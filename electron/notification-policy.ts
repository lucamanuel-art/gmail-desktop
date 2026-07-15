import type { Prefs } from './prefs-store';
import type { Surface } from '../renderer/lib/surfaces';

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function inQuietHours(start: string, end: string, minutes: number): boolean {
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (s === e) return false;
  if (s < e) return minutes >= s && minutes < e; // same-day window
  return minutes >= s || minutes < e; // crosses midnight
}

export function notificationsAllowed(
  prefs: Prefs,
  email: string,
  now: Date,
  surface: Surface = 'mail',
): boolean {
  const { dnd, dndUntil, quietHours } = prefs.notifications;
  if (dnd) return false;
  if (dndUntil && now.getTime() < dndUntil) return false;
  if (
    quietHours.enabled &&
    inQuietHours(quietHours.start, quietHours.end, now.getHours() * 60 + now.getMinutes())
  ) {
    return false;
  }
  const account = prefs.accounts[email];
  if (surface === 'calendar') return account?.calendarNotify === true;
  if (surface !== 'mail') return false; // v1: the other Google apps never notify
  return account?.notify !== false;
}

export function notificationSilent(
  prefs: Prefs,
  email: string,
  surface: Surface = 'mail',
): boolean {
  if (surface !== 'mail') return false; // v1: only mail honours the sound toggle
  return prefs.accounts[email]?.notifySound === false;
}
