import type { DelegatedEntry } from './delegation';

// Decide which scraped/captured delegated entries to register. Pure: lowercase,
// dedupe, and exclude any whose email matches an owned authuser account or whose
// `d:<email>` key the user has removed. Shared by the click-through capture path
// (Task 7) and the best-effort auto-scan suggestions (Task 8).
export function planDelegated(
  entries: DelegatedEntry[],
  knownAuthuserEmails: string[],
  removedKeys: string[],
): DelegatedEntry[] {
  const owned = new Set(knownAuthuserEmails.map((x) => x.toLowerCase()));
  const removed = new Set(removedKeys);
  const seen = new Set<string>();
  const out: DelegatedEntry[] = [];
  for (const entry of entries) {
    const email = entry.email.toLowerCase();
    if (owned.has(email) || removed.has(`d:${email}`) || seen.has(email)) continue;
    seen.add(email);
    out.push({ ...entry, email });
  }
  return out;
}
