# Delegated Mailboxes in the Sidebar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show Gmail delegated mailboxes as first-class sidebar entries (mail + unread + notifications, and a Calendar icon when a delegated calendar is reachable), alongside the user's own authuser accounts.

**Architecture:** Generalize the account identity from a bare integer `index` into a stable string `accountKey` plus a discriminated `AccountRef` that knows how to build its own surface URLs. A new delegation scan reads Google's account switcher (in `/u/0/` mail) to discover delegated mailboxes, adopting Google's own URLs. The view layer, IPC, and sidebar route by `accountKey`; persistence is already email-keyed and needs no migration.

**Tech Stack:** TypeScript, Electron (`WebContentsView`, shared `persist:google` session), Next.js renderer, vitest for pure logic, CDP live-test harness for Electron smoke.

## Global Constraints

- **No OAuth/API** — authentication is the logged-in Google web session inside embedded views only.
- **Locale-independent DOM scraping** — the user's Gmail is Dutch; match structure/attributes/`jslog`/href only, never UI text.
- **Adopt Google's URLs verbatim** for delegated surfaces — never construct a guessed delegation URL; use the href Google itself links to.
- **`surfaces.ts` stays pure data** — no Electron or DOM imports (it is shared by main, preload, renderer).
- **Delegated scope is mail + calendar only** — no Drive/Docs/Sheets/Slides/Keep/Contacts/Chat for delegated mailboxes.
- **Frequent commits** — one per task, Conventional Commits, type-only prefix, no scope, imperative, no `Co-authored-by` trailer (house style).

---

### Task 1: Capture the delegation contract → `electron/delegation.ts`

The whole feature pivots on the exact URL and switcher DOM Google uses. This task observes them on the user's real delegated mailbox and encodes the findings as typed functions the rest of the plan consumes. There is no unit test here — the deliverable is verified live via the CDP harness and recorded in the spec.

**Files:**
- Create: `electron/delegation.ts`
- Modify: `docs/superpowers/specs/2026-07-08-delegated-mailboxes-sidebar-design.md` (fill the Task 0 placeholders with observed values)

