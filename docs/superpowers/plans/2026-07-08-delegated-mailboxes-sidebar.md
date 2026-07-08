# Delegated Mailboxes in the Sidebar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show Gmail delegated mailboxes as first-class sidebar entries (mail + unread + notifications, and a Calendar icon when a delegated calendar is reachable), alongside the user's own authuser accounts — robustly, so a Gmail UI change degrades gracefully instead of losing working mailboxes.

**Architecture:** Generalize account identity from a bare integer `index` into a stable string `accountKey` plus a discriminated `AccountRef` that builds its own surface URLs. Delegated mailboxes live in a durable `delegated-store` (adopting Google's own URLs); a **manual add** path is the primary, always-works way to register them, and a best-effort **auto-scan** of Google's account switcher is a convenience layered on top with a health check that never drops the store to zero. Calendar availability is judged by redirect URL, not page content. Persistence is already email-keyed, so no migration.

**Tech Stack:** TypeScript, Electron (`WebContentsView`, shared `persist:google` session), Next.js renderer, vitest for pure logic, CDP live-test harness for Electron smoke.

## Global Constraints

- **No OAuth/API** — authentication is the logged-in Google web session inside embedded views only.
- **Locale-independent** — the user's Gmail is Dutch; match structure/attributes/`jslog`/href only, never UI text. Use redirect URLs (not page text) for availability/failure detection.
- **Adopt Google's URLs verbatim** for delegated surfaces — never construct a guessed delegation URL.
- **Graceful degradation** — the feature must never silently lose a working delegated mailbox; auto-scan is best-effort, persistence + manual-add are the guarantees.
- **`surfaces.ts` stays pure data** — no Electron or DOM imports.
- **Delegated scope is mail + calendar only** — no Drive/Docs/Sheets/Slides/Keep/Contacts/Chat.
- **Frequent commits** — one per task, Conventional Commits, type-only prefix, no scope, imperative, no `Co-authored-by` trailer (house style).

---

### Task 1: Capture the delegation contract + go/no-go gates → `electron/delegation.ts`

The feature pivots on the exact URL, switcher DOM, and redirect signals Google uses, which we observe on the user's real delegated mailbox and encode as typed functions. **This is a spike with a kill switch:** two gates decided here set the scope actually built. No unit test — verified live via the CDP harness and recorded in the spec.

**Files:**
- Create: `electron/delegation.ts`
- Modify: `docs/superpowers/specs/2026-07-08-delegated-mailboxes-sidebar-design.md` (fill the Task 0 placeholders + record both gate outcomes)

**Interfaces:**
- Produces:
  - `interface DelegatedEntry { email: string; mailUrl: string; }`
  - `parseDelegatedEntries(raw: Array<{ email: string; href: string }>): DelegatedEntry[]` — pure, DOM-free, unit-testable.
  - `delegatedMailUrl(entry: DelegatedEntry): string`
  - `delegatedCalendarUrl(entry: DelegatedEntry): string | null`
  - `isCalendarNoAccessUrl(finalUrl: string): boolean` — true when a navigated calendar URL redirected to Google's no-access form (the redirect signal).
  - `SWITCHER_SCRAPE_JS: string` — in-page JS that reads the switcher and returns `Array<{ email, href }>` for delegated entries, matched locale-independently through a layered selector chain.

- [ ] **Step 1: Launch the app under CDP**

```bash
rm -f ~/.config/gmail-desktop/SingletonLock
DISPLAY=:0 ./node_modules/.bin/electron . --remote-debugging-port=9333
```

- [ ] **Step 2: GATE 1 — can the switcher be read without a trusted click?**

Attach to the `/u/0/` mail target (`curl http://127.0.0.1:9333/json`) and try to read the delegated entries via `Runtime.evaluate` **without** a user gesture. Record whether the entries are present in the DOM directly, or only after an interaction we cannot reliably synthesize.
- **PASS** → auto-scan is viable (Task 8 ships).
- **FAIL** → auto-scan is dropped; the feature ships manual-add-only (Task 8 becomes a no-op, everything else stands). Write the outcome in the spec.

- [ ] **Step 3: Observe the mail URL + switcher DOM + calendar redirect**

Record in the spec: the delegated mail href form; the attribute carrying the email; the structural marker (attribute/`jslog`/shape, NOT text) distinguishing a delegated entry; the delegated-calendar URL form; and the URL a **no-access** calendar redirects to (navigate a hidden view to one and read the final URL).

- [ ] **Step 4: GATE 2 — do unread + notifications fire for a delegated inbox?**

Load a delegated mail view; confirm it reports unread via the existing preload path and can raise a notification (hook `window.Notification` / `ServiceWorkerRegistration.showNotification` per the CDP notes). Record PASS/FAIL in the spec. FAIL → ship viewing-only (Task 11 documents the limitation instead of asserting it works).

- [ ] **Step 5: Encode findings in `electron/delegation.ts`**

```ts
export interface DelegatedEntry { email: string; mailUrl: string; }

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
  return null; // finalised from Step 3
}

export function isCalendarNoAccessUrl(finalUrl: string): boolean {
  return /* observed no-access redirect pattern from Step 3 */ false;
}

// Layered selector chain, structure/attributes only (finalised from Step 3).
export const SWITCHER_SCRAPE_JS = `/* returns Array<{email, href}> */`;
```

- [ ] **Step 6: Commit**

```bash
git add electron/delegation.ts docs/superpowers/specs/2026-07-08-delegated-mailboxes-sidebar-design.md
git commit -m "feat: capture delegated-mailbox contract and gates"
```

---

### Task 2: Account identity model (`accountKey` + `AccountRef`)

**Files:**
- Create: `renderer/lib/account-ref.ts` (pure, importable by Next.js + esbuild + vitest)
- Create: `electron/account-ref.ts` (re-export from the renderer module, for Electron import paths)
- Test: `renderer/lib/account-ref.test.ts`

**Interfaces:**
- Produces:
  - `type AccountRef = { kind: 'authuser'; index: number } | { kind: 'delegated'; email: string; mailUrl: string; calendarUrl: string | null }`
  - `accountKey(ref: AccountRef): string` → `` `u${index}` `` / `` `d:${email}` ``
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
  it('round-trips delegated keys with the email intact', () => {
    expect(parseAccountKey('d:team@x.com')).toEqual({ kind: 'delegated', email: 'team@x.com' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run renderer/lib/account-ref.test.ts`
Expected: FAIL — cannot find module `./account-ref`.

- [ ] **Step 3: Implement**

```ts
// renderer/lib/account-ref.ts
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

```ts
// electron/account-ref.ts
export * from '../renderer/lib/account-ref';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run renderer/lib/account-ref.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add renderer/lib/account-ref.ts electron/account-ref.ts renderer/lib/account-ref.test.ts
git commit -m "feat: add account-ref identity model"
```

---

### Task 3: Generalize `surfaces.ts` URL builders to take `AccountRef`

**Files:**
- Modify: `renderer/lib/surfaces.ts:21-91`
- Test: `renderer/lib/surfaces.test.ts`

**Interfaces:**
- Consumes: `AccountRef` (Task 2).
- Produces: `SurfaceConfig.url(ref: AccountRef): string`; `surfacesForRef(ref: AccountRef): Surface[]` — all surfaces for authuser; `['mail']` (+ `'calendar'` when `ref.calendarUrl`) for delegated.

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

Change `SurfaceConfig.url` to `url(ref: AccountRef): string`. Add a private helper `authIndex(ref)` (`ref.kind === 'authuser' ? ref.index : 0`); authuser builders keep `/u/${authIndex(ref)}/`. Delegated `mail` returns `ref.mailUrl`; delegated `calendar` returns `ref.calendarUrl!`. Non-mail/calendar builders throw if called with a delegated ref (they are guarded by `surfacesForRef` and must never emit a wrong URL). Add:

```ts
export function surfacesForRef(ref: AccountRef): Surface[] {
  if (ref.kind === 'authuser') return [...SURFACES];
  return ref.calendarUrl ? ['mail', 'calendar'] : ['mail'];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run renderer/lib/surfaces.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add renderer/lib/surfaces.ts renderer/lib/surfaces.test.ts
git commit -m "feat: build surface urls from account-ref"
```

---

### Task 4: Delegation planner (register/skip/dedup) — pure

**Files:**
- Create: `electron/delegation-planner.ts`
- Test: `electron/delegation-planner.test.ts`

**Interfaces:**
- Consumes: `DelegatedEntry` (Task 1).
- Produces: `planDelegated(entries: DelegatedEntry[], knownAuthuserEmails: string[], removedKeys: string[]): DelegatedEntry[]` — lowercased, deduped, excluding any whose email matches an authuser account or whose `d:email` key is removed.

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

Mechanical but broad. No new unit test (Electron-bound); correctness enforced by the type checker + existing suite, verified live in Task 8/11.

**Files:**
- Modify: `electron/profile-view-manager.ts` (key fn, callback signatures, `Profile`)
- Modify: `electron/main.ts` (every renamed call site)

**Interfaces:**
- Consumes: `accountKey` (Task 2), `AccountRef` (Task 3).
- Produces: `ProfileViewManager` keyed by `accountKey: string`; `Profile` gains `ref: AccountRef` + `kind`; `ensureView(ref, surface, visible, urlOverride?)` builds its URL via `SURFACE_CONFIG[surface].url(ref)`; `activeIndex()` → `activeKey(): string | null`.

- [ ] **Step 1: Change `Profile` and the key function**

Add `ref: AccountRef` to `Profile` (keep `email/name/avatarUrl/color/order?/label?`). Replace `const key = (index, surface)` with `key(accountKey: string, surface: Surface)`. Change every callback type from `(index: number, …)` to `(accountKey: string, …)`. `loadURL` uses `SURFACE_CONFIG[surface].url(ref)`.

- [ ] **Step 2: Update every call site in `main.ts`**

Replace the integer `index` threaded through `onUnread`/`onActivate`/`onIdentity`/`onInput`/`getZoom` with `accountKey` + `ref`. Authuser index arithmetic (probing the next `/u/N/`) stays only in the authuser detection path; callbacks no longer carry a raw index.

- [ ] **Step 3: Type-check and run the full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; all existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add electron/profile-view-manager.ts electron/main.ts
git commit -m "refactor: route views and ipc by account key"
```

---

### Task 6: `delegated-store` — durable last-known-good persistence

The durability layer: delegated mailboxes survive Gmail UI changes because they persist with Google's real URLs.

**Files:**
- Create: `electron/delegated-store.ts`
- Test: `electron/delegated-store.test.ts`

**Interfaces:**
- Produces:
  - `interface StoredDelegate { email: string; mailUrl: string; calendarUrl: string | null }`
  - `class DelegatedStore { constructor(filePath: string); list(): StoredDelegate[]; upsert(d: StoredDelegate): void; remove(email: string): void; }`
  - `mergeScan(existing: StoredDelegate[], scanned: StoredDelegate[]): { next: StoredDelegate[]; healthOk: boolean }` — pure merge with the **health check**: never removes existing entries; `healthOk === false` when `scanned.length < existing.length` (probable scrape breakage), and the scanned set is *not* used to prune.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { mergeScan } from './delegated-store';

const d = (email: string, cal: string | null = null) => ({ email, mailUrl: `https://m/${email}`, calendarUrl: cal });

describe('mergeScan', () => {
  it('adds newly scanned delegates', () => {
    const { next } = mergeScan([d('a@x.com')], [d('a@x.com'), d('b@x.com')]);
    expect(next.map((x) => x.email).sort()).toEqual(['a@x.com', 'b@x.com']);
  });
  it('never drops an existing delegate the scan missed', () => {
    const { next } = mergeScan([d('a@x.com'), d('b@x.com')], [d('a@x.com')]);
    expect(next.map((x) => x.email).sort()).toEqual(['a@x.com', 'b@x.com']);
  });
  it('flags healthOk=false when the scan returns fewer than we hold', () => {
    const { healthOk } = mergeScan([d('a@x.com'), d('b@x.com')], [d('a@x.com')]);
    expect(healthOk).toBe(false);
  });
  it('updates calendarUrl from a fresh scan for an existing delegate', () => {
    const { next } = mergeScan([d('a@x.com', null)], [d('a@x.com', 'https://c/')]);
    expect(next.find((x) => x.email === 'a@x.com')?.calendarUrl).toBe('https://c/');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/delegated-store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface StoredDelegate { email: string; mailUrl: string; calendarUrl: string | null }

export function mergeScan(
  existing: StoredDelegate[],
  scanned: StoredDelegate[],
): { next: StoredDelegate[]; healthOk: boolean } {
  const byEmail = new Map(existing.map((d) => [d.email.toLowerCase(), d]));
  for (const s of scanned) byEmail.set(s.email.toLowerCase(), { ...byEmail.get(s.email.toLowerCase()), ...s });
  return { next: [...byEmail.values()], healthOk: scanned.length >= existing.length };
}

export class DelegatedStore {
  constructor(private readonly filePath: string) {}
  list(): StoredDelegate[] {
    if (!existsSync(this.filePath)) return [];
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8'));
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }
  private write(items: StoredDelegate[]): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(items, null, 2), 'utf8');
  }
  upsert(d: StoredDelegate): void {
    const items = this.list().filter((x) => x.email.toLowerCase() !== d.email.toLowerCase());
    items.push(d);
    this.write(items);
  }
  remove(email: string): void {
    this.write(this.list().filter((x) => x.email.toLowerCase() !== email.toLowerCase()));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/delegated-store.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/delegated-store.ts electron/delegated-store.test.ts
git commit -m "feat: add durable delegated-mailbox store"
```

---

### Task 7: Manual "Add delegated mailbox" — the primary path

Always works; does not depend on reading the switcher. Populate the sidebar from `delegated-store` on launch.

**Files:**
- Modify: `renderer/app/page.tsx` (the "+" menu), `electron/sidebar-preload.ts` (bridge), `electron/main.ts` (handler + launch-time load), `electron/ipc.ts` (channel)
- Uses: `DelegatedStore` (Task 6), `delegatedMailUrl`/`delegatedCalendarUrl`/`isCalendarNoAccessUrl` (Task 1), `AccountRef` (Task 2).

- [ ] **Step 1: Load persisted delegates on launch**

In `main.ts`, on startup read `DelegatedStore.list()`, build a `kind: 'delegated'` `Profile` per entry (color via `color-store`, order/label via `prefs-store`, all email-keyed), and include them in the `PROFILES_CHANGED` payload alongside authuser profiles.

- [ ] **Step 2: Add the manual entry point**

Extend the "+" control with "Add delegated mailbox" → email prompt → new IPC channel → main-side handler that builds the mail URL (Task 1), runs the calendar probe (Task 9), `upsert`s into `DelegatedStore`, and re-emits `PROFILES_CHANGED`. Skip if the email is already a known account.

- [ ] **Step 3: Live smoke via CDP**

Relaunch under `--remote-debugging-port=9333`. Add a delegated mailbox manually; confirm it appears, persists across a restart, and its mail view loads Google's delegated inbox.

- [ ] **Step 4: Commit**

```bash
git add renderer/app/page.tsx electron/sidebar-preload.ts electron/main.ts electron/ipc.ts
git commit -m "feat: add delegated mailboxes via manual entry"
```

---

### Task 8: Auto-scan the account switcher (best-effort convenience)

Only ships if **Gate 1 (Task 1) passed**. Layered selectors + health check; merges into the store, never prunes it.

**Files:**
- Modify: `electron/main.ts`
- Uses: `SWITCHER_SCRAPE_JS`, `parseDelegatedEntries` (Task 1); `planDelegated` (Task 4); `mergeScan` + `DelegatedStore` (Task 6).

- [ ] **Step 1: Run the scan after authuser detection**

In the `/u/0/` mail view, `executeJavaScript(SWITCHER_SCRAPE_JS)`, pass through `parseDelegatedEntries`, then `planDelegated(entries, knownAuthuserEmails, removedStore.keys())`. Convert survivors to `StoredDelegate` (calendar via Task 9), then `const { next, healthOk } = mergeScan(store.list(), scanned)`; write `next` back and, when `healthOk === false`, surface a non-fatal "couldn't refresh delegated accounts" hint (do **not** prune). Re-emit `PROFILES_CHANGED`.

- [ ] **Step 2: Live smoke via CDP**

Confirm each real delegated mailbox is auto-detected and merged; then simulate a broken scrape (temporarily point `SWITCHER_SCRAPE_JS` at a selector that returns fewer/none) and confirm the existing mailboxes remain and the hint appears.

- [ ] **Step 3: Commit**

```bash
git add electron/main.ts
git commit -m "feat: auto-detect delegated mailboxes with health check"
```

---

### Task 9: Calendar-availability probe via redirect signal

**Files:**
- Modify: `electron/main.ts`
- Uses: `delegatedCalendarUrl` + `isCalendarNoAccessUrl` (Task 1).

- [ ] **Step 1: Probe by final URL, not page content**

If `delegatedCalendarUrl(entry)` is non-null, load it in a hidden view and read the final URL from `did-navigate` / `did-redirect-navigation`. If `isCalendarNoAccessUrl(finalUrl)` is true, set `calendarUrl = null`; otherwise keep the calendar URL. Persist the result in `DelegatedStore` so it isn't re-probed each launch.

- [ ] **Step 2: Live smoke**

Confirm a delegated mailbox with a shared calendar keeps `calendarUrl`, and one without redirects to no-access and resolves to `null`.

- [ ] **Step 3: Commit**

```bash
git add electron/main.ts
git commit -m "feat: probe delegated calendar via redirect signal"
```

---

### Task 10: Render delegated profiles in the sidebar

**Files:**
- Modify: `renderer/app/page.tsx` (the `Sidebar` profile map, ~`:229-324`)
- Uses: `surfacesForRef` (Task 3).

- [ ] **Step 1: Conditional surfaces + marker**

Render mail avatar + unread badge as today. Render the Calendar icon only when `surfacesForRef(profile.ref)` includes `'calendar'`. Render the waffle flyout only for `profile.kind === 'authuser'`. Add a small visual marker (corner badge/overlay) when `profile.kind === 'delegated'`. Drag-reorder and label/color keep working via `accountKey`.

- [ ] **Step 2: Live smoke**

Relaunch under CDP; `Page.captureScreenshot` the sidebar target; confirm delegated avatars show the marker, show Calendar only when available, and show no waffle.

- [ ] **Step 3: Commit**

```bash
git add renderer/app/page.tsx
git commit -m "feat: render delegated mailboxes in sidebar"
```

---

### Task 11: Verify unread + notifications route to delegated mailboxes

Depends on **Gate 2 (Task 1)**. If Gate 2 passed, this is verification; if it failed, document the viewing-only limitation instead of asserting alerting works.

**Files:**
- Modify (only if a gap is found): `electron/main.ts`, `electron/preload.ts`
- Modify: `docs/superpowers/specs/2026-07-08-delegated-mailboxes-sidebar-design.md` (record final unread/notification behavior)

- [ ] **Step 1: Live smoke via CDP**

For a delegated mailbox: confirm the unread badge updates; trigger a test message to the delegated address from another view and confirm a notification fires and, on click, focuses the delegated mail view (routed by `accountKey`). Hook `window.Notification` / `ServiceWorkerRegistration.showNotification` to observe firing.

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

**Spec coverage:** account model → Tasks 2/5; `surfaces.ts` generalization → Task 3; persistence/last-known-good + health check → Task 6; manual-add (primary) → Task 7; auto-scan (best-effort, layered selectors, health check) → Task 8; dedup/removal/ordering → Task 4 + email-keyed stores; calendar-if-available via redirect signal → Task 9; sidebar rendering + marker → Task 10; unread/notifications → Task 11; URL/DOM/redirect capture + go/no-go gates → Task 1. All spec sections map to a task.

**Placeholder scan:** The only deferred values are the observed URL/DOM/redirect patterns in Task 1 — the task whose deliverable is to observe them — consumed downstream via typed functions, not literals. No stray TODOs.

**Type consistency:** `AccountRef`, `accountKey`, `parseAccountKey`, `DelegatedEntry`, `parseDelegatedEntries`, `delegatedMailUrl`, `delegatedCalendarUrl`, `isCalendarNoAccessUrl`, `planDelegated`, `surfacesForRef`, `StoredDelegate`, `DelegatedStore`, `mergeScan` are named identically across defining and consuming tasks. `Profile` gains `ref` + `kind` in Task 5 and is read with those names in Tasks 7–11.

**Gate dependencies:** Task 8 is conditional on Gate 1 (Task 1 Step 2); Task 11's assertion level is conditional on Gate 2 (Task 1 Step 4). Both gates are recorded in the spec so a fresh implementer knows the scope actually in force.
