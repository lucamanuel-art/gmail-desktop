# Changelog

All notable changes to Gmail Desktop are documented here. This project adheres
to [Semantic Versioning](https://semver.org/).

## [0.1.8] — 2026-07-08

### Added
- Choose how clicking a notification opens its message or event: **in the app**
  (default — brings the window forward and opens it in place) or **in a new
  window**. Setting lives under General.
- Settings now has a **Save** button and a "Saved ✓" confirmation. All controls
  still apply instantly; Save additionally commits an in-progress name edit and
  confirms everything was stored.

### Fixed
- Clicking a notification while the app is minimized now restores and focuses
  the window (with "Open in the app"), instead of leaving it minimized behind a
  stray window.
- Clicking a notification no longer opens **two** windows in "Open in a new
  window" mode (the app's own open and Gmail's follow-up popup both fired).
- Account name edits now also save on Enter, and the quiet-hours time fields no
  longer lose their value while you're typing a new time.
- **Clicking a mail notification now opens the clicked message**, not just the
  account's inbox. The "When you click a notification" setting now works as
  intended: *in the app* opens the message in place, *in a new window* opens it
  in Gmail's focused pop-out reading window (just the message, without the
  sidebar/search chrome). (Gmail's notifications carry no message reference and
  its own click handler does nothing inside the wrapper, so the app resolves the
  message from the notification's subject and triggers Gmail's own pop-out; if
  that button can't be found it falls back to a full thread window.)
- The app no longer crashes ("Cannot read properties of undefined") after a
  Google page inside a view closes itself, e.g. Gmail's pop-out compose after
  sending. Dead views are now cleaned up.
- Fixed a crash on quit ("Object has been destroyed") when views were torn down
  after the main window had already closed.
- Fixed a crash ("Object has been destroyed") when clicking a notification after
  the main window had been closed/torn down — the click now rebuilds the window
  and brings the app back instead of failing silently.
- Clicking a notification no longer triggers Gmail's "pop-up blocked" warning
  (the app opens the message itself and hands Gmail's follow-up popup a
  harmless stub instead of a blocked-looking null window).

## [0.1.7] — 2026-07-07

### Fixed
- Links clicked inside an email now open in your default browser instead of
  loading inside the mail view. Gmail, Calendar and Google sign-in navigation
  still stay in the app.

## [0.1.6] — 2026-07-07

### Fixed
- Per-account notification toggles in Settings now reflect the stored state and
  respond to clicks. Previously a toggle could show "on" while notifications for
  that account were actually muted, and toggling it had no effect (the settings
  UI was not kept in sync after a change).

### Added
- **Calendar reminders.** Google Calendar's own event reminders can now appear as
  desktop notifications, enabled per account (opt-in). They respect the global
  Do Not Disturb switch and quiet hours, and clicking a reminder opens that
  account's calendar. No calendar data is read — Google Calendar fires the
  reminders itself from a background view.
- Each account row in Settings now has separate **Mail** and **Calendar**
  notification toggles.

## [0.1.5] — 2026-07-06

### Added
- Launch at login (optional) and remembered window size/position.
- Per-account notifications with a global Do Not Disturb switch and quiet hours.
- Clicking a notification restores the window and switches to the right account.
- Drag to reorder accounts in the sidebar, and custom per-account labels.
- Keyboard shortcuts: Ctrl+1–9 to switch accounts, Ctrl+N to compose.
- Per-account zoom (Ctrl +/−/0), remembered across sessions.
- Light and dark theme for the app shell, following the system with a manual
  override.
- Google Calendar logo for the calendar button; removed the dark frame around
  the Gmail view.

## [0.1.1] – [0.1.4]

Initial Gmail Desktop wrapper: multi-account sidebar with avatars and unread
badges, per-account calendar, desktop notifications, tray with minimize-to-tray,
single-instance, account add/remove, and auto-update from GitHub Releases.
