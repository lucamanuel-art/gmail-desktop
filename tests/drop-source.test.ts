import { describe, it, expect } from 'vitest';
import { readPathFor, NO_ADMIN_ACCESS } from '../electron/drop-source';

describe('readPathFor — own accounts', () => {
  it('reads a label through the api when there is a token, as it does today', () => {
    expect(readPathFor({ drag: 'label', delegated: false, hasToken: true })).toBe('api');
  });

  it('falls back to the session for a label when there is no token', () => {
    expect(readPathFor({ drag: 'label', delegated: false, hasToken: false })).toBe('session');
  });

  it('keeps single threads on the session path even when a token exists', () => {
    // Deliberate: the api path is added for delegated mailboxes only, so the
    // most-used drag keeps behaving exactly as it did.
    expect(readPathFor({ drag: 'thread', delegated: false, hasToken: true })).toBe('session');
    expect(readPathFor({ drag: 'thread', delegated: false, hasToken: false })).toBe('session');
  });
});

describe('readPathFor — delegated mailboxes', () => {
  it('uses the api for both kinds of drag when a token was minted', () => {
    expect(readPathFor({ drag: 'label', delegated: true, hasToken: true })).toBe('api');
    expect(readPathFor({ drag: 'thread', delegated: true, hasToken: true })).toBe('api');
  });

  it('is blocked without a token: the session cannot reach a delegated mailbox', () => {
    // omUrl only builds /mail/u/<n>/, never /d/<opaque>/ — so falling back would
    // read the owner's own mailbox with a foreign thread id, or nothing at all.
    expect(readPathFor({ drag: 'label', delegated: true, hasToken: false })).toBe('blocked');
    expect(readPathFor({ drag: 'thread', delegated: true, hasToken: false })).toBe('blocked');
  });

  it('never answers session for a delegated mailbox, whatever the inputs', () => {
    for (const drag of ['label', 'thread'] as const) {
      for (const hasToken of [true, false]) {
        expect(readPathFor({ drag, delegated: true, hasToken })).not.toBe('session');
      }
    }
  });
});

describe('NO_ADMIN_ACCESS', () => {
  it('is the one message a blocked drag reports', () => {
    expect(NO_ADMIN_ACCESS).toBe('Beheerdertoegang nodig');
  });
});
