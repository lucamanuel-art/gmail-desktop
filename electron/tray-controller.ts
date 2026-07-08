import type { Tray, Menu, MenuItemConstructorOptions } from 'electron';

export function shouldHideOnClose(state: {
  isQuitting: boolean;
  platform: NodeJS.Platform;
}): boolean {
  return !state.isQuitting;
}

// Read model for the tray context menu. Everything the menu shows or does is
// passed in so the template is a pure function of state (and unit-testable
// without Electron). `now` is an epoch-ms timestamp used to render/relative-check
// the active snooze.
export interface TrayUpdateStatus {
  state: string; // idle | checking | available | not-available | downloading | downloaded | error | dev
  version?: string;
  percent?: number;
}
export interface TrayState {
  onOpen: () => void;
  onQuit: () => void;
  isPackaged: boolean;
  updateStatus: TrayUpdateStatus;
  onCheckUpdate: () => void;
  onDownloadUpdate: () => void;
  onInstallUpdate: () => void;
  autoStart: boolean;
  onToggleAutoStart: (v: boolean) => void;
  dnd: boolean; // indefinite mute ("off until I turn it back on")
  dndUntil?: number; // epoch ms; timed snooze end
  now: number; // epoch ms; used to decide whether dndUntil is still active
  onSnooze: (minutes: number | null) => void; // null = mute indefinitely
  onClearSnooze: () => void;
}

// Local 24h HH:MM, zero-padded.
export function formatClock(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

function snoozeActive(state: TrayState): boolean {
  return typeof state.dndUntil === 'number' && state.dndUntil > state.now;
}

export function snoozeStatusLabel(state: TrayState): string {
  if (snoozeActive(state)) return `Notifications snoozed until ${formatClock(new Date(state.dndUntil!))}`;
  if (state.dnd) return 'Notifications off';
  return 'Snooze notifications';
}

export function updateItemLabel(status: TrayUpdateStatus, isPackaged: boolean): string {
  if (!isPackaged || status.state === 'dev') return 'Check for updates (dev)';
  switch (status.state) {
    case 'checking':
      return 'Checking for updates…';
    case 'available':
      return `Download update${status.version ? ` v${status.version}` : ''}`;
    case 'downloading':
      return `Downloading update… ${status.percent ?? 0}%`;
    case 'downloaded':
      return 'Restart to install update';
    case 'error':
      return 'Update check failed — retry';
    default:
      return 'Check for updates';
  }
}

function updateItem(state: TrayState): MenuItemConstructorOptions {
  const { state: s } = state.updateStatus;
  const dev = !state.isPackaged || s === 'dev';
  const busy = s === 'checking' || s === 'downloading';
  const click = dev
    ? undefined
    : s === 'available'
      ? state.onDownloadUpdate
      : s === 'downloaded'
        ? state.onInstallUpdate
        : state.onCheckUpdate;
  return {
    label: updateItemLabel(state.updateStatus, state.isPackaged),
    enabled: !dev && !busy,
    click,
  };
}

function snoozeSubmenu(state: TrayState): MenuItemConstructorOptions[] {
  const muted = state.dnd || snoozeActive(state);
  return [
    { label: 'For 10 minutes', click: () => state.onSnooze(10) },
    { label: 'For 30 minutes', click: () => state.onSnooze(30) },
    { label: 'For 1 hour', click: () => state.onSnooze(60) },
    { type: 'separator' },
    {
      label: 'Until I turn them back on',
      type: 'checkbox',
      checked: state.dnd && !snoozeActive(state),
      click: () => state.onSnooze(null),
    },
    { label: 'Turn notifications on', enabled: muted, click: () => state.onClearSnooze() },
  ];
}

export function trayMenuTemplate(state: TrayState): MenuItemConstructorOptions[] {
  return [
    { label: 'Open', click: state.onOpen },
    { type: 'separator' },
    { label: snoozeStatusLabel(state), submenu: snoozeSubmenu(state) },
    updateItem(state),
    {
      label: 'Start at login',
      type: 'checkbox',
      checked: state.autoStart,
      click: () => state.onToggleAutoStart(!state.autoStart),
    },
    { type: 'separator' },
    { label: 'Quit', click: state.onQuit },
  ];
}

export function buildTrayMenu(state: TrayState): Menu {
  const { Menu } = require('electron') as typeof import('electron');
  return Menu.buildFromTemplate(trayMenuTemplate(state));
}

export function createTray(iconPath: string, state: TrayState): Tray {
  const { Tray, nativeImage } = require('electron') as typeof import('electron');
  // Load the app logo and scale it down to a crisp tray size. Fall back to an
  // empty (platform-default) image if the icon can't be read.
  let image = nativeImage.createFromPath(iconPath);
  if (!image.isEmpty()) image = image.resize({ width: 32, height: 32 });
  const tray = new Tray(image);
  tray.setToolTip('Gmail Desktop');
  tray.setContextMenu(buildTrayMenu(state));
  tray.on('click', state.onOpen);
  return tray;
}

// Rebuild the whole context menu from fresh state — Electron bakes checkbox/label
// values in at build time, so any state change (snooze, autostart, update status)
// must go through here to be reflected.
export function updateTrayMenu(tray: Tray, state: TrayState): void {
  tray.setContextMenu(buildTrayMenu(state));
}
