import { describe, it, expect } from 'vitest';
import {
  SURFACES,
  APP_SURFACES,
  SURFACE_CONFIG,
  surfaceForUrl,
  surfacesForRef,
  type Surface,
} from '../renderer/lib/surfaces';
import type { AccountRef } from '../renderer/lib/account-ref';

const u = (index: number): AccountRef => ({ kind: 'authuser', index });

describe('SURFACE_CONFIG', () => {
  it('covers every surface with a label, host and url', () => {
    for (const s of SURFACES) {
      const cfg = SURFACE_CONFIG[s];
      expect(cfg.label.length).toBeGreaterThan(0);
      expect(cfg.host).toMatch(/\.google\.com$/);
      expect(cfg.url(u(0))).toContain(cfg.host);
    }
  });

  it('embeds the account index in every url', () => {
    for (const s of SURFACES) {
      expect(SURFACE_CONFIG[s].url(u(0))).toContain('/u/0/');
      expect(SURFACE_CONFIG[s].url(u(3))).toContain('/u/3/');
    }
  });

  it('keeps the known mail/calendar urls stable', () => {
    expect(SURFACE_CONFIG.mail.url(u(2))).toBe('https://mail.google.com/mail/u/2/');
    expect(SURFACE_CONFIG.calendar.url(u(1))).toBe('https://calendar.google.com/calendar/u/1/r');
  });

  it('only disables background throttling for calendar (reminder timing)', () => {
    for (const s of SURFACES) {
      expect(SURFACE_CONFIG[s].backgroundThrottling).toBe(s !== 'calendar');
    }
  });

  it('APP_SURFACES is everything except the pinned mail/calendar', () => {
    expect(APP_SURFACES).not.toContain('mail');
    expect(APP_SURFACES).not.toContain('calendar');
    expect(new Set([...APP_SURFACES, 'mail', 'calendar']).size).toBe(SURFACES.length);
    expect(APP_SURFACES).toEqual(['drive', 'docs', 'sheets', 'slides', 'keep', 'contacts', 'chat']);
  });
});

describe('surface urls by ref', () => {
  it('builds authuser mail url from index', () => {
    expect(SURFACE_CONFIG.mail.url({ kind: 'authuser', index: 1 })).toBe(
      'https://mail.google.com/mail/u/1/',
    );
  });
  it('builds delegated mail url from Google href', () => {
    expect(
      SURFACE_CONFIG.mail.url({
        kind: 'delegated',
        email: 't@x.com',
        mailUrl: 'https://mail.google.com/mail/b/ID/',
        calendarUrl: null,
      }),
    ).toBe('https://mail.google.com/mail/b/ID/');
  });
  it('builds delegated calendar url from the captured url', () => {
    expect(
      SURFACE_CONFIG.calendar.url({
        kind: 'delegated',
        email: 't@x.com',
        mailUrl: 'https://m/',
        calendarUrl: 'https://calendar.google.com/calendar/b/CID/r',
      }),
    ).toBe('https://calendar.google.com/calendar/b/CID/r');
  });
  it('throws if a non-mail/calendar surface is built for a delegated ref', () => {
    expect(() =>
      SURFACE_CONFIG.drive.url({ kind: 'delegated', email: 't@x.com', mailUrl: 'https://m/', calendarUrl: null }),
    ).toThrow();
  });
});

describe('surfacesForRef', () => {
  it('offers all surfaces for an authuser ref', () => {
    expect(surfacesForRef(u(0))).toEqual([...SURFACES]);
  });
  it('offers only mail for a delegated ref without calendar', () => {
    expect(
      surfacesForRef({ kind: 'delegated', email: 't@x.com', mailUrl: 'https://m/', calendarUrl: null }),
    ).toEqual(['mail']);
  });
  it('offers mail+calendar for a delegated ref with a calendar', () => {
    expect(
      surfacesForRef({
        kind: 'delegated',
        email: 't@x.com',
        mailUrl: 'https://m/',
        calendarUrl: 'https://c/',
      }),
    ).toEqual(['mail', 'calendar']);
  });
});

describe('surfaceForUrl', () => {
  it('maps every surface url back to its surface', () => {
    for (const s of SURFACES) {
      expect(surfaceForUrl(SURFACE_CONFIG[s].url(u(1)))).toBe(s as Surface);
    }
  });

  it('disambiguates the shared docs.google.com host by path', () => {
    expect(surfaceForUrl('https://docs.google.com/document/d/abc/edit')).toBe('docs');
    expect(surfaceForUrl('https://docs.google.com/spreadsheets/d/abc/edit#gid=0')).toBe('sheets');
    expect(surfaceForUrl('https://docs.google.com/presentation/d/abc/edit')).toBe('slides');
  });

  it('returns null for a docs.google.com path that is no known app', () => {
    expect(surfaceForUrl('https://docs.google.com/forms/d/abc/edit')).toBe(null);
  });

  it('returns null for external and unknown urls', () => {
    expect(surfaceForUrl('https://example.com/')).toBe(null);
    expect(surfaceForUrl('https://www.google.com/url?q=https://example.com')).toBe(null);
    expect(surfaceForUrl('https://accounts.google.com/AddSession')).toBe(null);
    expect(surfaceForUrl('not a url')).toBe(null);
  });
});
