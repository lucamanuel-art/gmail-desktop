# Per-account Notification Sound Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-account toggle that keeps mail notifications visible but silences their sound, by constructing the web `Notification` with `options.silent = true` when the toggle is off.

**Architecture:** A new opt-out pref field `AccountPref.notifySound` drives a pure policy helper `notificationSilent()`. The main process pushes `{ show, silent }` to each mail view over the existing `IPC.NOTIFY_ALLOWED` channel; the preload uses `silent` to set `options.silent` when wrapping `window.Notification`. A Settings checkbox and i18n strings expose the toggle. Delegated mailboxes need no special-casing — they run the same preload/policy keyed by their own email.

**Tech Stack:** TypeScript, Electron 31, React (renderer), Vitest, esbuild.

## Global Constraints

- README files in English (global preference); code comments follow existing file's language (English here).
- `notifySound` is opt-out: absent/`true` = sound on (preserves current behaviour), `false` = silent. No prefs migration — `PrefsStore.getAll()` passes `accounts` through unchanged.
- Sound toggle applies to the `mail` surface only in v1. DnD/quiet hours still suppress the whole notification (independent of this toggle).
- Renderer is typechecked via `npm run build:renderer`; electron/tests via `npx tsc --noEmit` (tsconfig excludes `renderer`).
- Commit style: type-only Conventional Commits, no scope, imperative, no `Co-authored-by` trailer.

---

## File Structure

- `electron/prefs-store.ts` — add `notifySound?: boolean` to `AccountPref` (modify).
- `electron/notification-policy.ts` — add pure `notificationSilent()` (modify).
- `tests/notification-policy.test.ts` — unit tests for `notificationSilent` (modify).
- `electron/ipc.ts` — update `NOTIFY_ALLOWED` payload comment (modify).
- `electron/profile-view-manager.ts` — `pushNotifyAllowed` takes `{ show, silent }` (modify).
- `electron/main.ts` — `refreshNotifyAllowed` computes and pushes `{ show, silent }` (modify).
- `electron/preload.ts` — `notifyState` object + set `options.silent` (modify).
- `renderer/app/strings.ts` — add `soundToggle`/`soundToggleTitle` to interface + both string sets (modify).
- `renderer/app/SettingsPanel.tsx` — add the checkbox (modify).

---

### Task 1: Pref field + `notificationSilent` policy

**Files:**
- Modify: `electron/prefs-store.ts:4-11` (add field to `AccountPref`)
- Modify: `electron/notification-policy.ts` (add function)
- Test: `tests/notification-policy.test.ts`

**Interfaces:**
- Consumes: `Prefs`, `AccountPref` from `electron/prefs-store`; `Surface` from `renderer/lib/surfaces`.
- Produces: `notificationSilent(prefs: Prefs, email: string, surface?: Surface): boolean` — returns `true` only for `surface === 'mail'` when `prefs.accounts[email]?.notifySound === false`; `false` otherwise. Independent of DnD/quiet hours.

- [ ] **Step 1: Write the failing tests**

Add to `tests/notification-policy.test.ts` (import `notificationSilent` on line 2 alongside the existing imports: `import { notificationsAllowed, notificationSilent, inQuietHours } from '../electron/notification-policy';`):

```ts
describe('notificationSilent', () => {
  it('is not silent by default (field absent)', () => {
    expect(notificationSilent(prefs({}), 'a@x.com')).toBe(false);
  });
  it('is silent when notifySound is false', () => {
    const p = prefs({ accounts: { 'a@x.com': { notifySound: false } } });
    expect(notificationSilent(p, 'a@x.com')).toBe(true);
  });
  it('is not silent when notifySound is true', () => {
    const p = prefs({ accounts: { 'a@x.com': { notifySound: true } } });
    expect(notificationSilent(p, 'a@x.com')).toBe(false);
  });
  it('is never silent for non-mail surfaces', () => {
    const p = prefs({ accounts: { 'a@x.com': { notifySound: false } } });
    expect(notificationSilent(p, 'a@x.com', 'calendar')).toBe(false);
  });
  it('is independent of DND (silent stays as configured)', () => {
    const p = prefs({
      notifications: { dnd: true, quietHours: { enabled: false, start: '18:00', end: '08:00' } },
      accounts: { 'a@x.com': { notifySound: false } },
    });
    expect(notificationSilent(p, 'a@x.com')).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- notification-policy`
Expected: FAIL — `notificationSilent is not a function` / not exported.

- [ ] **Step 3: Add the pref field**

In `electron/prefs-store.ts`, add to the `AccountPref` interface (after `badgeCount?: boolean;` on line 10):

```ts
  notifySound?: boolean;
```

- [ ] **Step 4: Implement `notificationSilent`**

