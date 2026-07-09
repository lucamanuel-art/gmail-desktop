import { app, BrowserWindow, protocol, net, ipcMain, session, Menu, screen, dialog } from 'electron';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { release } from 'node:os';
import { pathToFileURL } from 'node:url';
import type { Tray } from 'electron';
import { parseChangelog, type ChangelogVersion } from './changelog';
import { ProfileViewManager, type Profile, type Surface } from './profile-view-manager';
import { SURFACES, surfacesForRef } from '../renderer/lib/surfaces';
import { accountKey, parseAccountKey, type AccountRef } from './account-ref';
import { DelegatedStore, type StoredDelegate } from './delegated-store';
import { SWITCHER_SCRAPE_JS, parseDelegatedEntries } from './delegation';
import { planDelegated } from './delegation-planner';
import { ColorStore } from './color-store';
import { RemovedStore } from './removed-store';
import { PrefsStore } from './prefs-store';
import { clampBoundsToDisplays } from './window-bounds';
import { colorForIndex } from './palette';
import { planNext } from './detection-planner';
import { addAccountUrl } from './google-urls';
import { applyBadge } from './badge-controller';
import { IPC } from './ipc';
import { shouldHideOnClose, createTray, updateTrayMenu, type TrayState, type TrayUpdateStatus } from './tray-controller';
import { autoUpdater } from 'electron-updater';
import { resolveShortcut, type KeyInput } from './shortcuts';
import { openCompose, openFullThreadWindow } from './compose-window';
import { sortByOrder } from './account-order';
import { notificationsAllowed } from './notification-policy';
import { updateCheckPopup } from './update-popup';
import { RENE_ZOOM_FACTOR, RENE_ZOOM_LEVEL } from './rene';

// WSL/WSLg has no usable GPU stack: Electron's GPU process fails to initialize
// and WSLg falls back to RDP "copy mode", leaving a black/degraded window. Force
// software rendering there so the dev window actually shows. Must be called
// before app 'ready'. No effect on the shipped Windows/macOS build.
if (process.platform === 'linux' && /microsoft|WSL/i.test(release())) {
  app.disableHardwareAcceleration();
}

const RENDERER_DIST = join(__dirname, '..', 'renderer', 'out');
const CHANGELOG_PATH = join(__dirname, '..', 'CHANGELOG.md');

// Read + parse the shipped CHANGELOG.md on demand. Returns [] if it's missing
// or unreadable so the "What's new" section simply hides rather than erroring.
function loadChangelog(): ChangelogVersion[] {
  try {
    return parseChangelog(readFileSync(CHANGELOG_PATH, 'utf8'));
  } catch {
    return [];
  }
}
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
let delegated: DelegatedStore | null = null;
let prefs: PrefsStore | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let settingsPanelOpen = false;
let updateRequested = false; // user pressed "Update now" → auto-install once downloaded
let pendingTrayUpdateCheck = false; // a check started from the tray → announce the result in a popup
let lastUpdateStatus: Record<string, unknown> = { state: 'idle' };

const SESSION_PARTITION = 'persist:google';

const profiles: Profile[] = [];
const seenEmails = new Set<string>();
const unreadCounts: Record<string, number> = {}; // keyed by accountKey
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

// --- account identity helpers ---
// The view layer and IPC now route by accountKey; the authuser detection state
// machine and the (unchanged) renderer still speak integer index. All accounts
// are authuser today — delegated mailboxes arrive with the later tasks and
// carry their own ref — so index <-> key is a clean bijection here.
const authRef = (index: number): AccountRef => ({ kind: 'authuser', index });
const keyOf = (p: Profile): string => accountKey(p.ref);
const keyOfIndex = (index: number): string => accountKey(authRef(index));
const authIdx = (p: Profile): number => (p.ref.kind === 'authuser' ? p.ref.index : -1);
const idxOfKey = (key: string): number | null => {
  const parsed = parseAccountKey(key);
  return parsed.kind === 'authuser' ? parsed.index : null;
};

