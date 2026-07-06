import { totalUnread } from './badge-math';

export function applyBadge(
  counts: Record<string, number>,
  setBadge: (n: number) => void,
): number {
  const total = totalUnread(counts);
  setBadge(total);
  return total;
}
