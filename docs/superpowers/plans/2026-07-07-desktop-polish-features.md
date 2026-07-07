# Desktop Polish Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add eight quality-of-life features (auto-start, window persistence, per-account notifications with DND/quiet-hours, notification-click focus, drag reorder + labels, shortcuts, per-account zoom, light/dark shell theme) to the Gmail Desktop wrapper, built on one shared preferences store.

**Architecture:** A single `PrefsStore` (JSON in `userData`, same pattern as the existing `ColorStore`/`RemovedStore`) is the persistence foundation. Pure decision logic (notification policy, shortcut mapping, bounds clamping, order sorting) lives in small unit-tested modules; the Electron main process wires them to `BrowserWindow`, `WebContentsView`, `app`, `nativeTheme`, and `before-input-event`. The React sidebar/settings render new controls and receive state over the existing IPC bridge.

**Tech Stack:** Electron (main + preloads, TypeScript), Next.js static export renderer (React + Tailwind), vitest for unit tests.

## Global Constraints

- **Unit tests only cover pure modules** (Node-safe, no Electron import at module top level). Electron-integration behaviour is verified manually on Windows. This mirrors the existing test suite.
- **Notifications only fire on Windows** — WSLg has no notification daemon (`Notification.isSupported()` is false). Verify notification features on Windows.
- **Keystroke injection into the Gmail `WebContentsView` does not work** (`sendInputEvent` is ineffective). Never simulate Gmail shortcuts; drive via URL navigation or a separate window instead.
- **DOM scraping must be locale-independent** — the user's Gmail is Dutch; never match English UI strings.
- **Commit message house style:** type-only Conventional Commits, no scope, imperative, ≤72 chars. Types: `feat`, `fix`, `refactor`, `docs`, `style`, `test`, `chore`, `perf`. No `Co-authored-by` trailer.
- **Stage by explicit path** in every commit (never `git add -A` or `.`).
- The Google session partition is `persist:google`. Reuse it for any new window.
- `CONTENT_MARGIN` is currently `0` (no frame); do not reintroduce a margin.

---

## File Structure

**New files (pure, unit-tested):**
- `electron/prefs-store.ts` — `Prefs` types, `DEFAULT_PREFS`, `PrefsStore` class.
- `electron/notification-policy.ts` — `notificationsAllowed(prefs, email, now)`.
- `electron/shortcuts.ts` — `resolveShortcut(input)`.
- `electron/window-bounds.ts` — `clampBoundsToDisplays(win, displays)`.
- `electron/account-order.ts` — `sortByOrder(items)`.
- Tests mirror each under `tests/`.

**New file (Electron-integration):**
- `electron/compose-window.ts` — `openCompose(index)` popup window.

**Modified:**
- `electron/ipc.ts` — new channel constants.
- `electron/main.ts` — wiring for every feature.
- `electron/profile-view-manager.ts` — `Profile` gains `order`/`label`; zoom apply, input events, notify-allowed push.
- `electron/preload.ts` — gate native notifications on the pushed allowed-flag.
- `electron/sidebar-preload.ts` — expose new bridge methods + theme listener.
- `renderer/app/page.tsx` — sidebar sort, drag reorder, theme classes, theme state.
- `renderer/app/SettingsPanel.tsx` — General / Notifications sections, label edit, per-account notify toggle, theme-aware colours.
- `renderer/app/layout.tsx` — apply theme class to `<html>`.
- `renderer/tailwind.config.ts` — `darkMode: 'class'`.

---

## Phase 1 — Foundation

### Task 1: PrefsStore

**Files:**
- Create: `electron/prefs-store.ts`
- Test: `tests/prefs-store.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface AccountPref { order?: number; label?: string; zoom?: number; notify?: boolean }`
  - `interface QuietHours { enabled: boolean; start: string; end: string }`
  - `interface NotificationPrefs { dnd: boolean; quietHours: QuietHours }`
  - `interface WindowPrefs { width: number; height: number; x?: number; y?: number; maximized: boolean }`
  - `type ThemeChoice = 'system' | 'light' | 'dark'`
  - `interface Prefs { window: WindowPrefs; autoStart: boolean; theme: ThemeChoice; notifications: NotificationPrefs; accounts: Record<string, AccountPref> }`
  - `const DEFAULT_PREFS: Prefs`
  - `class PrefsStore` with `getAll(): Prefs`, `setWindow(w: WindowPrefs): void`, `setAutoStart(v: boolean): void`, `setTheme(t: ThemeChoice): void`, `setNotifications(n: NotificationPrefs): void`, `getAccount(email: string): AccountPref`, `setAccount(email: string, partial: Partial<AccountPref>): void`, `setOrder(emailsInOrder: string[]): void`

- [ ] **Step 1: Write the failing test**

```ts
// tests/prefs-store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrefsStore, DEFAULT_PREFS } from '../electron/prefs-store';

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'prefs-'));
  file = join(dir, 'prefs.json');
});

describe('PrefsStore', () => {
  it('returns defaults when the file is missing', () => {
    const store = new PrefsStore(file);
    expect(store.getAll()).toEqual(DEFAULT_PREFS);
  });

  it('persists and re-reads a window patch', () => {
    const store = new PrefsStore(file);
    store.setWindow({ width: 900, height: 700, x: 10, y: 20, maximized: true });
    expect(new PrefsStore(file).getAll().window).toEqual({
      width: 900, height: 700, x: 10, y: 20, maximized: true,
    });
  });

  it('merges partial account prefs without dropping siblings', () => {
    const store = new PrefsStore(file);
    store.setAccount('a@x.com', { zoom: 1 });
    store.setAccount('a@x.com', { label: 'Work' });
    expect(store.getAccount('a@x.com')).toEqual({ zoom: 1, label: 'Work' });
  });

  it('assigns 0..n-1 order from setOrder', () => {
    const store = new PrefsStore(file);
    store.setOrder(['b@x.com', 'a@x.com']);
    expect(store.getAccount('b@x.com').order).toBe(0);
    expect(store.getAccount('a@x.com').order).toBe(1);
  });

  it('tolerates a corrupt file by returning defaults', () => {
    const store = new PrefsStore(file);
    store.setTheme('dark'); // create the file
    require('node:fs').writeFileSync(file, '{not json', 'utf8');
    expect(new PrefsStore(file).getAll()).toEqual(DEFAULT_PREFS);
  });

  it('deep-merges stored notifications over defaults', () => {
    const store = new PrefsStore(file);
    store.setNotifications({ dnd: true, quietHours: { enabled: true, start: '22:00', end: '07:00' } });
    expect(new PrefsStore(file).getAll().notifications.dnd).toBe(true);
  });
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));
```

Add the missing import: `import { describe, it, expect, beforeEach, afterEach } from 'vitest';`

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/prefs-store.test.ts`
Expected: FAIL — cannot find module `../electron/prefs-store`.

- [ ] **Step 3: Write minimal implementation**

```ts
// electron/prefs-store.ts
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface AccountPref {
  order?: number;
  label?: string;
  zoom?: number;
  notify?: boolean;
}
export interface QuietHours {
  enabled: boolean;
  start: string; // "HH:MM"
  end: string; // "HH:MM"
}
export interface NotificationPrefs {
  dnd: boolean;
  quietHours: QuietHours;
}
export interface WindowPrefs {
  width: number;
  height: number;
  x?: number;
  y?: number;
  maximized: boolean;
}
export type ThemeChoice = 'system' | 'light' | 'dark';