// Stable-ish color for a delegated mailbox (no authuser index to key off).
function colorForEmail(email: string): string {
  let h = 0;
  for (let i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) | 0;
  return colorForIndex(Math.abs(h));
}

function delegatedProfileFor(d: StoredDelegate): Profile {
  const ref: AccountRef = {
    kind: 'delegated',
    email: d.email,
    mailUrl: d.mailUrl,
    calendarUrl: d.calendarUrl,
  };
  return {
    ref,
    kind: 'delegated',
    email: d.email,
    name: d.email, // no reliable display name from the switcher; email is honest
    avatarUrl: '',
    color: colors?.get(d.email) ?? colorForEmail(d.email),
  };
}

// Add sidebar profiles for every persisted delegated mailbox not already present
// (and not user-removed). Idempotent: skips emails already held as a profile.
function loadDelegatedProfiles(): void {
  if (!delegated) return;
  let added = false;
  for (const d of delegated.list()) {
    const email = d.email.toLowerCase();
    if (removed?.has(email)) continue;
    if (profiles.some((p) => p.email.toLowerCase() === email)) continue;
    profiles.push(delegatedProfileFor({ ...d, email }));
    added = true;
  }
  if (added) {
    pushProfiles();
    syncCalendarViews();
  }
}

// Scan the /u/0 account switcher (hidden view) for delegated mailboxes.
// Best-effort (scrapes Google's ogs widget) — returns [] on any failure.
async function scanSwitcherEntries(): Promise<Array<{ email: string; mailUrl: string }>> {
  if (!manager) return [];
  const raw = await manager.scrapeSwitcher(keyOfIndex(0), SWITCHER_SCRAPE_JS).catch(() => []);
  return parseDelegatedEntries(raw).map((e) => ({ email: e.email, mailUrl: e.mailUrl }));
}

// New delegates from the switcher not already owned, removed, or present.
function suggestableDelegates(
  entries: Array<{ email: string; mailUrl: string }>,
): Array<{ email: string; mailUrl: string }> {
  const removedKeys = removed?.list().map((e) => `d:${e.toLowerCase()}`) ?? [];
  return planDelegated(entries, [...seenEmails], removedKeys)
    .filter((e) => !profiles.some((p) => p.email.toLowerCase() === e.email))
    .map((e) => ({ email: e.email, mailUrl: e.mailUrl }));
}

async function scanDelegatedSuggestions(): Promise<Array<{ email: string; mailUrl: string }>> {
  return suggestableDelegates(await scanSwitcherEntries());
}

function pushDelegatedSuggestions(suggestions: Array<{ email: string; mailUrl: string }>): void {
  mainWindow?.webContents.send(IPC.DELEGATED_SUGGESTIONS, { suggestions });
}

// On launch: re-scan the switcher (hidden), refresh persisted /d/ URLs whose
// opaque token rotated (so stored mailboxes keep opening), and offer any newly
// discovered delegates as suggestions. Health check: a scan that finds fewer
// than we already hold is treated as "scrape probably broke" — we keep the
// store intact and skip refresh/suggestions rather than act on the emptiness.
let delegatedScanStarted = false;
async function refreshAndSuggestDelegated(): Promise<void> {
  if (!delegated || !manager) return;
  const entries = await scanSwitcherEntries();
  const stored = delegated.list();
  if (entries.length < stored.length) return; // likely broken scrape — don't touch anything
  const freshByEmail = new Map(entries.map((e) => [e.email.toLowerCase(), e.mailUrl]));
  let changed = false;
  for (const d of stored) {
    const fresh = freshByEmail.get(d.email.toLowerCase());
    if (!fresh || fresh === d.mailUrl) continue;
    delegated.upsert({ ...d, mailUrl: fresh }); // refresh the rotated token
    const p = profiles.find((x) => x.kind === 'delegated' && x.email.toLowerCase() === d.email.toLowerCase());
    if (p && p.ref.kind === 'delegated') {
      for (const s of SURFACES) manager.discardView(keyOf(p), s); // drop stale views; reload fresh on next show
      p.ref = { ...p.ref, mailUrl: fresh };
      changed = true;
    }
  }
  if (changed) pushProfiles();
  if (entries.length > 0) pushDelegatedSuggestions(suggestableDelegates(entries));
}

