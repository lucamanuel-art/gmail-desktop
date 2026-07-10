# Update-Available Notification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a background update check discovers a new release, show a clickable OS notification that opens the app's Settings update section.

**Architecture:** A pure decision function (`shouldNotifyUpdate`) decides whether to notify, given the update state, version, whether the check was a background one, and the last version already notified this session. `electron/main.ts` runs the existing update check at launch plus a 30-minute timer (both tagged as background), and on `update-available` calls the decision function and — if true and notifications are supported — shows an Electron `Notification` whose click reuses the existing `openSettingsPanel()`.

**Tech Stack:** TypeScript, Electron 31, `electron-updater`, esbuild (bundles `electron/*.ts`), Vitest.

## Global Constraints

- Poll interval: **30 minutes** (`30 * 60_000` ms), plus the existing launch check.
- Re-notify rule: **once per version per session** — tracked in-memory via `notifiedUpdateVersion` (resets on restart).
- Only **background** checks trigger the notification; **manual** checks (tray "Check for updates", Settings "check now" IPC `UPDATE_CHECK`) keep their existing behavior and fire no toast.
- No auto-download: `autoUpdater.autoDownload` stays `false`; the notification only routes to Settings.
- Notification copy is **English** (default UI flavor), created in the main process. Title `Update available`; body `Gmail Desktop <version> is ready. Click to update.`
- Gate the toast on `Notification.isSupported()` (no-op in WSLg; verified on a Windows build).
- The timer and background startup check run **only when `app.isPackaged`** (`checkForUpdate` already no-ops in dev, so the timer must not even start in dev).

---

### Task 1: Pure `shouldNotifyUpdate` decision function

**Files:**
- Create: `electron/update-notifier.ts`
- Test: `tests/update-notifier.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces:
  - `interface NotifyDecisionInput { state: string; version: string | null; background: boolean; notifiedVersion: string | null }`
  - `function shouldNotifyUpdate(i: NotifyDecisionInput): boolean` — `true` only when `state === 'available'` AND `background` AND `version` is non-empty AND `version !== notifiedVersion`.

- [ ] **Step 1: Write the failing test**

Create `tests/update-notifier.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { shouldNotifyUpdate } from '../electron/update-notifier';

