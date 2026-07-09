import { describe, it, expect } from 'vitest';
import { composeUrl } from '../electron/compose-url';

const BASE = 'https://mail.google.com/mail/u/0/?view=cm&fs=1&tf=1';

describe('composeUrl', () => {
  it('with no fields returns exactly the current compose URL', () => {
    expect(composeUrl(0)).toBe(BASE);
  });
  it('puts the account index in the path', () => {
    expect(composeUrl(3)).toBe('https://mail.google.com/mail/u/3/?view=cm&fs=1&tf=1');
  });
  it('appends and encodes non-empty fields, subject as su', () => {
    const u = composeUrl(0, { to: 'a@b.com', cc: '', bcc: '', subject: 'Hi there', body: 'x&y' });
    expect(u).toBe(`${BASE}&to=a%40b.com&su=Hi%20there&body=x%26y`);
  });
  it('omits empty fields', () => {
    const u = composeUrl(0, { to: 'a@b.com', cc: '', bcc: '', subject: '', body: '' });
    expect(u).toBe(`${BASE}&to=a%40b.com`);
  });
});
