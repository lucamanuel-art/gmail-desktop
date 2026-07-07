# Calendar Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Google Calendar's own event reminders fire as desktop notifications from the app, per account (opt-in), gated by the existing DND/quiet-hours policy and routed to the right account's calendar on click — without reading calendar data.

**Architecture:** Keep a hidden Calendar `WebContentsView` alive per opted-in account so Google Calendar fires its native reminders; the existing preload `Notification` interception catches them; a per-surface allowed-flag (`calendarNotify` for calendar, `notify` for mail, both under global DND/quiet-hours) decides whether each fires; clicking a reminder switches to that account's calendar surface.

**Tech Stack:** Electron (main + `WebContentsView` + preloads, TypeScript), Next.js static-export renderer (React + Tailwind), vitest for unit tests.

## Global Constraints

- **Do not read calendar events / no OAuth / no DOM scraping / no dependency on Google's generated CSS classes.** Reminders come from Google Calendar web itself.
- **Calendar reminders are opt-in per account** (`calendarNotify` default off/undefined). Mail `notify` keeps default-on (undefined = enabled).
- **Global DND and quiet hours apply to BOTH mail and calendar.**
- **Unit tests only cover pure modules** (Node-safe, no `electron` import at module top level). Electron-integration behaviour is verified by build/typecheck here; real reminder firing is verified manually on **Windows** (WSLg has no notification daemon).
- **Session partition is `persist:google`** — reuse it for calendar views (they already do).
- Commit house style: type-only Conventional Commits, no scope, imperative, ≤72 chars. Types: `feat`, `fix`, `refactor`, `docs`, `style`, `test`, `chore`, `perf`. No `Co-authored-by` trailer.
- Stage by explicit path in every commit (never `git add -A`/`.`).

---

## File Structure

- `electron/prefs-store.ts` — add `calendarNotify?: boolean` to `AccountPref`.
- `electron/notification-policy.ts` — `notificationsAllowed` gains a `surface` param; +tests.
- `electron/ipc.ts` / `electron/sidebar-preload.ts` / `renderer/app/page.tsx` — extend the `SET_ACCOUNT_PREF` payload type with `calendarNotify`.
- `electron/main.ts` — `SET_ACCOUNT_PREF` persists `calendarNotify`; per-surface `refreshNotifyAllowed`; surface-aware `onActivate` routing; background calendar-view lifecycle.
- `electron/profile-view-manager.ts` — `pushNotifyAllowed(index, surface, allowed)`, calendar `ipc-message` wiring, `onActivate(index, surface)`, `backgroundThrottling:false` on calendar views, `isShowing(index, surface)`.
- `renderer/app/SettingsPanel.tsx` — Mail/Calendar per-account toggles.

---

### Task 1: `calendarNotify` pref + surface-aware notification policy

**Files:**
- Modify: `electron/prefs-store.ts` (the `AccountPref` interface)
- Modify: `electron/notification-policy.ts`
- Test: `tests/notification-policy.test.ts` (append cases)

**Interfaces:**
- Consumes: existing `Prefs`, `AccountPref`, `inQuietHours`.
- Produces:
  - `AccountPref` gains `calendarNotify?: boolean`.
  - `notificationsAllowed(prefs: Prefs, email: string, now: Date, surface?: 'mail' | 'calendar'): boolean` — `surface` defaults to `'mail'`. Mail: allowed unless `notify === false`. Calendar: allowed only if `calendarNotify === true`. DND and quiet hours gate both.

- [ ] **Step 1: Add the pref field**

In `electron/prefs-store.ts`, extend `AccountPref`:

```ts
export interface AccountPref {
  order?: number;
  label?: string;
  zoom?: number;
  notify?: boolean;
  calendarNotify?: boolean;
}
```

(No other store change: `setAccount` already merges an arbitrary partial and `getAll` preserves the raw `accounts` object.)

- [ ] **Step 2: Write the failing test**

Append to `tests/notification-policy.test.ts` (inside the existing `describe('notificationsAllowed', ...)` block, or a new `describe`):

