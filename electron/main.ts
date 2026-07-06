import { app, BrowserWindow, protocol, net, ipcMain } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Tray } from 'electron';
import { ProfileViewManager, type Profile, type Surface } from './profile-view-manager';
import { ColorStore } from './color-store';
import { colorForIndex } from './palette';
import { planNext } from './detection-planner';
import { applyBadge } from './badge-controller';
import { IPC } from './ipc';
import { shouldHideOnClose, createTray } from './tray-controller';

const RENDERER_DIST = join(__dirname, '..', 'renderer', 'out');
const PRELOAD_PATH = join(__dirname, 'preload.js');
const SIDEBAR_PRELOAD_PATH = join(__dirname, 'sidebar-preload.js');
const DEV_URL = process.env.ELECTRON_RENDERER_URL;
const PROBE_TIMEOUT_MS = 16000; // > preload identity poll window (~15s) so slow accounts aren't missed

let mainWindow: BrowserWindow | null = null;
let manager: ProfileViewManager | null = null;
let colors: ColorStore | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let settingsPanelOpen = false;

const profiles: Profile[] = [];
const seenEmails = new Set<string>();
const unreadCounts: Record<number, number> = {};
let probeTimer: ReturnType<typeof setTimeout> | null = null;
let probingIndex: number | null = null;
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

function pushProfiles(): void {
  mainWindow?.webContents.send(IPC.PROFILES_CHANGED, [...profiles]);
}
function pushUnread(): void {
  mainWindow?.webContents.send(IPC.UNREAD_CHANGED, { ...unreadCounts });
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
  const decision = planNext([...seenEmails], index, identity);
  clearProbeTimer();
  probingIndex = null;
  if (decision.register && identity.email) {
    seenEmails.add(identity.email);
    const color = colors!.get(identity.email) ?? colorForIndex(index);
    profiles.push({ index, email: identity.email, name: identity.name, avatarUrl: identity.avatarUrl, color });
    profiles.sort((a, b) => a.index - b.index);
    pushProfiles();
  } else if (index > 0) {
    manager?.discardView(index, 'mail'); // duplicate/empty probe view
  }
  if (!decision.stop) probe(index + 1);
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

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    backgroundColor: '#0a0a0a',
    webPreferences: { preload: SIDEBAR_PRELOAD_PATH, contextIsolation: true },
  });
  colors = new ColorStore(join(app.getPath('userData'), 'colors.json'));
  manager = new ProfileViewManager(
    mainWindow,
    PRELOAD_PATH,
    (index, count) => {
      unreadCounts[index] = count;
      pushUnread();
      applyBadge(unreadCounts as unknown as Record<string, number>, (n) => app.setBadgeCount(n));
    },
    (index) => {
      mainWindow?.show();
      if (settingsPanelOpen) {
        settingsPanelOpen = false;
        mainWindow?.webContents.send(IPC.SETTINGS_FORCE_CLOSE);
      }
      switchSurface(index, 'mail');
    },
    (index, identity) => onIdentity(index, identity),
  );

  if (DEV_URL) void mainWindow.loadURL(DEV_URL);
  else void mainWindow.loadURL('app://bundle/');

  mainWindow.webContents.on('did-finish-load', () => {
    pushProfiles(); // re-push on any (re)load so the sidebar repopulates
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
}

function registerIpc(): void {
  ipcMain.on(IPC.SWITCH_SURFACE, (_e, arg: { index: number; surface: Surface }) =>
    switchSurface(arg.index, arg.surface),
  );
  ipcMain.on(IPC.REDETECT, () => redetect());
  ipcMain.on(IPC.SET_COLOR, (_e, arg: { email: string; color: string }) => {
    colors!.set(arg.email, arg.color);
    const p = profiles.find((x) => x.email === arg.email);
    if (p) {
      p.color = arg.color;
      pushProfiles();
    }
  });
  ipcMain.on(IPC.SETTINGS_TOGGLE, (_e, arg: { open: boolean }) => {
    settingsPanelOpen = arg.open;
    if (arg.open) manager?.hideAll();
    else manager?.showActive();
  });
}

app.whenReady().then(() => {
  registerAppProtocol();
  registerIpc();
  createWindow();
  tray = createTray({
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
});

app.on('window-all-closed', () => {
  // Kept running in the tray; quit only via the tray menu.
});
app.on('before-quit', () => {
  isQuitting = true;
});
