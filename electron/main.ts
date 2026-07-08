import { app, BrowserWindow, protocol, net, ipcMain, session, Menu, screen } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Tray } from 'electron';
import { ProfileViewManager, type Profile, type Surface } from './profile-view-manager';
import { ColorStore } from './color-store';
import { RemovedStore } from './removed-store';
import { PrefsStore } from './prefs-store';
import { clampBoundsToDisplays } from './window-bounds';
import { colorForIndex } from './palette';
import { planNext } from './detection-planner';
import { addAccountUrl } from './google-urls';
import { applyBadge } from './badge-controller';
import { IPC } from './ipc';
import { shouldHideOnClose, createTray } from './tray-controller';
import { autoUpdater } from 'electron-updater';
import { resolveShortcut, type KeyInput } from './shortcuts';
import { openCompose, openFullThreadWindow } from './compose-window';
import { sortByOrder } from './account-order';
import { notificationsAllowed } from './notification-policy';
import { RENE_ZOOM_FACTOR, RENE_ZOOM_LEVEL } from './rene';

const RENDERER_DIST = join(__dirname, '..', 'renderer', 'out');
const PRELOAD_PATH = join(__dirname, 'preload.js');
const SIDEBAR_PRELOAD_PATH = join(__dirname, 'sidebar-preload.js');
// Bundled app icon. Resolves to <project>/assets/icon.png in dev and to
// app.asar/assets/icon.png when packaged (assets/** is in electron-builder files).
const ICON_PATH = join(app.getAppPath(), 'assets', 'icon.png');
const DEV_URL = process.env.ELECTRON_RENDERER_URL;
const PROBE_TIMEOUT_MS = 16000; // > preload identity poll window (~15s) so slow accounts aren't missed

let mainWindow: BrowserWindow | null = null;
let manager: ProfileViewManager | null = null;
let colors: ColorStore | null = null;
let removed: RemovedStore | null = null;
let prefs: PrefsStore | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let settingsPanelOpen = false;
let updateRequested = false; // user pressed "Update now" → auto-install once downloaded
let lastUpdateStatus: Record<string, unknown> = { state: 'idle' };

const SESSION_PARTITION = 'persist:google';

const profiles: Profile[] = [];
const seenEmails = new Set<string>();
const unreadCounts: Record<number, number> = {};
let probeTimer: ReturnType<typeof setTimeout> | null = null;
let probingIndex: number | null = null;
// Index of a *visible* probe (the "+ add account" flow) awaiting identity, vs
// the hidden auto-detect probes. Lets us keep a freshly added account on screen
// and restore a real view if the add is cancelled/duplicate.
let visibleProbe: number | null = null;
let detectionStarted = false;

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function registerAppProtocol(): void {
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    return net.fetch(pathToFileURL(join(RENDERER_DIST, rel)).toString());
  });
}

function decorate(list: Profile[]): Profile[] {
  const withPrefs = list.map((p) => {
    const ap = prefs?.getAccount(p.email) ?? {};
    return { ...p, order: ap.order, label: ap.label };
  });
  return sortByOrder(withPrefs);
}
function pushProfiles(): void {
  mainWindow?.webContents.send(IPC.PROFILES_CHANGED, decorate([...profiles]));
}
function pushUnread(): void {
  mainWindow?.webContents.send(IPC.UNREAD_CHANGED, { ...unreadCounts });
}
function pushPrefs(): void {
  if (prefs) mainWindow?.webContents.send(IPC.PREFS_CHANGED, prefs.getAll());
}

function clearProbeTimer(): void {
  if (probeTimer) {
    clearTimeout(probeTimer);
    probeTimer = null;
  }
}

function probe(index: number): void {
  probingIndex = index;
  manager?.ensureView(index, 'mail', false); // hidden probe; identity arrives via onIdentity
  clearProbeTimer();
  // Never auto-discard index 0: it is the visible primary/login view and may take
  // arbitrarily long to sign in. Only forward probes (1+) get the discard timeout.
  if (index > 0) {
    probeTimer = setTimeout(() => {
      // No identity within the timeout: no account at this index. Discard and stop.
      manager?.discardView(index, 'mail');
      probeTimer = null;
      probingIndex = null;
    }, PROBE_TIMEOUT_MS);
  }
}

