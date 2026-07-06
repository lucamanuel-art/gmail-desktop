export function parseUnreadCount(title: string | null | undefined): number {
  if (!title) return 0;
  const match = title.match(/\((\d+)\)/);
  if (!match) return 0;
  const n = parseInt(match[1], 10);
  return Number.isFinite(n) ? n : 0;
}