```ts
describe('notificationsAllowed — surface', () => {
  const at = (h: number, m = 0) => new Date(2026, 0, 1, h, m);
  const base = () => structuredClone(DEFAULT_PREFS);

  it("defaults to the mail surface", () => {
    const p = base();
    expect(notificationsAllowed(p, 'a@x.com', at(12))).toBe(true); // no 4th arg → mail
  });

  it('mail: allowed unless notify===false', () => {
    const p = base();
    expect(notificationsAllowed(p, 'a@x.com', at(12), 'mail')).toBe(true);
    p.accounts['a@x.com'] = { notify: false };
    expect(notificationsAllowed(p, 'a@x.com', at(12), 'mail')).toBe(false);
  });

  it('calendar: off by default, on only when calendarNotify===true', () => {
    const p = base();
    expect(notificationsAllowed(p, 'a@x.com', at(12), 'calendar')).toBe(false); // opt-in
    p.accounts['a@x.com'] = { calendarNotify: true };
    expect(notificationsAllowed(p, 'a@x.com', at(12), 'calendar')).toBe(true);
  });

  it('calendar toggle is independent of mail toggle', () => {
    const p = base();
    p.accounts['a@x.com'] = { notify: false, calendarNotify: true };
    expect(notificationsAllowed(p, 'a@x.com', at(12), 'mail')).toBe(false);
    expect(notificationsAllowed(p, 'a@x.com', at(12), 'calendar')).toBe(true);
  });

  it('DND and quiet hours gate calendar too', () => {
    const dnd = base();
    dnd.notifications.dnd = true;
    dnd.accounts['a@x.com'] = { calendarNotify: true };
    expect(notificationsAllowed(dnd, 'a@x.com', at(12), 'calendar')).toBe(false);

    const qh = base();
    qh.notifications.quietHours = { enabled: true, start: '18:00', end: '08:00' };
    qh.accounts['a@x.com'] = { calendarNotify: true };
    expect(notificationsAllowed(qh, 'a@x.com', at(23), 'calendar')).toBe(false);
  });
});
```

Ensure the file imports `DEFAULT_PREFS` and `notificationsAllowed` (the existing test already imports from `../electron/notification-policy` and `../electron/prefs-store`; add `DEFAULT_PREFS` to the prefs-store import if not already present).

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/notification-policy.test.ts`
Expected: FAIL — the new calendar cases fail (surface param not honoured / `calendarNotify` ignored).

- [ ] **Step 4: Implement**

Replace the body of `notificationsAllowed` in `electron/notification-policy.ts`:

```ts
export function notificationsAllowed(
  prefs: Prefs,
  email: string,
  now: Date,
  surface: 'mail' | 'calendar' = 'mail',
): boolean {
  const { dnd, quietHours } = prefs.notifications;
  if (dnd) return false;
  if (
    quietHours.enabled &&
    inQuietHours(quietHours.start, quietHours.end, now.getHours() * 60 + now.getMinutes())
  ) {
    return false;
  }
  const account = prefs.accounts[email];
  if (surface === 'calendar') return account?.calendarNotify === true;
  return account?.notify !== false;
}
```

(`inQuietHours` is unchanged. The default `surface = 'mail'` keeps the existing 3-arg caller in `main.ts` compiling and behaving identically.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/notification-policy.test.ts`
Expected: PASS (all existing + new cases).

- [ ] **Step 6: Full suite + commit**

Run: `npx vitest run` — expect all green.

```bash
git add electron/prefs-store.ts electron/notification-policy.ts tests/notification-policy.test.ts
git commit -m "feat: add per-surface notification policy and calendar pref"
```

---

### Task 2: Plumb `calendarNotify` through SET_ACCOUNT_PREF

**Files:**
- Modify: `electron/main.ts` (the `SET_ACCOUNT_PREF` handler)
- Modify: `electron/sidebar-preload.ts` (`setAccountPref`)
- Modify: `renderer/app/page.tsx` (`DesktopBridge.setAccountPref`)