// Register a delegated mailbox (from click-through pick or an accepted
// suggestion): persist it, clear any prior removal, surface it, and show it.
function addDelegatedMailbox(email: string, mailUrl: string): void {
  if (!delegated) return;
  const e = email.trim().toLowerCase();
  if (!e || !mailUrl) return;
  if (profiles.some((p) => p.email.toLowerCase() === e)) return; // already have it
  removed?.remove(e); // an explicit add un-hides a previously removed mailbox
  const entry: StoredDelegate = { email: e, mailUrl, calendarUrl: null }; // calendar probe: Task 9
  delegated.upsert(entry);
  loadDelegatedProfiles(); // adds the profile + pushes to the sidebar
  showAccount({ kind: 'delegated', email: e, mailUrl, calendarUrl: null }, 'mail');
}

// Decorate for the sidebar renderer: the stable `key` (accountKey) it routes by,
// the `kind`, whether a calendar surface is offered, per-account prefs, and a
// derived `index` (authuser slot, -1 for delegated) still used by index-based
// helpers like the compose window and sortByOrder's fallback.
function decorate(list: Profile[]) {
  const withPrefs = list.map((p) => {
    const ap = prefs?.getAccount(p.email) ?? {};
    return {
      ...p,
      key: keyOf(p),
      kind: p.ref.kind,
      index: authIdx(p),
      hasCalendar: surfacesForRef(p.ref).includes('calendar'),
      order: ap.order,
      label: ap.label,
    };
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
  manager?.ensureView(authRef(index), 'mail', false); // hidden probe; identity arrives via onIdentity
  clearProbeTimer();
  // Never auto-discard index 0: it is the visible primary/login view and may take
  // arbitrarily long to sign in. Only forward probes (1+) get the discard timeout.
  if (index > 0) {
    probeTimer = setTimeout(() => {
      // No identity within the timeout: no account at this index. Discard and stop.
      manager?.discardView(keyOfIndex(index), 'mail');
      probeTimer = null;
      probingIndex = null;
    }, PROBE_TIMEOUT_MS);
  }
}

function onIdentity(index: number, identity: { email: string; name: string; avatarUrl: string }): void {
  // Ignore re-fired identity for an already-registered index: Gmail's SPA re-runs the
  // preload identity poll on full navigations, which would otherwise abort an in-flight
  // probe timer and spuriously advance/leak views.
  if (profiles.some((p) => authIdx(p) === index)) return;

  const email = identity?.email;
  const isVisibleAdd = visibleProbe === index;

  // Explicit "+"-add of a previously removed account un-hides it again.
  if (isVisibleAdd && email && removed!.has(email)) removed!.remove(email);

  // A hidden detect/redetect probe that lands on a removed account: skip it but
  // keep scanning later indexes (authuser indexes are contiguous).
  if (!isVisibleAdd && email && removed!.has(email)) {
    clearProbeTimer();
    probingIndex = null;
    manager?.discardView(keyOfIndex(index), 'mail');
    if (manager?.activeKey() == null && profiles[0]) switchSurface(authIdx(profiles[0]), 'mail');
    probe(index + 1);
    return;
  }

  const decision = planNext([...seenEmails], index, identity);
  clearProbeTimer();
  probingIndex = null;
  if (decision.register && identity.email) {
    seenEmails.add(identity.email);
    // If this same mailbox was showing as a delegated entry, the owned authuser
    // account supersedes it (same inbox) — drop the delegated duplicate.
    const dup = profiles.findIndex(
      (p) => p.kind === 'delegated' && p.email.toLowerCase() === identity.email.toLowerCase(),
    );
    if (dup !== -1) {
      for (const surface of SURFACES) manager?.discardView(keyOf(profiles[dup]), surface);
      profiles.splice(dup, 1);
    }
    const color = colors!.get(identity.email) ?? colorForIndex(index);
    profiles.push({
      ref: authRef(index),
      kind: 'authuser',
      email: identity.email,
      name: identity.name,
      avatarUrl: identity.avatarUrl,
      color,
    });
    profiles.sort((a, b) => authIdx(a) - authIdx(b));
    pushProfiles();
    refreshNotifyAllowed();
    syncCalendarViews();
    if (visibleProbe === index) {
      // A freshly added account (via the "+" flow): keep it on screen.
      switchSurface(index, 'mail');
      visibleProbe = null;
    } else if (manager?.activeKey() == null) {
      // Nothing visible yet (e.g. the primary account was removed/skipped):
      // surface the first account we successfully register.
      switchSurface(index, 'mail');
    }
  } else if (index > 0) {
    manager?.discardView(keyOfIndex(index), 'mail'); // duplicate/empty probe view
    if (visibleProbe === index) {
      // Add cancelled or a duplicate account: fall back to a real view so the
      // user isn't left staring at a torn-down blank surface.
      visibleProbe = null;
      if (profiles[0]) switchSurface(authIdx(profiles[0]), 'mail');
    }
  }
  if (!decision.stop) probe(index + 1);
}

function removeAccount(email: string): void {
  removed!.add(email); // persist so detection skips it from now on
  const profile = profiles.find((p) => p.email === email);
  if (!profile) return;
  if (profile.kind === 'delegated') delegated?.remove(email); // stop persisting it
  const wasActive = manager?.activeKey() === keyOf(profile);
  profiles.splice(profiles.indexOf(profile), 1);
  seenEmails.delete(email);
  delete unreadCounts[keyOf(profile)];
  for (const surface of SURFACES) manager?.discardView(keyOf(profile), surface);
  pushProfiles();
  pushUnread();
  applyBadge(unreadCounts, (n) => app.setBadgeCount(n));
  if (wasActive && profiles[0]) showAccount(profiles[0].ref, 'mail');
}

// Show an account's surface (creates the view lazily) and re-gate notifications.
function showAccount(ref: AccountRef, surface: Surface): void {
  manager?.show(ref, surface);
  // A first switch to an app surface just created its view; gate it right away
  // (the app surfaces never notify in v1) instead of on the next 60s tick.
  refreshNotifyAllowed();
}
// Authuser convenience used by the index-based detection state machine.
function switchSurface(index: number, surface: Surface): void {
  showAccount(authRef(index), surface);
}

function startDetection(): void {
  switchSurface(0, 'mail'); // visible; user logs in; onIdentity(0,...) drives the rest
}

function redetect(): void {
  clearProbeTimer();
  // Tear down a probe view still in flight so repeated re-detects don't orphan hidden views.
  if (probingIndex !== null && !profiles.some((p) => authIdx(p) === probingIndex)) {
    manager?.discardView(keyOfIndex(probingIndex), 'mail');
  }
  probingIndex = null;
  const maxIndex = profiles.length ? Math.max(...profiles.map((p) => authIdx(p))) : -1;
  probe(maxIndex + 1);
}

function addAccount(): void {
  // Unlike redetect (hidden probe), open Google's add-session flow in a *visible*
  // view so the user can sign into a brand-new account. onIdentity registers it
  // once Gmail loads. No discard timer here — signing in can take a while.
  clearProbeTimer();
  if (probingIndex !== null && !profiles.some((p) => authIdx(p) === probingIndex)) {
    manager?.discardView(keyOfIndex(probingIndex), 'mail');
  }
  const nextIndex = profiles.length ? Math.max(...profiles.map((p) => authIdx(p))) + 1 : 0;
  probingIndex = nextIndex;
  visibleProbe = nextIndex;
  manager?.ensureView(authRef(nextIndex), 'mail', true, addAccountUrl());
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

// The shortcut always acts on the currently active view (queried from the
// manager), so the originating account identity isn't needed here.
function handleInput(input: KeyInput): void {
  const action = resolveShortcut(input);
  if (!action) return;
  if (action.type === 'switch') {
    const ordered = [...profiles].sort((a, b) => (a.order ?? authIdx(a)) - (b.order ?? authIdx(b)));
    const target = ordered[action.n - 1];
    if (target) showAccount(target.ref, 'mail');
  } else if (action.type === 'compose') {
    const activeKey = manager?.activeKey();
    const active = activeKey ? idxOfKey(activeKey) : null;
    if (active != null) openCompose(active);
  } else if (action.type === 'zoom') {
    if (prefs?.getAll().reneMode) return; // Rene mode pins everything at 200%
    const activeKey = manager?.activeKey();
    if (activeKey == null) return;
    const current = manager!.getActiveZoomLevel();
    const level = action.dir === 'reset' ? 0 : current + (action.dir === 'in' ? 0.5 : -0.5);
    const clamped = Math.max(-3, Math.min(3, level));
    manager!.setZoomForKey(activeKey, clamped);
    const email = profiles.find((p) => keyOf(p) === activeKey)?.email;
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
    manager?.setZoomForKey(keyOf(p), on ? RENE_ZOOM_LEVEL : prefs.getAccount(p.email).zoom ?? 0);
  }
  manager?.relayout();
}

let notifyTimer: ReturnType<typeof setInterval> | null = null;
function refreshNotifyAllowed(): void {
  if (!prefs) return;
  let p = prefs.getAll();
  const now = new Date();
  // Auto-expire a timed snooze on the minute tick so the gate reopens and the
  // tray label/checkbox don't keep showing a time that's already passed.
  if (p.notifications.dndUntil && now.getTime() >= p.notifications.dndUntil) {
    prefs.setNotifications({ ...p.notifications, dndUntil: undefined });
    p = prefs.getAll();
    pushPrefs();
    refreshTray();
  }
  for (const profile of profiles) {
    for (const surface of SURFACES) {
      manager?.pushNotifyAllowed(keyOf(profile), surface, notificationsAllowed(p, profile.email, now, surface));
    }
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
      manager.ensureView(profile.ref, 'calendar', false);
    } else if (!manager.isShowing(keyOf(profile), 'calendar')) {
      manager.discardView(keyOf(profile), 'calendar');
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
  delegated = new DelegatedStore(join(app.getPath('userData'), 'delegated.json'));
  manager = new ProfileViewManager(
    mainWindow,
    PRELOAD_PATH,
    (accountKey, count) => {
      unreadCounts[accountKey] = count;
      pushUnread();
      applyBadge(unreadCounts, (n) => app.setBadgeCount(n));
    },
    (accountKey, surface, threadId) => {
      const idx = idxOfKey(accountKey);
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
      if (threadId && surface === 'mail') manager?.markNotificationClickHandled(accountKey, 'mail');
      const windowMode = prefs?.getAll().notificationOpen === 'window';
      // "Open in a new window" mode: open the thread in the mail view so Gmail's
      // own pop-out button exists, then trigger it for a focused reading window.
      // Fall back to a full thread window if the button can't be found.
      if (threadId && surface === 'mail' && windowMode) {
        manager?.openMailThread(accountKey, threadId);
        void manager?.popOutThread(accountKey).then((ok) => {
          if (!ok && idx != null) openFullThreadWindow(idx, threadId);
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
      if (idx != null) switchSurface(idx, surface);
      // "In the app" mode: also open the clicked thread in that mail view.
      if (threadId && surface === 'mail') manager?.openMailThread(accountKey, threadId);
    },
    (accountKey, identity) => {
      const idx = idxOfKey(accountKey);
      if (idx != null) onIdentity(idx, identity);
    },
    (_accountKey, input) => handleInput(input),
    (accountKey) => {
      if (prefs?.getAll().reneMode) return RENE_ZOOM_LEVEL;
      const email = profiles.find((p) => keyOf(p) === accountKey)?.email;
      return email ? prefs!.getAccount(email).zoom ?? 0 : 0;
    },
    () => prefs?.getAll().notificationOpen ?? 'app',
    () => (prefs?.getAll().reneMode ? RENE_ZOOM_FACTOR : 1),
  );

  if (DEV_URL) void mainWindow.loadURL(DEV_URL);
  else void mainWindow.loadURL('app://bundle/');

  mainWindow.webContents.on('did-finish-load', () => {
    loadDelegatedProfiles(); // surface persisted delegated mailboxes immediately
    pushProfiles(); // re-push on any (re)load so the sidebar repopulates
    pushPrefs();
    if (!delegatedScanStarted) {
      delegatedScanStarted = true;
      // Delay so the /u/0 mail view is loaded before we scrape its switcher.
      setTimeout(() => void refreshAndSuggestDelegated(), 7000);
    }
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
    handleInput(input as unknown as KeyInput);
  });
}

function sendUpdate(status: Record<string, unknown>): void {
  lastUpdateStatus = { ...status, currentVersion: app.getVersion() };
  mainWindow?.webContents.send(IPC.UPDATE_STATUS, lastUpdateStatus);
  refreshTray(); // keep the tray's update label in sync with each status transition
  maybeShowTrayUpdatePopup();
}

// Bring the window forward and open the Settings panel (where the update section
// lives). Used by the tray "Check for updates" item.
function openSettingsPanel(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  settingsPanelOpen = true;
  manager?.hideAll();
  mainWindow.webContents.send(IPC.SETTINGS_FORCE_OPEN);
}

// Tray "Check for updates": open settings so the user sees the update section,
// then run the check and announce the terminal result in a small popup.
function checkForUpdateFromTray(): void {
  openSettingsPanel();
  pendingTrayUpdateCheck = true;
  checkForUpdate();
}

function maybeShowTrayUpdatePopup(): void {
  if (!pendingTrayUpdateCheck) return;
  const popup = updateCheckPopup(lastUpdateStatus as { state: string });
  if (!popup) return; // still checking/downloading — wait for a terminal result
  pendingTrayUpdateCheck = false;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  void dialog
    .showMessageBox(mainWindow, {
      type: 'info',
      title: 'Gmail Desktop',
      message: popup.message,
      detail: popup.detail,
      buttons: popup.buttons,
      defaultId: 0,
      cancelId: popup.buttons.length - 1,
      noLink: true,
    })
    .then((res) => {
      if (popup.downloadButtonIndex != null && res.response === popup.downloadButtonIndex) {
        downloadUpdate();
      }
    });
}

// Update / autostart / snooze actions are factored out so both the IPC handlers
// (settings UI) and the tray menu invoke the exact same logic.
function checkForUpdate(): void {
  if (!app.isPackaged) return sendUpdate({ state: 'dev' });
  sendUpdate({ state: 'checking' });
  autoUpdater
    .checkForUpdates()
    .catch((err) => sendUpdate({ state: 'error', message: String(err?.message || err) }));
}
function downloadUpdate(): void {
  updateRequested = true;
  autoUpdater
    .downloadUpdate()
    .catch((err) => sendUpdate({ state: 'error', message: String(err?.message || err) }));
}
function installUpdate(): void {
  isQuitting = true;
  autoUpdater.quitAndInstall();
}
function setAutoStart(v: boolean): void {
  prefs!.setAutoStart(v);
  app.setLoginItemSettings({ openAtLogin: v });
  pushPrefs();
  refreshTray();
}
// minutes: a positive number sets a timed snooze; null mutes indefinitely
// ("until I turn it back on"); 0 clears any active mute.
function setSnooze(minutes: number | null): void {
  if (!prefs) return;
  const n = prefs.getAll().notifications;
  if (minutes === null) prefs.setNotifications({ ...n, dnd: true, dndUntil: undefined });
  else if (minutes <= 0) prefs.setNotifications({ ...n, dnd: false, dndUntil: undefined });
  else prefs.setNotifications({ ...n, dnd: false, dndUntil: Date.now() + minutes * 60_000 });
  pushPrefs();
  refreshNotifyAllowed();
  refreshTray();
}
function clearSnooze(): void {
  setSnooze(0);
}

function getTrayState(): TrayState {
  const p = prefs?.getAll();
  return {
    onOpen: () => mainWindow?.show(),
    onQuit: () => {
      isQuitting = true;
      app.quit();
    },
    isPackaged: app.isPackaged,
    updateStatus: lastUpdateStatus as unknown as TrayUpdateStatus,
    onCheckUpdate: checkForUpdateFromTray,
    onDownloadUpdate: downloadUpdate,
    onInstallUpdate: installUpdate,
    autoStart: p?.autoStart ?? false,
    onToggleAutoStart: setAutoStart,
    dnd: p?.notifications.dnd ?? false,
    dndUntil: p?.notifications.dndUntil,
    now: Date.now(),
    onSnooze: setSnooze,
    onClearSnooze: clearSnooze,
  };
}
function refreshTray(): void {
  if (tray) updateTrayMenu(tray, getTrayState());
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
  ipcMain.on(IPC.SWITCH_SURFACE, (_e, arg: { key: string; surface: Surface }) => {
    const p = profiles.find((x) => keyOf(x) === arg.key);
    if (p) showAccount(p.ref, arg.surface);
  });
  ipcMain.on(IPC.REDETECT, () => redetect());
  ipcMain.on(IPC.ADD_ACCOUNT, () => addAccount());
  // Open the account switcher and offer the delegated mailboxes found there.
  ipcMain.on(IPC.ADD_DELEGATED, () => {
    void scanDelegatedSuggestions().then(pushDelegatedSuggestions);
  });
  ipcMain.on(IPC.ADD_DELEGATED_SUGGESTION, (_e, arg: { email: string; mailUrl: string }) =>
    addDelegatedMailbox(arg.email, arg.mailUrl),
  );
  ipcMain.on(IPC.SET_COLOR, (_e, arg: { email: string; color: string }) => {
    colors!.set(arg.email, arg.color);
    const p = profiles.find((x) => x.email === arg.email);
    if (p) {
      p.color = arg.color;
      pushProfiles();
    }
  });
  ipcMain.on(IPC.REMOVE_ACCOUNT, (_e, arg: { email: string }) => removeAccount(arg.email));
  ipcMain.on(IPC.UPDATE_CHECK, () => checkForUpdate());
  ipcMain.on(IPC.UPDATE_DOWNLOAD, () => downloadUpdate());
  ipcMain.on(IPC.UPDATE_INSTALL, () => installUpdate());
  ipcMain.on(IPC.SETTINGS_TOGGLE, (_e, arg: { open: boolean }) => {
    settingsPanelOpen = arg.open;
    if (arg.open) manager?.hideAll();
    else manager?.showActive();
  });
  ipcMain.on(IPC.SET_AUTO_START, (_e, v: boolean) => setAutoStart(v));
  ipcMain.on(IPC.SET_SNOOZE, (_e, minutes: number | null) => setSnooze(minutes));
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
      refreshTray(); // a settings-driven DND change should re-label the tray too
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
  ipcMain.handle(IPC.CHANGELOG_GET, () => loadChangelog());
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
  tray = createTray(ICON_PATH, getTrayState());
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
