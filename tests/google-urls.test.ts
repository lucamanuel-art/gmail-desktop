import { describe, it, expect } from 'vitest';
import {
  mailUrl,
  calendarUrl,
  addAccountUrl,
  isInAppUrl,
  isGoogleUrl,
  isPopoutUrl,
} from '../electron/google-urls';

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
  it('detects Gmail pop-out urls', () => {
    expect(isPopoutUrl('https://mail.google.com/mail/u/0/popout?search=all&th=x')).toBe(true);
    expect(isPopoutUrl('https://mail.google.com/mail/u/0/#inbox/abc')).toBe(false);
    expect(isPopoutUrl('not a url')).toBe(false);
  });
});

describe('isInAppUrl', () => {
  it('keeps the app-hosted surfaces in-app', () => {
    expect(isInAppUrl('https://mail.google.com/mail/u/0/')).toBe(true);
    expect(isInAppUrl('https://calendar.google.com/calendar/u/0/r')).toBe(true);
    expect(isInAppUrl('https://accounts.google.com/AddSession')).toBe(true);
  });
  it('keeps every Google app surface host in-app', () => {
    expect(isInAppUrl('https://drive.google.com/drive/u/0/my-drive')).toBe(true);
    expect(isInAppUrl('https://docs.google.com/document/d/abc')).toBe(true);
    expect(isInAppUrl('https://docs.google.com/spreadsheets/d/abc')).toBe(true);
    expect(isInAppUrl('https://keep.google.com/u/0/')).toBe(true);
    expect(isInAppUrl('https://contacts.google.com/u/0/')).toBe(true);
    expect(isInAppUrl('https://chat.google.com/u/0/')).toBe(true);
  });
  it('treats email links as external, including the redirect wrapper', () => {
    expect(isInAppUrl('https://www.google.com/url?q=https://example.com')).toBe(false);
    expect(isInAppUrl('https://example.com/article')).toBe(false);
    expect(isInAppUrl('https://meet.google.com/abc-defg-hij')).toBe(false);
  });
  it('returns false for malformed urls', () => {
    expect(isInAppUrl('not a url')).toBe(false);
  });
});

describe('isGoogleUrl', () => {
  it('matches google.com and its subdomains', () => {
    expect(isGoogleUrl('https://google.com/')).toBe(true);
    expect(isGoogleUrl('https://mail.google.com/mail/u/0/')).toBe(true);
    expect(isGoogleUrl('https://www.google.com/url?q=x')).toBe(true);
  });
  it('does not match look-alike or off-google hosts', () => {
    expect(isGoogleUrl('https://example.com/')).toBe(false);
    expect(isGoogleUrl('https://notgoogle.com/')).toBe(false);
    expect(isGoogleUrl('https://google.com.evil.com/')).toBe(false);
  });
  it('returns false for malformed urls', () => {
    expect(isGoogleUrl('::::')).toBe(false);
  });
});
