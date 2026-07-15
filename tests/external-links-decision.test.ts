import { describe, expect, it } from 'vitest';
import { windowOpenAction } from '../electron/external-links';

// windowOpenAction(url, mode, suppressed, popoutExpected)
// On a real notification click Gmail's own handler ALSO opens the thread (a
// normal window or its focused pop-out). That must be suppressed so the user
// doesn't get a stray/duplicate window; only the pop-out the app deliberately
// triggers (popoutExpected) is allowed through.
const POPOUT = 'https://mail.google.com/mail/u/0/popout?search=all&th=x';
const THREAD = 'https://mail.google.com/mail/u/0/#inbox/abc';
// Gmail's "View entire message" link on a clipped email opens this standalone
// full-message reader via target=_blank.
const FULL_MSG = 'https://mail.google.com/mail/u/0/?ui=2&ik=abc&view=lg&permmsgid=msg-f:1&th=2';

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

  it('opens a blank/opener-driven popup as a real window, never handing about: to the OS', () => {
    // The reported bug: a login/verify flow opens a blank popup (window.open()
    // / window.open('about:blank')) and then redirects it to the identity
    // provider itself. Treating about:blank as "not in-app" sent it to
    // shell.openExternal, which popped a Windows "no app can open this about:
    // link" dialog and denied the window — so the login page never appeared.
    // A blank popup must open as a real window the opener can drive, in any state.
    expect(windowOpenAction('about:blank', 'app', false, false)).toBe('allow');
    expect(windowOpenAction('about:blank', 'window', false, false)).toBe('allow');
    expect(windowOpenAction('', 'app', false, false)).toBe('allow');
    expect(windowOpenAction('about:blank#foo', 'window', false, false)).toBe('allow');
    // Never suppressed, even right after a notification click.
    expect(windowOpenAction('about:blank', 'app', true, false)).toBe('allow');
  });

  it('always opens the "View entire message" reader as its own window', () => {
    // The reported bug: in app mode this loaded into the shared mail view,
    // replacing the inbox with no way back. It must open as a separate window
    // in either mode (a standalone reader, like a pop-out).
    expect(windowOpenAction(FULL_MSG, 'app', false, false)).toBe('allow');
    expect(windowOpenAction(FULL_MSG, 'window', false, false)).toBe('allow');
  });
});
