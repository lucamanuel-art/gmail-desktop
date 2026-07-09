# Per-mailbox Taskbar Badge Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user exclude a delegated mailbox from the Windows taskbar unread badge, per mailbox, via a checkbox in Settings → Accounts.

**Architecture:** A new optional `badgeCount` field on the per-account pref. The pure badge-sum functions (`totalUnread`, `applyBadge`) gain an `excluded` key-set parameter; `main.ts` derives that set from delegated profiles whose `badgeCount === false` and passes it at every badge-apply site. A delegated-only checkbox in the settings UI writes the pref through the existing `SET_ACCOUNT_PREF` IPC channel.

**Tech Stack:** TypeScript, Electron (main + preload), Next.js/React renderer, Vitest.

## Global Constraints

- Default behavior unchanged: an absent/`true` `badgeCount` means the mailbox is counted. No prefs migration.
- Only the taskbar badge total is affected — desktop notifications (`notify` pref) and sidebar unread pills stay as they are.
- The Badge toggle is shown for delegated mailboxes only (`p.kind === 'delegated'`); owned accounts always count.
- All user-facing text lives in `renderer/app/strings.ts` in both flavors: English (`UI_STRINGS`) and Rene-mode simple Dutch (`RENE_STRINGS`). Every new key must be added to the `UiStrings` interface and both objects.
- Follow existing patterns: per-account prefs keyed by email; badge functions keep default-valued params so existing callers/tests are unaffected.

---

### Task 1: Add `badgeCount` to the pref model

**Files:**
- Modify: `electron/prefs-store.ts:4-10` (the `AccountPref` interface)
- Test: `tests/prefs-store.test.ts` (create if absent)

**Interfaces:**
- Produces: `AccountPref.badgeCount?: boolean` — `false` means exclude this mailbox from the taskbar badge; `undefined`/`true` means include it.

Note: `PrefsStore.getAll()` copies the `accounts` map verbatim (`electron/prefs-store.ts:74-76`) and `setAccount` shallow-merges the partial (`:110-117`), so `badgeCount` persists with no parsing change. The test locks this in.

- [ ] **Step 1: Write the failing test**

Check whether `tests/prefs-store.test.ts` already exists. If it does, add the `it` block below into its top-level `describe`. If not, create the file with this content:

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrefsStore } from '../electron/prefs-store';

