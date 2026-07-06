import type { Tray } from 'electron';

export function shouldHideOnClose(state: {
  isQuitting: boolean;
  platform: NodeJS.Platform;
}): boolean {
  return !state.isQuitting;
}

export function createTray(
  iconPath: string,
  opts: { onOpen: () => void; onQuit: () => void },
): Tray {
  const { Tray, Menu, nativeImage } = require('electron') as typeof import('electron');
  // Load the app logo and scale it down to a crisp tray size. Fall back to an
  // empty (platform-default) image if the icon can't be read.
  let image = nativeImage.createFromPath(iconPath);
  if (!image.isEmpty()) image = image.resize({ width: 32, height: 32 });
  const tray = new Tray(image);
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