function onIdentity(index: number, identity: { email: string; name: string; avatarUrl: string }): void {
  // Ignore re-fired identity for an already-registered index: Gmail's SPA re-runs the
  // preload identity poll on full navigations, which would otherwise abort an in-flight
  // probe timer and spuriously advance/leak views.
  if (profiles.some((p) => p.index === index)) return;

  const email = identity?.email;
  const isVisibleAdd = visibleProbe === index;

  // Explicit "+"-add of a previously removed account un-hides it again.
  if (isVisibleAdd && email && removed!.has(email)) removed!.remove(email);

  // A hidden detect/redetect probe that lands on a removed account: skip it but
  // keep scanning later indexes (authuser indexes are contiguous).
  if (!isVisibleAdd && email && removed!.has(email)) {
    clearProbeTimer();
    probingIndex = null;
    manager?.discardView(index, 'mail');
    if (manager?.activeIndex() == null && profiles[0]) switchSurface(profiles[0].index, 'mail');
    probe(index + 1);
    return;
  }

  const decision = planNext([...seenEmails], index, identity);
  clearProbeTimer();
  probingIndex = null;
  if (decision.register && identity.email) {
    seenEmails.add(identity.email);
    const color = colors!.get(identity.email) ?? colorForIndex(index);
    profiles.push({ index, email: identity.email, name: identity.name, avatarUrl: identity.avatarUrl, color });
    profiles.sort((a, b) => a.index - b.index);
    pushProfiles();
    refreshNotifyAllowed();
    syncCalendarViews();
    if (visibleProbe === index) {
      // A freshly added account (via the "+" flow): keep it on screen.
      switchSurface(index, 'mail');
      visibleProbe = null;
    } else if (manager?.activeIndex() == null) {
      // Nothing visible yet (e.g. the primary account was removed/skipped):
      // surface the first account we successfully register.
      switchSurface(index, 'mail');
    }
  } else if (index > 0) {
    manager?.discardView(index, 'mail'); // duplicate/empty probe view
    if (visibleProbe === index) {
      // Add cancelled or a duplicate account: fall back to a real view so the
      // user isn't left staring at a torn-down blank surface.
      visibleProbe = null;
      if (profiles[0]) switchSurface(profiles[0].index, 'mail');
    }
  }
  if (!decision.stop) probe(index + 1);
}

function removeAccount(email: string): void {
  removed!.add(email); // persist so detection skips it from now on
  const profile = profiles.find((p) => p.email === email);
  if (!profile) return;
  const idx = profile.index;
  const wasActive = manager?.activeIndex() === idx;
  profiles.splice(profiles.indexOf(profile), 1);
  seenEmails.delete(email);
  delete unreadCounts[idx];
  manager?.discardView(idx, 'mail');
  manager?.discardView(idx, 'calendar');
  pushProfiles();
  pushUnread();
  applyBadge(unreadCounts as unknown as Record<string, number>, (n) => app.setBadgeCount(n));
  if (wasActive && profiles[0]) switchSurface(profiles[0].index, 'mail');
}

function switchSurface(index: number, surface: Surface): void {
  manager?.show(index, surface);
}

function startDetection(): void {
  switchSurface(0, 'mail'); // visible; user logs in; onIdentity(0,...) drives the rest
}

function redetect(): void {
  clearProbeTimer();
  // Tear down a probe view still in flight so repeated re-detects don't orphan hidden views.
  if (probingIndex !== null && !profiles.some((p) => p.index === probingIndex)) {
    manager?.discardView(probingIndex, 'mail');
  }
  probingIndex = null;
  const maxIndex = profiles.length ? Math.max(...profiles.map((p) => p.index)) : -1;
  probe(maxIndex + 1);
}

function addAccount(): void {
  // Unlike redetect (hidden probe), open Google's add-session flow in a *visible*
  // view so the user can sign into a brand-new account. onIdentity registers it
  // once Gmail loads. No discard timer here — signing in can take a while.
  clearProbeTimer();
  if (probingIndex !== null && !profiles.some((p) => p.index === probingIndex)) {
    manager?.discardView(probingIndex, 'mail');
  }
  const nextIndex = profiles.length ? Math.max(...profiles.map((p) => p.index)) + 1 : 0;
  probingIndex = nextIndex;
  visibleProbe = nextIndex;
  manager?.ensureView(nextIndex, 'mail', true, addAccountUrl());
}

let saveBoundsTimer: ReturnType<typeof setTimeout> | null = null;
function saveWindowBounds(): void {
  if (!mainWindow || mainWindow.isDestroyed() || !prefs) return;
  const maximized = mainWindow.isMaximized();
  const b = mainWindow.getNormalBounds();
  prefs.setWindow({ width: b.width, height: b.height, x: b.x, y: b.y, maximized });
}
function scheduleSaveBounds(): void {
  if (saveBoundsTimer) clearTimeout(saveBoundsTimer);
  saveBoundsTimer = setTimeout(saveWindowBounds, 400);
}

