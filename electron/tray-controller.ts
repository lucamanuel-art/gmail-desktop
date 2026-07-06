import type { Tray } from 'electron';

export function shouldHideOnClose(state: {
  isQuitting: boolean;
  platform: NodeJS.Platform;
}): boolean {
  return !state.isQuitting;
}

export function createTray(opts: { onOpen: () => void; onQuit: () => void }): Tray {
  const { Tray, Menu, nativeImage } = require('electron') as typeof import('electron');
  // Empty image => platform default tray icon; a real icon can be added later.
  const tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip('Gmail Desktop');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open', click: opts.onOpen },
      { type: 'separator' },
      { label: 'Quit', click: opts.onQuit },
    ]),
  );
  tray.on('click', opts.onOpen);
  return tray;
}
