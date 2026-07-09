# Per-mailbox taskbar badge toggle — design

**Date:** 2026-07-09
**Status:** Approved, ready for implementation plan

## Problem

The Windows taskbar unread badge (`app.setBadgeCount`) is driven by `applyBadge`
in `electron/badge-controller.ts`, which sums the unread counts of **every**
account via `totalUnread` — including delegated mailboxes (keyed `d:<email>`).
A user who has added someone else's mailbox as a delegate does not necessarily
want that mailbox's unread mail inflating their own taskbar number.

There is already a per-account desktop-notification toggle (`notify`), but
nothing controls whether an account contributes to the badge total.

## Goal

Let the user exclude a delegated mailbox from the taskbar badge count, per
mailbox, without affecting anything else.

## Scope

**In scope**

- A per-mailbox "count in badge" toggle, shown for delegated mailboxes only.
- Excludes that mailbox's unread count from the taskbar badge total when off.
- Default on (preserves today's behavior); no migration needed.

**Explicitly out of scope**

- Desktop notification banners — unchanged; still governed by the per-account
  `notify` pref.
- The sidebar's per-account unread pills — unchanged; still show real counts.
- Owned (authuser) accounts — always counted; the toggle is not shown for them.
- Any global "include all delegated mailboxes" switch — this is per-mailbox.

## Behavior

Each delegated mailbox row in Settings → Accounts gains a third checkbox next to
the existing Mail / Calendar notify toggles, labelled "Badge". When checked
(default), that mailbox's unread count is included in the taskbar number. When
unchecked, it is excluded. Toggling updates the badge immediately.

Owned accounts show only the existing Mail / Calendar toggles — no Badge toggle.

## Data model

Add an optional field to `AccountPref` in `electron/prefs-store.ts`:

```ts
export interface AccountPref {
  order?: number;
  label?: string;
  zoom?: number;
  notify?: boolean;
  calendarNotify?: boolean;
  badgeCount?: boolean; // NEW: false = exclude this mailbox from the taskbar badge
}
```

Semantics: `undefined` or `true` → counted (default); `false` → excluded.
Persisted per-email like the other per-account prefs. No migration: an absent
field means counted, which is the pre-existing behavior. `PrefsStore.getAll()`
already preserves the `accounts` map verbatim, so `badgeCount` round-trips with
no parsing change; a round-trip test locks this in.

## Badge computation (pure, testable)

`electron/badge-math.ts`:

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

`electron/badge-controller.ts`:

```ts
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

Both keep their default-empty parameter, so existing callers and tests that omit
it are unaffected.

## Wiring (electron/main.ts)

Add a helper that derives the excluded key set from current profiles + prefs:

```ts
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

Pass it at every `applyBadge` call site:

- `removeAccount` (~line 361): `applyBadge(unreadCounts, (n) => app.setBadgeCount(n), excludedBadgeKeys())`
- unread update handler (~line 524): same third argument.
- **New:** in the `SET_ACCOUNT_PREF` handler, after `prefs.setAccount(...)`, call
  `applyBadge(unreadCounts, (n) => app.setBadgeCount(n), excludedBadgeKeys())`
  so toggling the checkbox re-applies the badge immediately.

## IPC / preload plumbing

Add `badgeCount?: boolean` to the `SET_ACCOUNT_PREF` argument type in:

- `electron/main.ts` handler signature, plus `if ('badgeCount' in arg) patch.badgeCount = arg.badgeCount;`
- `electron/sidebar-preload.ts` `setAccountPref` arg type.
- `renderer/app/page.tsx` bridge `setAccountPref` arg type.

No new IPC channel; this reuses `SET_ACCOUNT_PREF`.

## UI (renderer/app/SettingsPanel.tsx)

In the per-account toggle group (the `flex items-center gap-2` div near line 506),
render a third checkbox **only when `p.kind === 'delegated'`**:

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

Add `badgeToggle` and `badgeToggleTitle` strings to `renderer/app/strings.ts`,
following the existing `mailToggle` / `calendarToggle` pattern and locale.

## Testing

- `tests/badge-math.test.ts`: `totalUnread` excludes keys present in the
  `excluded` set; empty/omitted set behaves exactly as before; non-finite values
  still ignored.
- `tests/badge-controller.test.ts` (if extended): `applyBadge` forwards the
  excluded set and reports the filtered total.
- `prefs-store` round-trip: an account with `badgeCount: false` survives
  `setAccount` → `getAll`.

## Files touched

- `electron/prefs-store.ts` — add `badgeCount` field.
- `electron/badge-math.ts` — `excluded` parameter.
- `electron/badge-controller.ts` — `excluded` parameter.
- `electron/main.ts` — `excludedBadgeKeys()` helper; three `applyBadge` call
  sites; `SET_ACCOUNT_PREF` handler arg + patch.
- `electron/sidebar-preload.ts` — arg type.
- `renderer/app/page.tsx` — bridge arg type.
- `renderer/app/SettingsPanel.tsx` — delegated-only Badge checkbox.
- `renderer/app/strings.ts` — `badgeToggle`, `badgeToggleTitle`.
- `tests/badge-math.test.ts` (+ optionally `tests/badge-controller.test.ts`) — coverage.