function handleInput(index: number, input: KeyInput): void {
  const action = resolveShortcut(input);
  if (!action) return;
  if (action.type === 'switch') {
    const ordered = [...profiles].sort((a, b) => (a.order ?? a.index) - (b.order ?? b.index));
    const target = ordered[action.n - 1];
    if (target) switchSurface(target.index, 'mail');
  } else if (action.type === 'compose') {
    const active = manager?.activeIndex();
    if (active != null) openCompose(active);
  } else if (action.type === 'zoom') {
    if (prefs?.getAll().reneMode) return; // Rene mode pins everything at 200%
    const active = manager?.activeIndex();
    if (active == null) return;
    const current = manager!.getActiveZoomLevel();
    const level = action.dir === 'reset' ? 0 : current + (action.dir === 'in' ? 0.5 : -0.5);
    const clamped = Math.max(-3, Math.min(3, level));
    manager!.setZoomForIndex(active, clamped);
    const email = profiles.find((p) => p.index === active)?.email;
    if (email) prefs!.setAccount(email, { zoom: clamped });
  }
}

// Rene mode: zoom the sidebar renderer and every Gmail/Calendar view to 200%
// (or restore factor 1 and each account's own stored zoom), then relayout so
// the content view clears the now-wider sidebar.
function applyReneZoom(): void {
  if (!prefs || !mainWindow || mainWindow.isDestroyed()) return;
  const on = prefs.getAll().reneMode;
  mainWindow.webContents.setZoomFactor(on ? RENE_ZOOM_FACTOR : 1);
  for (const p of profiles) {
    manager?.setZoomForIndex(p.index, on ? RENE_ZOOM_LEVEL : prefs.getAccount(p.email).zoom ?? 0);
  }
  manager?.relayout();
}

let notifyTimer: ReturnType<typeof setInterval> | null = null;
function refreshNotifyAllowed(): void {
  if (!prefs) return;
  const p = prefs.getAll();
  const now = new Date();
  for (const profile of profiles) {
    manager?.pushNotifyAllowed(profile.index, 'mail', notificationsAllowed(p, profile.email, now, 'mail'));
    manager?.pushNotifyAllowed(profile.index, 'calendar', notificationsAllowed(p, profile.email, now, 'calendar'));
  }
}
function startNotifyTimer(): void {
  if (notifyTimer) return;
  // Quiet-hours boundaries only change on the minute; re-evaluate each minute.
  notifyTimer = setInterval(refreshNotifyAllowed, 60_000);
}

// Keep a hidden calendar view alive for each account with calendar reminders
// enabled, so Google Calendar fires its native reminders in the background.
// Views for disabled accounts are torn down (unless currently shown) to free memory.
function syncCalendarViews(): void {
  if (!prefs || !manager) return;
  for (const profile of profiles) {
    const enabled = prefs.getAccount(profile.email).calendarNotify === true;
    if (enabled) {
      manager.ensureView(profile.index, 'calendar', false);
    } else if (!manager.isShowing(profile.index, 'calendar')) {
      manager.discardView(profile.index, 'calendar');
    }
  }
  refreshNotifyAllowed(); // push flags to any newly created calendar views
}