Append to `electron/notification-policy.ts`:

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

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- notification-policy`
Expected: PASS (all `notificationSilent` cases + existing cases).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add electron/prefs-store.ts electron/notification-policy.ts tests/notification-policy.test.ts
git commit -m "feat: add notifySound pref and notificationSilent policy"
```

---

### Task 2: Push `{ show, silent }` over IPC from main

**Files:**
- Modify: `electron/ipc.ts:39` (payload comment)
- Modify: `electron/profile-view-manager.ts:250-254` (`pushNotifyAllowed`)
- Modify: `electron/main.ts:31` (import) and `electron/main.ts:548-552` (`refreshNotifyAllowed` loop)

**Interfaces:**
- Consumes: `notificationsAllowed`, `notificationSilent` from `electron/notification-policy` (Task 1).
- Produces: `pushNotifyAllowed(accountKey: string, surface: Surface, state: { show: boolean; silent: boolean }): void` — sends the object on `IPC.NOTIFY_ALLOWED`. This object shape `{ show: boolean; silent: boolean }` is what the preload (Task 3) consumes.

- [ ] **Step 1: Update the IPC payload comment**

In `electron/ipc.ts`, change line 39 to:

```ts
  NOTIFY_ALLOWED: 'notify:allowed', // main -> mail view: send({ show: boolean; silent: boolean })
```

- [ ] **Step 2: Change `pushNotifyAllowed` to take the state object**

In `electron/profile-view-manager.ts`, replace the method at lines 250-254:

```ts
  pushNotifyAllowed(
    accountKey: string,
    surface: Surface,
    state: { show: boolean; silent: boolean },
  ): void {
    const wc = this.views.get(viewKey(accountKey, surface))?.webContents;
    if (!wc || wc.isDestroyed()) return;
    wc.send(IPC.NOTIFY_ALLOWED, state);
  }
```

- [ ] **Step 3: Import `notificationSilent` in main**

In `electron/main.ts`, change the import on line 31:

```ts
import { notificationsAllowed, notificationSilent } from './notification-policy';
```

- [ ] **Step 4: Push both fields from `refreshNotifyAllowed`**

In `electron/main.ts`, replace the push line inside the loop (line 550):

```ts
      manager?.pushNotifyAllowed(keyOf(profile), surface, {
        show: notificationsAllowed(p, profile.email, now, surface),
        silent: notificationSilent(p, profile.email, surface),
      });
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (preload still reads the old boolean until Task 3 — but preload is not part of the electron tsconfig type graph in a way that breaks here; if tsc flags the preload handler's `allowed: boolean` type, that is fixed in Task 3. If it errors now, proceed to Task 3 and re-run there.)

- [ ] **Step 6: Commit**

```bash
git add electron/ipc.ts electron/profile-view-manager.ts electron/main.ts
git commit -m "feat: push notification silent state to mail views"
```

---

### Task 3: Preload honours the silent flag

**Files:**
- Modify: `electron/preload.ts:117-120` (state var + IPC handler) and `electron/preload.ts:137-151` (Wrapped constructor)

**Interfaces:**
- Consumes: `{ show: boolean; silent: boolean }` on `IPC.NOTIFY_ALLOWED` (Task 2).
- Produces: wrapped `window.Notification` that returns a stub when `!show`, else constructs the real notification with `options.silent = true` when `silent`.

- [ ] **Step 1: Replace the boolean state with the state object**

In `electron/preload.ts`, replace lines 117-120:

```ts
  let notifyState: { show: boolean; silent: boolean } = { show: true, silent: false };
  ipcRenderer.on(
    IPC.NOTIFY_ALLOWED,
    (_e: unknown, state: { show: boolean; silent: boolean }) => {
      notifyState = state;
    },
  );
```

- [ ] **Step 2: Use the state in the Wrapped constructor**

In `electron/preload.ts`, replace the body of `Wrapped` (lines 140-150) so the gate reads `notifyState.show` and the real notification is built silent when requested:

```ts
        if (!notifyState.show) {
          // Return a harmless stub so Gmail's code doesn't throw; nothing is shown.
          return { onclick: null, close() {}, addEventListener() {} } as unknown as Notification;
        }
        const n = new Original(
          title,
          notifyState.silent ? { ...options, silent: true } : options,
        );
        n.addEventListener('click', () => {
          // Resolve the clicked thread at click time (the row exists by then).
          const threadId = findThreadIdBySubject(document, options?.body ?? '');
          ipcRenderer.send(IPC.NOTIFICATION_ACTIVATE, threadId ?? undefined);
        });
        return n;
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Build the main bundle (esbuild) to confirm preload compiles**

Run: `npm run build:main`
Expected: build succeeds, `dist-electron/preload.js` emitted, no errors.

- [ ] **Step 5: Commit**

```bash
git add electron/preload.ts
git commit -m "feat: silence mail notifications when sound toggle is off"
```

---

### Task 4: Settings checkbox + i18n strings

