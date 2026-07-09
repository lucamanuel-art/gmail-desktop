# Delegated mailboxes in the sidebar — design

**Date:** 2026-07-08
**Status:** Design approved; implementation deferred (build tomorrow)

## Goal

Show Gmail **delegated mailboxes** — inboxes another Google account has granted
this user access to — as first-class entries in the sidebar, alongside the
user's own logged-in accounts. Each delegated mailbox gets a mail avatar
(read/send as the delegate), an unread badge, and desktop notifications. A
Calendar icon appears **only when** that delegated account also shares a
calendar the user can open.

Out of scope: Drive/Docs/Sheets/Slides/Keep/Contacts/Chat for delegated
mailboxes (Gmail delegation does not grant these), and any change to how the
user's own `/u/N/` accounts are detected.

## Background: how accounts work today

- One shared Electron session partition `persist:google`; no OAuth/API, just the
  logged-in Google web session inside embedded `WebContentsView`s.
- The user's own accounts are Google multi-login "authuser" slots. Detection
  probes `/u/0/`, `/u/1/`, … scraping each account's identity from the Gmail
  DOM, stopping when an email repeats or at 10 (`detection-planner.ts`).
- Every surface URL is built from that integer: `surfaces.ts` `url(index)` →
  `https://mail.google.com/mail/u/${i}/`, etc.
- The view layer (`profile-view-manager.ts`) keys views by `` `${index}:${surface}` ``
  and every IPC callback (`onUnread(index)`, `onActivate(index, surface)`,
  `onIdentity(index)`, zoom) is threaded by that integer index.
- Persistence, however, is **already email-keyed**: `prefs-store.ts` stores
  `accounts: Record<email, AccountPref>` and orders by email. `color-store` and
  `removed-store` similarly key by a stable identifier, not the raw index.

Delegated mailboxes break the integer-index assumption: Google does **not** give
a delegated mailbox its own authuser slot. It appears inside a host account's
Gmail account-switcher with a distinct URL form. So the core of this work is
generalizing "an account is an integer" into "an account is a reference that
knows how to build its own URLs and has a stable key."

## Task 0 (do first, tomorrow): capture the real delegation contract

Everything downstream depends on the exact URL and switcher DOM Google uses,
which we must observe rather than guess (Google has shipped several forms over
the years). Using the CDP live-test harness (launch with
`--remote-debugging-port`, attach via `Runtime.evaluate`), on the user's real
delegated mailbox capture and record in this spec:

1. **The delegated mail URL** Google itself links to from the account switcher
   (e.g. a `/mail/u/0/?authuser=<email>` form, or a `/mail/b/<delegate-id>/`
   form). We adopt Google's URL verbatim — never construct a guessed one.