**Interfaces:**
- Consumes: `PrefsStore.setAccount` (merges partial), existing `SET_ACCOUNT_PREF` channel.
- Produces: `setAccountPref` accepts `{ email; label?; notify?; calendarNotify? }` end-to-end; the handler persists `calendarNotify` when present.

- [ ] **Step 1: Extend the main handler**

In `electron/main.ts`, the existing `SET_ACCOUNT_PREF` handler looks like:

```ts
  ipcMain.on(IPC.SET_ACCOUNT_PREF, (_e, arg: { email: string; label?: string; notify?: boolean }) => {
    const patch: Record<string, unknown> = {};
    if ('label' in arg) patch.label = arg.label;
    if ('notify' in arg) patch.notify = arg.notify;
    prefs!.setAccount(arg.email, patch);
    pushProfiles();
    refreshNotifyAllowed();
  });
```

Change the `arg` type and add the `calendarNotify` branch:

```ts
  ipcMain.on(IPC.SET_ACCOUNT_PREF, (_e, arg: { email: string; label?: string; notify?: boolean; calendarNotify?: boolean }) => {
    const patch: Record<string, unknown> = {};
    if ('label' in arg) patch.label = arg.label;
    if ('notify' in arg) patch.notify = arg.notify;
    if ('calendarNotify' in arg) patch.calendarNotify = arg.calendarNotify;
    prefs!.setAccount(arg.email, patch);
    pushProfiles();
    refreshNotifyAllowed();
  });
```

(The background-view reaction to the toggle is added in Task 4; here it only persists + refreshes flags.)

- [ ] **Step 2: Extend the preload bridge type**

In `electron/sidebar-preload.ts`, update `setAccountPref`:

```ts
  setAccountPref: (arg: { email: string; label?: string; notify?: boolean; calendarNotify?: boolean }): void =>
    ipcRenderer.send(IPC.SET_ACCOUNT_PREF, arg),
```

- [ ] **Step 3: Extend the renderer bridge type**

In `renderer/app/page.tsx`, update the `DesktopBridge` member:

```ts
  setAccountPref(arg: { email: string; label?: string; notify?: boolean; calendarNotify?: boolean }): void;
```

- [ ] **Step 4: Verify build/typecheck/tests**

Run, capturing output:
- `npm run build` — renderer + main succeed.
- `npx tsc --noEmit` and `npx tsc --noEmit -p renderer/tsconfig.json` — both clean.
- `npx vitest run` — full suite green.

- [ ] **Step 5: Commit**

```bash
git add electron/main.ts electron/sidebar-preload.ts renderer/app/page.tsx
git commit -m "feat: plumb calendarNotify through account pref ipc"
```

---

### Task 3: Per-surface notify push + calendar activation + background throttling

**Files:**
- Modify: `electron/profile-view-manager.ts`
- Modify: `electron/main.ts`

**Interfaces:**
- Consumes: `notificationsAllowed(prefs, email, now, surface)` (Task 1), existing `Surface = 'mail' | 'calendar'`, `IPC.NOTIFY_ALLOWED`, `IPC.NOTIFICATION_ACTIVATE`, `IPC.UNREAD_UPDATE`, `IPC.ACCOUNT_IDENTITY`.
- Produces:
  - `ProfileViewManager.pushNotifyAllowed(index: number, surface: Surface, allowed: boolean): void`
  - Constructor `onActivate` param becomes `(index: number, surface: Surface) => void`.
  - Calendar views created with `backgroundThrottling: false`.
  - `refreshNotifyAllowed()` in main pushes for both surfaces of every profile.

> Note: `pushNotifyAllowed` arity and `onActivate` arity both change here; the matching call sites in `main.ts` change in the same task so the build stays green.

- [ ] **Step 1: Change `pushNotifyAllowed` to take a surface**

In `electron/profile-view-manager.ts`, the current method is:

```ts
  pushNotifyAllowed(index: number, allowed: boolean): void {
    const v = this.views.get(key(index, 'mail'));
    v?.webContents.send(IPC.NOTIFY_ALLOWED, allowed);
  }
```

Replace with:

