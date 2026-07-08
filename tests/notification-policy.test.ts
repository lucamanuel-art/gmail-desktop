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

  it('blocks while a timed snooze (dndUntil) is still in the future', () => {
    const p = prefs({
      notifications: { dnd: false, dndUntil: at(12, 30).getTime(), quietHours: { enabled: false, start: '18:00', end: '08:00' } },
    });
    expect(notificationsAllowed(p, 'a@x.com', at(12))).toBe(false); // 12:00 < 12:30
  });

  it('allows again once dndUntil has passed', () => {
    const p = prefs({
      notifications: { dnd: false, dndUntil: at(11, 30).getTime(), quietHours: { enabled: false, start: '18:00', end: '08:00' } },
    });
    expect(notificationsAllowed(p, 'a@x.com', at(12))).toBe(true); // 12:00 > 11:30
  });

  it('a snooze gates the calendar surface too', () => {
    const p = prefs({
      notifications: { dnd: false, dndUntil: at(13).getTime(), quietHours: { enabled: false, start: '18:00', end: '08:00' } },
      accounts: { 'a@x.com': { calendarNotify: true } },
    });
    expect(notificationsAllowed(p, 'a@x.com', at(12), 'calendar')).toBe(false);
  });
});

describe('notificationsAllowed — surface', () => {
  const base = () => structuredClone(DEFAULT_PREFS);

  it("defaults to the mail surface", () => {
    const p = base();
    expect(notificationsAllowed(p, 'a@x.com', at(12))).toBe(true); // no 4th arg → mail
  });

  it('mail: allowed unless notify===false', () => {
    const p = base();
    expect(notificationsAllowed(p, 'a@x.com', at(12), 'mail')).toBe(true);
    p.accounts['a@x.com'] = { notify: false };
    expect(notificationsAllowed(p, 'a@x.com', at(12), 'mail')).toBe(false);
  });

  it('calendar: off by default, on only when calendarNotify===true', () => {
    const p = base();
    expect(notificationsAllowed(p, 'a@x.com', at(12), 'calendar')).toBe(false); // opt-in
    p.accounts['a@x.com'] = { calendarNotify: true };
    expect(notificationsAllowed(p, 'a@x.com', at(12), 'calendar')).toBe(true);
  });

  it('calendar toggle is independent of mail toggle', () => {
    const p = base();
    p.accounts['a@x.com'] = { notify: false, calendarNotify: true };
    expect(notificationsAllowed(p, 'a@x.com', at(12), 'mail')).toBe(false);
    expect(notificationsAllowed(p, 'a@x.com', at(12), 'calendar')).toBe(true);
  });

  it('DND and quiet hours gate calendar too', () => {
    const dnd = base();
    dnd.notifications.dnd = true;
    dnd.accounts['a@x.com'] = { calendarNotify: true };
    expect(notificationsAllowed(dnd, 'a@x.com', at(12), 'calendar')).toBe(false);

    const qh = base();
    qh.notifications.quietHours = { enabled: true, start: '18:00', end: '08:00' };
    qh.accounts['a@x.com'] = { calendarNotify: true };
    expect(notificationsAllowed(qh, 'a@x.com', at(23), 'calendar')).toBe(false);
  });
});