export interface Prefs {
  window: WindowPrefs;
  autoStart: boolean;
  theme: ThemeChoice;
  notifications: NotificationPrefs;
  accounts: Record<string, AccountPref>;
}

export const DEFAULT_PREFS: Prefs = {
  window: { width: 1200, height: 820, maximized: false },
  autoStart: false,
  theme: 'system',
  notifications: { dnd: false, quietHours: { enabled: false, start: '18:00', end: '08:00' } },
  accounts: {},
};

export class PrefsStore {
  constructor(private readonly filePath: string) {}

  getAll(): Prefs {
    if (!existsSync(this.filePath)) return structuredClone(DEFAULT_PREFS);
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8'));
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return structuredClone(DEFAULT_PREFS);
      return {
        window: { ...DEFAULT_PREFS.window, ...(raw.window ?? {}) },
        autoStart: typeof raw.autoStart === 'boolean' ? raw.autoStart : DEFAULT_PREFS.autoStart,
        theme: ['system', 'light', 'dark'].includes(raw.theme) ? raw.theme : DEFAULT_PREFS.theme,
        notifications: {
          dnd: typeof raw.notifications?.dnd === 'boolean' ? raw.notifications.dnd : false,
          quietHours: { ...DEFAULT_PREFS.notifications.quietHours, ...(raw.notifications?.quietHours ?? {}) },
        },
        accounts: raw.accounts && typeof raw.accounts === 'object' && !Array.isArray(raw.accounts)
          ? raw.accounts
          : {},
      };
    } catch {
      return structuredClone(DEFAULT_PREFS);
    }
  }

  private write(prefs: Prefs): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(prefs, null, 2), 'utf8');
  }

  setWindow(w: WindowPrefs): void {
    this.write({ ...this.getAll(), window: w });
  }
  setAutoStart(v: boolean): void {
    this.write({ ...this.getAll(), autoStart: v });
  }
  setTheme(t: ThemeChoice): void {
    this.write({ ...this.getAll(), theme: t });
  }
  setNotifications(n: NotificationPrefs): void {
    this.write({ ...this.getAll(), notifications: n });
  }
  getAccount(email: string): AccountPref {
    return this.getAll().accounts[email] ?? {};
  }
  setAccount(email: string, partial: Partial<AccountPref>): void {
    const prefs = this.getAll();
    const next = { ...(prefs.accounts[email] ?? {}), ...partial };
    // Drop keys explicitly cleared with undefined/'' so labels can be removed.
    if (partial.label === '' || partial.label === undefined && 'label' in partial) delete next.label;
    prefs.accounts = { ...prefs.accounts, [email]: next };
    this.write(prefs);
  }
  setOrder(emailsInOrder: string[]): void {
    const prefs = this.getAll();
    emailsInOrder.forEach((email, i) => {
      prefs.accounts = { ...prefs.accounts, [email]: { ...(prefs.accounts[email] ?? {}), order: i } };
    });
    this.write(prefs);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/prefs-store.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/prefs-store.ts tests/prefs-store.test.ts
git commit -m "feat: add prefs store for desktop preferences"
```

---

## Phase 2 — Window bounds + auto-start

### Task 2: Bounds clamp (pure)

**Files:**
- Create: `electron/window-bounds.ts`
- Test: `tests/window-bounds.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface Rect { x: number; y: number; width: number; height: number }`
  - `interface Display { bounds: Rect }`
  - `interface StoredBounds { width: number; height: number; x?: number; y?: number }`
  - `function clampBoundsToDisplays(win: StoredBounds, displays: Display[]): StoredBounds` — returns `win` with `x`/`y` dropped if the window would not be visibly on any display (needs ≥100px overlap on each axis); always keeps `width`/`height`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/window-bounds.test.ts
import { describe, it, expect } from 'vitest';
import { clampBoundsToDisplays } from '../electron/window-bounds';

const primary = { bounds: { x: 0, y: 0, width: 1920, height: 1080 } };

describe('clampBoundsToDisplays', () => {
  it('keeps bounds that sit on a display', () => {
    const win = { width: 1200, height: 820, x: 100, y: 100 };
    expect(clampBoundsToDisplays(win, [primary])).toEqual(win);
  });

  it('drops x/y when the window is fully off-screen', () => {
    const win = { width: 1200, height: 820, x: 5000, y: 5000 };
    expect(clampBoundsToDisplays(win, [primary])).toEqual({ width: 1200, height: 820 });
  });

  it('passes through when no x/y is stored', () => {
    const win = { width: 1200, height: 820 };
    expect(clampBoundsToDisplays(win, [primary])).toEqual(win);
  });

  it('keeps bounds visible on a secondary display', () => {
    const secondary = { bounds: { x: 1920, y: 0, width: 1920, height: 1080 } };
    const win = { width: 800, height: 600, x: 2000, y: 50 };
    expect(clampBoundsToDisplays(win, [primary, secondary])).toEqual(win);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/window-bounds.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// electron/window-bounds.ts
export interface Rect { x: number; y: number; width: number; height: number }
export interface Display { bounds: Rect }
export interface StoredBounds { width: number; height: number; x?: number; y?: number }

const MIN_VISIBLE = 100; // px that must overlap a display on each axis

function overlaps(win: Required<StoredBounds>, d: Rect): boolean {
  const xOverlap = Math.min(win.x + win.width, d.x + d.width) - Math.max(win.x, d.x);
  const yOverlap = Math.min(win.y + win.height, d.y + d.height) - Math.max(win.y, d.y);
  return xOverlap >= MIN_VISIBLE && yOverlap >= MIN_VISIBLE;
}

export function clampBoundsToDisplays(win: StoredBounds, displays: Display[]): StoredBounds {
  if (win.x === undefined || win.y === undefined) return win;
  const full = win as Required<StoredBounds>;
  if (displays.some((d) => overlaps(full, d.bounds))) return win;
  return { width: win.width, height: win.height };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/window-bounds.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/window-bounds.ts tests/window-bounds.test.ts
git commit -m "feat: add on-screen window bounds clamping"
```

### Task 3: Persist and restore window bounds

**Files:**
- Modify: `electron/main.ts`

**Interfaces:**
- Consumes: `PrefsStore` (Task 1), `clampBoundsToDisplays` (Task 2).
- Produces: a module-level `let prefs: PrefsStore | null` used by later tasks.

- [ ] **Step 1: Add imports and the prefs instance**

In `electron/main.ts`, add imports near the other electron imports (line 1 uses `app, BrowserWindow, protocol, net, ipcMain, session, Menu`; add `screen`):

```ts
import { app, BrowserWindow, protocol, net, ipcMain, session, Menu, screen } from 'electron';
import { PrefsStore } from './prefs-store';
import { clampBoundsToDisplays } from './window-bounds';
```

Add a module-level variable next to the other stores (`let colors …`):

```ts
let prefs: PrefsStore | null = null;
```

- [ ] **Step 2: Construct the store and restore bounds in `createWindow`**

Replace the `mainWindow = new BrowserWindow({...})` block (main.ts:194-200) with:

```ts
  prefs = new PrefsStore(join(app.getPath('userData'), 'prefs.json'));
  const stored = prefs.getAll().window;
  const bounds = clampBoundsToDisplays(
    { width: stored.width, height: stored.height, x: stored.x, y: stored.y },
    screen.getAllDisplays().map((d) => ({ bounds: d.bounds })),
  );
  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    backgroundColor: '#0a0a0a',
    icon: ICON_PATH,
    webPreferences: { preload: SIDEBAR_PRELOAD_PATH, contextIsolation: true },
  });
  if (stored.maximized) mainWindow.maximize();
```

Keep the existing `colors = …` / `removed = …` lines that follow.

- [ ] **Step 3: Save bounds on resize/move/close**

Add this helper above `createWindow` and wire the listeners inside `createWindow` (after the `mainWindow.on('close', …)` handler at main.ts:234):

```ts
let saveBoundsTimer: ReturnType<typeof setTimeout> | null = null;
function saveWindowBounds(): void {
  if (!mainWindow || !prefs) return;
  const maximized = mainWindow.isMaximized();
  const b = mainWindow.getNormalBounds();
  prefs.setWindow({ width: b.width, height: b.height, x: b.x, y: b.y, maximized });
}
function scheduleSaveBounds(): void {
  if (saveBoundsTimer) clearTimeout(saveBoundsTimer);
  saveBoundsTimer = setTimeout(saveWindowBounds, 400);
}
```

Inside `createWindow`, after the `close` handler:

```ts
  mainWindow.on('resize', scheduleSaveBounds);
  mainWindow.on('move', scheduleSaveBounds);
  mainWindow.on('close', saveWindowBounds);
```

- [ ] **Step 4: Verify manually**

Build and run:

```bash
npm run build --prefix renderer && npm run build:electron 2>/dev/null; DISPLAY=:0 npm run dev
```

(If `build:electron` is not a script, use the project's normal dev launcher `./run-dev.sh`.)
Expected: resize/move the window, quit via tray, relaunch — the window reopens at the same size/position. Maximize, quit, relaunch — reopens maximized. Confirm `prefs.json` in the userData dir contains a `window` block.

- [ ] **Step 5: Commit**

```bash
git add electron/main.ts
git commit -m "feat: remember window size and position across sessions"
```

### Task 4: Auto-start toggle + General settings section

**Files:**
- Modify: `electron/ipc.ts`, `electron/main.ts`, `electron/sidebar-preload.ts`, `renderer/app/page.tsx`, `renderer/app/SettingsPanel.tsx`

**Interfaces:**
- Consumes: `prefs` (Task 3).
- Produces: IPC `SET_AUTO_START`; bridge `setAutoStart(v)`, `getPrefs()` returning initial prefs via a `PREFS_CHANGED` push; a `General` settings section that later tasks extend with the theme selector.

- [ ] **Step 1: Add IPC channels**

In `electron/ipc.ts`, add inside the `IPC` object:

```ts
  SET_AUTO_START: 'prefs:auto-start', // send(boolean)
  PREFS_CHANGED: 'prefs:changed', // main -> renderer: full Prefs
```

- [ ] **Step 2: Push prefs and apply auto-start in main**

In `electron/main.ts`, add a pusher near `pushProfiles`:

```ts
function pushPrefs(): void {
  if (prefs) mainWindow?.webContents.send(IPC.PREFS_CHANGED, prefs.getAll());
}
```

In `createWindow`'s `did-finish-load` handler (main.ts:225), add `pushPrefs();` alongside `pushProfiles();`.

In `app.whenReady()` after `createWindow()`, sync the OS login item to the stored pref:

```ts
  app.setLoginItemSettings({ openAtLogin: prefs!.getAll().autoStart });
```

In `registerIpc()`, add:

```ts
  ipcMain.on(IPC.SET_AUTO_START, (_e, v: boolean) => {
    prefs!.setAutoStart(v);
    app.setLoginItemSettings({ openAtLogin: v });
    pushPrefs();
  });
```

- [ ] **Step 3: Expose bridge methods**

In `electron/sidebar-preload.ts`, add to the exposed object:

```ts
  setAutoStart: (v: boolean): void => ipcRenderer.send(IPC.SET_AUTO_START, v),
  onPrefsChanged: (cb: (prefs: unknown) => void): void => {
    ipcRenderer.on(IPC.PREFS_CHANGED, (_e, p) => cb(p));
  },
```

- [ ] **Step 4: Add Prefs typing + state to the renderer**

In `renderer/app/page.tsx`, extend `DesktopBridge` with:

```ts
  setAutoStart(v: boolean): void;
  onPrefsChanged(cb: (prefs: Prefs) => void): void;
```

Add a `Prefs` type mirroring the store (place near the top with the other exports):

```ts
export interface AccountPref { order?: number; label?: string; zoom?: number; notify?: boolean }
export interface Prefs {
  window: { width: number; height: number; x?: number; y?: number; maximized: boolean };
  autoStart: boolean;
  theme: 'system' | 'light' | 'dark';
  notifications: { dnd: boolean; quietHours: { enabled: boolean; start: string; end: string } };
  accounts: Record<string, AccountPref>;
}
```

In `Sidebar()`, add `const [prefs, setPrefs] = useState<Prefs | null>(null);` and, in the `useEffect`, `bridge.onPrefsChanged((p) => setPrefs(p as Prefs));`. Pass `prefs` and handlers into `<SettingsPanel prefs={prefs} onSetAutoStart={(v)=>window.desktop?.setAutoStart(v)} … />`.

- [ ] **Step 5: Add the General section to SettingsPanel**

In `renderer/app/SettingsPanel.tsx`, extend the props with `prefs: Prefs | null` and `onSetAutoStart: (v: boolean) => void`, then render a section above **About & updates**:

```tsx
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">
          General
        </h2>
        <div className="mb-6 rounded-xl border border-white/5 bg-neutral-900 p-4">
          <label className="flex items-center justify-between gap-3">
            <span className="text-sm">Start Gmail Desktop when I sign in</span>
            <input
              type="checkbox"
              checked={!!prefs?.autoStart}
              onChange={(e) => onSetAutoStart(e.target.checked)}
              className="h-4 w-4 accent-blue-600"
            />
          </label>
        </div>
```

(Import the `Prefs` type from `./page`.)

- [ ] **Step 6: Verify manually**

Run the app. Toggle "Start when I sign in"; confirm `prefs.json` `autoStart` flips and (on Windows) `app.getLoginItemSettings().openAtLogin` matches. On Windows, confirm the registry Run entry appears/disappears.

- [ ] **Step 7: Commit**

```bash
git add electron/ipc.ts electron/main.ts electron/sidebar-preload.ts renderer/app/page.tsx renderer/app/SettingsPanel.tsx
git commit -m "feat: add launch-at-login toggle"
```

---

## Phase 3 — Zoom + shortcuts

### Task 5: Shortcut resolver (pure)

**Files:**
- Create: `electron/shortcuts.ts`
- Test: `tests/shortcuts.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface KeyInput { type: string; key: string; control: boolean; meta: boolean; shift: boolean; alt: boolean }`
  - `type Action = { type: 'switch'; n: number } | { type: 'compose' } | { type: 'zoom'; dir: 'in' | 'out' | 'reset' }`
  - `function resolveShortcut(input: KeyInput): Action | null`

- [ ] **Step 1: Write the failing test**

```ts
// tests/shortcuts.test.ts
import { describe, it, expect } from 'vitest';
import { resolveShortcut } from '../electron/shortcuts';

const base = { type: 'keyDown', control: false, meta: false, shift: false, alt: false };

describe('resolveShortcut', () => {
  it('maps Ctrl+3 to switch account 3', () => {
    expect(resolveShortcut({ ...base, control: true, key: '3' })).toEqual({ type: 'switch', n: 3 });
  });
  it('maps Cmd+1 (meta) to switch account 1', () => {
    expect(resolveShortcut({ ...base, meta: true, key: '1' })).toEqual({ type: 'switch', n: 1 });
  });
  it('maps Ctrl+N to compose', () => {
    expect(resolveShortcut({ ...base, control: true, key: 'n' })).toEqual({ type: 'compose' });
  });
  it('maps Ctrl+= and Ctrl+- and Ctrl+0 to zoom', () => {
    expect(resolveShortcut({ ...base, control: true, key: '=' })).toEqual({ type: 'zoom', dir: 'in' });
    expect(resolveShortcut({ ...base, control: true, key: '-' })).toEqual({ type: 'zoom', dir: 'out' });
    expect(resolveShortcut({ ...base, control: true, key: '0' })).toEqual({ type: 'zoom', dir: 'reset' });
  });
  it('ignores keyUp events', () => {
    expect(resolveShortcut({ ...base, type: 'keyUp', control: true, key: '1' })).toBeNull();
  });
  it('ignores plain keys without a modifier', () => {
    expect(resolveShortcut({ ...base, key: '1' })).toBeNull();
  });
  it('ignores Ctrl+0 reserved digit as switch (0 is zoom-reset only)', () => {
    // '0' with modifier is zoom-reset, never switch
    expect(resolveShortcut({ ...base, control: true, key: '0' })).toEqual({ type: 'zoom', dir: 'reset' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shortcuts.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// electron/shortcuts.ts
export interface KeyInput {
  type: string;
  key: string;
  control: boolean;
  meta: boolean;
  shift: boolean;
  alt: boolean;
}
export type Action =
  | { type: 'switch'; n: number }
  | { type: 'compose' }
  | { type: 'zoom'; dir: 'in' | 'out' | 'reset' };

export function resolveShortcut(input: KeyInput): Action | null {
  if (input.type !== 'keyDown') return null;
  const mod = input.control || input.meta;
  if (!mod) return null;
  const key = input.key.toLowerCase();
  if (key === 'n') return { type: 'compose' };
  if (key === '0') return { type: 'zoom', dir: 'reset' };
  if (key === '=' || key === '+') return { type: 'zoom', dir: 'in' };
  if (key === '-' || key === '_') return { type: 'zoom', dir: 'out' };
  if (/^[1-9]$/.test(key)) return { type: 'switch', n: Number(key) };
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/shortcuts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/shortcuts.ts tests/shortcuts.test.ts
git commit -m "feat: add keyboard shortcut resolver"
```

### Task 6: Wire shortcuts + per-account zoom

**Files:**
- Modify: `electron/profile-view-manager.ts`, `electron/main.ts`

**Interfaces:**
- Consumes: `resolveShortcut` (Task 5), `prefs` (Task 3), `Action` type.
- Produces on `ProfileViewManager`:
  - constructor gains `onInput: (index: number, input: KeyInput) => void` and `getZoom: (index: number) => number`.
  - `setZoomForIndex(index: number, level: number): void`
  - `getActiveZoomLevel(): number`
  - `activeIndex(): number | null` (exists)

- [ ] **Step 1: Extend ProfileViewManager**

In `electron/profile-view-manager.ts`, import the input type:

```ts
import type { KeyInput } from './shortcuts';
```

Add two constructor params after `onIdentity`:

```ts
    private readonly onInput: (index: number, input: KeyInput) => void,
    private readonly getZoom: (index: number) => number,
```

In `ensureView`, after `view.webContents.loadURL(...)`, wire input + initial zoom:

```ts
    view.webContents.on('before-input-event', (_e, input) => this.onInput(index, input as unknown as KeyInput));
    view.webContents.on('did-finish-load', () => {
      view.webContents.setZoomLevel(this.getZoom(index));
    });
```

Add methods to the class:

```ts
  setZoomForIndex(index: number, level: number): void {
    for (const surface of ['mail', 'calendar'] as Surface[]) {
      const v = this.views.get(key(index, surface));
      if (v) v.webContents.setZoomLevel(level);
    }
  }
  getActiveZoomLevel(): number {
    if (!this.activeKey) return 0;
    return this.views.get(this.activeKey)?.webContents.getZoomLevel() ?? 0;
  }
```

- [ ] **Step 2: Provide the new constructor args in main**

In `electron/main.ts` where `manager = new ProfileViewManager(...)` is built (main.ts:203), append two args after the identity callback:

```ts
    (index, input) => handleInput(index, input),
    (index) => {
      const email = profiles.find((p) => p.index === index)?.email;
      return email ? prefs!.getAccount(email).zoom ?? 0 : 0;
    },
```

- [ ] **Step 3: Add the input handler in main**

Add imports:

```ts
import { resolveShortcut, type KeyInput } from './shortcuts';
import { openCompose } from './compose-window';
```

Add the handler above `createWindow`:

```ts
function handleInput(index: number, input: KeyInput): void {
  const action = resolveShortcut(input);
  if (!action) return;
  if (action.type === 'switch') {
    const ordered = [...profiles].sort((a, b) => (a.order ?? a.index) - (b.order ?? b.index));
    const target = ordered[action.n - 1];
    if (target) switchSurface(target.index, 'mail');
  } else if (action.type === 'compose') {
    const active = manager?.activeIndex();
    if (active != null) openCompose(active);
  } else if (action.type === 'zoom') {
    const active = manager?.activeIndex();
    if (active == null) return;
    const current = manager!.getActiveZoomLevel();
    const level = action.dir === 'reset' ? 0 : current + (action.dir === 'in' ? 0.5 : -0.5);
    const clamped = Math.max(-3, Math.min(3, level));
    manager!.setZoomForIndex(active, clamped);
    const email = profiles.find((p) => p.index === active)?.email;
    if (email) prefs!.setAccount(email, { zoom: clamped });
  }
}
```

Note: `profiles` items may not yet carry `order`; `a.order ?? a.index` handles that (Task 9 populates `order`). Add `order?: number` to the `Profile` used here — done in Task 9; until then TypeScript needs the field. Add `order?: number; label?: string;` to the `Profile` interface in `profile-view-manager.ts` now:

```ts
export interface Profile {
  index: number;
  email: string;
  name: string;
  avatarUrl: string;
  color: string;
  order?: number;
  label?: string;
}
```

- [ ] **Step 4: Also wire the sidebar webContents for shortcuts**

In `createWindow`, after the bounds listeners, add (so Ctrl+1…9 work when the sidebar has focus, routing to the active account):

```ts
  mainWindow.webContents.on('before-input-event', (_e, input) => {
    const active = manager?.activeIndex() ?? 0;
    handleInput(active, input as unknown as KeyInput);
  });
```

- [ ] **Step 5: Verify manually**

Run the app (compose depends on Task 7 — do this step after Task 7, or expect a no-op for Ctrl+N until then). Verify Ctrl+2 switches to the second account, Ctrl+= / Ctrl+- zoom the active view, Ctrl+0 resets, and the zoom level survives account-switch and relaunch (check `prefs.json` `accounts[email].zoom`).

- [ ] **Step 6: Commit**

```bash
git add electron/profile-view-manager.ts electron/main.ts
git commit -m "feat: add account-switch and zoom shortcuts with per-account zoom"
```

### Task 7: Compose popup window

**Files:**
- Create: `electron/compose-window.ts`

**Interfaces:**
- Consumes: nothing (uses Electron + the `persist:google` partition).
- Produces: `function openCompose(index: number): void` — used by `handleInput` (Task 6).

- [ ] **Step 1: Implement**

```ts
// electron/compose-window.ts
import { BrowserWindow } from 'electron';

const SESSION_PARTITION = 'persist:google';

// Opens Gmail's standalone compose window for account `index`. Keystroke
// injection into the main Gmail view does not work, so compose is triggered by
// loading Gmail's compose URL in a small popup on the shared Google session.
export function openCompose(index: number): void {
  const win = new BrowserWindow({
    width: 720,
    height: 640,
    title: 'New message',
    backgroundColor: '#ffffff',
    webPreferences: { partition: SESSION_PARTITION, contextIsolation: true },
  });
  void win.loadURL(`https://mail.google.com/mail/u/${index}/?view=cm&fs=1&tf=1`);
}
```

- [ ] **Step 2: Verify manually**

Run the app, press Ctrl+N on an active account. Expected: a compose window opens, already authenticated as that account, ready to type. Sending closes it (Gmail's behaviour). Confirm the correct `/u/<index>/` account is used by composing from a non-primary account.

- [ ] **Step 3: Commit**

```bash
git add electron/compose-window.ts
git commit -m "feat: open compose in a popup window on Ctrl+N"
```

---

## Phase 4 — Reorder + labels

### Task 8: Order sort (pure)

**Files:**
- Create: `electron/account-order.ts`
- Test: `tests/account-order.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface Orderable { index: number; order?: number }`
  - `function sortByOrder<T extends Orderable>(items: T[]): T[]` — stable sort by `order ?? index`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/account-order.test.ts
import { describe, it, expect } from 'vitest';
import { sortByOrder } from '../electron/account-order';

describe('sortByOrder', () => {
  it('falls back to index when no order set', () => {
    const items = [{ index: 2 }, { index: 0 }, { index: 1 }];
    expect(sortByOrder(items).map((i) => i.index)).toEqual([0, 1, 2]);
  });
  it('honours explicit order over index', () => {
    const items = [{ index: 0, order: 2 }, { index: 1, order: 0 }, { index: 2, order: 1 }];
    expect(sortByOrder(items).map((i) => i.index)).toEqual([1, 2, 0]);
  });
  it('does not mutate the input', () => {
    const items = [{ index: 1 }, { index: 0 }];
    sortByOrder(items);
    expect(items.map((i) => i.index)).toEqual([1, 0]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/account-order.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// electron/account-order.ts
export interface Orderable { index: number; order?: number }

export function sortByOrder<T extends Orderable>(items: T[]): T[] {
  return [...items].sort((a, b) => (a.order ?? a.index) - (b.order ?? b.index));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/account-order.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/account-order.ts tests/account-order.test.ts
git commit -m "feat: add account order sorting helper"
```

### Task 9: Merge order/label into profiles + IPC

**Files:**
- Modify: `electron/ipc.ts`, `electron/main.ts`, `electron/sidebar-preload.ts`, `renderer/app/page.tsx`

**Interfaces:**
- Consumes: `PrefsStore` (Task 1), `sortByOrder` (Task 8).
- Produces: IPC `SET_ACCOUNT_PREF { email, label?, notify? }`, `SET_ACCOUNT_ORDER { emails: string[] }`; `pushProfiles` now attaches `order`/`label` and emits in display order; bridge `setAccountPref`, `setAccountOrder`.

- [ ] **Step 1: Add IPC channels**

In `electron/ipc.ts`:

```ts
  SET_ACCOUNT_PREF: 'prefs:account', // send({email, label?, notify?})
  SET_ACCOUNT_ORDER: 'prefs:order', // send({emails: string[]})
```

- [ ] **Step 2: Decorate profiles in main**

In `electron/main.ts`, add import:

```ts
import { sortByOrder } from './account-order';
```

Replace `pushProfiles` (main.ts:60-62) with:

```ts
function decorate(list: Profile[]): Profile[] {
  const withPrefs = list.map((p) => {
    const ap = prefs?.getAccount(p.email) ?? {};
    return { ...p, order: ap.order, label: ap.label };
  });
  return sortByOrder(withPrefs);
}
function pushProfiles(): void {
  mainWindow?.webContents.send(IPC.PROFILES_CHANGED, decorate([...profiles]));
}
```

- [ ] **Step 3: Handle the new IPC in main**

In `registerIpc()`:

```ts
  ipcMain.on(IPC.SET_ACCOUNT_PREF, (_e, arg: { email: string; label?: string; notify?: boolean }) => {
    const patch: Record<string, unknown> = {};
    if ('label' in arg) patch.label = arg.label;
    if ('notify' in arg) patch.notify = arg.notify;
    prefs!.setAccount(arg.email, patch);
    pushProfiles();
    refreshNotifyAllowed(); // defined in Task 13
  });
  ipcMain.on(IPC.SET_ACCOUNT_ORDER, (_e, arg: { emails: string[] }) => {
    prefs!.setOrder(arg.emails);
    pushProfiles();
  });
```

Note: `refreshNotifyAllowed` is added in Task 13. If implementing Phase 4 before Phase 5, temporarily omit that line and re-add it in Task 13.

- [ ] **Step 4: Expose bridge methods**

In `electron/sidebar-preload.ts`:

```ts
  setAccountPref: (arg: { email: string; label?: string; notify?: boolean }): void =>
    ipcRenderer.send(IPC.SET_ACCOUNT_PREF, arg),
  setAccountOrder: (emails: string[]): void =>
    ipcRenderer.send(IPC.SET_ACCOUNT_ORDER, { emails }),
```

- [ ] **Step 5: Extend the renderer Profile + bridge types**

In `renderer/app/page.tsx`, add `order?: number; label?: string;` to `interface Profile`, and to `DesktopBridge`:

```ts
  setAccountPref(arg: { email: string; label?: string; notify?: boolean }): void;
  setAccountOrder(emails: string[]): void;
```

Add a display-name helper and use it for tooltips/labels:

```ts
function displayName(p: Profile): string {
  return (p.label && p.label.trim()) || p.name || p.email;
}
```

Use `displayName(p)` in the sidebar `title={...}` attributes (mail + calendar buttons).

- [ ] **Step 6: Verify manually**

Run the app; in DevTools call `window.desktop.setAccountOrder([...emailsReordered])` and confirm the sidebar reorders and persists across relaunch. Call `window.desktop.setAccountPref({email, label:'Test'})` and confirm the tooltip changes.

- [ ] **Step 7: Commit**

```bash
git add electron/ipc.ts electron/main.ts electron/sidebar-preload.ts renderer/app/page.tsx
git commit -m "feat: apply account order and label overrides to profiles"
```

### Task 10: Drag-to-reorder in the sidebar

**Files:**
- Modify: `renderer/app/page.tsx`

**Interfaces:**
- Consumes: `setAccountOrder` (Task 9).
- Produces: drag handlers on each account row.

- [ ] **Step 1: Add drag state and handlers**

In `Sidebar()`, add:

```ts
  const [dragEmail, setDragEmail] = useState<string | null>(null);

  function onDrop(targetEmail: string) {
    if (!dragEmail || dragEmail === targetEmail) return;
    const emails = profiles.map((p) => p.email);
    const from = emails.indexOf(dragEmail);
    const to = emails.indexOf(targetEmail);
    if (from < 0 || to < 0) return;
    emails.splice(to, 0, emails.splice(from, 1)[0]);
    window.desktop?.setAccountOrder(emails);
    setDragEmail(null);
  }
```

- [ ] **Step 2: Make each account row draggable**

On the per-profile wrapper `<div key={p.index} className="flex flex-col items-center gap-1.5">` add:

```tsx
              draggable
              onDragStart={() => setDragEmail(p.email)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDrop(p.email)}
              className={`flex flex-col items-center gap-1.5 ${dragEmail === p.email ? 'opacity-40' : ''}`}
```

- [ ] **Step 3: Verify manually**

Run the app with ≥2 accounts. Drag one avatar onto another; the order changes and persists across relaunch. The active Gmail view is unchanged (reorder is display-only).

- [ ] **Step 4: Commit**

```bash
git add renderer/app/page.tsx
git commit -m "feat: reorder sidebar accounts by drag and drop"
```

### Task 11: Edit account label in settings

**Files:**
- Modify: `renderer/app/SettingsPanel.tsx`

**Interfaces:**
- Consumes: `setAccountPref` (Task 9), `Profile.label`.
- Produces: an inline label editor in the accounts list.

- [ ] **Step 1: Add label editing UI**

In `SettingsPanel.tsx`, inside the account row (near the name/email block, `SettingsPanel.tsx:182-185`), replace the name/email block with an editable label input:

```tsx
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <input
                      defaultValue={p.label ?? p.name ?? ''}
                      placeholder={p.name || p.email}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v !== (p.label ?? p.name ?? '')) window.desktop?.setAccountPref({ email: p.email, label: v });
                      }}
                      className="w-full truncate rounded bg-transparent text-sm font-medium outline-none focus:bg-neutral-800 focus:px-2 focus:py-1"
                    />
                    <span className="truncate text-xs text-neutral-400">{p.email}</span>
                  </div>
```

Add `label?: string` to the local `Profile` interface in `SettingsPanel.tsx`.

- [ ] **Step 2: Verify manually**

Run the app, open Settings, edit an account's label, blur the field. The sidebar tooltip updates and the label persists across relaunch. Clearing the field restores the detected name.

- [ ] **Step 3: Commit**

```bash
git add renderer/app/SettingsPanel.tsx
git commit -m "feat: edit custom account labels in settings"
```

---

## Phase 5 — Notifications + click polish

### Task 12: Notification policy (pure)

**Files:**
- Create: `electron/notification-policy.ts`
- Test: `tests/notification-policy.test.ts`

**Interfaces:**
- Consumes: `Prefs` (Task 1).
- Produces:
  - `function inQuietHours(start: string, end: string, minutes: number): boolean`
  - `function notificationsAllowed(prefs: Prefs, email: string, now: Date): boolean`

- [ ] **Step 1: Write the failing test**

```ts
// tests/notification-policy.test.ts
import { describe, it, expect } from 'vitest';
import { notificationsAllowed, inQuietHours } from '../electron/notification-policy';
import { DEFAULT_PREFS, type Prefs } from '../electron/prefs-store';

function prefs(overrides: Partial<Prefs>): Prefs {
  return { ...structuredClone(DEFAULT_PREFS), ...overrides };
}
const at = (h: number, m = 0) => new Date(2026, 0, 1, h, m);

describe('inQuietHours', () => {
  it('handles a midnight-crossing window', () => {
    expect(inQuietHours('22:00', '07:00', 23 * 60)).toBe(true); // 23:00
    expect(inQuietHours('22:00', '07:00', 6 * 60)).toBe(true); // 06:00
    expect(inQuietHours('22:00', '07:00', 12 * 60)).toBe(false); // 12:00
  });
  it('handles a same-day window', () => {
    expect(inQuietHours('09:00', '17:00', 10 * 60)).toBe(true);
    expect(inQuietHours('09:00', '17:00', 20 * 60)).toBe(false);
  });
  it('treats start==end as never in quiet hours', () => {
    expect(inQuietHours('09:00', '09:00', 9 * 60)).toBe(false);
  });
});

describe('notificationsAllowed', () => {
  it('allows by default', () => {
    expect(notificationsAllowed(prefs({}), 'a@x.com', at(12))).toBe(true);
  });
  it('blocks all when DND is on', () => {
    expect(notificationsAllowed(prefs({ notifications: { dnd: true, quietHours: { enabled: false, start: '18:00', end: '08:00' } } }), 'a@x.com', at(12))).toBe(false);
  });
  it('blocks during quiet hours', () => {
    expect(notificationsAllowed(prefs({ notifications: { dnd: false, quietHours: { enabled: true, start: '18:00', end: '08:00' } } }), 'a@x.com', at(23))).toBe(false);
  });
  it('blocks a per-account opt-out', () => {
    const p = prefs({ accounts: { 'a@x.com': { notify: false } } });
    expect(notificationsAllowed(p, 'a@x.com', at(12))).toBe(false);
  });
  it('allows an account with notify:true even if another is off', () => {
    const p = prefs({ accounts: { 'a@x.com': { notify: false }, 'b@x.com': { notify: true } } });
    expect(notificationsAllowed(p, 'b@x.com', at(12))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/notification-policy.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// electron/notification-policy.ts
import type { Prefs } from './prefs-store';

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function inQuietHours(start: string, end: string, minutes: number): boolean {
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (s === e) return false;
  if (s < e) return minutes >= s && minutes < e; // same-day window
  return minutes >= s || minutes < e; // crosses midnight
}

export function notificationsAllowed(prefs: Prefs, email: string, now: Date): boolean {
  const { dnd, quietHours } = prefs.notifications;
  if (dnd) return false;
  if (quietHours.enabled && inQuietHours(quietHours.start, quietHours.end, now.getHours() * 60 + now.getMinutes())) {
    return false;
  }
  if (prefs.accounts[email]?.notify === false) return false;
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/notification-policy.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/notification-policy.ts tests/notification-policy.test.ts
git commit -m "feat: add notification policy for dnd and quiet hours"
```

### Task 13: Compute + push notify-allowed; notification IPC + quiet-hours timer

**Files:**
- Modify: `electron/ipc.ts`, `electron/main.ts`, `electron/profile-view-manager.ts`, `electron/sidebar-preload.ts`, `renderer/app/page.tsx`

**Interfaces:**
- Consumes: `notificationsAllowed` (Task 12), `prefs` (Task 3).
- Produces: IPC `NOTIFY_ALLOWED` (main→mail view), `SET_NOTIFICATIONS`; `manager.pushNotifyAllowed(index, allowed)`; global `refreshNotifyAllowed()`; bridge `setNotifications`.

- [ ] **Step 1: Add IPC channels**

In `electron/ipc.ts`:

```ts
  SET_NOTIFICATIONS: 'prefs:notifications', // send({dnd, quietHours})
  NOTIFY_ALLOWED: 'notify:allowed', // main -> mail view: send(boolean)
```

- [ ] **Step 2: Add the push method to ProfileViewManager**

In `electron/profile-view-manager.ts`:

```ts
  pushNotifyAllowed(index: number, allowed: boolean): void {
    const v = this.views.get(key(index, 'mail'));
    v?.webContents.send(IPC.NOTIFY_ALLOWED, allowed);
  }
```

(`IPC` is already imported in this file.)

- [ ] **Step 3: Compute + push + timer in main**

In `electron/main.ts` add import:

```ts
import { notificationsAllowed } from './notification-policy';
```

Add the refresh function and a quiet-hours re-check timer above `createWindow`:

```ts
let notifyTimer: ReturnType<typeof setInterval> | null = null;
function refreshNotifyAllowed(): void {
  if (!prefs) return;
  const p = prefs.getAll();
  for (const profile of profiles) {
    manager?.pushNotifyAllowed(profile.index, notificationsAllowed(p, profile.email, new Date()));
  }
}
function startNotifyTimer(): void {
  if (notifyTimer) return;
  // Quiet-hours boundaries only change on the minute; re-evaluate each minute.
  notifyTimer = setInterval(refreshNotifyAllowed, 60_000);
}
```

Call `refreshNotifyAllowed()` at the end of `onIdentity` after a successful `pushProfiles()` (so a newly detected account gets its flag), and call `startNotifyTimer()` once in `app.whenReady()` after `createWindow()`.

In `registerIpc()`:

```ts
  ipcMain.on(IPC.SET_NOTIFICATIONS, (_e, arg: { dnd: boolean; quietHours: { enabled: boolean; start: string; end: string } }) => {
    prefs!.setNotifications(arg);
    pushPrefs();
    refreshNotifyAllowed();
  });
```

Ensure the `SET_ACCOUNT_PREF` handler (Task 9) calls `refreshNotifyAllowed()` (re-add the line if it was omitted).

- [ ] **Step 4: Expose the bridge method**

In `electron/sidebar-preload.ts`:

```ts
  setNotifications: (arg: { dnd: boolean; quietHours: { enabled: boolean; start: string; end: string } }): void =>
    ipcRenderer.send(IPC.SET_NOTIFICATIONS, arg),
```

In `renderer/app/page.tsx` add to `DesktopBridge`:

```ts
  setNotifications(arg: { dnd: boolean; quietHours: { enabled: boolean; start: string; end: string } }): void;
```

- [ ] **Step 5: Verify manually (with Task 14)**

Deferred to Task 14 (needs the preload gate). Continue to Task 14, then verify together.

- [ ] **Step 6: Commit**

```bash
git add electron/ipc.ts electron/main.ts electron/profile-view-manager.ts electron/sidebar-preload.ts renderer/app/page.tsx
git commit -m "feat: compute and push per-account notification permission"
```

### Task 14: Gate native notifications in the mail preload

**Files:**
- Modify: `electron/preload.ts`

**Interfaces:**
- Consumes: IPC `NOTIFY_ALLOWED` (Task 13).
- Produces: notification suppression when not allowed.

- [ ] **Step 1: Track the allowed flag and gate construction**

In `electron/preload.ts`, inside the `if (typeof document !== 'undefined')` block, after `const { ipcRenderer } = require('electron') …`, add:

```ts
  let notifyAllowed = true;
  ipcRenderer.on(IPC.NOTIFY_ALLOWED, (_e: unknown, allowed: boolean) => {
    notifyAllowed = allowed;
  });
```

Modify the `Wrapped` Notification constructor so it suppresses when not allowed:

```ts
      const Wrapped = function (this: Notification, title: string, options?: NotificationOptions) {
        if (!notifyAllowed) {
          // Return a harmless stub so Gmail's code doesn't throw; nothing is shown.
          return { onclick: null, close() {}, addEventListener() {} } as unknown as Notification;
        }
        const n = new Original(title, options);
        n.addEventListener('click', () => ipcRenderer.send(IPC.NOTIFICATION_ACTIVATE));
        return n;
      } as unknown as typeof Notification;
```

- [ ] **Step 2: Verify manually (Windows)**

On Windows: with DND off and outside quiet hours, a new mail shows a native notification. Turn on DND in Settings → no notification for a new mail. Toggle an account's notify off → that account is silent while others still notify. Set quiet hours to include "now" → all silent.

- [ ] **Step 3: Commit**

```bash
git add electron/preload.ts
git commit -m "feat: suppress native notifications when not allowed"
```

### Task 15: Notifications settings section + per-account toggle

**Files:**
- Modify: `renderer/app/SettingsPanel.tsx`

**Interfaces:**
- Consumes: `prefs.notifications` (Task 4/13), `setNotifications` (Task 13), `setAccountPref` (Task 9).
- Produces: DND toggle, quiet-hours controls, per-account notify toggle.

- [ ] **Step 1: Add props**

Extend `SettingsPanel` props with `onSetNotifications: (arg: { dnd: boolean; quietHours: { enabled: boolean; start: string; end: string } }) => void`. Wire it from `page.tsx` as `onSetNotifications={(a)=>window.desktop?.setNotifications(a)}`.

- [ ] **Step 2: Render the Notifications section**

Add below the General section:

```tsx
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">
          Notifications
        </h2>
        <div className="mb-6 flex flex-col gap-3 rounded-xl border border-white/5 bg-neutral-900 p-4">
          <label className="flex items-center justify-between gap-3">
            <span className="text-sm">Do not disturb (mute all)</span>
            <input
              type="checkbox"
              checked={!!prefs?.notifications.dnd}
              onChange={(e) =>
                onSetNotifications({ dnd: e.target.checked, quietHours: prefs!.notifications.quietHours })
              }
              className="h-4 w-4 accent-blue-600"
            />
          </label>
          <label className="flex items-center justify-between gap-3">
            <span className="text-sm">Quiet hours</span>
            <input
              type="checkbox"
              checked={!!prefs?.notifications.quietHours.enabled}
              onChange={(e) =>
                onSetNotifications({
                  dnd: prefs!.notifications.dnd,
                  quietHours: { ...prefs!.notifications.quietHours, enabled: e.target.checked },
                })
              }
              className="h-4 w-4 accent-blue-600"
            />
          </label>
          {prefs?.notifications.quietHours.enabled && (
            <div className="flex items-center gap-2 text-sm text-neutral-300">
              <span>From</span>
              <input
                type="time"
                value={prefs.notifications.quietHours.start}
                onChange={(e) =>
                  onSetNotifications({ dnd: prefs!.notifications.dnd, quietHours: { ...prefs!.notifications.quietHours, start: e.target.value } })
                }
                className="rounded bg-neutral-800 px-2 py-1"
              />
              <span>to</span>
              <input
                type="time"
                value={prefs.notifications.quietHours.end}
                onChange={(e) =>
                  onSetNotifications({ dnd: prefs!.notifications.dnd, quietHours: { ...prefs!.notifications.quietHours, end: e.target.value } })
                }
                className="rounded bg-neutral-800 px-2 py-1"
              />
            </div>
          )}
        </div>
```

- [ ] **Step 3: Add per-account notify toggle**

In each account row (near the color swatches / trash button), add before the trash button:

```tsx
                    <label className="flex items-center gap-1 text-xs text-neutral-400" title="Notifications for this account">
                      <input
                        type="checkbox"
                        checked={prefs?.accounts?.[p.email]?.notify !== false}
                        onChange={(e) => window.desktop?.setAccountPref({ email: p.email, notify: e.target.checked })}
                        className="h-3.5 w-3.5 accent-blue-600"
                      />
                    </label>
```

- [ ] **Step 4: Verify manually (Windows)**

Confirm the controls reflect and update `prefs.json`, and that behaviour matches Task 14's checks.

- [ ] **Step 5: Commit**

```bash
git add renderer/app/SettingsPanel.tsx renderer/app/page.tsx
git commit -m "feat: add notification settings and per-account toggle"
```

### Task 16: Harden notification-click activation

**Files:**
- Modify: `electron/main.ts`

**Interfaces:**
- Consumes: existing `onActivate` callback (main.ts:211-218).
- Produces: window restore/focus + mail-surface switch on notification click.

- [ ] **Step 1: Strengthen the activate handler**

Replace the `onActivate` arrow passed to `ProfileViewManager` (main.ts:211-218) with:

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

- [ ] **Step 2: Verify manually (Windows)**

With the window minimized/behind other apps, click a Gmail notification → the app restores, focuses, switches to that account's mail, and Gmail opens the thread.

- [ ] **Step 3: Commit**

```bash
git add electron/main.ts
git commit -m "fix: restore and focus window on notification click"
```

---

## Phase 6 — Theme

### Task 17: Theme plumbing (persist + apply class)

**Files:**
- Modify: `renderer/tailwind.config.ts`, `renderer/app/layout.tsx`, `renderer/app/page.tsx`, `electron/ipc.ts`, `electron/main.ts`, `electron/sidebar-preload.ts`

**Interfaces:**
- Consumes: `prefs.theme` (Task 4), `PREFS_CHANGED` (Task 4).
- Produces: IPC `SET_THEME`; bridge `setTheme`; `<html>` carries `class="light"|"dark"`.

- [ ] **Step 1: Enable class-based dark mode**

Replace `renderer/tailwind.config.ts` contents:

```ts
import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
};

export default config;
```

- [ ] **Step 2: Add IPC + main handler**

In `electron/ipc.ts`:

```ts
  SET_THEME: 'prefs:theme', // send('system'|'light'|'dark')
```

In `main.ts` `registerIpc()`:

```ts
  ipcMain.on(IPC.SET_THEME, (_e, theme: 'system' | 'light' | 'dark') => {
    prefs!.setTheme(theme);
    pushPrefs();
  });
```

- [ ] **Step 3: Expose the bridge method**

In `electron/sidebar-preload.ts`:

```ts
  setTheme: (theme: 'system' | 'light' | 'dark'): void => ipcRenderer.send(IPC.SET_THEME, theme),
```

In `renderer/app/page.tsx` add to `DesktopBridge`:

```ts
  setTheme(theme: 'system' | 'light' | 'dark'): void;
```

- [ ] **Step 4: Apply the theme class from renderer state**

In `renderer/app/page.tsx`, inside `Sidebar()`, add an effect that reflects `prefs.theme` onto `<html>`:

```ts
  useEffect(() => {
    const choice = prefs?.theme ?? 'system';
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = choice === 'dark' || (choice === 'system' && mq.matches);
      document.documentElement.classList.toggle('dark', dark);
      document.documentElement.classList.toggle('light', !dark);
    };
    apply();
    if (choice === 'system') {
      mq.addEventListener('change', apply);
      return () => mq.removeEventListener('change', apply);
    }
  }, [prefs?.theme]);
```

- [ ] **Step 5: Verify manually**

In DevTools call `window.desktop.setTheme('light')` / `'dark'` / `'system'`; confirm `<html>` class toggles and persists across relaunch. (Visual styling lands in Task 18.)

- [ ] **Step 6: Commit**

```bash
git add renderer/tailwind.config.ts electron/ipc.ts electron/main.ts electron/sidebar-preload.ts renderer/app/page.tsx
git commit -m "feat: add theme preference plumbing"
```

### Task 18: Theme-aware shell + selector

**Files:**
- Modify: `renderer/app/page.tsx`, `renderer/app/SettingsPanel.tsx`

**Interfaces:**
- Consumes: theme class on `<html>` (Task 17), `setTheme` (Task 17).
- Produces: light/dark styling for sidebar + settings, and a theme selector.

- [ ] **Step 1: Make the sidebar theme-aware**

In `renderer/app/page.tsx`, change the root container class (page.tsx:156) from `bg-neutral-950 text-neutral-200` to:

```tsx
    <div className="flex h-screen w-full bg-neutral-100 text-neutral-800 dark:bg-neutral-950 dark:text-neutral-200">
```

Update the sidebar accents that assume dark: the unread badge ring `ring-neutral-950` → `ring-neutral-100 dark:ring-neutral-950`; the mail active ring offset `ring-offset-neutral-950` → `ring-offset-neutral-100 dark:ring-offset-neutral-950`; divider `bg-white/10` → `bg-black/10 dark:bg-white/10`; hover/active `text-neutral-500`/`hover:bg-white/10` → add light equivalents `text-neutral-500 dark:text-neutral-400` and `hover:bg-black/5 dark:hover:bg-white/10`.

- [ ] **Step 2: Make SettingsPanel theme-aware**

In `renderer/app/SettingsPanel.tsx`, update the root (`SettingsPanel.tsx:96`) and the repeated card/heading classes:
- Root `bg-neutral-950 text-neutral-100` → `bg-neutral-100 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100`.
- Section headings `text-neutral-500` (unchanged; readable in both).
- Cards `border-white/5 bg-neutral-900` → `border-black/5 bg-white dark:border-white/5 dark:bg-neutral-900`.
- Neutral buttons `bg-neutral-800 text-neutral-100 hover:bg-neutral-700` → `bg-neutral-200 text-neutral-900 hover:bg-neutral-300 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700`.

Apply the same dark-prefixed pattern to the remaining `neutral-*` utility classes in the file (color swatch ring offset, trash hover, confirm dialog). Keep blue action buttons and red destructive buttons as-is (they read in both themes).

- [ ] **Step 3: Add the theme selector to the General section**

In the General card (Task 4), add below the auto-start toggle:

```tsx
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-sm">Theme</span>
            <select
              value={prefs?.theme ?? 'system'}
              onChange={(e) => window.desktop?.setTheme(e.target.value as 'system' | 'light' | 'dark')}
              className="rounded bg-neutral-200 px-2 py-1 text-sm text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>
```

- [ ] **Step 4: Verify manually**

Run the app. Switch System/Light/Dark: the 72px sidebar and settings pane restyle; Gmail keeps its own theme. In System mode, change the OS theme and confirm the shell follows live. Confirm the unread badge, active rings, and settings cards look correct in both themes.

- [ ] **Step 5: Commit**

```bash
git add renderer/app/page.tsx renderer/app/SettingsPanel.tsx
git commit -m "feat: light and dark theme for the app shell"
```

---

## Self-Review Notes

**Spec coverage:** auto-start → Task 4; window persistence → Tasks 2–3; per-account notifications + DND + quiet hours → Tasks 12–15; notification click → Task 16; reorder + labels → Tasks 8–11; shortcuts → Tasks 5–7; per-account zoom → Task 6; theme → Tasks 17–18. Calendar tray notification intentionally excluded (out of scope). All covered.

**Type consistency:** `Prefs`/`AccountPref` shapes match between `electron/prefs-store.ts` and the renderer mirror in `page.tsx`. `Profile` gains `order?`/`label?` in both `profile-view-manager.ts` and `page.tsx`. `KeyInput`/`Action` from `shortcuts.ts` are used consistently in `main.ts` and `profile-view-manager.ts`. `refreshNotifyAllowed` is defined in Task 13 and referenced by the Task 9 `SET_ACCOUNT_PREF` handler (ordering note included).

**Cross-phase note:** If Phase 4 is implemented before Phase 5, omit the `refreshNotifyAllowed()` call in Task 9 Step 3 and add it back in Task 13. Recommended order is sequential (Phase 1 → 6) so this does not arise.

**Verification gap:** notifications, auto-start, compose, and theme-follows-OS are only fully verifiable on Windows (per Global Constraints); the pure logic behind each is unit-tested so regressions surface without a GUI.