```ts
  pushNotifyAllowed(index: number, surface: Surface, allowed: boolean): void {
    const v = this.views.get(key(index, surface));
    v?.webContents.send(IPC.NOTIFY_ALLOWED, allowed);
  }
```

- [ ] **Step 2: Wire calendar ipc-message + surface-aware activation**

In `ensureView`, the current mail-only wiring is:

```ts
    if (surface === 'mail') {
      view.webContents.on('ipc-message', (_e, channel, ...args) => {
        if (channel === IPC.UNREAD_UPDATE) this.onUnread(index, Number(args[0]) || 0);
        else if (channel === IPC.NOTIFICATION_ACTIVATE) this.onActivate(index);
        else if (channel === IPC.ACCOUNT_IDENTITY) this.onIdentity(index, args[0]);
      });
    }
```

Replace with wiring that runs for BOTH surfaces (unread/identity stay mail-only; activation is per-surface):

```ts
    view.webContents.on('ipc-message', (_e, channel, ...args) => {
      if (surface === 'mail') {
        if (channel === IPC.UNREAD_UPDATE) this.onUnread(index, Number(args[0]) || 0);
        else if (channel === IPC.ACCOUNT_IDENTITY) this.onIdentity(index, args[0]);
      }
      if (channel === IPC.NOTIFICATION_ACTIVATE) this.onActivate(index, surface);
    });
```

- [ ] **Step 3: Update the `onActivate` constructor param type + set backgroundThrottling**

In the `ProfileViewManager` constructor signature, change the `onActivate` parameter type from `(index: number) => void` to:

```ts
    private readonly onActivate: (index: number, surface: Surface) => void,
```

In `ensureView`, the `WebContentsView` is created with `webPreferences`. Add `backgroundThrottling` so hidden calendar reminder timers fire on time:

```ts
    const view = new WebContentsView({
      webPreferences: {
        preload: this.preloadPath,
        partition: SESSION_PARTITION,
        contextIsolation: false,
        backgroundThrottling: surface === 'calendar' ? false : true,
      },
    });
```

- [ ] **Step 4: Update main — activation routing + per-surface push**

In `electron/main.ts`, the `onActivate` arrow passed to `new ProfileViewManager(...)` currently switches to mail:

```ts
    (index) => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
      if (settingsPanelOpen) {
        settingsPanelOpen = false;
        mainWindow?.webContents.send(IPC.SETTINGS_FORCE_CLOSE);
      }
      switchSurface(index, 'mail');
    },
```

Change it to accept and route by surface:

```ts
    (index, surface) => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
      if (settingsPanelOpen) {
        settingsPanelOpen = false;
        mainWindow?.webContents.send(IPC.SETTINGS_FORCE_CLOSE);
      }
      switchSurface(index, surface);
    },
```

And update `refreshNotifyAllowed()` to push both surfaces. Current:

```ts
function refreshNotifyAllowed(): void {
  if (!prefs) return;
  const p = prefs.getAll();
  for (const profile of profiles) {
    manager?.pushNotifyAllowed(profile.index, notificationsAllowed(p, profile.email, new Date()));
  }
}
```

Replace with:

```ts
function refreshNotifyAllowed(): void {
  if (!prefs) return;
  const p = prefs.getAll();
  const now = new Date();
  for (const profile of profiles) {
    manager?.pushNotifyAllowed(profile.index, 'mail', notificationsAllowed(p, profile.email, now, 'mail'));
    manager?.pushNotifyAllowed(profile.index, 'calendar', notificationsAllowed(p, profile.email, now, 'calendar'));
  }
}
```

- [ ] **Step 5: Verify build/typecheck/tests**

Run, capturing output:
- `npm run build:main` — esbuild bundle succeeds.
- `npx tsc --noEmit` — clean (this catches any arity mismatch between the manager and its call sites).
- `npx vitest run` — full suite green.

- [ ] **Step 6: Commit**

```bash
git add electron/profile-view-manager.ts electron/main.ts
git commit -m "feat: push per-surface notify flags and route calendar clicks"
```

---

