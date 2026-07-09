import { describe, it, expect } from 'vitest';
import { accountKey, parseAccountKey } from '../renderer/lib/account-ref';

describe('accountKey', () => {
  it('keys authuser accounts by index', () => {
    expect(accountKey({ kind: 'authuser', index: 2 })).toBe('u2');
  });
  it('keys delegated mailboxes by email', () => {
    expect(
      accountKey({ kind: 'delegated', email: 'team@x.com', mailUrl: 'https://m/', calendarUrl: null }),
    ).toBe('d:team@x.com');
  });
  it('round-trips authuser keys', () => {
    expect(parseAccountKey('u2')).toEqual({ kind: 'authuser', index: 2 });
  });
  it('round-trips delegated keys with the email intact', () => {
    expect(parseAccountKey('d:team@x.com')).toEqual({ kind: 'delegated', email: 'team@x.com' });
  });
});
