// Which of your own accounts holds the delegation for a delegated mailbox.
//
// The relay decides whether a token may be minted by asking Google who the
// mailbox's delegates are, and comparing that with whoever authenticated the
// request. So the request has to go out as the account that actually holds the
// delegation, not just any connected account.
//
// Google's own url tells us: a delegated mailbox lives at
// `/mail/u/<n>/d/<opaque>/`, where <n> is the authuser index of the account it
// hangs under (see the observations at the top of delegation.ts).

const DELEGATED_PATH = /^\/mail\/u\/(\d+)\/d\/[^/]+/;

export function delegatedHostIndex(mailUrl: string): number | null {
  try {
    const u = new URL(mailUrl);
    if (u.hostname !== 'mail.google.com') return null;
    const m = DELEGATED_PATH.exec(u.pathname);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

/**
 * The email of the account the mailbox hangs under, or null when it cannot be
 * determined — the caller then falls back to trying the connected accounts, and
 * a wrong guess simply earns a clean 403 from the relay.
 */
export function ownerFor(
  mailUrl: string,
  authusers: Array<{ index: number; email: string }>,
): string | null {
  const index = delegatedHostIndex(mailUrl);
  if (index === null) return null;
  return authusers.find((a) => a.index === index)?.email ?? null;
}