describe('PrefsStore badgeCount', () => {
  it('round-trips a per-account badgeCount=false through save and load', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'prefs-')), 'prefs.json');
    const store = new PrefsStore(file);
    store.setAccount('a@b.com', { badgeCount: false });
    expect(store.getAll().accounts['a@b.com'].badgeCount).toBe(false);
    // A fresh instance reading the same file sees it too.
    expect(new PrefsStore(file).getAccount('a@b.com').badgeCount).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/prefs-store.test.ts`
Expected: FAIL — TypeScript error "Object literal may only specify known properties, and 'badgeCount' does not exist in type 'Partial<AccountPref>'".

- [ ] **Step 3: Add the field**

In `electron/prefs-store.ts`, add `badgeCount` to `AccountPref`:

```ts
export interface AccountPref {
  order?: number;
  label?: string;
  zoom?: number;
  notify?: boolean;
  calendarNotify?: boolean;
  badgeCount?: boolean;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/prefs-store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/prefs-store.ts tests/prefs-store.test.ts
git commit -m "feat: add badgeCount to per-account prefs"
```

---

### Task 2: Exclude keys from the badge sum

**Files:**
- Modify: `electron/badge-math.ts:1-6`
- Modify: `electron/badge-controller.ts:3-10`
- Test: `tests/badge-math.test.ts`, `tests/badge-controller.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `totalUnread(counts: Record<string, number>, excluded?: Set<string>): number`
  - `applyBadge(counts: Record<string, number>, setBadge: (n: number) => void, excluded?: Set<string>): number`
  - Both `excluded` params default to an empty set, so omitting them preserves current behavior.

- [ ] **Step 1: Write the failing tests**

Add to `tests/badge-math.test.ts` inside the existing `describe('totalUnread', ...)`:

```ts
  it('skips keys present in the excluded set', () => {
    expect(totalUnread({ u0: 3, 'd:x@y.com': 5 }, new Set(['d:x@y.com']))).toBe(3);
  });
  it('an empty excluded set sums everything (default behavior)', () => {
    expect(totalUnread({ a: 3, b: 5 }, new Set())).toBe(8);
  });
```

Add to `tests/badge-controller.test.ts` inside the existing `describe('applyBadge', ...)`:

```ts
  it('excludes the given keys from the badge total', () => {
    const setBadge = vi.fn();
    const total = applyBadge({ u0: 2, 'd:x@y.com': 3 }, setBadge, new Set(['d:x@y.com']));
    expect(total).toBe(2);
    expect(setBadge).toHaveBeenCalledWith(2);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/badge-math.test.ts tests/badge-controller.test.ts`
Expected: FAIL — the new cases get the unfiltered total (8 / 5) because the `excluded` argument is ignored.

- [ ] **Step 3: Implement the exclusion**

Replace the body of `electron/badge-math.ts` with:

```ts
export function totalUnread(
  counts: Record<string, number>,
  excluded: Set<string> = new Set(),
): number {
  return Object.entries(counts).reduce(
    (sum, [key, n]) =>
      excluded.has(key) || !Number.isFinite(n) ? sum : sum + n,
    0,
  );
}
```

Replace the body of `electron/badge-controller.ts` with:

```ts
import { totalUnread } from './badge-math';

export function applyBadge(
  counts: Record<string, number>,
  setBadge: (n: number) => void,
  excluded: Set<string> = new Set(),
): number {
  const total = totalUnread(counts, excluded);
  setBadge(total);
  return total;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/badge-math.test.ts tests/badge-controller.test.ts`
Expected: PASS (all cases, including the pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add electron/badge-math.ts electron/badge-controller.ts tests/badge-math.test.ts tests/badge-controller.test.ts
git commit -m "feat: support excluding keys from the taskbar badge total"
```

---

### Task 3: Thread the excluded set through main.ts

**Files:**
- Modify: `electron/main.ts` — add `excludedBadgeKeys()` helper; update `applyBadge` calls at ~line 361 and ~line 524; update the `SET_ACCOUNT_PREF` handler at ~line 814.

**Interfaces:**
- Consumes: `applyBadge(counts, setBadge, excluded?)` from Task 2; `AccountPref.badgeCount` from Task 1.
- Produces: `excludedBadgeKeys(): Set<string>` — accountKeys (`d:<email>`) for delegated profiles whose stored `badgeCount === false`. Uses the module-level `profiles` array, `prefs`, and the existing `keyOf(profile)` helper.

This task has no unit test of its own — `main.ts` wires Electron singletons that aren't unit-testable here; the pure logic it composes is already covered by Tasks 1–2, and Task 5 verifies it end-to-end. Correctness is confirmed via typecheck.

- [ ] **Step 1: Add the helper**

In `electron/main.ts`, add near the other badge/profile helpers (e.g. just above `pushUnread` around line 248):

```ts
// Delegated mailboxes the user has opted out of the taskbar badge. Owned
// (authuser) accounts always count; only delegated entries are excludable.
function excludedBadgeKeys(): Set<string> {
  const keys = new Set<string>();
  for (const p of profiles) {
    if (p.kind === 'delegated' && prefs?.getAccount(p.email).badgeCount === false) {
      keys.add(keyOf(p));
    }
  }
  return keys;
}
```

- [ ] **Step 2: Update the two existing badge-apply sites**

At `electron/main.ts:361` (inside `removeAccount`), change:

```ts
  applyBadge(unreadCounts, (n) => app.setBadgeCount(n));
```
to:
```ts
  applyBadge(unreadCounts, (n) => app.setBadgeCount(n), excludedBadgeKeys());
```

At `electron/main.ts:524` (inside the unread-update handler), make the same change:

```ts
      applyBadge(unreadCounts, (n) => app.setBadgeCount(n), excludedBadgeKeys());
```

- [ ] **Step 3: Handle `badgeCount` in `SET_ACCOUNT_PREF` and re-apply the badge**

Replace the handler at `electron/main.ts:814-824` with:

```ts
  ipcMain.on(IPC.SET_ACCOUNT_PREF, (_e, arg: { email: string; label?: string; notify?: boolean; calendarNotify?: boolean; badgeCount?: boolean }) => {
    const patch: Record<string, unknown> = {};
    if ('label' in arg) patch.label = arg.label;
    if ('notify' in arg) patch.notify = arg.notify;
    if ('calendarNotify' in arg) patch.calendarNotify = arg.calendarNotify;
    if ('badgeCount' in arg) patch.badgeCount = arg.badgeCount;
    prefs!.setAccount(arg.email, patch);
    pushProfiles();
    pushPrefs(); // keep the settings UI's per-account toggles in sync with what was stored
    refreshNotifyAllowed();
    syncCalendarViews();
    applyBadge(unreadCounts, (n) => app.setBadgeCount(n), excludedBadgeKeys()); // reflect a badgeCount change immediately
  });
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no errors).

- [ ] **Step 5: Commit**

```bash
git add electron/main.ts
git commit -m "feat: exclude opted-out delegated mailboxes from the taskbar badge"
```

---

### Task 4: Plumb `badgeCount` through preload + renderer bridge

**Files:**
- Modify: `electron/sidebar-preload.ts:55-56` (`setAccountPref` arg type)
- Modify: `renderer/app/page.tsx:86` (bridge `setAccountPref` arg type)

**Interfaces:**
- Consumes: the `SET_ACCOUNT_PREF` handler from Task 3 now accepts `badgeCount`.
- Produces: `setAccountPref` accepting `{ email; label?; notify?; calendarNotify?; badgeCount?: boolean }` on both the preload bridge and the renderer's `DesktopBridge` type, so Task 5's UI can call it type-safely.

- [ ] **Step 1: Update the preload arg type**

In `electron/sidebar-preload.ts`, change the `setAccountPref` signature (line 55) to:

```ts
  setAccountPref: (arg: { email: string; label?: string; notify?: boolean; calendarNotify?: boolean; badgeCount?: boolean }): void =>
    ipcRenderer.send(IPC.SET_ACCOUNT_PREF, arg),
```

- [ ] **Step 2: Update the renderer bridge type**

In `renderer/app/page.tsx`, change the `setAccountPref` declaration (line 86) to:

```ts
  setAccountPref(arg: { email: string; label?: string; notify?: boolean; calendarNotify?: boolean; badgeCount?: boolean }): void;
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add electron/sidebar-preload.ts renderer/app/page.tsx
git commit -m "feat: accept badgeCount in setAccountPref bridge"
```

---

### Task 5: Add the delegated-only Badge checkbox + strings

**Files:**
- Modify: `renderer/app/strings.ts` — add `badgeToggle`/`badgeToggleTitle` to the `UiStrings` interface (near line 52), the English `UI_STRINGS` object (near line 167), and the Rene `RENE_STRINGS` object (near line 244).
- Modify: `renderer/app/SettingsPanel.tsx:506-525` — add the checkbox.

**Interfaces:**
- Consumes: `setAccountPref({ email, badgeCount })` from Task 4; `S.badgeToggle` / `S.badgeToggleTitle` strings; the per-profile `p.kind` field (already decorated onto profiles — see `DelegatedBadge` usage in `page.tsx`).
- Produces: the user-visible toggle. Final task.

- [ ] **Step 1: Add the interface keys**

In `renderer/app/strings.ts`, in the `UiStrings` interface right after `calendarToggleTitle: string;` (line 53), add:

```ts
  badgeToggle: string;
  badgeToggleTitle: string;
```

- [ ] **Step 2: Add the English strings**

In the `UI_STRINGS` object, right after `calendarToggleTitle: 'Calendar reminders for this account',` (line 168), add:

```ts
  badgeToggle: 'Badge',
  badgeToggleTitle: 'Count this mailbox in the taskbar unread badge',
```

- [ ] **Step 3: Add the Rene-mode Dutch strings**

In the `RENE_STRINGS` object, right after `calendarToggleTitle: 'Meldingen voor de agenda van deze meneer of mevrouw',` (line 245), add:

```ts
  badgeToggle: 'Getal',
  badgeToggleTitle: 'Tel de post van deze meneer of mevrouw mee in het getal op de knop',
```

- [ ] **Step 4: Add the checkbox to the account row**

In `renderer/app/SettingsPanel.tsx`, inside the `<div className="flex items-center gap-2">` group, immediately after the closing `</label>` of the Calendar toggle (line 524) and before the closing `</div>` (line 525), add:

```tsx
                      {p.kind === 'delegated' && (
                        <label className="flex items-center gap-1 text-xs text-neutral-500 dark:text-neutral-400" title={S.badgeToggleTitle}>
                          <input
                            type="checkbox"
                            checked={prefs?.accounts?.[p.email]?.badgeCount !== false}
                            onChange={(e) => window.desktop?.setAccountPref({ email: p.email, badgeCount: e.target.checked })}
                            className="h-3.5 w-3.5 accent-blue-600"
                          />
                          {S.badgeToggle}
                        </label>
                      )}
```

Note: if `p.kind` is not in scope on the row's profile object, confirm it is by checking the mapped profile type (it drives `DelegatedBadge` elsewhere via `page.tsx`); the `decorate()` step in `main.ts:236` sets `kind: p.ref.kind` on every profile.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Run the full test suite**

Run: `npx vitest run`
Expected: PASS (no regressions).

- [ ] **Step 7: Commit**

```bash
git add renderer/app/strings.ts renderer/app/SettingsPanel.tsx
git commit -m "feat: add per-delegated-mailbox taskbar badge toggle to settings"
```

---

## Verification (after all tasks)

Manual end-to-end check (per the project's `verify` conventions; the app runs headfully via `DISPLAY=:0` in this WSLg env):

1. Launch the app with at least one delegated mailbox that has unread mail.
2. Open Settings → Accounts. Confirm the delegated mailbox row shows a "Badge" checkbox (checked) and owned accounts do not.
3. Note the taskbar badge number.
4. Uncheck "Badge" for the delegated mailbox → the taskbar number drops by that mailbox's unread count immediately.
5. Re-check it → the number returns.
6. Confirm desktop notifications behavior for that mailbox is unchanged (still governed by the Mail toggle) and the sidebar unread pill for it still shows its real count.

## Self-Review Notes

- **Spec coverage:** data model (Task 1), pure badge exclusion (Task 2), main.ts wiring incl. immediate re-apply on toggle (Task 3), IPC/preload/bridge plumbing (Task 4), delegated-only UI + strings (Task 5), tests (Tasks 1, 2), manual verification (above). All spec sections mapped.
- **Type consistency:** `badgeCount?: boolean` and the `setAccountPref` arg shape `{ email; label?; notify?; calendarNotify?; badgeCount? }` are identical across prefs-store, main.ts handler, sidebar-preload, and page.tsx bridge. `excludedBadgeKeys(): Set<string>` feeds `applyBadge(..., excluded?: Set<string>)` and `totalUnread(..., excluded?: Set<string>)` — all `Set<string>`.
- **No placeholders:** every code and command step is concrete.
