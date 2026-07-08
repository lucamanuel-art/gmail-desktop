import { describe, it, expect, vi } from 'vitest';
import {
  shouldHideOnClose,
  formatClock,
  updateItemLabel,
  snoozeStatusLabel,
  trayMenuTemplate,
  type TrayState,
} from '../electron/tray-controller';

describe('shouldHideOnClose', () => {
  it('hides to tray during a normal close', () => {
    expect(shouldHideOnClose({ isQuitting: false, platform: 'linux' })).toBe(true);
  });
  it('does not hide when the app is quitting', () => {
    expect(shouldHideOnClose({ isQuitting: true, platform: 'linux' })).toBe(false);
  });
});

function state(overrides: Partial<TrayState> = {}): TrayState {
  return {
    onOpen: vi.fn(),
    onQuit: vi.fn(),
    isPackaged: true,
    updateStatus: { state: 'idle' },
    onCheckUpdate: vi.fn(),
    onDownloadUpdate: vi.fn(),
    onInstallUpdate: vi.fn(),
    autoStart: false,
    onToggleAutoStart: vi.fn(),
    dnd: false,
    dndUntil: undefined,
    now: new Date(2026, 0, 1, 12, 0).getTime(),
    onSnooze: vi.fn(),
    onClearSnooze: vi.fn(),
    ...overrides,
  };
}

// Flatten a template into a label->item map (recurses one level into submenus).
function byLabel(items: any[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (const it of items) if (typeof it.label === 'string') out[it.label] = it;
  return out;
}

describe('formatClock', () => {
  it('zero-pads to 24h HH:MM', () => {
    expect(formatClock(new Date(2026, 0, 1, 9, 5))).toBe('09:05');
    expect(formatClock(new Date(2026, 0, 1, 15, 30))).toBe('15:30');
    expect(formatClock(new Date(2026, 0, 1, 0, 0))).toBe('00:00');
  });
});

describe('updateItemLabel', () => {
  it('shows a dev label when unpackaged regardless of state', () => {
    expect(updateItemLabel({ state: 'available', version: '1.2.3' }, false)).toBe('Check for updates (dev)');
  });
  it('maps each updater state to a label', () => {
    expect(updateItemLabel({ state: 'idle' }, true)).toBe('Check for updates');
    expect(updateItemLabel({ state: 'not-available' }, true)).toBe('Check for updates');
    expect(updateItemLabel({ state: 'checking' }, true)).toBe('Checking for updates…');
    expect(updateItemLabel({ state: 'available', version: '0.2.0' }, true)).toBe('Download update v0.2.0');
    expect(updateItemLabel({ state: 'downloading', percent: 42 }, true)).toBe('Downloading update… 42%');
    expect(updateItemLabel({ state: 'downloaded' }, true)).toBe('Restart to install update');
    expect(updateItemLabel({ state: 'error' }, true)).toBe('Update check failed — retry');
  });
});

describe('snoozeStatusLabel', () => {
  it('reads "Snooze notifications" when nothing is muted', () => {
    expect(snoozeStatusLabel(state())).toBe('Snooze notifications');
  });
  it('reads a clock time while a timed snooze is active', () => {
    const now = new Date(2026, 0, 1, 12, 0).getTime();
    const until = new Date(2026, 0, 1, 12, 30).getTime();
    expect(snoozeStatusLabel(state({ now, dndUntil: until }))).toBe('Notifications snoozed until 12:30');
  });
  it('reads "Notifications off" for an indefinite mute', () => {
    expect(snoozeStatusLabel(state({ dnd: true }))).toBe('Notifications off');
  });
  it('ignores a snooze that has already expired', () => {
    const now = new Date(2026, 0, 1, 12, 0).getTime();
    const past = new Date(2026, 0, 1, 11, 0).getTime();
    expect(snoozeStatusLabel(state({ now, dndUntil: past }))).toBe('Snooze notifications');
  });
});

describe('trayMenuTemplate', () => {
  it('has the expected top-level items in order', () => {
    const items = trayMenuTemplate(state());
    const labels = items.filter((i) => i.type !== 'separator').map((i) => i.label);
    expect(labels).toEqual([
      'Open',
      'Snooze notifications',
      'Check for updates',
      'Start at login',
      'Quit',
    ]);
  });

  it('wires Open and Quit', () => {
    const s = state();
    const items = byLabel(trayMenuTemplate(s));
    items['Open'].click();
    items['Quit'].click();
    expect(s.onOpen).toHaveBeenCalledOnce();
    expect(s.onQuit).toHaveBeenCalledOnce();
  });

  it('renders the autostart checkbox from state and toggles it inverted', () => {
    const s = state({ autoStart: true });
    const item = byLabel(trayMenuTemplate(s))['Start at login'];
    expect(item.type).toBe('checkbox');
    expect(item.checked).toBe(true);
    item.click();
    expect(s.onToggleAutoStart).toHaveBeenCalledWith(false);
  });

  it('update item calls download when an update is available', () => {
    const s = state({ updateStatus: { state: 'available', version: '0.2.0' } });
    byLabel(trayMenuTemplate(s))['Download update v0.2.0'].click();
    expect(s.onDownloadUpdate).toHaveBeenCalledOnce();
    expect(s.onCheckUpdate).not.toHaveBeenCalled();
  });

  it('update item installs when an update is downloaded', () => {
    const s = state({ updateStatus: { state: 'downloaded' } });
    byLabel(trayMenuTemplate(s))['Restart to install update'].click();
    expect(s.onInstallUpdate).toHaveBeenCalledOnce();
  });

  it('update item is disabled mid-check and mid-download', () => {
    expect(byLabel(trayMenuTemplate(state({ updateStatus: { state: 'checking' } })))['Checking for updates…'].enabled).toBe(false);
    expect(byLabel(trayMenuTemplate(state({ updateStatus: { state: 'downloading', percent: 5 } })))['Downloading update… 5%'].enabled).toBe(false);
  });

  it('offers timed snooze presets that call onSnooze with minutes', () => {
    const s = state();
    const sub = byLabel(trayMenuTemplate(s))['Snooze notifications'].submenu as any[];
    const subItems = byLabel(sub);
    subItems['For 10 minutes'].click();
    subItems['For 30 minutes'].click();
    subItems['For 1 hour'].click();
    expect(s.onSnooze).toHaveBeenNthCalledWith(1, 10);
    expect(s.onSnooze).toHaveBeenNthCalledWith(2, 30);
    expect(s.onSnooze).toHaveBeenNthCalledWith(3, 60);
  });

  it('"Until I turn them back on" snoozes indefinitely (null)', () => {
    const s = state();
    const sub = byLabel(trayMenuTemplate(s))['Snooze notifications'].submenu as any[];
    byLabel(sub)['Until I turn them back on'].click();
    expect(s.onSnooze).toHaveBeenCalledWith(null);
  });

  it('"Turn notifications on" is enabled only while muted and clears the snooze', () => {
    const off = byLabel(byLabel(trayMenuTemplate(state()))['Snooze notifications'].submenu as any[]);
    expect(off['Turn notifications on'].enabled).toBe(false);

    const s = state({ dnd: true });
    const on = byLabel(byLabel(trayMenuTemplate(s))['Notifications off'].submenu as any[]);
    expect(on['Turn notifications on'].enabled).toBe(true);
    on['Turn notifications on'].click();
    expect(s.onClearSnooze).toHaveBeenCalledOnce();
  });
});
