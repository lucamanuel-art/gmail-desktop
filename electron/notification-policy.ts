import type { Prefs } from './prefs-store';

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

export function notificationsAllowed(prefs: Prefs, email: string, now: Date): boolean {
  const { dnd, quietHours } = prefs.notifications;
  if (dnd) return false;
  if (quietHours.enabled && inQuietHours(quietHours.start, quietHours.end, now.getHours() * 60 + now.getMinutes())) {
    return false;
  }
  if (prefs.accounts[email]?.notify === false) return false;
  return true;
}
