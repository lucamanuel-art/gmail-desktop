import { describe, it, expect } from 'vitest';
import { mailUrl, calendarUrl, addAccountUrl } from '../electron/google-urls';

describe('google urls', () => {
  it('builds mail url per authuser index', () => {
    expect(mailUrl(0)).toBe('https://mail.google.com/mail/u/0/');
    expect(mailUrl(2)).toBe('https://mail.google.com/mail/u/2/');
  });
  it('builds calendar url per authuser index', () => {
    expect(calendarUrl(0)).toBe('https://calendar.google.com/calendar/u/0/r');
    expect(calendarUrl(1)).toBe('https://calendar.google.com/calendar/u/1/r');
  });
  it('builds an add-account url that continues to Gmail', () => {
    expect(addAccountUrl()).toBe(
      'https://accounts.google.com/AddSession?continue=https://mail.google.com/mail/',
    );
  });
});