function createWindow(): void {
  prefs = new PrefsStore(join(app.getPath('userData'), 'prefs.json'));
  const stored = prefs.getAll().window;
  const bounds = clampBoundsToDisplays(
    { width: stored.width, height: stored.height, x: stored.x, y: stored.y },
    screen.getAllDisplays().map((d) => ({ bounds: d.bounds })),
  );
  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    backgroundColor: '#0a0a0a',
    icon: ICON_PATH,
    webPreferences: { preload: SIDEBAR_PRELOAD_PATH, contextIsolation: true },
  });
  if (stored.maximized) mainWindow.maximize();
  colors = new ColorStore(join(app.getPath('userData'), 'colors.json'));
  removed = new RemovedStore(join(app.getPath('userData'), 'removed.json'));
  manager = new ProfileViewManager(
    mainWindow,
    PRELOAD_PATH,
    (index, count) => {
      unreadCounts[index] = count;
      pushUnread();
      applyBadge(unreadCounts as unknown as Record<string, number>, (n) => app.setBadgeCount(n));
    },
    (index, surface, threadId) => {
      // The main window may have been torn down (some setups actually destroy it
      // on close rather than hiding to the tray) while hidden views still fire
      // events. Rebuild it so a notification click brings the app back instead of
      // crashing on a destroyed window. Skip while quitting (don't resurrect).
      if (!mainWindow || mainWindow.isDestroyed()) {
        if (isQuitting) return;
        detectionStarted = false;
        createWindow();
        return;
      }
      // The app opens the clicked thread itself; Gmail's own click handler may
      // fire window.open with the same thread right after — suppress that
      // (genuine pop-out windows are exempted in windowOpenAction).
      if (threadId && surface === 'mail') manager?.markNotificationClickHandled(index, 'mail');
      const windowMode = prefs?.getAll().notificationOpen === 'window';
      // "Open in a new window" mode: open the thread in the mail view so Gmail's
      // own pop-out button exists, then trigger it for a focused reading window.
      // Fall back to a full thread window if the button can't be found.
      if (threadId && surface === 'mail' && windowMode) {
        manager?.openMailThread(index, threadId);
        void manager?.popOutThread(index).then((ok) => {
          if (!ok) openFullThreadWindow(index, threadId);
        });
        return;
      }
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
      if (settingsPanelOpen) {
        settingsPanelOpen = false;
        mainWindow?.webContents.send(IPC.SETTINGS_FORCE_CLOSE);
      }
      switchSurface(index, surface);
      // "In the app" mode: also open the clicked thread in that mail view.
      if (threadId && surface === 'mail') manager?.openMailThread(index, threadId);
    },
    (index, identity) => onIdentity(index, identity),
    (index, input) => handleInput(index, input),
    (index) => {
      if (prefs?.getAll().reneMode) return RENE_ZOOM_LEVEL;
      const email = profiles.find((p) => p.index === index)?.email;
      return email ? prefs!.getAccount(email).zoom ?? 0 : 0;
    },
    () => prefs?.getAll().notificationOpen ?? 'app',
    () => (prefs?.getAll().reneMode ? RENE_ZOOM_FACTOR : 1),
  );

  if (DEV_URL) void mainWindow.loadURL(DEV_URL);
  else void mainWindow.loadURL('app://bundle/');

  mainWindow.webContents.on('did-finish-load', () => {
    pushProfiles(); // re-push on any (re)load so the sidebar repopulates
    pushPrefs();
    applyReneZoom(); // a (re)load resets the renderer's zoom factor
    mainWindow?.webContents.send(IPC.UPDATE_STATUS, { ...lastUpdateStatus, currentVersion: app.getVersion() });
    if (!detectionStarted) {
      detectionStarted = true;
      startDetection();
    }
  });

  mainWindow.on('close', (e) => {
    if (shouldHideOnClose({ isQuitting, platform: process.platform })) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('resize', scheduleSaveBounds);
  mainWindow.on('move', scheduleSaveBounds);
  mainWindow.on('close', saveWindowBounds);
  mainWindow.on('closed', () => {
    if (saveBoundsTimer) clearTimeout(saveBoundsTimer);
    mainWindow = null;
  });

  mainWindow.webContents.on('before-input-event', (_e, input) => {
    const active = manager?.activeIndex() ?? 0;
    handleInput(active, input as unknown as KeyInput);
  });
}

function sendUpdate(status: Record<string, unknown>): void {
  lastUpdateStatus = { ...status, currentVersion: app.getVersion() };
  mainWindow?.webContents.send(IPC.UPDATE_STATUS, lastUpdateStatus);
}

function setupUpdater(): void {
  autoUpdater.autoDownload = false; // download only when the user asks
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => sendUpdate({ state: 'checking' }));
  autoUpdater.on('update-available', (info) => sendUpdate({ state: 'available', version: info.version }));
  autoUpdater.on('update-not-available', (info) => sendUpdate({ state: 'not-available', version: info.version }));
  autoUpdater.on('error', (err) => sendUpdate({ state: 'error', message: String(err?.message || err) }));
  autoUpdater.on('download-progress', (p) => sendUpdate({ state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => {
    sendUpdate({ state: 'downloaded', version: info.version });
    if (updateRequested) {
      isQuitting = true;
      autoUpdater.quitAndInstall();
    }
  });
}

function setupNotifications(): void {
  // Windows shows/attributes native notifications by AppUserModelID; without it
  // Gmail's desktop notifications silently don't appear.
  if (process.platform === 'win32') app.setAppUserModelId('com.gmaildesktop.app');
  // Grant notification (and related) permissions for the shared Google session.
  // Only trusted Google domains ever load in these views, so a blanket grant is
  // safe here and is what lets Gmail's HTML5 notifications actually fire.
  const ses = session.fromPartition(SESSION_PARTITION);
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(true));
  ses.setPermissionCheckHandler(() => true);
}

function registerIpc(): void {
  ipcMain.on(IPC.SWITCH_SURFACE, (_e, arg: { index: number; surface: Surface }) =>
    switchSurface(arg.index, arg.surface),
  );
  ipcMain.on(IPC.REDETECT, () => redetect());
  ipcMain.on(IPC.ADD_ACCOUNT, () => addAccount());
  ipcMain.on(IPC.SET_COLOR, (_e, arg: { email: string; color: string }) => {
    colors!.set(arg.email, arg.color);
    const p = profiles.find((x) => x.email === arg.email);
    if (p) {
      p.color = arg.color;
      pushProfiles();
    }
  });
  ipcMain.on(IPC.REMOVE_ACCOUNT, (_e, arg: { email: string }) => removeAccount(arg.email));
  ipcMain.on(IPC.UPDATE_CHECK, () => {
    if (!app.isPackaged) return sendUpdate({ state: 'dev' });
    sendUpdate({ state: 'checking' });
    autoUpdater
      .checkForUpdates()
      .catch((err) => sendUpdate({ state: 'error', message: String(err?.message || err) }));
  });
  ipcMain.on(IPC.UPDATE_DOWNLOAD, () => {
    updateRequested = true;
    autoUpdater
      .downloadUpdate()
      .catch((err) => sendUpdate({ state: 'error', message: String(err?.message || err) }));
  });
  ipcMain.on(IPC.UPDATE_INSTALL, () => {
    isQuitting = true;
    autoUpdater.quitAndInstall();
  });
  ipcMain.on(IPC.SETTINGS_TOGGLE, (_e, arg: { open: boolean }) => {
    settingsPanelOpen = arg.open;
    if (arg.open) manager?.hideAll();
    else manager?.showActive();
  });
  ipcMain.on(IPC.SET_AUTO_START, (_e, v: boolean) => {
    prefs!.setAutoStart(v);
    app.setLoginItemSettings({ openAtLogin: v });
    pushPrefs();
  });
  ipcMain.on(IPC.SET_ACCOUNT_PREF, (_e, arg: { email: string; label?: string; notify?: boolean; calendarNotify?: boolean }) => {
    const patch: Record<string, unknown> = {};
    if ('label' in arg) patch.label = arg.label;
    if ('notify' in arg) patch.notify = arg.notify;
    if ('calendarNotify' in arg) patch.calendarNotify = arg.calendarNotify;
    prefs!.setAccount(arg.email, patch);
    pushProfiles();
    pushPrefs(); // keep the settings UI's per-account toggles in sync with what was stored
    refreshNotifyAllowed();
    syncCalendarViews();
  });
  ipcMain.on(IPC.SET_ACCOUNT_ORDER, (_e, arg: { emails: string[] }) => {
    prefs!.setOrder(arg.emails);
    pushProfiles();
  });
  ipcMain.on(
    IPC.SET_NOTIFICATIONS,
    (_e, arg: { dnd: boolean; quietHours: { enabled: boolean; start: string; end: string } }) => {
      prefs!.setNotifications(arg);
      pushPrefs();
      refreshNotifyAllowed();
    },
  );
  ipcMain.on(IPC.SET_THEME, (_e, theme: 'system' | 'light' | 'dark') => {
    prefs!.setTheme(theme);
    pushPrefs();
  });
  ipcMain.on(IPC.SET_NOTIFICATION_OPEN, (_e, v: 'app' | 'window') => {
    prefs!.setNotificationOpen(v);
    pushPrefs();
  });
  ipcMain.on(IPC.SET_RENE_MODE, (_e, v: boolean) => {
    prefs!.setReneMode(v === true);
    applyReneZoom();
    pushPrefs();
  });
}

// Single-instance: closing the window keeps the process alive in the tray, so a
// second launch must focus the existing window instead of starting a duplicate.
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  });
}

app.whenReady().then(() => {
  if (!gotTheLock) return; // a primary instance is already running
  Menu.setApplicationMenu(null); // drop the default File/Edit/View… menu bar
  registerAppProtocol();
  setupNotifications();
  registerIpc();
  createWindow();
  startNotifyTimer();
  app.setLoginItemSettings({ openAtLogin: prefs!.getAll().autoStart });
  tray = createTray(ICON_PATH, {
    onOpen: () => mainWindow?.show(),
    onQuit: () => {
      isQuitting = true;
      app.quit();
    },
  });
  void tray;
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  // Auto-update from GitHub Releases (packaged builds only; no-op in dev).
  setupUpdater();
  if (app.isPackaged) {
    autoUpdater
      .checkForUpdates()
      .catch((err) => sendUpdate({ state: 'error', message: String(err?.message || err) }));
  }
});

app.on('window-all-closed', () => {
  // Kept running in the tray; quit only via the tray menu.
});
app.on('before-quit', () => {
  isQuitting = true;
});
