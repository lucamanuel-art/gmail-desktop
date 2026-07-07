import { describe, it, expect } from 'vitest';
import { notificationsAllowed, inQuietHours } from '../electron/notification-policy';
import { DEFAULT_PREFS, type Prefs } from '../electron/prefs-store';

function prefs(overrides: Partial<Prefs>): Prefs {
  return { ...structuredClone(DEFAULT_PREFS), ...overrides };
}
const at = (h: number, m = 0) => new Date(2026, 0, 1, h, m);

describe('inQuietHours', () => {
  it('handles a midnight-crossing window', () => {
    expect(inQuietHours('22:00', '07:00', 23 * 60)).toBe(true); // 23:00
    expect(inQuietHours('22:00', '07:00', 6 * 60)).toBe(true); // 06:00
    expect(inQuietHours('22:00', '07:00', 12 * 60)).toBe(false); // 12:00
  });
  it('handles a same-day window', () => {
    expect(inQuietHours('09:00', '17:00', 10 * 60)).toBe(true);
    expect(inQuietHours('09:00', '17:00', 20 * 60)).toBe(false);
  });
  it('treats start==end as never in quiet hours', () => {
    expect(inQuietHours('09:00', '09:00', 9 * 60)).toBe(false);
  });
});

describe('notificationsAllowed', () => {
  it('allows by default', () => {
    expect(notificationsAllowed(prefs({}), 'a@x.com', at(12))).toBe(true);
  });
  it('blocks all when DND is on', () => {
    expect(notificationsAllowed(prefs({ notifications: { dnd: true, quietHours: { enabled: false, start: '18:00', end: '08:00' } } }), 'a@x.com', at(12))).toBe(false);
  });
  it('blocks during quiet hours', () => {
    expect(notificationsAllowed(prefs({ notifications: { dnd: false, quietHours: { enabled: true, start: '18:00', end: '08:00' } } }), 'a@x.com', at(23))).toBe(false);
  });
  it('blocks a per-account opt-out', () => {
    const p = prefs({ accounts: { 'a@x.com': { notify: false } } });
    expect(notificationsAllowed(p, 'a@x.com', at(12))).toBe(false);
  });
  it('allows an account with notify:true even if another is off', () => {
    const p = prefs({ accounts: { 'a@x.com': { notify: false }, 'b@x.com': { notify: true } } });
    expect(notificationsAllowed(p, 'b@x.com', at(12))).toBe(true);
  });
});
