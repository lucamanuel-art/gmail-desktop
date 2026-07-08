import { describe, expect, it } from 'vitest';
import { windowOpenAction } from '../electron/external-links';

// windowOpenAction(url, mode, suppressed, popoutExpected)
// On a real notification click Gmail's own handler ALSO opens the thread (a
// normal window or its focused pop-out). That must be suppressed so the user
// doesn't get a stray/duplicate window; only the pop-out the app deliberately
// triggers (popoutExpected) is allowed through.
const POPOUT = 'https://mail.google.com/mail/u/0/popout?search=all&th=x';
const THREAD = 'https://mail.google.com/mail/u/0/#inbox/abc';

describe('windowOpenAction', () => {
  it('sends non-Google URLs to the external browser regardless of state', () => {
    expect(windowOpenAction('https://example.com/x', 'app', false, false)).toBe('open-external');
    expect(windowOpenAction('https://example.com/x', 'window', true, false)).toBe('open-external');
  });

  it('suppresses in-app popups right after a handled notification click', () => {
    expect(windowOpenAction(THREAD, 'window', true, false)).toBe('suppress');
    expect(windowOpenAction(THREAD, 'app', true, false)).toBe('suppress');
  });

  it('opens in-app popups in place in app mode', () => {
    expect(windowOpenAction(THREAD, 'app', false, false)).toBe('open-in-app');
  });

  it('allows the separate window in window mode', () => {
    expect(windowOpenAction(THREAD, 'window', false, false)).toBe('allow');
    expect(windowOpenAction('https://accounts.google.com/signin', 'window', false, false)).toBe('allow');
  });

  it('suppresses Gmail’s own auto pop-out during a notification click (either mode)', () => {
    // The reported bug: in app mode a pop-out window appeared. Gmail opens it
    // itself on click; without our trigger it must be suppressed.
    expect(windowOpenAction(POPOUT, 'app', true, false)).toBe('suppress');
    expect(windowOpenAction(POPOUT, 'window', true, false)).toBe('suppress');
  });

  it('allows the pop-out the app deliberately triggers', () => {
    expect(windowOpenAction(POPOUT, 'window', true, true)).toBe('allow');
    expect(windowOpenAction(POPOUT, 'app', true, true)).toBe('allow');
  });

  it('allows a manual pop-out click when nothing is being suppressed', () => {
    expect(windowOpenAction(POPOUT, 'app', false, false)).toBe('allow');
    expect(windowOpenAction(POPOUT, 'window', false, false)).toBe('allow');
  });
});
