# Calendar reminders — design

Date: 2026-07-07

Let Google Calendar's own event reminders fire as desktop notifications from the
app, per account, without reading calendar data. This is the deferred "agenda
notification" idea (out of scope of the 2026-07-07 desktop-polish spec), now
scoped as its own feature.

## Goal

When an account has calendar reminders enabled, Google Calendar's native event
reminders pop up as desktop notifications from the app — the same way mail
notifications already work — and clicking one focuses the app on that account's
calendar. No OAuth, no calendar API, no DOM scraping, no dependency on Google's
generated CSS classes.

## Why this approach

The app is a web wrapper around an authenticated Google session. Google Calendar
web already fires HTML5 `Notification`s for events whose reminders are set to
"Notification". The app already intercepts `window.Notification` in the shared
preload (for mail) and grants notification permission on the `persist:google`
session. So the robust path is to keep a Calendar `WebContentsView` alive in the
background per opted-in account and let Google fire the reminders — Google owns
the event logic; we only gate and route.

Rejected alternatives: Google Calendar API (requires an OAuth client, consent
screen, token storage/refresh — a whole new subsystem the wrapper doesn't have);
DOM/ICS scraping (fragile, locale-dependent, breaks on Google's generated
classes — explicitly ruled out).

## Non-goals

- No custom "next appointment" indicator/tray badge (that would need to read
  events — a separate future feature).
- No change to how mail notifications work.
- No calendar event parsing of any kind.

## Design

### 1. Preference

Add `calendarNotify?: boolean` to `AccountPref` in `electron/prefs-store.ts`
(alongside `notify` for mail). **Default off (opt-in)**: absent/undefined means
disabled, because each enabled account costs a persistent background view. (Mail
`notify` keeps its default-on semantics — absent means enabled.)

### 2. Background calendar view lifecycle

For calendar reminders to fire, that account's calendar `WebContentsView` must be
loaded and running even when never opened.

- On account detection and on the toggle flipping on: if `calendarNotify === true`
  for the account, eagerly `ensureView(index, 'calendar', false)` (hidden).
- On the toggle flipping off: `discardView(index, 'calendar')` **unless** that
  calendar surface is the currently-shown view.
- On account removal / redetect: existing teardown already discards both surfaces;
  recreate background calendar views for opted-in accounts after redetect.
- Calendar views are created with `backgroundThrottling: false` in
  `webPreferences` so reminder timers fire on time while the view is hidden.
  (Mail views are unaffected; only the calendar-view creation path sets this.)

This mirrors the existing pattern where every detected account keeps a hidden
mail view alive for unread badges + notifications.

### 3. Notification policy — two independent per-account switches under one umbrella

- Global **DND** and **quiet hours** apply to BOTH mail and calendar (they are the
  mute-all / scheduled-silence controls).
- Under that umbrella, two independent per-account switches: **Mail** (`notify`,
  default on) and **Calendar** (`calendarNotify`, default off).
- Extend the pure policy function to take a surface:
  `notificationsAllowed(prefs, email, now, surface: 'mail' | 'calendar')`.
  - DND on → false (both surfaces).
  - quiet hours enabled and `now` inside window → false (both).
  - surface `'mail'`: `false` if `accounts[email].notify === false`, else true.
  - surface `'calendar'`: `true` only if `accounts[email].calendarNotify === true`
    (opt-in), else false.
  This stays pure and unit-tested (mail vs calendar pick the right toggle; DND and
  quiet hours gate both).
- `main` computes the allowed flag per (account, surface) and pushes
  `NOTIFY_ALLOWED` to the corresponding view. Today `pushNotifyAllowed(index,
  allowed)` targets only the mail view; generalize it to
  `pushNotifyAllowed(index, surface, allowed)` and push to both surfaces.
- `refreshNotifyAllowed()` recomputes and pushes for both surfaces of every
  profile; still triggered on pref change, DND/quiet-hours change, per-account
  toggle change, identity, and the existing 60s quiet-hours tick.

The mail preload gate already suppresses construction of the native
`Notification` when its cached `NOTIFY_ALLOWED` flag is false. The same preload
runs in the calendar view, so no preload change is needed — the calendar view
just receives its own flag.

### 4. Click routing

The `ipc-message` wiring in `ProfileViewManager.ensureView` currently forwards
unread/notification/identity only for `surface === 'mail'`. Extend it so calendar
views also forward `NOTIFICATION_ACTIVATE`, tagged with their surface. The
activation callback becomes `onActivate(index, surface)`:
- restore (if minimized) + show + focus the window;
- close the settings panel if open;
- switch to that account's surface — mail notification → mail, calendar
  reminder → calendar.

Surface is known at the manager level (the handler is wired per view), so the
preload does not change.

### 5. Settings UI

In each account row in `SettingsPanel.tsx`, replace the single notification
checkbox with two labelled toggles: **Mail** (bound to `notify !== false`,
default on) and **Calendar** (bound to `calendarNotify === true`, default off).
Each sends `setAccountPref({ email, notify })` / `setAccountPref({ email,
calendarNotify })`. English copy. The global DND + quiet-hours controls in the
Notifications section are unchanged and now documented as applying to both.

## Files touched

- `electron/prefs-store.ts` — add `calendarNotify?: boolean` to `AccountPref`.
- `electron/notification-policy.ts` — add `surface` parameter; +tests.
- `electron/profile-view-manager.ts` — calendar `ipc-message` wiring, surface in
  activation callback, `backgroundThrottling: false` on calendar views,
  `pushNotifyAllowed(index, surface, allowed)`.
- `electron/main.ts` — eager background calendar views for opted-in accounts
  (load/discard on toggle), per-surface allowed computation + push,
  `onActivate(index, surface)` routing.
- `electron/ipc.ts` — `SET_ACCOUNT_PREF` already carries arbitrary account-pref
  fields; extend its typed payload to include `calendarNotify`.
- `electron/sidebar-preload.ts` / `renderer/app/page.tsx` — `setAccountPref`
  already exists; extend its arg type with `calendarNotify`.
- `renderer/app/SettingsPanel.tsx` — Mail/Calendar per-account toggles.

## Testing

- Unit (vitest, pure): `notificationsAllowed(prefs, email, now, 'mail'|'calendar')`
  — mail uses `notify` (default on), calendar uses `calendarNotify` (default off),
  DND and quiet hours gate both surfaces, boundary minutes for quiet hours.
- Electron-integration (manual, Windows — reminders don't fire in WSLg): a real
  Google Calendar reminder fires as a desktop notification for an opted-in
  account; DND and quiet hours suppress it; toggling Calendar off stops reminders
  and frees the background view; clicking a reminder focuses the app on that
  account's calendar; enabling Calendar for multiple accounts loads a background
  view per account.

## Rollout

Ships as the next version (0.1.6) via the existing tag-triggered Windows release
workflow (`.github/workflows/release.yml`).
