import { totalUnread } from './badge-math';

export function applyBadge(
  counts: Record<string, number>,
  setBadge: (n: number) => void,
  excluded: Set<string> = new Set(),
  clearOverlay?: () => void,
): number {
  const total = totalUnread(counts, excluded);
  setBadge(total);
  // On Windows, app.setBadgeCount's overlay clear doesn't reliably stick (e.g. when
  // the window was hidden to tray as unread dropped), leaving a stale number on the
  // taskbar. Let the caller explicitly clear the overlay once nothing is unread.
  if (total === 0) clearOverlay?.();
  return total;
}
