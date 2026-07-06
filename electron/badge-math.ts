export function totalUnread(counts: Record<string, number>): number {
  return Object.values(counts).reduce(
    (sum, n) => sum + (Number.isFinite(n) ? n : 0),
    0,
  );
}
