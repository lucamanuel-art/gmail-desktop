// Tokens for delegated mailboxes, minted by the relay.
//
// Why not simply an access token like every other account: the Gmail API has no
// notion of a delegate, so reading or writing in a delegated mailbox needs a
// token that impersonates it. That takes a service-account key with domain-wide
// delegation, and such a key is a password for every mailbox in the domain — far
// too dangerous to ship inside the app. So the relay holds the key, checks with
// Google whether the requester really is a delegate, and only then mints.
//
// Deliberately NOT stored on disk, unlike OAuthStore: these last an hour and can
// always be re-minted, so writing them down would add risk and buy nothing.

export interface MintedToken {
  accessToken: string;
  /** Epoch ms; the relay already subtracted a minute of slack. */
  expiresAt: number;
}

export interface DelegatedTokenDeps {
  tokenUrl: string;
  // The relay authorizes on who is asking, so the request must carry the token
  // of the account that actually holds the delegation — see delegated-owner.ts.
  ownerToken: (mailbox: string) => Promise<string | null>;
  fetch?: typeof fetch;
  now?: () => number;
  log?: (msg: string) => void;
}

export class DelegatedTokenSource {
  private cache = new Map<string, MintedToken>();

  constructor(private readonly deps: DelegatedTokenDeps) {}

  /** A valid token for this mailbox, minted only if the cached one is gone. */
  async get(mailbox: string): Promise<string | null> {
    const key = mailbox.trim().toLowerCase();
    const hit = this.cache.get(key);
    if (hit && (this.deps.now ?? Date.now)() < hit.expiresAt) return hit.accessToken;
    return this.mint(key);
  }

  /**
   * Mint regardless of the cache. For the 401 path: Google rejecting a token is
   * the final word on whether it is alive, whatever our own clock believes.
   */
  async forceMint(mailbox: string): Promise<string | null> {
    return this.mint(mailbox.trim().toLowerCase());
  }

  forget(mailbox: string): void {
    this.cache.delete(mailbox.trim().toLowerCase());
  }

  private async mint(mailbox: string): Promise<string | null> {
    const owner = await this.deps.ownerToken(mailbox);
    // No token for the owning account means there is nothing to authenticate the
    // request with; asking anyway would only earn a 401.
    if (!owner) return null;

    const doFetch = this.deps.fetch ?? fetch;
    let res: Response;
    try {
      res = await doFetch(this.deps.tokenUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${owner}` },
        body: JSON.stringify({ mailbox }),
      });
    } catch {
      this.deps.log?.(`[delegated] relay unreachable for ${mailbox}`);
      return null;
    }
    if (!res.ok) {
      // 403 is the normal answer for a mailbox that is not delegated to us; the
      // caller turns this into a message in the interface, not a crash.
      this.deps.log?.(`[delegated] relay refused ${mailbox}: HTTP ${res.status}`);
      return null;
    }

    let json: Partial<MintedToken>;
    try {
      json = (await res.json()) as Partial<MintedToken>;
    } catch {
      return null;
    }
    if (typeof json.accessToken !== 'string' || typeof json.expiresAt !== 'number') return null;

    this.cache.set(mailbox, { accessToken: json.accessToken, expiresAt: json.expiresAt });
    return json.accessToken;
  }
}
