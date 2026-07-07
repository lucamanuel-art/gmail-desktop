# Desktop polish features — design

Date: 2026-07-07

Eight quality-of-life features for the Gmail Desktop wrapper, built on a shared
preferences foundation. A ninth idea — a tray notification for the next calendar
appointment — is explicitly **out of scope** here and will get its own spec (it
needs fragile, locale-dependent calendar DOM scraping and is larger in nature).

## Goals

1. **Launch at login** (auto-start) — toggle, default off.
2. **Remember window size/position** across sessions.
3. **Per-account notifications** — on/off per account, a global Do-Not-Disturb
   toggle, and a quiet-hours schedule.
4. **Notification click → account + message** — harden the existing behaviour so
   clicking a notification restores/focuses the window, switches to the right
   account, and lets Gmail open the thread.
5. **Reorder accounts (drag) + custom label per account.**
6. **Shortcuts** — Ctrl+1…9 to switch accounts, Ctrl+N to compose.
7. **Zoom per account**, remembered across sessions (Ctrl +/−/0).
8. **Light/dark theme for the shell** — follow OS by default, with a manual
   override.

Note: close-to-tray already exists (`shouldHideOnClose` hides the window on
close on all platforms); this spec does not change that.

## Non-goals

- Calendar/agenda tray notification (separate future spec).
- Changing the Google `authuser` index mapping. Reordering is display-only.
- Search shortcut (blocked by the "keystroke injection into the Gmail view does
  not work" limitation; compose is done via a compose URL instead).
- Refactoring the existing `ColorStore`/`RemovedStore` into the new store.

## Foundation — `PrefsStore`

A single JSON store at `<userData>/prefs.json`, following the existing
`ColorStore`/`RemovedStore` pattern (defensive read, atomic-ish write, tolerant
of missing/corrupt files). It holds one typed `Prefs` object:

```ts
interface AccountPref {
  order?: number;   // display order in the sidebar; falls back to authuser index
  label?: string;   // overrides the displayed account name
  zoom?: number;    // webContents zoom level
  notify?: boolean; // per-account notification toggle (default: true when absent)
}

interface Prefs {
  window: { width: number; height: number; x?: number; y?: number; maximized: boolean };
  autoStart: boolean;                 // default false
  theme: 'system' | 'light' | 'dark'; // default 'system'
  notifications: {
    dnd: boolean;                                          // default false
    quietHours: { enabled: boolean; start: string; end: string }; // "HH:MM", default disabled
  };
  accounts: Record<string /* email */, AccountPref>;
}
```

API surface (keep it small and typed):

- `getAll(): Prefs` — returns the stored object merged over defaults.
- `patch(partial: DeepPartial<Prefs>): void` — shallow-merge top-level keys,
  deep-merge `notifications` and per-email `accounts` entries, then write.
- Thin helpers used by callers: `getAccount(email)`, `setAccount(email, partial)`,
  `setWindow(bounds)`, `setTheme`, `setAutoStart`, `setNotifications`.

`ColorStore` and `RemovedStore` stay as they are.

## Per-feature design

### 1. Auto-start
- On app ready, read `prefs.autoStart` and call
  `app.setLoginItemSettings({ openAtLogin: prefs.autoStart })` so the OS setting
  reflects the stored pref.
- New IPC `SET_AUTO_START(boolean)`: persist + apply.
- Settings UI: a toggle in a new **General** section.

### 2. Window bounds persistence
- In `createWindow`, read `prefs.window`. Validate the stored `{x,y,width,height}`
  against the current displays via the `screen` module; if the rect is not
  substantially on any display, drop `x/y` and use the default centred window.
  Restore `maximized` by calling `win.maximize()` after creation.
- Persist on `resize`/`move` (debounced ~400ms) and on `close`, recording
  `maximized` and — when not maximized — the normal bounds.
- The on-screen validation (`clampBoundsToDisplays`) is a pure function, unit-tested.

### 3. Notifications — per-account + DND + quiet hours
- **Main is the source of truth.** Main computes a per-account boolean
  `notificationsAllowed(prefs, email, now)`:
  - `false` if global `dnd` is on;
  - `false` if `quietHours.enabled` and `now` falls inside the (possibly
    midnight-crossing) `start..end` window;
  - `false` if the account's `notify` pref is explicitly `false`;
  - otherwise `true`.
  This is a pure function, unit-tested (including the midnight-crossing case and
  boundary minutes).
- Main pushes the current allowed-flag to each mail view's preload over a new IPC
  channel `NOTIFY_ALLOWED { allowed: boolean }`. The `preload.ts` Notification
  wrapper checks the cached flag and, when `false`, does **not** construct the
  native `Notification` (returns a harmless stub). When `true`, it constructs the
  real notification exactly as today — so Gmail's own click→thread navigation is
  preserved.
- Main recomputes and re-pushes on: any notification pref change, DND toggle,
  per-account toggle, profile changes, and a timer that fires at the next
  quiet-hours boundary.
- New IPC: `SET_NOTIFICATIONS` (dnd + quietHours) and per-account toggle folded
  into a `SET_ACCOUNT_PREF { email, notify }`.
- Settings UI: a **Notifications** section (DND toggle; quiet-hours enable +
  start/end time inputs) and a per-account notification toggle in the accounts list.
- Testing note: notifications only fire on Windows; verify there, not in WSL.

### 4. Notification click → account + message
- Existing wiring already routes `NOTIFICATION_ACTIVATE` with the correct index
  to `onActivate`, which shows the window and switches account. Harden it:
  - `win.restore()` if minimized, then `win.show()` and `win.focus()`.
  - Ensure the switch targets the **mail** surface for that index.
  - Rely on Gmail's own `onclick` to open the specific thread inside the view.
- No message-id plumbing; the thread navigation is Gmail's responsibility.

### 5. Reorder (drag) + custom labels
- Sidebar sorts profiles by `order ?? index`. Main merges `order` and `label`
  from `PrefsStore` into the `Profile` objects it sends via `PROFILES_CHANGED`
  (extend `Profile` with optional `order` and `label`; `label` falls back to
  `name`).
- Drag-and-drop reorder in the sidebar using native HTML5 drag events (no
  library). Dropping recomputes a compact `order` for all accounts and sends
  `SET_ACCOUNT_ORDER { emailsInOrder: string[] }`; main assigns 0..n-1.
- Label editing lives in the accounts list in settings (inline edit); sends
  `SET_ACCOUNT_PREF { email, label }`. An empty label clears the override.
- The `order ?? index` sort is a pure helper, unit-tested.

### 6. Shortcuts (Ctrl+1…9, Ctrl+N)
- A pure `resolveShortcut(input): Action | null` maps a `before-input-event`
  descriptor to an action: `{type:'switch', n}` for Ctrl+1…9,
  `{type:'compose'}` for Ctrl+N, `{type:'zoom', dir}` for Ctrl +/−/0 (shared with
  feature 7). Unit-tested.
- Main attaches `webContents.on('before-input-event')` to the sidebar and to
  every view created in `ensureView`, routing resolved actions so they work
  regardless of which surface has focus.
  - `switch n` → activate the n-th account in display order.
  - `compose` → open a small popup `BrowserWindow` on the `persist:google`
    partition loading the compose URL `…/mail/u/<index>/?view=cm&fs=1&tf=1` for
    the active account (reliable, since keystrokes into the view don't work).
  - `zoom` → see feature 7.

### 7. Zoom per account, remembered
- Ctrl+= / Ctrl+- / Ctrl+0 (via the same `before-input-event` plumbing) adjust
  `webContents.setZoomLevel` on the active view. Ctrl+0 resets to 0.
- The resulting level is persisted per email (`accounts[email].zoom`) and applied
  in `ensureView` when a view is created — for both the mail and calendar
  surfaces of that account.

### 8. Theme (system + manual override)
- Enable Tailwind `darkMode: 'class'`. A small theme provider in the renderer
  sets `light`/`dark` on `<html>`:
  - `'system'` → follow `window.matchMedia('(prefers-color-scheme: dark)')`
    (Chromium follows the OS via `nativeTheme`), updating on change.
  - `'light'`/`'dark'` → forced.
- Persist the choice (`SET_THEME`); load it into the renderer via
  `PROFILES_CHANGED`-adjacent state or a dedicated `THEME_CHANGED` push.
- Make the hard-coded shell colours in `page.tsx` and `SettingsPanel.tsx`
  theme-aware (`bg-white dark:bg-neutral-950`, etc.). Only the 72px sidebar and
  the settings pane change; Gmail keeps its own theme. This is the largest UI
  change in the set.
- Settings UI: a System/Light/Dark selector in the **General** section.

## Settings panel layout

New sections in `SettingsPanel`, above/around the existing **About & updates**:
- **General** — auto-start toggle, theme selector.
- **Notifications** — DND toggle, quiet-hours enable + start/end.
- **Accounts** — existing color/remove, plus inline label edit and a per-account
  notification toggle.
- **Shortcuts** — a static reference list (Ctrl+1…9, Ctrl+N, Ctrl +/−/0).

## New IPC channels

Renderer → main: `SET_AUTO_START`, `SET_THEME`, `SET_NOTIFICATIONS`,
`SET_ACCOUNT_PREF` (label/notify), `SET_ACCOUNT_ORDER`.
Main → mail view: `NOTIFY_ALLOWED`.
Main → renderer: extend `PROFILES_CHANGED` with `order`/`label`; add
`THEME_CHANGED` (and initial theme on load).

## Build order (implementation phases)

1. **Foundation** — `PrefsStore` + General settings section scaffold.
2. **Window bounds + auto-start** — quick wins on the new store.
3. **Zoom + shortcuts** — share the `before-input-event` plumbing and
   `resolveShortcut`.
4. **Reorder + labels.**
5. **Notifications** (DND / quiet hours / per-account) + click-activate polish.
6. **Theme** — shell light/dark refactor.

Each phase leaves the app in a shippable state.

## Testing

Unit (vitest, existing pattern) for the pure logic:
- `PrefsStore` read/patch/defaults and corrupt-file tolerance.
- `notificationsAllowed(prefs, email, now)` incl. midnight-crossing quiet hours
  and boundary minutes.
- `resolveShortcut(input)` mapping.
- `clampBoundsToDisplays(bounds, displays)` on-screen validation.
- `order ?? index` sidebar sort.

Electron-integration parts verified manually on Windows: auto-start registration,
notification suppression, compose popup, zoom persistence, and the light/dark
shell.
