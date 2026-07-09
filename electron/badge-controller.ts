import { totalUnread } from './badge-math';

export function applyBadge(
  counts: Record<string, number>,
  setBadge: (n: number) => void,
  excluded: Set<string> = new Set(),
): number {
  const total = totalUnread(counts, excluded);
  setBadge(total);
  return total;
}
