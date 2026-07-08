import { describe, expect, it } from 'vitest';
import { windowOpenAction } from '../electron/external-links';

// On a real (trusted) notification click Gmail's own handler ALSO calls
// window.open with the thread permalink. When the app has just opened the
// thread itself (threadId resolved), that popup must be suppressed or the user
// gets two windows at once ('window' mode) / a slow full reload ('app' mode).
describe('windowOpenAction', () => {
  it('sends non-Google URLs to the external browser regardless of state', () => {
    expect(windowOpenAction('https://example.com/x', 'app', false)).toBe('open-external');
    expect(windowOpenAction('https://example.com/x', 'window', true)).toBe('open-external');
  });

  it('suppresses in-app popups right after a handled notification click', () => {
    expect(windowOpenAction('https://mail.google.com/mail/u/0/#inbox/abc', 'window', true)).toBe('suppress');
    expect(windowOpenAction('https://mail.google.com/mail/u/0/#inbox/abc', 'app', true)).toBe('suppress');
  });

  it('opens in-app popups in place in app mode', () => {
    expect(windowOpenAction('https://mail.google.com/mail/u/0/#inbox/abc', 'app', false)).toBe('open-in-app');
  });

  it('allows the separate window in window mode', () => {
    expect(windowOpenAction('https://mail.google.com/mail/u/0/#inbox/abc', 'window', false)).toBe('allow');
    expect(windowOpenAction('https://accounts.google.com/signin', 'window', false)).toBe('allow');
  });
});