### Task 4: Background calendar-view lifecycle for opted-in accounts

**Files:**
- Modify: `electron/profile-view-manager.ts` (add `isShowing`)
- Modify: `electron/main.ts` (add `syncCalendarViews`, call it in the right places)

**Interfaces:**
- Consumes: `manager.ensureView(index, 'calendar', false)`, `manager.discardView(index, 'calendar')`, `prefs.getAccount(email).calendarNotify`, `refreshNotifyAllowed()` (Task 3).
- Produces:
  - `ProfileViewManager.isShowing(index: number, surface: Surface): boolean`
  - `main.syncCalendarViews()` — for each profile, ensures a hidden calendar view exists iff `calendarNotify === true`, discards it otherwise (unless currently shown), then refreshes flags.

- [ ] **Step 1: Add `isShowing` to the manager**

In `electron/profile-view-manager.ts`, add:

```ts
  isShowing(index: number, surface: Surface): boolean {
    return this.activeKey === key(index, surface);
  }
```

- [ ] **Step 2: Add `syncCalendarViews` in main**

In `electron/main.ts`, add above `createWindow` (near `refreshNotifyAllowed`):

```ts
// Keep a hidden calendar view alive for each account with calendar reminders
// enabled, so Google Calendar fires its native reminders in the background.
// Views for disabled accounts are torn down (unless currently shown) to free memory.
function syncCalendarViews(): void {
  if (!prefs || !manager) return;
  for (const profile of profiles) {
    const enabled = prefs.getAccount(profile.email).calendarNotify === true;
    if (enabled) {
      manager.ensureView(profile.index, 'calendar', false);
    } else if (!manager.isShowing(profile.index, 'calendar')) {
      manager.discardView(profile.index, 'calendar');
    }
  }
  refreshNotifyAllowed(); // push flags to any newly created calendar views
}
```

- [ ] **Step 3: Call it at detection, on toggle change, and on redetect**

In `main.ts`:

1. At the end of `onIdentity`, right after the successful-registration `pushProfiles()` and the existing `refreshNotifyAllowed()` call, add `syncCalendarViews();`.
2. In the `SET_ACCOUNT_PREF` handler (Task 2), add `syncCalendarViews();` after `refreshNotifyAllowed();` so flipping the Calendar toggle creates/tears down the background view immediately.
3. In `redetect()`, after the existing detection kickoff, the identity path (1) already re-runs per account — no extra call needed. (If `redetect` tears down views without going through `onIdentity` for already-known accounts, also call `syncCalendarViews();` at the end of `redetect()`.)

Concretely for (1), the success branch of `onIdentity` currently ends with something like `pushProfiles(); ... refreshNotifyAllowed();` — add:

```ts
      syncCalendarViews();
```

For (2), the handler becomes:

```ts
    prefs!.setAccount(arg.email, patch);
    pushProfiles();
    refreshNotifyAllowed();
    syncCalendarViews();
```

- [ ] **Step 4: Verify build/typecheck/tests**

Run, capturing output:
- `npm run build:main` — esbuild bundle succeeds.
- `npx tsc --noEmit` — clean.
- `npx vitest run` — full suite green.

- [ ] **Step 5: Commit**

```bash
git add electron/profile-view-manager.ts electron/main.ts
git commit -m "feat: keep background calendar views for reminder accounts"
```

---

### Task 5: Mail / Calendar per-account toggles in settings

**Files:**
- Modify: `renderer/app/SettingsPanel.tsx`

**Interfaces:**
- Consumes: `window.desktop.setAccountPref({ email, notify | calendarNotify })` (Task 2), `prefs.accounts[email].notify`/`calendarNotify`.
- Produces: two labelled per-account checkboxes (Mail, Calendar).

- [ ] **Step 1: Replace the single notify checkbox with Mail + Calendar toggles**

In `renderer/app/SettingsPanel.tsx`, the account row currently has one notification checkbox (from the notifications task), roughly:

