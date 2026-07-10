# Clickable "update available" notification — design

**Date:** 2026-07-10
**Status:** Approved, ready for implementation plan

## Problem

The app already auto-updates via `electron-updater` against GitHub Releases
(`electron/main.ts`, `setupUpdater`). Today the update state is surfaced two ways:

- The **Settings → update section** reflects live state via IPC `UPDATE_STATUS`.
- The **tray "Check for updates"** item runs a manual check and shows a native
  `dialog` popup with the terminal result (`maybeShowTrayUpdatePopup`).

But the **automatic** check only runs **once, at launch** (`app.whenReady` →
`autoUpdater.checkForUpdates()`), and when it discovers a new version it surfaces
*nothing* proactive — the user has to open Settings or the tray to find out.
There is also no re-check while the app runs for days in the tray.

## Goal

When a new release is discovered by a background check, show a **clickable OS
notification**. Clicking it brings the app forward and opens the Settings update
section, where the existing Download/Install controls live.

## Scope

**In scope**

- Periodic background update checks: at launch (existing) **plus every 30
  minutes** while running.
- A native `Notification` on a background-discovered new version.
- Clicking the notification → `openSettingsPanel()` (window forward + Settings
  update section).
- Re-notify rule: **once per version per session** (nudges again after a restart
  if still not updated).

**Explicitly out of scope**

- Webhook / server push. A desktop client behind NAT can't receive inbound
  webhooks; polling is the standard `electron-updater` model and needs no
  backend. Documented here so it isn't revisited.
- Auto-download / silent install. The notification only *routes the user to
  Settings*; `autoUpdater.autoDownload` stays `false` and the user chooses to
  download there, exactly as today.
- Notification action buttons. Body-click only (matches the request).
- Localized (Rene-mode simple-Dutch) notification copy. The toast is created in
  the main process, which has no access to the renderer `UiStrings`; v1 copy is
  the default English. Revisit only if asked.
- Changing the manual paths. Tray "Check for updates" keeps its `dialog`; the
  Settings "check now" button keeps its inline UI. Neither also fires a toast.

## Behavior

1. On launch (packaged only) the existing check runs, now tagged as a
   **background** check. A `setInterval` re-runs a background check every 30 min.
2. When `autoUpdater` emits `update-available` **and** the triggering check was a
   background one **and** we have not already notified for that version this
   session, the app shows a notification:
   - **Title:** `Update available`
   - **Body:** `Gmail Desktop <version> is ready. Click to update.`
3. Clicking the notification calls `openSettingsPanel()` — restores/shows/focuses
   the window and force-opens the Settings panel (update section visible).
4. Manual checks (tray item, Settings "check now") do **not** fire the toast —
   the user is already looking at the result — they keep their current behavior.
5. Gated by `Notification.isSupported()`; a no-op where notifications aren't
   available (e.g. the WSLg dev box). Verified visually on a Windows build.

## Components

### 1. `electron/update-notifier.ts` (new, pure + unit-tested)

Encapsulates the decision so it is testable without Electron:

```ts
export interface NotifyDecisionInput {
  state: string;              // autoUpdater-derived state
  version: string | null;     // the available version
  background: boolean;         // was the triggering check a background one?
  notifiedVersion: string | null; // last version we already notified this session
}

export function shouldNotifyUpdate(i: NotifyDecisionInput): boolean {
  return (
    i.state === 'available' &&
    i.background &&
    !!i.version &&
    i.version !== i.notifiedVersion
  );
}
```

`Notification.isSupported()` is an environmental side-effect and is checked in
`main.ts`, not here, so this stays pure.

### 2. `electron/main.ts` (wiring)

- **Import** `Notification` from `'electron'`.
- **State:** `let notifiedUpdateVersion: string | null = null;` and
  `let lastCheckBackground = false;` (module-level, alongside `lastUpdateStatus`).
  In-memory → resets on restart, giving the "once per launch" nudge.
- **`checkForUpdate(opts?: { background?: boolean })`:** set
  `lastCheckBackground = opts?.background === true` as the first line, then the
  existing body (dev guard → `sendUpdate({state:'checking'})` →
  `autoUpdater.checkForUpdates()`). Manual callers (tray, `UPDATE_CHECK` IPC)
  pass nothing (`background` false); background callers pass `{ background: true }`.
  Checks are infrequent (30 min) and short, so the shared flag won't realistically
  race between a manual and background check.
- **Notify helper:**

  ```ts
  function maybeNotifyUpdate(version: string): void {
    if (
      !shouldNotifyUpdate({
        state: 'available',
        version,
        background: lastCheckBackground,
        notifiedVersion: notifiedUpdateVersion,
      })
    )
      return;
    if (!Notification.isSupported()) return;
    notifiedUpdateVersion = version;
    const n = new Notification({
      title: 'Update available',
      body: `Gmail Desktop ${version} is ready. Click to update.`,
    });
    n.on('click', () => openSettingsPanel());
    n.show();
  }
  ```

- **Hook it in** the existing `update-available` handler in `setupUpdater`:

  ```ts
  autoUpdater.on('update-available', (info) => {
    sendUpdate({ state: 'available', version: info.version });
    maybeNotifyUpdate(info.version);
  });
  ```

- **Periodic timer + startup tag** (in the `app.whenReady` block, after
  `setupUpdater()`, replacing the current direct `checkForUpdates()` call):

  ```ts
  if (app.isPackaged) {
    checkForUpdate({ background: true });
    setInterval(() => checkForUpdate({ background: true }), 30 * 60_000);
  }
  ```

  (`checkForUpdate` already carries the dev guard, so the timer is inert in dev.)

`openSettingsPanel()` is reused unchanged. If the window has been destroyed it
no-ops today; in the Windows tray flow the window is hidden, not destroyed, so
the click path works. Resurrecting a destroyed window from a notification click
is a possible later hardening, not v1.

## Testing

- `tests/update-notifier.test.ts` (new): `shouldNotifyUpdate`
  - background + `state:'available'` + new version → `true`.
  - same version repeated (`version === notifiedVersion`) → `false`.
  - manual check (`background:false`) → `false`.
  - non-available state (`checking` / `not-available` / `downloaded`) → `false`.
  - null/empty version → `false`.
- Timer, `Notification`, and click wiring are integration-only; the toast can't be
  observed in WSLg. Confirmed on a Windows build (per repo convention). A launch
  smoke check confirms the new wiring doesn't crash startup.

## Files touched

- `electron/update-notifier.ts` — new pure `shouldNotifyUpdate`.
- `electron/main.ts` — import `Notification`; `notifiedUpdateVersion` +
  `lastCheckBackground` state; `checkForUpdate` background param;
  `maybeNotifyUpdate`; hook in `update-available`; 30-min timer + background-tagged
  startup check.
- `tests/update-notifier.test.ts` — coverage for the decision function.
