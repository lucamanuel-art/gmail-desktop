# Per-account notification sound toggle

**Date:** 2026-07-15
**Status:** Approved (design)

## Problem

Users (notably those with delegated mailboxes) want to keep seeing new-mail
notification banners but stop hearing the notification **sound**. Today the app
offers only an all-or-nothing per-account `notify` toggle: notifications are
either fully on (banner + sound) or fully off. The separate `badgeCount` toggle
only controls the taskbar badge and has no effect on notifications or their
sound, which is a common point of confusion ("I turned badges off but still
hear the sound").

The sound is **not** controlled by the original mailbox owner's Gmail settings.
It is the OS/Chromium HTML5-notification sound, emitted as a side effect of the
web `Notification` that our preload constructs at `electron/preload.ts:144`.
The wrapper's only current lever is whether that notification is created at all.
The web `Notification` API supports an `options.silent` flag that suppresses the
sound while still showing the banner — we are not using it.

## Goal

Add a **per-account** "notification sound" toggle. When off, mail notifications
for that account are still shown but constructed with `options.silent = true`,
so no sound plays. Existing behaviour (sound on) is preserved for all current
accounts. Works identically for delegated mailboxes with no special-casing.

## Non-goals

- No global "silent mode" for Do-Not-Disturb / quiet hours. DnD and quiet hours
  continue to suppress the whole notification (banner included). The sound
  toggle only applies when a notification would otherwise be shown.
- No change to calendar-reminder notifications (they keep their current sound
  behaviour in v1).
- No in-page Gmail audio handling — there is none; the sound is purely the OS
  notification sound.

## Design

### 1. Pref field — `electron/prefs-store.ts`

Add to `AccountPref`:

```ts
notifySound?: boolean; // default (absent) = sound on; false = silent
```

Opt-out semantics, mirroring `notify`. No migration needed: `getAll()` passes
the `accounts` map through unchanged, and absent = sound on.

### 2. Policy — `electron/notification-policy.ts`

Add a pure function alongside `notificationsAllowed` (which stays unchanged):

```ts
export function notificationSilent(
  prefs: Prefs,
  email: string,
  surface: Surface = 'mail',
): boolean {
  if (surface !== 'mail') return false; // v1: only mail honours the sound toggle
  return prefs.accounts[email]?.notifySound === false;
}
```

Silent is only meaningful when a notification is actually shown; the caller
combines it with `notificationsAllowed`. Independent of DnD/quiet hours by
construction.

### 3. IPC payload — `electron/ipc.ts`

Change `IPC.NOTIFY_ALLOWED` payload from `boolean` to an object:

```ts
NOTIFY_ALLOWED: 'notify:allowed', // main -> mail view: send({ show: boolean; silent: boolean })
```

Sending both fields in one message avoids a race between two separate signals.

### 4. Push from main — `electron/profile-view-manager.ts` + `electron/main.ts`

- `pushNotifyAllowed(accountKey, surface, state: { show: boolean; silent: boolean })`
  sends the object over `IPC.NOTIFY_ALLOWED`.
- `refreshNotifyAllowed()` computes
  `{ show: notificationsAllowed(...), silent: notificationSilent(...) }`
  per profile per surface and pushes it. `main.ts` imports `notificationSilent`.
- The existing `SET_ACCOUNT_PREF` handler already calls `refreshNotifyAllowed()`,
  so toggling `notifySound` re-pushes immediately.

### 5. Preload — `electron/preload.ts`

- Replace the boolean `notifyAllowed` with state
  `let notifyState = { show: true, silent: false }`.
- `ipcRenderer.on(IPC.NOTIFY_ALLOWED, (_e, state) => { notifyState = state; })`.
- In the `Wrapped` constructor:
  - `if (!notifyState.show)` → return the existing harmless stub.
  - else construct
    `new Original(title, notifyState.silent ? { ...options, silent: true } : options)`.

  This preserves any `silent` Gmail itself set and only forces it on when our
  toggle is off.

### 6. Settings UI — `renderer/app/SettingsPanel.tsx`

Add a fourth checkbox in the per-account toggle row (after the badge checkbox),
labelled with a new i18n string. Bound to `notifySound !== false`, calling
`setAccountPref({ email, notifySound: e.target.checked })`. The checkbox is
disabled/greyed when `notify === false` (no banner means the sound toggle is
moot).

### 7. i18n — `renderer/app/strings.ts`

Add `soundToggle` and `soundToggleTitle` to the `Strings` interface and to both
the default (English) and René-mode (Dutch) string sets.

## Testing

- **Unit (`tests/notification-policy.test.ts`):** add `notificationSilent` cases
  — default (absent) → false; `notifySound: false` → true; non-mail surface →
  false; independent of DnD/quiet hours (silent stays as configured even when
  `notificationsAllowed` would be false — the caller gates on `show`).
- **Logic verification (this WSL2 box):** confirm the preload builds the options
  object with `silent: true` only when the pushed state says so (the CDP/verify
  harness can inspect the constructed options).
- **Manual on Windows (required):** desktop notifications don't fire in WSL2
  (no daemon), so the actual sound suppression must be verified on the real
  Windows target — confirm the banner still appears but plays no sound when the
  toggle is off, for both an owned and a delegated mailbox.

## Risks

- **Chromium `silent` support on Windows:** the whole feature hinges on
  Chromium's web `Notification` honouring `options.silent` on the Windows target.
  This is standard web-platform behaviour but must be confirmed on Windows
  (see testing). If it does not suppress the sound, the fallback would be a
  larger change (routing mail notifications through the main-process Electron
  `Notification` with its `silent` option), which is out of scope for this spec.
