import { describe, it, expect } from 'vitest';
import { isDelegatedMailUrl, parseDelegatedEntries, delegatedMailUrl } from '../electron/delegation';

// The delegated mail URL form observed live in the Task 1 spike.
const DELEGATED = 'https://mail.google.com/mail/u/0/d/AEoRXRTYOddZV924KXKu6a5zD9bNp1IJo1ctbL1EvLsatGZu6d_R/';

describe('isDelegatedMailUrl', () => {
  it('recognizes the observed /mail/u/<n>/d/<token>/ delegated form', () => {
    expect(isDelegatedMailUrl(DELEGATED)).toBe(true);
  });
  it('rejects a normal authuser inbox url', () => {
    expect(isDelegatedMailUrl('https://mail.google.com/mail/u/0/#inbox')).toBe(false);
    expect(isDelegatedMailUrl('https://mail.google.com/mail/u/2/')).toBe(false);
  });
  it('rejects non-mail and malformed urls', () => {
    expect(isDelegatedMailUrl('https://calendar.google.com/calendar/u/0/r')).toBe(false);
    expect(isDelegatedMailUrl('not a url')).toBe(false);
  });
});

describe('parseDelegatedEntries', () => {
  it('normalizes and keeps Google’s href verbatim as the mailUrl', () => {
    const [e] = parseDelegatedEntries([{ email: '  Bart@Abovomaxlead.NL ', href: DELEGATED }]);
    expect(e.email).toBe('bart@abovomaxlead.nl');
    expect(delegatedMailUrl(e)).toBe(DELEGATED);
  });
  it('drops entries missing an email or href', () => {
    expect(parseDelegatedEntries([{ email: '', href: DELEGATED }])).toEqual([]);
    expect(parseDelegatedEntries([{ email: 'x@y.com', href: '' }])).toEqual([]);
  });
});