describe('shouldNotifyUpdate', () => {
  const base = { state: 'available', version: '0.2.5', background: true, notifiedVersion: null };

  it('notifies for a new version found by a background check', () => {
    expect(shouldNotifyUpdate(base)).toBe(true);
  });
  it('stays silent for a version already notified this session', () => {
    expect(shouldNotifyUpdate({ ...base, notifiedVersion: '0.2.5' })).toBe(false);
  });
  it('stays silent for a manual (non-background) check', () => {
    expect(shouldNotifyUpdate({ ...base, background: false })).toBe(false);
  });
  it('stays silent for non-available states', () => {
    for (const state of ['checking', 'not-available', 'downloading', 'downloaded', 'error', 'dev', 'idle']) {
      expect(shouldNotifyUpdate({ ...base, state })).toBe(false);
    }
  });
  it('stays silent when the version is null or empty', () => {
    expect(shouldNotifyUpdate({ ...base, version: null })).toBe(false);
    expect(shouldNotifyUpdate({ ...base, version: '' })).toBe(false);
  });
  it('notifies for a newer version after a different one was already notified', () => {
    expect(shouldNotifyUpdate({ ...base, version: '0.2.6', notifiedVersion: '0.2.5' })).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/update-notifier.test.ts`
Expected: FAIL — cannot resolve `../electron/update-notifier` (module not found).

- [ ] **Step 3: Write minimal implementation**

Create `electron/update-notifier.ts`:

```ts
export interface NotifyDecisionInput {
  state: string; // autoUpdater-derived state
  version: string | null; // the available version
  background: boolean; // was the triggering check a background one?
  notifiedVersion: string | null; // last version already notified this session
}

// Notify only for a genuinely new version surfaced by a background check — not
// for manual checks (the user is already looking) and not twice for the same
// version within a session.
export function shouldNotifyUpdate(i: NotifyDecisionInput): boolean {
  return (
    i.state === 'available' &&
    i.background &&
    !!i.version &&
    i.version !== i.notifiedVersion
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/update-notifier.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/update-notifier.ts tests/update-notifier.test.ts
git commit -m "feat: add shouldNotifyUpdate decision for update notifications"
```

---

### Task 2: Wire the notification and 30-minute background check into main

**Files:**
- Modify: `electron/main.ts`
  - Import block (line 1): add `Notification`.
  - `electron/update-notifier` import (near the other `./` imports, e.g. after the `badge-controller` import ~line 21).
  - State vars near `lastUpdateStatus` (~line 72).
  - `checkForUpdate` (~line 753).
  - `setupUpdater` `update-available` handler (~line 822).
  - `app.whenReady` update block (~line 982).

**Interfaces:**
- Consumes: `shouldNotifyUpdate` from Task 1; existing `openSettingsPanel()`, `sendUpdate()`, `autoUpdater`, `app.isPackaged`.
- Produces: no new exports (internal wiring only).

- [ ] **Step 1: Add imports**

At the top of `electron/main.ts`, add `Notification` to the existing electron import:

```ts
import { app, BrowserWindow, protocol, net, ipcMain, session, Menu, screen, dialog, Notification } from 'electron';
```

And add the decision-function import alongside the other local imports (e.g. just below `import { applyBadge } from './badge-controller';`):

```ts
import { shouldNotifyUpdate } from './update-notifier';
```

- [ ] **Step 2: Add session state vars**

Immediately after the `let lastUpdateStatus: Record<string, unknown> = { state: 'idle' };` line (~line 72), add:

```ts
let notifiedUpdateVersion: string | null = null; // last version we showed a notification for this session
let lastCheckBackground = false; // was the in-flight update check a background one?
```

- [ ] **Step 3: Tag `checkForUpdate` with a background flag**

Change the `checkForUpdate` signature and first line (~line 753). Current:

```ts
function checkForUpdate(): void {
  if (!app.isPackaged) return sendUpdate({ state: 'dev' });
  sendUpdate({ state: 'checking' });
  autoUpdater
    .checkForUpdates()
    .catch((err) => sendUpdate({ state: 'error', message: String(err?.message || err) }));
}
```

Replace with:

```ts
function checkForUpdate(opts?: { background?: boolean }): void {
  lastCheckBackground = opts?.background === true;
  if (!app.isPackaged) return sendUpdate({ state: 'dev' });
  sendUpdate({ state: 'checking' });
  autoUpdater
    .checkForUpdates()
    .catch((err) => sendUpdate({ state: 'error', message: String(err?.message || err) }));
}
```

(Existing callers — the tray path via `checkForUpdateFromTray` and the
`UPDATE_CHECK` IPC handler — call `checkForUpdate()` with no args, so
`lastCheckBackground` becomes `false` for them, which is correct.)

- [ ] **Step 4: Add the `maybeNotifyUpdate` helper**

Add this function directly below `checkForUpdate` (before `downloadUpdate`):

```ts
// Show a clickable OS notification for a background-discovered new version, at
// most once per version per session. Clicking it opens the Settings update
// section. Manual checks don't reach here as "background", so they stay quiet.
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

- [ ] **Step 5: Call it from the `update-available` handler**

In `setupUpdater` (~line 822), change:

```ts
  autoUpdater.on('update-available', (info) => sendUpdate({ state: 'available', version: info.version }));
```

to:

```ts
  autoUpdater.on('update-available', (info) => {
    sendUpdate({ state: 'available', version: info.version });
    maybeNotifyUpdate(info.version);
  });
```

- [ ] **Step 6: Replace the startup check with a background-tagged check + 30-min timer**

In the `app.whenReady` block (~line 982), change:

```ts
  if (app.isPackaged) {
    autoUpdater
      .checkForUpdates()
      .catch((err) => sendUpdate({ state: 'error', message: String(err?.message || err) }));
  }
```

to:

```ts
  if (app.isPackaged) {
    checkForUpdate({ background: true });
    setInterval(() => checkForUpdate({ background: true }), 30 * 60_000);
  }
```

- [ ] **Step 7: Typecheck and bundle**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0, no errors.

Run: `npm run build:main`
Expected: esbuild reports `dist-electron/main.js` written, no errors.

- [ ] **Step 8: Run the full test suite**

Run: `npx vitest run`
Expected: all suites pass (existing 205 + the 6 new = 211).

- [ ] **Step 9: Launch smoke (no crash from new wiring)**

Run: `DISPLAY=:0 timeout 12 npx electron . > /tmp/update-notif-smoke.log 2>&1; echo exit=$?`
Expected: exit=124 (timeout kills the still-running GUI). Then check the log has no JS errors:
Run: `grep -iE "TypeError|is not a function|uncaught|cannot find module" /tmp/update-notif-smoke.log || echo "no JS errors"`
Expected: `no JS errors` (ALSA/GPU/zygote warnings are benign in WSL).

- [ ] **Step 10: Commit**

```bash
git add electron/main.ts
git commit -m "feat: notify on background-discovered updates, poll every 30m"
```

---

## Self-Review

**1. Spec coverage:**
- Periodic 30-min background checks + launch check → Task 2 Step 6. ✓
- Background-tagged vs manual checks → Task 2 Steps 3, 6 (existing manual callers untouched). ✓
- Notification on background `update-available` → Task 2 Steps 4–5. ✓
- Click → `openSettingsPanel()` → Task 2 Step 4. ✓
- Once-per-version-per-session (`notifiedUpdateVersion`, in-memory) → Task 1 logic + Task 2 Steps 2, 4. ✓
- `Notification.isSupported()` gate → Task 2 Step 4. ✓
- No auto-download (autoDownload untouched) → nothing in plan changes it. ✓
- English copy, main-process notification → Task 2 Step 4, Global Constraints. ✓
- Packaged-only timer → Task 2 Step 6 (inside `if (app.isPackaged)`). ✓
- Pure decision function unit-tested → Task 1. ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows full code. `<version>` in copy is a runtime template literal, not a placeholder. ✓

**3. Type consistency:** `shouldNotifyUpdate` / `NotifyDecisionInput` names and field types (`state`, `version`, `background`, `notifiedVersion`) match between Task 1 (definition), the Task 1 tests, and the Task 2 call site. `checkForUpdate({ background?: boolean })` matches its background-tagged call sites. `notifiedUpdateVersion: string | null` matches the `notifiedVersion: string | null` param. ✓
