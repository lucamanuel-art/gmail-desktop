// Where the app can ask for a token for a delegated mailbox. Is this missing,
// then copying into delegated mailboxes stays off and the app behaves exactly as
// it did before — the same pattern as push (`push-config.ts`).
//
// The config itself sits with the OAuth details in userData and not in the repo:
// the repo is public. Environment wins, so a local relay can be tested without
// touching the file.
export interface DelegatedConfig {
  tokenUrl: string;
}

const HTTP_SCHEME = /^https?:\/\//i;
const PLAIN_SCHEME = /^http:\/\//i;

// The request carries a live Google access token in its Authorization header, so
// plain http may only go to this machine — which is exactly what testing against
// a local relay needs. Same rule, same reason, as push-config's ws:// check.
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1']);

function isLoopback(url: string): boolean {
  try {
    // URL gives an IPv6 host back WITH its brackets ('[::1]', not '::1'), which
    // we strip here rather than putting bracketed forms in the set.
    const hostname = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return LOOPBACK.has(hostname);
  } catch {
    return false; // unreadable url: certainly not a deliberate local test
  }
}

export function parseDelegatedConfig(raw: unknown, env: NodeJS.ProcessEnv): DelegatedConfig | null {
  const file = (raw ?? {}) as { delegatedTokenUrl?: unknown };
  const fromEnv = (env.GMAIL_DELEGATED_TOKEN_URL ?? '').trim();
  const fromFile = typeof file.delegatedTokenUrl === 'string' ? file.delegatedTokenUrl.trim() : '';
  const tokenUrl = fromEnv || fromFile;
  if (!tokenUrl) return null;
  // A ws:// or bare host would only break at request time, with an error that
  // says nothing about the cause. Refusing here is clearer.
  if (!HTTP_SCHEME.test(tokenUrl)) return null;
  if (PLAIN_SCHEME.test(tokenUrl) && !isLoopback(tokenUrl)) return null;
  return { tokenUrl };
}
