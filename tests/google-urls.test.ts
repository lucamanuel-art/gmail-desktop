import { describe, it, expect } from 'vitest';
import { mailUrl, calendarUrl } from '../electron/google-urls';

describe('google urls', () => {
  it('builds mail url per authuser index', () => {
    expect(mailUrl(0)).toBe('https://mail.google.com/mail/u/0/');
    expect(mailUrl(2)).toBe('https://mail.google.com/mail/u/2/');
  });
  it('builds calendar url per authuser index', () => {
    expect(calendarUrl(0)).toBe('https://calendar.google.com/calendar/u/0/r');
    expect(calendarUrl(1)).toBe('https://calendar.google.com/calendar/u/1/r');
  });
});
