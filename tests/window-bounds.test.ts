import { describe, it, expect } from 'vitest';
import { clampBoundsToDisplays } from '../electron/window-bounds';

const primary = { bounds: { x: 0, y: 0, width: 1920, height: 1080 } };

describe('clampBoundsToDisplays', () => {
  it('keeps bounds that sit on a display', () => {
    const win = { width: 1200, height: 820, x: 100, y: 100 };
    expect(clampBoundsToDisplays(win, [primary])).toEqual(win);
  });

  it('drops x/y when the window is fully off-screen', () => {
    const win = { width: 1200, height: 820, x: 5000, y: 5000 };
    expect(clampBoundsToDisplays(win, [primary])).toEqual({ width: 1200, height: 820 });
  });

  it('passes through when no x/y is stored', () => {
    const win = { width: 1200, height: 820 };
    expect(clampBoundsToDisplays(win, [primary])).toEqual(win);
  });

  it('keeps bounds visible on a secondary display', () => {
    const secondary = { bounds: { x: 1920, y: 0, width: 1920, height: 1080 } };
    const win = { width: 800, height: 600, x: 2000, y: 50 };
    expect(clampBoundsToDisplays(win, [primary, secondary])).toEqual(win);
  });
});