**Interfaces:**
- Produces:
  - `interface DelegatedEntry { email: string; mailUrl: string; }`
  - `parseDelegatedEntries(switcherHtmlOrHandle): DelegatedEntry[]` — pure function operating on a serialisable description of the switcher DOM (array of `{ email, href }` scraped in-page), returning normalised entries. Kept DOM-free so it is unit-testable.
  - `delegatedMailUrl(entry: DelegatedEntry): string` — returns `entry.mailUrl` (Google's own href), normalised.
  - `delegatedCalendarUrl(entry: DelegatedEntry): string | null` — the calendar URL to probe, or `null` if the form observed in Task 1 has no calendar variant.
  - `SWITCHER_SCRAPE_JS: string` — the in-page JS (string) that, run in the `/u/0/` mail view, opens/reads the account switcher and returns `Array<{ email: string; href: string }>` for delegated entries only, matched locale-independently.

- [ ] **Step 1: Launch the app under CDP**

Delete any stale lock, then launch headfully with remote debugging (per the CDP live-test harness notes):

```bash
rm -f ~/.config/gmail-desktop/SingletonLock
DISPLAY=:0 ./node_modules/.bin/electron . --remote-debugging-port=9333
```

- [ ] **Step 2: Observe the delegated mail URL and switcher DOM**

Attach to the `/u/0/` mail page target (`curl http://127.0.0.1:9333/json`), then via `Runtime.evaluate` inspect the account-switcher menu. Record:
- the href Google uses for each delegated mailbox (the `mailUrl` form),
- the DOM attribute carrying the delegate email,
- the structural marker distinguishing a delegated entry from an owned account (attribute / `jslog` / element shape — NOT text).

Write the observed values into the spec's Task 0 section (replace the placeholders).

- [ ] **Step 3: Determine calendar reachability + URL**

Navigate a hidden view to the candidate delegated-calendar URL for one delegated account. Record whether it loads a real calendar vs an error page, and the exact URL form. If no delegated-calendar form exists, `delegatedCalendarUrl` returns `null` and the Calendar icon is simply never shown for delegated mailboxes.

- [ ] **Step 4: Encode findings in `electron/delegation.ts`**

Implement `DelegatedEntry`, `parseDelegatedEntries`, `delegatedMailUrl`, `delegatedCalendarUrl`, and `SWITCHER_SCRAPE_JS` using the observed values. Example shape (fill URL/selectors from observation):

```ts
export interface DelegatedEntry { email: string; mailUrl: string; }

// Pure: takes what SWITCHER_SCRAPE_JS returns, normalises to entries.
export function parseDelegatedEntries(
  raw: Array<{ email: string; href: string }>,
): DelegatedEntry[] {
  return raw
    .filter((r) => r.email && r.href)
    .map((r) => ({ email: r.email.trim().toLowerCase(), mailUrl: r.href }));
}

export function delegatedMailUrl(entry: DelegatedEntry): string {
  return entry.mailUrl; // Google's own href, adopted verbatim
}

export function delegatedCalendarUrl(/* entry */): string | null {
  // Return the observed calendar URL form, or null if none exists.
  return null; // finalised in Step 3
}

// In-page JS, matched locale-independently (structure/attributes only).
export const SWITCHER_SCRAPE_JS = `/* finalised from Step 2 observation */`;
```

- [ ] **Step 5: Commit**

```bash
git add electron/delegation.ts docs/superpowers/specs/2026-07-08-delegated-mailboxes-sidebar-design.md
git commit -m "feat: capture delegated-mailbox URL/switcher contract"
```

---

### Task 2: Account identity model (`accountKey` + `AccountRef`)

**Files:**
- Create: `electron/account-ref.ts`
- Test: `electron/account-ref.test.ts`

**Interfaces:**
- Produces:
  - `type AccountRef = { kind: 'authuser'; index: number } | { kind: 'delegated'; email: string; mailUrl: string; calendarUrl: string | null }`
  - `accountKey(ref: AccountRef): string` → `` `u${index}` `` or `` `d:${email}` ``
  - `parseAccountKey(key: string): { kind: 'authuser'; index: number } | { kind: 'delegated'; email: string }`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { accountKey, parseAccountKey } from './account-ref';

describe('accountKey', () => {
  it('keys authuser accounts by index', () => {
    expect(accountKey({ kind: 'authuser', index: 2 })).toBe('u2');
  });
  it('keys delegated mailboxes by email', () => {
    expect(accountKey({ kind: 'delegated', email: 'team@x.com', mailUrl: 'https://m/', calendarUrl: null }))
      .toBe('d:team@x.com');
  });
  it('round-trips authuser keys', () => {
    expect(parseAccountKey('u2')).toEqual({ kind: 'authuser', index: 2 });
  });
  it('round-trips delegated keys with colons in email intact', () => {
    expect(parseAccountKey('d:team@x.com')).toEqual({ kind: 'delegated', email: 'team@x.com' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/account-ref.test.ts`
Expected: FAIL — cannot find module `./account-ref`.

- [ ] **Step 3: Write minimal implementation**

```ts
export type AccountRef =
  | { kind: 'authuser'; index: number }
  | { kind: 'delegated'; email: string; mailUrl: string; calendarUrl: string | null };

export function accountKey(ref: AccountRef): string {
  return ref.kind === 'authuser' ? `u${ref.index}` : `d:${ref.email}`;
}

export function parseAccountKey(
  key: string,
): { kind: 'authuser'; index: number } | { kind: 'delegated'; email: string } {
  if (key.startsWith('d:')) return { kind: 'delegated', email: key.slice(2) };
  return { kind: 'authuser', index: Number(key.slice(1)) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/account-ref.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/account-ref.ts electron/account-ref.test.ts
git commit -m "feat: add account-ref identity model for accounts"
```

---

### Task 3: Generalize `surfaces.ts` URL builders to take `AccountRef`

**Files:**
- Modify: `renderer/lib/surfaces.ts:21-91` (the `SurfaceConfig.url` signature and each builder)
- Test: `renderer/lib/surfaces.test.ts`

Note: `surfaces.ts` must stay pure. Import the *type* `AccountRef` from a pure module. Move `AccountRef` into `renderer/lib/surfaces.ts` itself (or a sibling pure file under `renderer/lib/`) so Next.js can compile it; `electron/account-ref.ts` re-exports it to keep Task 2's import path. (Adjust Task 2's file to `renderer/lib/account-ref.ts` with an `electron/account-ref.ts` re-export if cleaner — decide at Task 3 and keep consistent.)

**Interfaces:**
- Consumes: `AccountRef` from Task 2.
- Produces: `SurfaceConfig.url(ref: AccountRef): string`; a helper `surfacesForRef(ref: AccountRef): Surface[]` returning `['mail','calendar',...]` for authuser and `['mail']` (+ `'calendar'` when `ref.calendarUrl`) for delegated.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { SURFACE_CONFIG, surfacesForRef } from './surfaces';

describe('surface urls by ref', () => {
  it('builds authuser mail url from index', () => {
    expect(SURFACE_CONFIG.mail.url({ kind: 'authuser', index: 1 }))
      .toBe('https://mail.google.com/mail/u/1/');
  });
  it('builds delegated mail url from Google href', () => {
    expect(SURFACE_CONFIG.mail.url({ kind: 'delegated', email: 't@x.com', mailUrl: 'https://mail.google.com/mail/b/ID/', calendarUrl: null }))
      .toBe('https://mail.google.com/mail/b/ID/');
  });
  it('offers only mail for a delegated ref without calendar', () => {
    expect(surfacesForRef({ kind: 'delegated', email: 't@x.com', mailUrl: 'https://m/', calendarUrl: null }))
      .toEqual(['mail']);
  });
  it('offers mail+calendar for a delegated ref with a calendar', () => {
    expect(surfacesForRef({ kind: 'delegated', email: 't@x.com', mailUrl: 'https://m/', calendarUrl: 'https://c/' }))
      .toEqual(['mail', 'calendar']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run renderer/lib/surfaces.test.ts`
Expected: FAIL — `url` still expects a number / `surfacesForRef` undefined.

- [ ] **Step 3: Implement**

Change `SurfaceConfig.url` to `url(ref: AccountRef): string`. Each authuser builder reads `ref.kind === 'authuser' ? ref.index : 0`-guarded; delegated `mail` returns `ref.mailUrl`, delegated `calendar` returns `ref.calendarUrl!`. Add:

```ts
export function surfacesForRef(ref: AccountRef): Surface[] {
  if (ref.kind === 'authuser') return [...SURFACES];
  return ref.calendarUrl ? ['mail', 'calendar'] : ['mail'];
}
```

For authuser, keep existing `/u/${index}/` forms (extract `const i = ref.kind === 'authuser' ? ref.index : 0;` at the top of each builder, or a shared `authIndex(ref)` helper). Delegated builders for non-mail/calendar surfaces are never called (guarded by `surfacesForRef`), but should throw a clear error if reached rather than emit a wrong URL.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run renderer/lib/surfaces.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add renderer/lib/surfaces.ts renderer/lib/surfaces.test.ts renderer/lib/account-ref.ts electron/account-ref.ts
git commit -m "feat: build surface urls from account-ref"
```

---

### Task 4: Delegation planner (register/skip/dedup) — pure

**Files:**
- Create: `electron/delegation-planner.ts`
- Test: `electron/delegation-planner.test.ts`

**Interfaces:**
- Consumes: `DelegatedEntry` (Task 1), the list of already-known authuser emails, and the removed-list keys.
- Produces: `planDelegated(entries: DelegatedEntry[], knownAuthuserEmails: string[], removedKeys: string[]): DelegatedEntry[]` — entries to register, lowercased-deduped, excluding any whose email matches an authuser account or whose `d:email` key is in the removed list.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { planDelegated } from './delegation-planner';

const e = (email: string) => ({ email, mailUrl: `https://m/${email}` });

describe('planDelegated', () => {
  it('registers new delegated entries', () => {
    expect(planDelegated([e('a@x.com')], [], []).map((r) => r.email)).toEqual(['a@x.com']);
  });
  it('skips a delegate that is also an owned authuser account', () => {
    expect(planDelegated([e('me@x.com')], ['me@x.com'], [])).toEqual([]);
  });
  it('skips entries removed by the user', () => {
    expect(planDelegated([e('a@x.com')], [], ['d:a@x.com'])).toEqual([]);
  });
  it('dedupes repeated entries case-insensitively', () => {
    expect(planDelegated([e('A@x.com'), e('a@x.com')], [], []).length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/delegation-planner.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import type { DelegatedEntry } from './delegation';

export function planDelegated(
  entries: DelegatedEntry[],
  knownAuthuserEmails: string[],
  removedKeys: string[],
): DelegatedEntry[] {
  const owned = new Set(knownAuthuserEmails.map((e) => e.toLowerCase()));
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/delegation-planner.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/delegation-planner.ts electron/delegation-planner.test.ts
git commit -m "feat: add delegation planner"
```

---

### Task 5: Route the view layer by `accountKey` instead of integer index

Mechanical but broad. No new unit test (the view manager is Electron-bound); correctness is enforced by the type checker and the existing suite. Verified at Task 6's live smoke.

**Files:**
- Modify: `electron/profile-view-manager.ts` (key fn + all callback signatures + `Profile`)
- Modify: `electron/main.ts` (every call site of the renamed callbacks)

**Interfaces:**
- Consumes: `accountKey` (Task 2), `AccountRef` (Task 3).
- Produces: `ProfileViewManager` methods keyed by `accountKey: string`; `Profile` gains `ref: AccountRef` and `kind`. `ensureView(ref, surface, visible, urlOverride?)` builds its URL via `SURFACE_CONFIG[surface].url(ref)`.

- [ ] **Step 1: Change the `Profile` type and key function**

In `profile-view-manager.ts`: add `ref: AccountRef` and keep `email/name/avatarUrl/color/order?/label?`; replace `index: number` internal keying with `accountKey`. Change `const key = (index, surface)` to `const key = (accountKey: string, surface: Surface)`. Change every callback type from `(index: number, …)` to `(accountKey: string, …)`. Change `ensureView`/`show`/`isShowing`/`discardView`/`setZoomForIndex`/`openMailThread`/`popOutThread`/`pushNotifyAllowed`/`markNotificationClickHandled` to accept `ref`/`accountKey` as appropriate; `activeIndex()` becomes `activeKey(): string | null`. `loadURL` uses `SURFACE_CONFIG[surface].url(ref)`.

- [ ] **Step 2: Update every call site in `main.ts`**

Replace the integer `index` threaded through `onUnread`/`onActivate`/`onIdentity`/`onInput`/`getZoom` and detection with `accountKey` + `ref`. Where code previously did arithmetic on `index` (probing next authuser), that logic stays in the authuser detection path only (Task 6) — the callbacks no longer carry a raw index.

- [ ] **Step 3: Type-check and run the full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; all existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add electron/profile-view-manager.ts electron/main.ts
git commit -m "refactor: route views and ipc by account key"
```

---

### Task 6: Wire the delegation scan into the detection driver

**Files:**
- Modify: `electron/main.ts` (after authuser detection completes, run the scan)
- Uses: `SWITCHER_SCRAPE_JS`, `parseDelegatedEntries`, `delegatedMailUrl`, `delegatedCalendarUrl` (Task 1); `planDelegated` (Task 4); `AccountRef` (Task 2).

- [ ] **Step 1: Add the scan step**

When authuser detection finishes, in the `/u/0/` mail view run `webContents.executeJavaScript(SWITCHER_SCRAPE_JS)`, pass the result through `parseDelegatedEntries`, then `planDelegated(entries, knownAuthuserEmails, removedStore.keys())`. For each surviving entry build `ref: { kind: 'delegated', email, mailUrl: delegatedMailUrl(entry), calendarUrl: null }` (calendar filled in Task 7) and register a `Profile` (color via `color-store`, order/label via `prefs-store` — already email-keyed).

- [ ] **Step 2: Emit `PROFILES_CHANGED`**

Merge delegated profiles into the profile list already pushed to the renderer over IPC, sorted by the existing order logic (email-keyed).

- [ ] **Step 3: Live smoke via CDP**

Relaunch under `--remote-debugging-port=9333`. Confirm each real delegated mailbox appears in the profile list (inspect the sidebar `app://bundle/` target state) and its mail view loads Google's delegated inbox (not an error page).

- [ ] **Step 4: Commit**

```bash
git add electron/main.ts
git commit -m "feat: detect delegated mailboxes from account switcher"
```

---

### Task 7: Calendar-availability probe for delegated mailboxes

**Files:**
- Modify: `electron/main.ts` (probe after registering a delegated profile)
- Uses: `delegatedCalendarUrl` (Task 1).

- [ ] **Step 1: Probe**

If `delegatedCalendarUrl(entry)` is non-null, load it in a hidden view and check whether it resolves to a real calendar vs a permission/error page (detect via a locale-independent signal observed in Task 1 — e.g. presence of the calendar grid root element, absence of the error container). Set `ref.calendarUrl` accordingly and cache the result on the profile so it is not re-probed each render.

- [ ] **Step 2: Live smoke**

Confirm a delegated mailbox with a shared calendar shows `calendarUrl` set, and one without shows `null`.

- [ ] **Step 3: Commit**

```bash
git add electron/main.ts
git commit -m "feat: probe delegated calendar availability"
```

---

### Task 8: Render delegated profiles in the sidebar

**Files:**
- Modify: `renderer/app/page.tsx` (the `Sidebar` profile map, ~`:229-324`)
- Uses: `surfacesForRef` (Task 3).

- [ ] **Step 1: Conditional surfaces + marker**

For each profile, render mail avatar + unread badge as today. Render the Calendar icon only when `surfacesForRef(profile.ref)` includes `'calendar'`. Render the waffle flyout only for `profile.kind === 'authuser'`. Add a small visual marker (e.g. a corner badge/overlay on the avatar) when `profile.kind === 'delegated'` so owned vs delegated is distinguishable. Drag-reorder and label/color keep working via `accountKey`.

- [ ] **Step 2: Live smoke**

Relaunch under CDP; `Page.captureScreenshot` the sidebar target and confirm delegated avatars show the marker, show Calendar only when available, and show no waffle.

- [ ] **Step 3: Commit**

```bash
git add renderer/app/page.tsx
git commit -m "feat: render delegated mailboxes in sidebar"
```

---

### Task 9: Manual "Add delegated mailbox" fallback

**Files:**
- Modify: `renderer/app/page.tsx` (the "+" menu), `electron/sidebar-preload.ts` (bridge method), `electron/main.ts` (handler), `electron/ipc.ts` (channel)

- [ ] **Step 1: Add the entry point**

Extend the "+" control with an "Add delegated mailbox" action that prompts for an email, sends it over a new IPC channel, and on the main side constructs a delegated `Profile` using the Task 1 URL form + the calendar probe (Task 7), then re-emits `PROFILES_CHANGED`. Skip if the email is already a known account.

- [ ] **Step 2: Live smoke**

Add a delegated mailbox manually and confirm it appears and loads.

- [ ] **Step 3: Commit**

```bash
git add renderer/app/page.tsx electron/sidebar-preload.ts electron/main.ts electron/ipc.ts
git commit -m "feat: add manual delegated-mailbox entry"
```

---

### Task 10: Verify unread + notifications route to delegated mailboxes

Unread and notifications already flow per view and now route by `accountKey`, so this task is verification + any small fix, not new plumbing.

**Files:**
- Modify (only if a gap is found): `electron/main.ts`, `electron/preload.ts`

- [ ] **Step 1: Live smoke via CDP**

For a delegated mailbox: confirm the unread badge updates, and trigger a test message (send to the delegated address from another view) to confirm a notification fires and, on click, focuses the delegated mail view (routed by `accountKey`). Hook `window.Notification` / `ServiceWorkerRegistration.showNotification` to observe firing, per the CDP notes.

- [ ] **Step 2: Fix any routing gap, then re-run the full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: green.

- [ ] **Step 3: Commit (if changes were needed)**

```bash
git add -u
git commit -m "fix: route delegated-mailbox notifications by account key"
```

---

## Self-Review

**Spec coverage:** account model → Tasks 2/5; `surfaces.ts` generalization → Task 3; hybrid detection → Tasks 6 (auto) + 9 (manual); dedup/removal/ordering → Task 4 + email-keyed stores; calendar-if-available → Task 7; sidebar rendering + marker → Task 8; unread/notifications → Task 10; Task 0 URL/DOM capture → Task 1. All spec sections map to a task.

**Placeholder scan:** The only deferred values are the observed URL/DOM in Task 1, which is *the task whose deliverable is to observe them* — not a plan gap. Downstream tasks consume Task 1's typed functions, not literals.

**Type consistency:** `AccountRef`, `accountKey`, `DelegatedEntry`, `parseDelegatedEntries`, `delegatedMailUrl`, `delegatedCalendarUrl`, `planDelegated`, `surfacesForRef` are named identically across the tasks that define and consume them. `Profile` gains `ref` + `kind` in Task 5 and is read with those names in Tasks 6–10.