**Files:**
- Modify: `renderer/app/strings.ts:58-59` (interface), `:179-180` (English), `:262-263` (Dutch/René)
- Modify: `renderer/app/SettingsPanel.tsx:545-553` (add checkbox after the badge one)

**Interfaces:**
- Consumes: `notifySound` pref (Task 1) via `prefs.accounts[email]`; `window.desktop?.setAccountPref` (already accepts `Partial<AccountPref>`, so `notifySound` is accepted with no bridge change).
- Produces: a per-account "sound" checkbox, disabled when `notify === false`.

- [ ] **Step 1: Add the strings to the interface**

In `renderer/app/strings.ts`, after `badgeToggleTitle: string;` (line 59), add:

```ts
  soundToggle: string;
  soundToggleTitle: string;
```

- [ ] **Step 2: Add the English strings**

In `renderer/app/strings.ts`, after `badgeToggleTitle: 'Count this mailbox in the taskbar unread badge',` (line 180), add:

```ts
  soundToggle: 'Sound',
  soundToggleTitle: 'Play a sound with notifications for this account',
```

- [ ] **Step 3: Add the Dutch (René-mode) strings**

In `renderer/app/strings.ts`, after `badgeToggleTitle: 'Tel de post van deze meneer of mevrouw mee in het getal op de knop',` (line 263), add:

```ts
  soundToggle: 'Geluid',
  soundToggleTitle: 'Speel een geluidje bij meldingen voor deze meneer of mevrouw',
```

- [ ] **Step 4: Add the checkbox in SettingsPanel**

In `renderer/app/SettingsPanel.tsx`, insert after the badge `</label>` (line 553, before the closing `</div>` on line 554):

```tsx
                      <label className="flex items-center gap-1 text-xs text-neutral-500 dark:text-neutral-400" title={S.soundToggleTitle}>
                        <input
                          type="checkbox"
                          checked={prefs?.accounts?.[p.email]?.notifySound !== false}
                          disabled={prefs?.accounts?.[p.email]?.notify === false}
                          onChange={(e) => window.desktop?.setAccountPref({ email: p.email, notifySound: e.target.checked })}
                          className="h-3.5 w-3.5 accent-blue-600 disabled:opacity-40"
                        />
                        {S.soundToggle}
                      </label>
```

- [ ] **Step 5: Typecheck / build the renderer**

Run: `npm run build:renderer`
Expected: build succeeds, no TypeScript errors (all three string sets satisfy the `Strings` interface; the new pref key is accepted by `setAccountPref`).

- [ ] **Step 6: Commit**

```bash
git add renderer/app/strings.ts renderer/app/SettingsPanel.tsx
git commit -m "feat: add per-account notification sound toggle to settings"
```

---

### Task 5: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 2: Typecheck electron + build both bundles**

Run: `npx tsc --noEmit && npm run build`
Expected: no type errors; renderer and main both build.

- [ ] **Step 3: Logic verification on this box (WSL2, via verify skill / CDP)**

Confirm at runtime that toggling the account's sound checkbox off pushes
`{ show: true, silent: true }` and that the preload constructs the notification
options with `silent: true` (inspect via the CDP harness — hook `window.Notification`
to record the options it receives). Confirm `show` still flips to `false` under DnD.
Note: actual audible sound cannot be tested here — WSL2 has no notification daemon.

- [ ] **Step 4: Manual verification on Windows (required, per spec risk)**

On the real Windows build: with an owned account and a delegated mailbox, enable
notifications and turn the sound toggle OFF. Trigger a new mail. Confirm the banner
still appears but plays no sound. Turn it back ON and confirm the sound returns.
This confirms Chromium honours `options.silent` on the Windows target (the spec's
key risk).

- [ ] **Step 5: No commit** (verification only; report results).

---

## Self-Review

**Spec coverage:**
- `notifySound` pref field → Task 1 ✓
- `notificationSilent` policy, mail-only, DnD-independent → Task 1 ✓
- IPC payload `{ show, silent }` → Task 2 ✓
- main push of both fields → Task 2 ✓
- preload sets `options.silent` / preserves Gmail's own silent → Task 3 ✓
- Settings checkbox, disabled when notify off → Task 4 ✓
- i18n strings (interface + English + Dutch) → Task 4 ✓
- Delegated works automatically (same preload/policy) → no code, covered by Task 5 Step 4 ✓
- Unit tests for notificationSilent → Task 1 ✓
- Windows sound-suppression verification (spec risk) → Task 5 ✓

**Placeholder scan:** none — every code step shows the exact code.

**Type consistency:** `{ show: boolean; silent: boolean }` used identically in Tasks 2 and 3; `notificationSilent(prefs, email, surface?)` signature matches between Task 1 (definition) and Task 2 (call); `notifySound?: boolean` field name consistent across Tasks 1, 2 (via policy), and 4.
