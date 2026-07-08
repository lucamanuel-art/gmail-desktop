import { describe, expect, it, vi } from 'vitest';
import { wrapWindowOpen } from '../electron/preload';

// The main process denies window.open calls it handles itself (open-in-app
// navigation, external browser, or the duplicate popup right after a handled
// notification click). A denied window.open returns null, which Gmail treats
// as a popup blocker and alerts ("Helaas! Een pop-upblokkering…"). The wrapper
// substitutes a harmless stub so page code sees a window-like object.
describe('wrapWindowOpen', () => {
  it('returns the real window when the open is allowed', () => {
    const real = { name: 'real' };
    const open = vi.fn(() => real);
    const wrapped = wrapWindowOpen(open as unknown as typeof window.open);
    expect(wrapped('https://x', '_blank')).toBe(real);
    expect(open).toHaveBeenCalledWith('https://x', '_blank');
  });

  it('returns a window-like stub instead of null when the open was denied', () => {
    const open = vi.fn(() => null);
    const wrapped = wrapWindowOpen(open as unknown as typeof window.open);
    const w = wrapped('https://mail.google.com/mail/u/0/#inbox/abc') as Window;
    expect(w).toBeTruthy();
    expect(w.closed).toBe(true);
    expect(() => {
      w.close();
      w.focus();
      w.blur();
      w.postMessage('x', '*');
    }).not.toThrow();
  });
});
