export interface MailtoFields {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
}

// decodeURIComponent, but tolerant of malformed sequences (never throws).
function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

// Split a raw comma list into decoded, trimmed, non-empty addresses.
function recipients(raw: string): string[] {
  return raw
    .split(',')
    .map((t) => decode(t).trim())
    .filter(Boolean);
}

/** Parse a mailto: URL into Gmail compose fields, or null if not a mailto. */
export function parseMailto(url: string): MailtoFields | null {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!/^mailto:/i.test(trimmed)) return null;
  const rest = trimmed.slice('mailto:'.length);
  const q = rest.indexOf('?');
  const pathPart = q === -1 ? rest : rest.slice(0, q);
  const queryPart = q === -1 ? '' : rest.slice(q + 1);

  // Store RAW (undecoded) query values, first occurrence wins; decode per field.
  const query: Record<string, string> = {};
  for (const pair of queryPart.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const key = (eq === -1 ? pair : pair.slice(0, eq)).toLowerCase();
    const val = eq === -1 ? '' : pair.slice(eq + 1);
    if (!(key in query)) query[key] = val;
  }

  return {
    to: [...recipients(pathPart), ...recipients(query.to ?? '')].join(','),
    cc: recipients(query.cc ?? '').join(','),
    bcc: recipients(query.bcc ?? '').join(','),
    subject: decode(query.subject ?? ''),
    body: decode(query.body ?? ''),
  };
}

/** First argv entry that is a mailto: URL, else null. */
export function extractMailtoFromArgv(argv: string[]): string | null {
  if (!Array.isArray(argv)) return null;
  return argv.find((a) => typeof a === 'string' && /^mailto:/i.test(a.trim())) ?? null;
}
