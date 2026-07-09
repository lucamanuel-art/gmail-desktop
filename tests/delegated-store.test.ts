import { describe, it, expect } from 'vitest';
import { mergeScan } from '../electron/delegated-store';

const d = (email: string, cal: string | null = null) => ({
  email,
  mailUrl: `https://m/${email}`,
  calendarUrl: cal,
});

describe('mergeScan', () => {
  it('adds newly scanned delegates', () => {
    const { next } = mergeScan([d('a@x.com')], [d('a@x.com'), d('b@x.com')]);
    expect(next.map((x) => x.email).sort()).toEqual(['a@x.com', 'b@x.com']);
  });
  it('never drops an existing delegate the scan missed', () => {
    const { next } = mergeScan([d('a@x.com'), d('b@x.com')], [d('a@x.com')]);
    expect(next.map((x) => x.email).sort()).toEqual(['a@x.com', 'b@x.com']);
  });
  it('flags healthOk=false when the scan returns fewer than we hold', () => {
    const { healthOk } = mergeScan([d('a@x.com'), d('b@x.com')], [d('a@x.com')]);
    expect(healthOk).toBe(false);
  });
  it('updates calendarUrl from a fresh scan for an existing delegate', () => {
    const { next } = mergeScan([d('a@x.com', null)], [d('a@x.com', 'https://c/')]);
    expect(next.find((x) => x.email === 'a@x.com')?.calendarUrl).toBe('https://c/');
  });
});