2. **The switcher DOM shape**: how delegated entries are marked, and which
   attribute carries the email and the href. Must be matched
   locale-independently (the user's Gmail is Dutch) — structure/attributes only,
   never UI text.
3. **Whether a delegated Calendar is reachable**, and at what URL, so the
   "calendar if available" probe has a concrete target.

The rest of the plan is written against these placeholders; the first
implementation step fills them in and the URL builders are finalized then.

**Two go/no-go gates** are decided during Task 0 — treat it as a spike with a
kill switch, not a commitment to the full build:

1. **Can the switcher be read without a trusted click?** If delegated entries
   only render after a user gesture we can't reliably synthesize into a Gmail
   view, the zero-click *auto-scan suggestions* are off the table and the
   feature ships **click-through-capture only** (still fully useful — the user
   just clicks the delegate themselves). This does not block the feature — see
   the detection design, which makes click-through capture primary regardless.
2. **Do unread + notifications fire for a delegated inbox?** Quick spike: does
   the delegated mail view report unread and raise a notification like an owned
   account? If not, the feature ships as delegated **viewing**, not delegated
   **alerting**, and that limitation is documented rather than forced.

Record both answers in this section; they determine the scope actually built.

### Task 0 findings (observed live 2026-07-09)

Spike run against a real delegate **bart@abovomaxlead.nl** delegated to
**luca.manuel@abovomaxlead.nl** (`/u/0/`), Dutch UI, via the CDP harness.

1. **Delegated mail URL:** `https://mail.google.com/mail/u/<host>/d/<opaque-token>/`
   — observed `https://mail.google.com/mail/u/0/d/AEoRXRT…EvLsatGZu6d_R/`. The
   token is **opaque**: it cannot be derived from the delegate's email, so a
   typed-email add is impossible and we must adopt Google's href verbatim. This
   confirms **click-through capture as the primary (and only robust) add path**.
2. **Switcher DOM shape:** the entry is an `<a>` inside a **cross-origin
   `ogs.google.com` One-Google widget** that loads lazily only after the avatar
   is clicked. Its text carries name + email + a localized badge
   ("Gemachtigd" in NL, "Delegated" in EN). The **locale-independent** marker of
   a delegated mailbox is the **`/d/<token>/` href segment** (`isDelegatedMailUrl`),
   never the badge text.
3. **Delegated Calendar:** none reachable for this delegate (Gmail delegation
   doesn't grant calendar). No delegated-calendar URL or no-access redirect was
   observable here, so `calendarUrl` defaults to `null` (mail-only). The probe
   (design §3 / plan Task 9) stays, to be exercised if a delegate ever shares a
   calendar.

**GATE 1 — read switcher without a trusted click? → PASS (fragile).** A
*programmatic* `.click()` (no trusted gesture) opens the One-Google widget, and
its delegated entries — `{email, href}` including the opaque `/d/` URL — are
readable from the `ogs.google.com` frame's own context (in Electron via
`WebFrameMain.executeJavaScript` on the subframe, which the cross-origin wall
does not block; the mail view's *own* `executeJavaScript` cannot, which is what
initially looked like a fail). So auto-detection is feasible but depends on
Google's internal widget markup (obfuscated, churned) and on timing the lazily
loaded frame. **Decision (user, 2026-07-09): ship auto-detect as best-effort
SUGGESTIONS** the user one-click accepts (plan Task 8) — never auto-adding, so it
can't fight curation — with click-through capture (Task 7) as the primary path
and durable fallback, and persistence keeping known mailboxes when the scrape
eventually breaks.

**GATE 2 — do unread + notifications fire for a delegated inbox? → PENDING.**
Not yet confirmable: it requires the delegated view running under the app's own
preload, which the click-through capture path (Task 7) builds. To be recorded in
Task 11. Strong prior it PASSES (the delegated mailbox is ordinary
`mail.google.com` served in the same session with the same preload machinery).

## Design

### 1. Account identity model (the central change)

Introduce a stable string **account key** and a **surface-URL reference**,
replacing the bare integer as the thing threaded through the view layer and IPC.

- `accountKey`: `` `u${index}` `` for an authuser account, `` `d:${email}` `` for a
  delegated mailbox. Used for view-map keys, unread/notify routing, activation,
  ordering, colors, removed-list.
- The `Profile` type gains a discriminant and carries the info needed to build
  URLs:
  - authuser: `{ kind: 'authuser', index, email, name, avatarUrl, color, … }`
  - delegated: `{ kind: 'delegated', hostIndex, delegate, email, name,
    avatarUrl, color, hasCalendar, … }` where `delegate`/`hostIndex` are exactly
    what Task 0 determined is needed to reconstruct Google's URL.
- `surfaces.ts`: change `url(index: number)` to `url(ref: AccountRef)` where
  `AccountRef` is the discriminated union above (or the minimal fields each
  builder needs). Authuser builders keep `/u/${index}/`; delegated builders emit
  the captured mail (and, if present, calendar) URL. Surfaces that don't apply
  to delegated accounts simply aren't offered for them.
- `profile-view-manager.ts`: replace `key(index, surface)` with
  `key(accountKey, surface)` and change the `onUnread`/`onActivate`/`onIdentity`/
  zoom callback signatures from `index: number` to `accountKey: string`. This is
  mechanical but touches every call site in `main.ts`.

This keeps each account self-describing: the view manager no longer knows or
cares whether an account is an authuser slot or a delegate — it just asks the
ref for its URL and routes by key.

### 2. Detection (persistence-first; manual primary, auto-scan best-effort)

The design goal is **graceful degradation**: because delegated discovery lives
in Google's DOM (which we don't control and can't test against), the feature
must never *silently lose* a working mailbox when Google reshuffles its UI. The
scrape is treated as a convenience layered on top of durable persistence and
manual control, not as the thing the feature depends on.

- **Persist last-known-good (durability layer).** A new `delegated-store`
  persists each known delegated mailbox: `{ email, mailUrl, calendarUrl }`.
  Because we adopt Google's *real* href, a persisted entry keeps working
  regardless of the switcher DOM. On launch the sidebar is populated from this
  store immediately; detection only ever *adds* to it. This converts the top
  risk from "mailboxes silently vanish" into "you keep everything; only
  discovery of a brand-new mailbox may need a manual add."
- **Click-through capture (primary path).** The sidebar "+" menu gains "Add
  delegated mailbox," which opens Google's **own** account switcher in a visible
  view and lets the user click the delegate they want; we record the URL the
  view lands on (`did-navigate`) and write it to `delegated-store`. This never
  scrapes the switcher DOM — the human does the selection, we only observe the
  landed URL — so it rides Google's durable URL contract, is locale- and
  redesign-proof, captures the exact real URL even when it is opaque (a form no
  typed email could reconstruct), and lets the user curate **exactly which**
  mailboxes appear. It is the primary way to add a mailbox and the guaranteed
  fallback if auto-scan ever stops working.
- **Auto-scan → suggestions (optional convenience).** After authuser detection,
  attempt to read the account switcher in `/u/0/` mail and extract delegated
  entries (email + Google's href), locale-independently. Any found are shown as
  **suggestions** the user can one-click accept (routing through the capture
  path above) — the scan **never auto-adds** to `delegated-store`, so it cannot
  fight the user's curation or resurrect a removed mailbox. This saves typing
  when it works, but the feature does not rely on it.
  - **Layered selectors:** match each entry through a fallback chain (stable
    `jslog` id → href pattern → structural shape), so a single DOM change does
    not kill detection.
  - **Health check — never drop to zero:** a scan that returns *fewer* entries
    than the store already holds is treated as "scrape probably broke," not as
    "mailboxes removed." The store is kept intact and a non-fatal
    "couldn't refresh delegated accounts" hint is surfaced. Only explicit user
    removal deletes an entry.
- **Dedup / removal / ordering.** Keyed by `accountKey`, so delegated mailboxes
  coexist with authuser accounts in `removed-store`, `prefs-store` order, and
  colors with no collisions. A delegated mailbox whose email equals an
  already-detected authuser account is skipped (it's the same inbox).
- Detection stays a pure planner where practical: a delegation planner takes the
  scraped list plus the store and returns which entries to register vs skip.

### 3. Calendar "if available"

Mail delegation and calendar sharing are independent. For each delegated
mailbox, **probe** the delegated calendar URL (from Task 0) in a hidden view.
Judge reachability by the **navigation/redirect signal**, not page content:
Google redirects a no-access calendar to a predictable URL, so read the final
URL after `did-navigate`/`did-redirect-navigation` (and the HTTP response)
rather than scraping the page DOM. This is far more stable than recognizing an
error page's markup and is locale-proof for free. On success set the profile's
`calendarUrl`; otherwise leave it `null` (mail only). The result is persisted in
`delegated-store` so it isn't re-probed every launch.

### 4. Sidebar rendering

`renderer/app/page.tsx` renders delegated profiles with the same avatar + mail
button + unread badge as authuser accounts, and the Calendar icon **conditional
on `hasCalendar`**. No waffle flyout for delegated profiles (no extra surfaces).
A subtle visual marker (e.g. a small badge/overlay on the avatar) distinguishes
a delegated mailbox from an owned account so the user can tell them apart.
Drag-reorder and per-account label/color continue to work via `accountKey`.

### 5. Unread + notifications

The mail preload already reports unread and raises notifications per view; since
those now route by `accountKey`, delegated mailboxes get badges and
notifications with no preload change beyond the key rename. Per-account
`notify`/`calendarNotify`/quiet-hours prefs apply unchanged (email-keyed).

## Error handling & edge cases

- **Switcher DOM changes / Google changes the URL:** contained, not eliminated.
  Persisted mailboxes keep working (real Google hrefs); the health check keeps
  the store intact when a scan returns fewer entries; manual-add always works.
  Worst case degrades to "auto-discovery of new mailboxes stops," never "working
  mailboxes disappear."
- **Delegate access revoked:** the view loads Google's "no access" page; the
  user removes the entry via the existing remove flow. (No special-casing in v1.)
- **Same inbox as an owned account:** deduped by email during detection.
- **Locale:** all new DOM scraping matches structure/attributes only, never
  Dutch/English text; failure/availability detection uses redirect URLs, not
  page text.

## Risk register (irreducible vs contained)

This feature scrapes a product Google controls, so it *will* eventually need
maintenance. The design contains the failure modes so they degrade instead of
breaking hard:

| Risk | Likelihood | Mitigation | Residual |
| --- | --- | --- | --- |
| Switcher DOM changes → auto-scan stops finding mailboxes | High, eventually | Persist last-known-good + click-through capture primary (no scrape) + health check + layered selectors | Auto-scan *suggestions* stop; adding via click-through and all existing mailboxes unaffected |
| Switcher needs a trusted click we can't synthesize | Unknown until Task 0 | Click-through capture is primary (the user clicks); auto-scan suggestions are best-effort | Ship click-through-only (go/no-go gate 1) |
| Unread/notifications don't fire for delegated inbox | Medium | Same preload as owned accounts (delegated view is a normal Gmail page) | Ship viewing without alerting (go/no-go gate 2) |
| Calendar availability misjudged | Low | Redirect-URL signal, not DOM scraping | Rare wrong icon; user ignores |
| Shared session (account 0) expires | Low | Recovers on re-login | Temporary breakage |

## Testing

- **Pure logic (vitest):** the delegation planner (register/skip/dedup against
  authuser emails), account-key derivation, and the generalized `surfaces.ts`
  URL builders for both `kind`s. These need no Electron and are the bulk of the
  automated coverage.
- **Live smoke (CDP harness):** after Task 0, confirm a real delegated mailbox
  is detected, its mail view loads, the calendar probe resolves correctly, and
  an unread/notification routes to the right `accountKey`.

## Rollout / risk

Single incremental feature, no data migration (prefs already email-keyed). The
riskiest unknown (the URL/DOM contract) is retired by Task 0 before any
downstream code is written. The index→accountKey rename is broad but mechanical
and covered by the existing type checker plus the pure tests.