```tsx
                    <label className="flex items-center gap-1 text-xs text-neutral-500 dark:text-neutral-400" title="Notifications for this account">
                      <input
                        type="checkbox"
                        checked={prefs?.accounts?.[p.email]?.notify !== false}
                        onChange={(e) => window.desktop?.setAccountPref({ email: p.email, notify: e.target.checked })}
                        className="h-3.5 w-3.5 accent-blue-600"
                      />
                    </label>
```

Replace that single `<label>` with two labelled toggles:

```tsx
                    <label className="flex items-center gap-1 text-xs text-neutral-500 dark:text-neutral-400" title="Mail notifications for this account">
                      <input
                        type="checkbox"
                        checked={prefs?.accounts?.[p.email]?.notify !== false}
                        onChange={(e) => window.desktop?.setAccountPref({ email: p.email, notify: e.target.checked })}
                        className="h-3.5 w-3.5 accent-blue-600"
                      />
                      Mail
                    </label>
                    <label className="flex items-center gap-1 text-xs text-neutral-500 dark:text-neutral-400" title="Calendar reminders for this account">
                      <input
                        type="checkbox"
                        checked={prefs?.accounts?.[p.email]?.calendarNotify === true}
                        onChange={(e) => window.desktop?.setAccountPref({ email: p.email, calendarNotify: e.target.checked })}
                        className="h-3.5 w-3.5 accent-blue-600"
                      />
                      Calendar
                    </label>
```

(If the surrounding flex container is tight, wrap the two labels in a `<div className="flex items-center gap-2">` so they sit side by side without breaking the row layout. Keep the existing swatches/label-input/trash controls unchanged.)

- [ ] **Step 2: Verify build/typecheck/tests**

Run, capturing output:
- `npm run build` — renderer builds (Tailwind emits any new utilities).
- `npx tsc --noEmit -p renderer/tsconfig.json` — clean.
- `npx vitest run` — full suite green.

- [ ] **Step 3: Commit**

```bash
git add renderer/app/SettingsPanel.tsx
git commit -m "feat: add per-account mail and calendar notification toggles"
```

---

## Self-Review Notes

**Spec coverage:** pref `calendarNotify` → Task 1; surface-aware policy (mail uses `notify`, calendar uses `calendarNotify`, DND/quiet-hours gate both) → Task 1; background calendar view per opted-in account + `backgroundThrottling:false` → Tasks 3 (throttling) & 4 (lifecycle); per-surface allowed push → Task 3; click routing to calendar surface → Task 3; opt-in default off (mail default on) → Task 1 (policy) + Task 5 (UI `=== true` vs `!== false`); Mail/Calendar toggles → Task 5; SET_ACCOUNT_PREF plumbing → Task 2. All spec sections covered.

**Type consistency:** `notificationsAllowed(prefs, email, now, surface?)` signature used identically in Task 1 (definition) and Task 3 (main caller). `pushNotifyAllowed(index, surface, allowed)` defined in Task 3 and called only in Task 3's `refreshNotifyAllowed`. `onActivate(index, surface)` — manager param type (Task 3) matches the arrow in main (Task 3). `isShowing(index, surface)` defined Task 4, used only in Task 4. `setAccountPref({ email, label?, notify?, calendarNotify? })` identical across main handler / preload / renderer (Task 2) and used in Task 5. `Surface = 'mail' | 'calendar'` is the existing exported type.

**Build-stays-green ordering:** Task 1 keeps the 3-arg `notificationsAllowed` caller working via the `surface='mail'` default. Task 3 changes `pushNotifyAllowed`/`onActivate` arity and updates both call sites in the same commit. Task 4 only adds new code paths. Every task compiles and tests green on its own.

**Verification gap:** actual reminder firing, click routing to calendar, DND/quiet-hours suppression of calendar reminders, background-view memory, and multi-account behaviour are only verifiable on Windows (per Global Constraints); the surface-aware policy that decides all of it is unit-tested so regressions surface without a GUI.

## Rollout

After merge, ship as **0.1.6**: bump `package.json`, push a `v0.1.6` tag — the existing `.github/workflows/release.yml` builds the Windows installer and publishes the GitHub release with `latest.yml`.
