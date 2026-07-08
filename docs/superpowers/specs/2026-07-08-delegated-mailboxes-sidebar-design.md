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

### 2. Detection (hybrid: auto-detect + manual fallback)

- **Auto-detect (primary).** After the existing authuser probe finishes, run a
  new **delegation scan**: in account `/u/0/`'s mail view, read the account
  switcher and extract every entry Google marks as delegated — email + the href
  Google points it at. This yields **all** delegated mailboxes at once
  (the user has several), each becoming a `kind: 'delegated'` profile.
  Locale-independent DOM matching only.
- **Manual fallback.** The sidebar "+" menu gains an "Add delegated mailbox"
  entry (email input) for anything the scan misses; it creates the same profile
  shape using the Task 0 URL form.
- **Dedup / removal / ordering.** Keyed by `accountKey`, so delegated mailboxes
  coexist with authuser accounts in `removed-store`, `prefs-store` order, and
  colors with no collisions. A delegated mailbox whose delegate email equals an
  already-detected authuser account is skipped (it's the same inbox).
- Detection stays a pure planner where practical: extend/parallel
  `detection-planner.ts` with a delegation planner that takes the scraped list
  and returns which entries to register vs skip.

### 3. Calendar "if available"

Mail delegation and calendar sharing are independent. For each delegated
mailbox, **probe** the delegated calendar URL (from Task 0) in a hidden view; if
it loads a real calendar (not a permission/error page), set `hasCalendar: true`
and render the Calendar icon. Otherwise render mail only. The probe result is
cached on the profile so it isn't repeated every render.

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

- **Task 0 URL wrong / Google changes it:** the manual-add fallback and the fact
  that we adopt Google's own href (not a constructed URL) limit blast radius; a
  delegated view that fails to load shows Google's own error inside the view.
- **Delegate access revoked:** the view loads Google's "no access" page; the
  user removes the entry via the existing remove flow. (No special-casing in v1.)
- **Same inbox as an owned account:** deduped by email during detection.
- **Locale:** all new DOM scraping matches structure/attributes only, never
  Dutch/English text.

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
