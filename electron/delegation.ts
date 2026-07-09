// The delegation contract: the exact Gmail URL forms, account-switcher DOM
// shape and calendar redirect signals Google uses for delegated mailboxes.
//
// These are OBSERVED, not guessed (Google has shipped several forms over the
// years). The pure, typed surface below is final; the concrete URL / DOM /
// redirect patterns marked "OBSERVE" are filled in from a live CDP spike
// against a real delegated mailbox (plan Task 1, Steps 1-4) and recorded in
// docs/superpowers/specs/2026-07-08-delegated-mailboxes-sidebar-design.md.
//
// Constraints (see plan Global Constraints):
//   - No OAuth/API — only the logged-in Google web session in embedded views.
//   - Locale-independent — match structure / stable attributes / href only,
//     never UI text (the user's Gmail is Dutch, and may be switched to any
//     language). aria-label/title/textContent are localized and off-limits.
//   - Adopt Google's own URLs verbatim — never construct a guessed one.

/** A delegated mailbox as discovered from Google's account switcher. */
export interface DelegatedEntry {
  email: string;
  /** Google's own mail href, adopted verbatim. */
  mailUrl: string;
}

/**
 * Normalize raw {email, href} pairs (from a switcher scrape or a captured
 * navigation) into DelegatedEntry values: trim/lowercase the email, drop
 * anything missing an email or href. Pure and DOM-free so it is unit-testable.
 */
export function parseDelegatedEntries(
  raw: Array<{ email: string; href: string }>,
): DelegatedEntry[] {
  return raw
    .filter((r) => r.email && r.href)
    .map((r) => ({ email: r.email.trim().toLowerCase(), mailUrl: r.href }));
}

/** The mail URL for a delegated entry — Google's own href, adopted verbatim. */
export function delegatedMailUrl(entry: DelegatedEntry): string {
  return entry.mailUrl;
}

/**
 * The delegated-calendar URL for an entry, or null if none can be derived.
 *
 * OBSERVE (plan Task 1, Step 3): the delegated-calendar URL form. Until the
 * spike records it, return null (calendar treated as unavailable — mail-only),
 * which is the safe default: a missing calendar icon, never a wrong one.
 */
export function delegatedCalendarUrl(_entry: DelegatedEntry): string | null {
  return null;
}

/**
 * True when a navigated calendar URL redirected to Google's "no access" form.
 * Availability is judged by the final redirect URL, not page content, so it is
 * locale-proof (plan Task 9 / design §3).
 *
 * OBSERVE (plan Task 1, Step 3): the no-access redirect URL pattern. Until the
 * spike records it, return false (treat as no observed no-access signal).
 */
export function isCalendarNoAccessUrl(_finalUrl: string): boolean {
  return false;
}

/**
 * In-page JS (run via WebContents.executeJavaScript in the /u/0/ mail view)
 * that reads Google's account switcher and returns
 * `Array<{ email: string, href: string }>` for the delegated entries only,
 * matched locale-independently through a layered selector chain
 * (stable id/data-* -> href pattern -> structural shape).
 *
 * This powers the best-effort auto-scan SUGGESTIONS only (plan Task 8), which
 * never auto-adds; the primary add path is click-through capture (Task 7) and
 * does not use this. It ships only if Gate 1 (Task 1, Step 2) passes.
 *
 * OBSERVE (plan Task 1, Steps 2-3): the actual selector chain. Until then this
 * returns an empty list so the auto-scan finds nothing (safe no-op) while the
 * primary click-through path and persistence work unaffected.
 */
export const SWITCHER_SCRAPE_JS = `(() => {
  // OBSERVE: replace with the layered, locale-independent selector chain
  // recorded during the Task 1 live spike. Structure / stable attributes /
  // href only — never UI text, aria-label, title or textContent.
  return [];
})()`;
