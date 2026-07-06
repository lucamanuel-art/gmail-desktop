export function menuTemplate(): Array<{ role?: string; label?: string; submenu?: unknown[] }> {
  return [
    {
      label: 'App',
      submenu: [{ role: 'quit' }],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
  ];
}

export function installMenu(): void {
  const { Menu, globalShortcut, BrowserWindow } = require('electron') as typeof import('electron');
  const menu = Menu.buildFromTemplate(menuTemplate() as Electron.MenuItemConstructorOptions[]);
  Menu.setApplicationMenu(menu);
  // Non-colliding DevTools toggle for debugging (F12 is not an Outlook shortcut).
  globalShortcut.register('F12', () => {
    BrowserWindow.getFocusedWindow()?.webContents.toggleDevTools();
  });
}
