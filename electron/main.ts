import { app, BrowserWindow, protocol, net } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const RENDERER_DIST = join(__dirname, '..', 'renderer', 'out');
const DEV_URL = process.env.ELECTRON_RENDERER_URL;

let mainWindow: BrowserWindow | null = null;

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function registerAppProtocol(): void {
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const filePath = join(RENDERER_DIST, rel);
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    backgroundColor: '#0a0a0a',
    webPreferences: {},
  });

  if (DEV_URL) {
    void mainWindow.loadURL(DEV_URL);
  } else {
    void mainWindow.loadURL('app://bundle/');
  }
}

app.whenReady().then(() => {
  registerAppProtocol();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
