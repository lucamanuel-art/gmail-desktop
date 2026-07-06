import { app, BrowserWindow, protocol, net, ipcMain } from 'electron';
import type { Tray } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AccountsStore, type Account } from './accounts-store';
import { AccountViewManager } from './account-view-manager';
import { applyBadge } from './badge-controller';
import { IPC } from './ipc';
import { shouldHideOnClose, createTray } from './tray-controller';

const RENDERER_DIST = join(__dirname, '..', 'renderer', 'out');
const PRELOAD_PATH = join(__dirname, 'preload.js');
const SIDEBAR_PRELOAD_PATH = join(__dirname, 'sidebar-preload.js');
const DEV_URL = process.env.ELECTRON_RENDERER_URL;

let mainWindow: BrowserWindow | null = null;
let manager: AccountViewManager | null = null;
let store: AccountsStore | null = null;
let tray: Tray | null = null;
let isQuitting = false;
const unreadCounts: Record<string, number> = {};

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

function pushUnread(): void {
  mainWindow?.webContents.send(IPC.UNREAD_CHANGED, { ...unreadCounts });
}

function pushAccounts(): void {
  mainWindow?.webContents.send(IPC.ACCOUNTS_CHANGED, store?.list() ?? []);
}

function activate(accountId: string): void {
  mainWindow?.show();
  manager?.show(accountId);
  mainWindow?.webContents.send(IPC.ACCOUNTS_CHANGED, store?.list() ?? []);
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    backgroundColor: '#0a0a0a',
    webPreferences: { preload: SIDEBAR_PRELOAD_PATH, contextIsolation: true },
  });

  store = new AccountsStore(join(app.getPath('userData'), 'accounts.json'));
  manager = new AccountViewManager(
    mainWindow,
    PRELOAD_PATH,
    (accountId, count) => {
      unreadCounts[accountId] = count;
      pushUnread();
      applyBadge(unreadCounts, (n) => app.setBadgeCount(n));
    },
    (accountId) => activate(accountId),
  );

  for (const account of store.list()) manager.ensureView(account);
  const first = store.list()[0];
  if (first) manager.show(first.id);

  if (DEV_URL) void mainWindow.loadURL(DEV_URL);
  else void mainWindow.loadURL('app://bundle/');

  mainWindow.on('close', (e) => {
    if (shouldHideOnClose({ isQuitting, platform: process.platform })) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
}

function registerIpc(): void {
  ipcMain.handle(IPC.ACCOUNTS_LIST, () => store?.list() ?? []);
  ipcMain.handle(IPC.ACCOUNTS_ADD, (_e, input: { label: string; color: string }) => {
    const account = store!.add(input) as Account;
    manager!.ensureView(account);
    pushAccounts();
    return account;
  });
  ipcMain.handle(IPC.ACCOUNTS_REMOVE, (_e, id: string) => {
    manager!.removeView(id);
    store!.remove(id);
    delete unreadCounts[id];
    pushAccounts();
    pushUnread();
  });
  ipcMain.on(IPC.ACCOUNTS_SWITCH, (_e, id: string) => manager?.show(id));
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
  void tray; // retained for lifetime of the app
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // Intentionally left running in the tray; quit only via the tray menu.
});

app.on('before-quit', () => {
  isQuitting = true;
});
