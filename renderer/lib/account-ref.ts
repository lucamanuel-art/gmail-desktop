// A stable, self-describing account identity, replacing the bare integer index
// that was threaded through the view layer and IPC. Pure data — no Electron or
// DOM imports — so it is importable by Next.js, the esbuild main bundle and
// vitest alike (mirrors surfaces.ts's placement rationale).

export type AccountRef =
  | { kind: 'authuser'; index: number }
  | { kind: 'delegated'; email: string; mailUrl: string; calendarUrl: string | null };

/**
 * Stable string key for an account: `u<index>` for an authuser slot,
 * `d:<email>` for a delegated mailbox. Used for view-map keys, unread/notify
 * routing, activation, ordering, colors and the removed-list.
 */
export function accountKey(ref: AccountRef): string {
  return ref.kind === 'authuser' ? `u${ref.index}` : `d:${ref.email}`;
}

/** Inverse of accountKey: recover the discriminant + identity from a key. */
export function parseAccountKey(
  key: string,
): { kind: 'authuser'; index: number } | { kind: 'delegated'; email: string } {
  if (key.startsWith('d:')) return { kind: 'delegated', email: key.slice(2) };
  return { kind: 'authuser', index: Number(key.slice(1)) };
}
