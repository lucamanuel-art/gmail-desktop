// The delegation contract: the exact Gmail URL forms, account-switcher DOM
// shape and calendar redirect signals Google uses for delegated mailboxes.
//
// OBSERVED LIVE (plan Task 1 spike, 2026-07-09, against a real delegate
// "bart@abovomaxlead.nl" delegated to luca.manuel@abovomaxlead.nl; recorded in
// docs/superpowers/specs/2026-07-08-delegated-mailboxes-sidebar-design.md):
//
//   - Delegated mail URL form:  https://mail.google.com/mail/u/<host>/d/<token>/
//     e.g. https://mail.google.com/mail/u/0/d/AEoRXRT...EvLsatGZu6d_R/
//     The <token> is OPAQUE — it cannot be derived from the delegate's email,
//     which is why we adopt Google's own href verbatim and why click-through
//     capture (not typed-email) is the primary add path (plan Task 7).
//   - The switcher entry is an <a> in a cross-origin ogs.google.com One-Google
//     widget, loaded lazily only after the avatar is clicked. Its text carries
//     the delegate name + email + a localized "Gemachtigd"/"Delegated" badge.
//   - GATE 1 = FAIL for a robust auto-scan: that widget is cross-origin to the
//     mail view, so the app's executeJavaScript there cannot read it. Auto-scan
//     (plan Task 8) is therefore dropped; the feature ships click-through only.
//   - The locale-INDEPENDENT marker of a delegated mail URL is the "/d/<token>/"
//     path segment (isDelegatedMailUrl below) — never the badge text.
//
// Constraints (see plan Global Constraints):
//   - No OAuth/API — only the logged-in Google web session in embedded views.
//   - Locale-independent — match structure / href only, never UI text (the
//     user's Gmail is Dutch, and may be switched to any language).
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
 * True when a URL is a delegated Gmail mailbox, i.e. matches the observed
 * `/mail/u/<host>/d/<opaque-token>/` form — as opposed to a normal authuser
 * `/mail/u/<n>/` inbox. Locale-independent (path structure only). Used by the
 * click-through capture flow (plan Task 7) to validate that the URL the view
 * landed on really is a delegated mailbox before registering it.
 */
export function isDelegatedMailUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname === 'mail.google.com' && /^\/mail\/u\/\d+\/d\/[^/]+/.test(u.pathname);
  } catch {
    return false;
  }
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
 * GATE 1 FAILED in the Task 1 live spike: the switcher is a cross-origin
 * ogs.google.com widget the mail view's executeJavaScript cannot read, so the
 * auto-scan (plan Task 8) is DROPPED and this stays a no-op. Kept as a documented
 * anchor: were Google ever to render the chooser same-origin, the delegated
 * entries are `<a href*="/d/">` whose text carries the delegate email — but the
 * primary click-through path (Task 7) does not depend on any of this.
 */
export const SWITCHER_SCRAPE_JS = `(() => {
  // No-op: Gate 1 failed (cross-origin One-Google widget). See doc above.
  return [];
})()`;
