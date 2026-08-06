import { describe, it, expect } from 'vitest';
import { delegatedHostIndex, ownerFor } from '../electron/delegated-owner';

const url = (n: number) => `https://mail.google.com/mail/u/${n}/d/AEoRXRTxxxEvLsatGZu6d_R/`;
const authusers = [
  { index: 0, email: 'luca.manuel@abovomaxlead.nl' },
  { index: 1, email: 'info@abovomaxlead.nl' },
];

describe('delegatedHostIndex', () => {
  it('reads the authuser index the delegated mailbox hangs under', () => {
    expect(delegatedHostIndex(url(0))).toBe(0);
    expect(delegatedHostIndex(url(2))).toBe(2);
  });

  it('returns null for a normal inbox url, which has no /d/ segment', () => {
    expect(delegatedHostIndex('https://mail.google.com/mail/u/0/')).toBeNull();
  });

  it('returns null for nonsense instead of guessing', () => {
    expect(delegatedHostIndex('')).toBeNull();
    expect(delegatedHostIndex('not a url')).toBeNull();
    expect(delegatedHostIndex('https://example.com/mail/u/0/d/x/')).toBeNull();
  });
});

describe('ownerFor', () => {
  it('resolves the mailbox to the account it hangs under', () => {
    expect(ownerFor(url(1), authusers)).toBe('info@abovomaxlead.nl');
  });

  it('returns null when that account is not connected, so the caller can fall back', () => {
    expect(ownerFor(url(7), authusers)).toBeNull();
    expect(ownerFor('https://mail.google.com/mail/u/0/', authusers)).toBeNull();
  });
});
