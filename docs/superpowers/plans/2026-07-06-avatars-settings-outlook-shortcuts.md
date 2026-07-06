# Avatars, Settings Panel & Outlook Shortcuts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing Gmail wrapper with real profile avatars + auto-labels in the sidebar, a settings panel behind the ⚙ button (rename/recolor/remove accounts + toggle Outlook shortcuts), and comprehensive Outlook-for-Windows keyboard shortcuts mapped onto Gmail.

**Architecture:** A pure, context-aware key mapper (`outlook-shortcuts.ts`) is driven by an Electron `before-input-event` handler on each Gmail view; matched Outlook combos are `preventDefault`ed and the equivalent Gmail keystroke is injected via `sendInputEvent`. Identity (email/name/avatar) is scraped from the Gmail DOM by the preload and pushed to main → accounts store → sidebar. A minimal app menu frees the browser accelerators the shortcuts need. Settings live in a small JSON store; the settings panel is drawn by the renderer while main hides the active Gmail view.

**Tech Stack:** Electron 31, TypeScript (strict), Next.js 14 static export, Vitest, esbuild. Node 22.

## Global Constraints

- Node >= 22, npm >= 10; TypeScript `strict: true`.
- Pure logic modules (`outlook-shortcuts`, `settings-store`, `accounts-store`, preload helpers) contain NO Electron imports and are Vitest-testable under Node. Electron side effects stay guarded / lazily required.
- Account Gmail views: `contextIsolation: false`. Sidebar window: `contextIsolation: true` with the `window.desktop` bridge.
- Outlook combos are matched on the **Control** modifier (they are Windows shortcuts) regardless of host OS. Injected Gmail combos use `mod` = `control` on win/linux, `meta` on darwin.
- Run `next` from inside `renderer/` (never a dir-arg from root) — Tailwind config/CWD depends on it (`npm run build:renderer` already does `npm run build --prefix renderer`).
- Build gates for every task: `npx tsc --noEmit` clean, `npx vitest run` all pass, `npm run build` produces `dist-electron/{main,preload,sidebar-preload}.js` + `renderer/out/index.html`.
- GUI runtime cannot be launched in this sandbox (no display libs) — verify via build + typecheck + unit tests; note GUI steps as environment-limited, do not block.
- Commit after each task with a type-only Conventional Commit (no scope).

---

### Task 1: IPC channels + Account identity fields + `accounts-store.update`

**Files:**
- Modify: `electron/ipc.ts`
- Modify: `electron/accounts-store.ts`
- Test: `tests/accounts-store.test.ts`

**Interfaces:**
- Consumes: existing `IPC` object, existing `Account`/`AccountsStore`.
- Produces:
  - New `IPC` channels: `ACCOUNT_IDENTITY`, `EDITABLE_FOCUS`, `ACCOUNTS_UPDATE`, `SETTINGS_TOGGLE`, `SETTINGS_GET`, `SETTINGS_SET`.
  - `Account` gains optional `email?: string; name?: string; avatarUrl?: string`.
  - `AccountsStore.update(id: string, patch: Partial<Pick<Account,'label'|'color'|'email'|'name'|'avatarUrl'>>): Account | null`.

- [ ] **Step 1: Add the new IPC channels**

In `electron/ipc.ts`, add these entries inside the `IPC` object (keep existing ones):
```ts
  // Gmail view -> main
  ACCOUNT_IDENTITY: 'account:identity', // send({email,name,avatarUrl})
  EDITABLE_FOCUS: 'editable:focus', // send(boolean)
  // renderer (sidebar) -> main
  ACCOUNTS_UPDATE: 'accounts:update', // invoke(id, {label?,color?})
  SETTINGS_TOGGLE: 'settings:toggle', // send({open:boolean})
  SETTINGS_GET: 'settings:get', // invoke -> Settings
  SETTINGS_SET: 'settings:set', // invoke(patch) -> Settings
```

- [ ] **Step 2: Write the failing store tests**

Append to `tests/accounts-store.test.ts` (inside the existing `describe`):
```ts
  it('updates label and color of an existing account', () => {
    const a = store.add({ label: 'A', color: '#000' });
    const updated = store.update(a.id, { label: 'Work', color: '#EA4335' });
    expect(updated).toEqual({ ...a, label: 'Work', color: '#EA4335' });
    expect(store.list()[0]).toEqual({ ...a, label: 'Work', color: '#EA4335' });
  });

  it('persists identity fields via update', () => {
    const a = store.add({ label: 'A', color: '#000' });
    store.update(a.id, { email: 'me@gmail.com', name: 'Me', avatarUrl: 'https://x/y.png' });
    const reopened = new AccountsStore((store as unknown as { filePath: string }).filePath);
    expect(reopened.list()[0]).toMatchObject({
      email: 'me@gmail.com',
      name: 'Me',
      avatarUrl: 'https://x/y.png',
    });
  });

  it('returns null when updating a missing id', () => {
    expect(store.update('nope', { label: 'X' })).toBeNull();
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/accounts-store.test.ts`
Expected: FAIL — `store.update is not a function`.

- [ ] **Step 4: Implement the fields and `update`**

In `electron/accounts-store.ts`, extend the interface:
```ts
export interface Account {
  id: string;
  label: string;
  color: string;
  email?: string;
  name?: string;
  avatarUrl?: string;
}
```
Add this method to the `AccountsStore` class (after `remove`):
```ts
  update(
    id: string,
    patch: Partial<Pick<Account, 'label' | 'color' | 'email' | 'name' | 'avatarUrl'>>,
  ): Account | null {
    const accounts = this.list();
    const idx = accounts.findIndex((a) => a.id === id);
    if (idx === -1) return null;
    const updated = { ...accounts[idx], ...patch };
    accounts[idx] = updated;
    this.persist(accounts);
    return updated;
  }
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run tests/accounts-store.test.ts && npx tsc --noEmit`
Expected: all PASS; no type errors.

- [ ] **Step 6: Commit**

```bash
git add electron/ipc.ts electron/accounts-store.ts tests/accounts-store.test.ts
git commit -m "feat: add identity fields, accounts update, and new ipc channels"
```

---

### Task 2: `settings-store` — persisted app settings

**Files:**
- Create: `electron/settings-store.ts`
- Test: `tests/settings-store.test.ts`

**Interfaces:**
- Consumes: nothing (Node `fs` only).
- Produces:
  - `interface Settings { outlookShortcuts: boolean }`
  - `class SettingsStore` — `new SettingsStore(filePath)`, `get(): Settings`, `set(patch: Partial<Settings>): Settings`. Default `{ outlookShortcuts: true }`.

- [ ] **Step 1: Write the failing tests**

`tests/settings-store.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SettingsStore } from '../electron/settings-store';

function newStore() {
  const dir = mkdtempSync(join(tmpdir(), 'settings-'));
  return new SettingsStore(join(dir, 'settings.json'));
}

describe('SettingsStore', () => {
  let store: SettingsStore;
  beforeEach(() => {
    store = newStore();
  });

  it('defaults outlookShortcuts to true', () => {
    expect(store.get()).toEqual({ outlookShortcuts: true });
  });

  it('persists a changed setting across instances', () => {
    store.set({ outlookShortcuts: false });
    const reopened = new SettingsStore((store as unknown as { filePath: string }).filePath);
    expect(reopened.get()).toEqual({ outlookShortcuts: false });
  });

  it('returns the merged settings from set', () => {
    expect(store.set({ outlookShortcuts: false })).toEqual({ outlookShortcuts: false });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/settings-store.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Implement**

`electron/settings-store.ts`:
```ts
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface Settings {
  outlookShortcuts: boolean;
}

const DEFAULTS: Settings = { outlookShortcuts: true };

export class SettingsStore {
  constructor(private readonly filePath: string) {}

  get(): Settings {
    if (!existsSync(this.filePath)) return { ...DEFAULTS };
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8'));
      return { ...DEFAULTS, ...(parsed as Partial<Settings>) };
    } catch {
      return { ...DEFAULTS };
    }
  }

  set(patch: Partial<Settings>): Settings {
    const next = { ...this.get(), ...patch };
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(next, null, 2), 'utf8');
    return next;
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/settings-store.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/settings-store.ts tests/settings-store.test.ts
git commit -m "feat: add persisted settings store"
```

---

### Task 3: `outlook-shortcuts` — the pure, context-aware key mapper

**Files:**
- Create: `electron/outlook-shortcuts.ts`
- Test: `tests/outlook-shortcuts.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface KeyInput { type: string; key: string; control: boolean; shift: boolean; alt: boolean; meta: boolean }`
  - `interface InjectKey { key: string; shift?: boolean; mod?: boolean }`
  - `interface MapResult { preventDefault: boolean; inject: InjectKey[] | null }`
  - `mapKey(input: KeyInput, editableFocused: boolean): MapResult` — matches Outlook combos (Control-based) and returns the Gmail injection. Non-matches return `{ preventDefault: false, inject: null }`. Only acts on `type === 'keyDown'`.
  - `toSendInputEvents(keys: InjectKey[], platform: NodeJS.Platform): Array<{ keyCode: string; modifiers: string[] }>` — expands `mod` to `control`/`meta` and `shift` to `'shift'`.

- [ ] **Step 1: Write the failing tests**

`tests/outlook-shortcuts.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { mapKey, toSendInputEvents, type KeyInput } from '../electron/outlook-shortcuts';

const base: KeyInput = { type: 'keyDown', key: '', control: false, shift: false, alt: false, meta: false };
const k = (over: Partial<KeyInput>): KeyInput => ({ ...base, ...over });

describe('mapKey — list context (not editable)', () => {
  it('maps Ctrl+R to reply (r) and prevents default', () => {
    expect(mapKey(k({ key: 'r', control: true }), false)).toEqual({
      preventDefault: true,
      inject: [{ key: 'r' }],
    });
  });
  it('maps Ctrl+Shift+R to reply all (a)', () => {
    expect(mapKey(k({ key: 'R', control: true, shift: true }), false)).toEqual({
      preventDefault: true,
      inject: [{ key: 'a' }],
    });
  });
  it('maps Delete to # (Shift+3)', () => {
    expect(mapKey(k({ key: 'Delete' }), false)).toEqual({
      preventDefault: true,
      inject: [{ key: '3', shift: true }],
    });
  });
  it('maps Ctrl+Shift+I to the go-to-inbox sequence g,i', () => {
    expect(mapKey(k({ key: 'I', control: true, shift: true }), false)).toEqual({
      preventDefault: true,
      inject: [{ key: 'g' }, { key: 'i' }],
    });
  });
  it('maps Ctrl+Q to mark-read (Shift+i)', () => {
    expect(mapKey(k({ key: 'q', control: true }), false)).toEqual({
      preventDefault: true,
      inject: [{ key: 'i', shift: true }],
    });
  });
  it('passes plain letter through', () => {
    expect(mapKey(k({ key: 'x' }), false)).toEqual({ preventDefault: false, inject: null });
  });
});

describe('mapKey — compose context (editable)', () => {
  it('maps Ctrl+R to align-right (mod+shift+r), NOT reply', () => {
    expect(mapKey(k({ key: 'r', control: true }), true)).toEqual({
      preventDefault: true,
      inject: [{ key: 'r', shift: true, mod: true }],
    });
  });
  it('does not intercept Ctrl+B (native bold)', () => {
    expect(mapKey(k({ key: 'b', control: true }), true)).toEqual({
      preventDefault: false,
      inject: null,
    });
  });
  it('maps Alt+S to send (mod+Enter)', () => {
    expect(mapKey(k({ key: 's', alt: true }), true)).toEqual({
      preventDefault: true,
      inject: [{ key: 'Enter', mod: true }],
    });
  });
  it('Delete is not intercepted while editable (normal text delete)', () => {
    expect(mapKey(k({ key: 'Delete' }), true)).toEqual({ preventDefault: false, inject: null });
  });
});

describe('mapKey — ignores non-keydown', () => {
  it('returns pass-through for keyUp', () => {
    expect(mapKey(k({ key: 'r', control: true, type: 'keyUp' }), false)).toEqual({
      preventDefault: false,
      inject: null,
    });
  });
});

describe('toSendInputEvents', () => {
  it('uses control on linux and shift when set', () => {
    expect(toSendInputEvents([{ key: 'Enter', mod: true }], 'linux')).toEqual([
      { keyCode: 'Enter', modifiers: ['control'] },
    ]);
    expect(toSendInputEvents([{ key: 'i', shift: true }], 'linux')).toEqual([
      { keyCode: 'i', modifiers: ['shift'] },
    ]);
  });
  it('uses meta on darwin for mod', () => {
    expect(toSendInputEvents([{ key: 'Enter', mod: true }], 'darwin')).toEqual([
      { keyCode: 'Enter', modifiers: ['meta'] },
    ]);
  });
  it('expands a sequence in order', () => {
    expect(toSendInputEvents([{ key: 'g' }, { key: 'i' }], 'linux')).toEqual([
      { keyCode: 'g', modifiers: [] },
      { keyCode: 'i', modifiers: [] },
    ]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/outlook-shortcuts.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the mapper**

`electron/outlook-shortcuts.ts`:
```ts
export interface KeyInput {
  type: string;
  key: string;
  control: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
}

export interface InjectKey {
  key: string;
  shift?: boolean;
  mod?: boolean; // control on win/linux, meta on darwin
}

export interface MapResult {
  preventDefault: boolean;
  inject: InjectKey[] | null;
}

const PASS: MapResult = { preventDefault: false, inject: null };
const hit = (...inject: InjectKey[]): MapResult => ({ preventDefault: true, inject });

// Only Control-based (Outlook-for-Windows) combos and specific bare keys are matched.
function mapList(key: string, ctrl: boolean, shift: boolean): MapResult {
  if (ctrl && shift) {
    if (key === 'm') return hit({ key: 'c' });
    if (key === 'r') return hit({ key: 'a' });
    if (key === 'v') return hit({ key: 'v' });
    if (key === 'd') return hit({ key: 'm' });
    if (key === 'i') return hit({ key: 'g' }, { key: 'i' });
  }
  if (ctrl && !shift) {
    if (key === 'n') return hit({ key: 'c' });
    if (key === 'r') return hit({ key: 'r' });
    if (key === 'f') return hit({ key: 'f' });
    if (key === 'o') return hit({ key: 'o' });
    if (key === 'q') return hit({ key: 'i', shift: true });
    if (key === 'u') return hit({ key: 'u', shift: true });
    if (key === 'z') return hit({ key: 'z' });
    if (key === 'a') return hit({ key: '8', shift: true }, { key: 'a' });
    if (key === 'e') return hit({ key: '/' });
    if (key === '1') return hit({ key: 'g' }, { key: 'i' });
    if (key === '.') return hit({ key: 'n' });
    if (key === ',') return hit({ key: 'p' });
    if (key === ' ') return hit({ key: 'x' });
  }
  if (!ctrl && !shift) {
    if (key === 'delete') return hit({ key: '3', shift: true });
    if (key === 'backspace') return hit({ key: 'e' });
    if (key === 'insert') return hit({ key: 's' });
    if (key === 'f3') return hit({ key: '/' });
    if (key === 'arrowdown') return hit({ key: 'j' });
    if (key === 'arrowup') return hit({ key: 'k' });
  }
  return PASS;
}

function mapCompose(key: string, ctrl: boolean, shift: boolean, alt: boolean): MapResult {
  if (alt && key === 's') return hit({ key: 'Enter', mod: true });
  if (ctrl && shift) {
    if (key === 'l') return hit({ key: '8', shift: true, mod: true });
    if (key === 't') return hit({ key: '[', mod: true });
    if (key === 'd') return hit({ key: 'd', shift: true, mod: true });
  }
  if (ctrl && !shift) {
    if (key === 't') return hit({ key: ']', mod: true });
    if (key === 'l') return hit({ key: 'l', shift: true, mod: true });
    if (key === 'e') return hit({ key: 'e', shift: true, mod: true });
    if (key === 'r') return hit({ key: 'r', shift: true, mod: true });
    if (key === ' ') return hit({ key: '\\', mod: true });
  }
  // Ctrl+B/I/U/K and Ctrl+Enter are left native → pass through.
  return PASS;
}

export function mapKey(input: KeyInput, editableFocused: boolean): MapResult {
  if (input.type !== 'keyDown') return PASS;
  const key = input.key.toLowerCase();
  return editableFocused
    ? mapCompose(key, input.control, input.shift, input.alt)
    : mapList(key, input.control, input.shift);
}

export function toSendInputEvents(
  keys: InjectKey[],
  platform: NodeJS.Platform,
): Array<{ keyCode: string; modifiers: string[] }> {
  const modKey = platform === 'darwin' ? 'meta' : 'control';
  return keys.map((k) => {
    const modifiers: string[] = [];
    if (k.mod) modifiers.push(modKey);
    if (k.shift) modifiers.push('shift');
    return { keyCode: k.key, modifiers };
  });
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/outlook-shortcuts.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add electron/outlook-shortcuts.ts tests/outlook-shortcuts.test.ts
git commit -m "feat: add context-aware outlook-to-gmail key mapper"
```

---

### Task 4: Minimal application menu

**Files:**
- Create: `electron/menu.ts`
- Test: `tests/menu.test.ts`

**Interfaces:**
- Consumes: nothing at module top (lazy `require('electron')` inside `installMenu`).
- Produces:
  - `menuTemplate(): Array<{ role?: string; label?: string; submenu?: unknown[] }>` — pure, returns the template (Edit roles for text fields + Quit; NO reload/devtools/newwindow/tab accelerators).
  - `installMenu(): void` — builds the template into a `Menu` and calls `Menu.setApplicationMenu`; also registers F12 → toggle DevTools on the focused window (dev aid, non-colliding).

- [ ] **Step 1: Write the failing test (pure template)**

`tests/menu.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { menuTemplate } from '../electron/menu';

describe('menuTemplate', () => {
  it('provides an Edit submenu with clipboard roles', () => {
    const template = menuTemplate();
    const edit = template.find((m) => m.label === 'Edit');
    const roles = (edit?.submenu ?? []).map((i) => (i as { role?: string }).role);
    for (const r of ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']) {
      expect(roles).toContain(r);
    }
  });
  it('does NOT bind reload, forceReload, or toggleDevTools roles (they steal Outlook shortcuts)', () => {
    const roles = menuTemplate()
      .flatMap((m) => (m.submenu ?? []) as Array<{ role?: string }>)
      .map((i) => i.role);
    expect(roles).not.toContain('reload');
    expect(roles).not.toContain('forceReload');
    expect(roles).not.toContain('toggleDevTools');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/menu.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`electron/menu.ts`:
```ts
export function menuTemplate(): Array<{ role?: string; label?: string; submenu?: unknown[] }> {
  return [
    {
      label: 'App',
      submenu: [{ role: 'quit' }],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
  ];
}

export function installMenu(): void {
  const { Menu, globalShortcut, BrowserWindow } = require('electron') as typeof import('electron');
  const menu = Menu.buildFromTemplate(menuTemplate() as Electron.MenuItemConstructorOptions[]);
  Menu.setApplicationMenu(menu);
  // Non-colliding DevTools toggle for debugging (F12 is not an Outlook shortcut).
  globalShortcut.register('F12', () => {
    BrowserWindow.getFocusedWindow()?.webContents.toggleDevTools();
  });
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/menu.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/menu.ts tests/menu.test.ts
git commit -m "feat: add minimal app menu freeing browser accelerators"
```

---

### Task 5: Preload — identity scrape + editable-focus reporting

**Files:**
- Modify: `electron/preload.ts`
- Test: `tests/preload-identity.test.ts`

**Interfaces:**
- Consumes: `IPC` (Task 1).
- Produces (exported pure helpers, testable under Node):
  - `extractIdentity(doc: { querySelector(sel: string): any }): { email: string; name: string; avatarUrl: string } | null`
  - `isEditableTarget(el: { tagName?: string; isContentEditable?: boolean } | null | undefined): boolean`
  - Guarded side effects: poll for identity (max 15×, 1s apart) and send `IPC.ACCOUNT_IDENTITY`; on `focusin`/`focusout` send `IPC.EDITABLE_FOCUS` with `isEditableTarget(document.activeElement)`.

- [ ] **Step 1: Write the failing tests**

`tests/preload-identity.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { extractIdentity, isEditableTarget } from '../electron/preload';

function fakeDoc(ariaLabel: string | null, imgSrc: string | null) {
  return {
    querySelector(sel: string) {
      if (sel.startsWith('a[')) {
        if (ariaLabel === null) return null;
        return {
          getAttribute: (n: string) => (n === 'aria-label' ? ariaLabel : null),
          querySelector: () => (imgSrc === null ? null : { getAttribute: () => imgSrc }),
        };
      }
      return null;
    },
  };
}

describe('extractIdentity', () => {
  it('pulls email, name and avatar from the account anchor', () => {
    const doc = fakeDoc(
      'Google Account: Ada Lovelace (ada@gmail.com)',
      'https://lh3.googleusercontent.com/a/pic',
    );
    expect(extractIdentity(doc)).toEqual({
      email: 'ada@gmail.com',
      name: 'Ada Lovelace',
      avatarUrl: 'https://lh3.googleusercontent.com/a/pic',
    });
  });
  it('returns null when the anchor is absent', () => {
    expect(extractIdentity(fakeDoc(null, null))).toBeNull();
  });
});

describe('isEditableTarget', () => {
  it('is true for input, textarea and contenteditable', () => {
    expect(isEditableTarget({ tagName: 'INPUT' })).toBe(true);
    expect(isEditableTarget({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isEditableTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
  });
  it('is false for a plain element or null', () => {
    expect(isEditableTarget({ tagName: 'DIV' })).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/preload-identity.test.ts`
Expected: FAIL — `extractIdentity` not exported.

- [ ] **Step 3: Add the helpers and guarded wiring**

In `electron/preload.ts`, add these exports near the top (after the existing imports, before the `if (typeof document !== 'undefined')` block):
```ts
export function extractIdentity(
  doc: { querySelector(sel: string): any },
): { email: string; name: string; avatarUrl: string } | null {
  const anchor = doc.querySelector('a[aria-label^="Google Account"]');
  if (!anchor) return null;
  const label: string = anchor.getAttribute('aria-label') || '';
  const email = (label.match(/\S+@\S+\.\S+/) || [''])[0].replace(/[()]/g, '');
  const name = label
    .replace(/^Google Account:?\s*/i, '')
    .split('(')[0]
    .trim();
  const img = anchor.querySelector('img');
  const avatarUrl: string = (img && img.getAttribute('src')) || '';
  if (!email && !avatarUrl) return null;
  return { email, name, avatarUrl };
}

export function isEditableTarget(
  el: { tagName?: string; isContentEditable?: boolean } | null | undefined,
): boolean {
  if (!el) return false;
  const tag = (el.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || el.isContentEditable === true;
}
```

Then, inside the existing `if (typeof document !== 'undefined') { ... }` block (which already lazily `require`s `ipcRenderer` and defines `start`), add to the `start` function body:
```ts
    // Report editable-focus so the main process can disambiguate shortcuts.
    const reportFocus = () =>
      ipcRenderer.send(IPC.EDITABLE_FOCUS, isEditableTarget(document.activeElement));
    document.addEventListener('focusin', reportFocus);
    document.addEventListener('focusout', reportFocus);
    reportFocus();

    // Poll for the signed-in identity and report it once found.
    let identityTries = 0;
    const identityTimer = setInterval(() => {
      identityTries += 1;
      const identity = extractIdentity(document);
      if (identity) {
        ipcRenderer.send(IPC.ACCOUNT_IDENTITY, identity);
        clearInterval(identityTimer);
      } else if (identityTries >= 15) {
        clearInterval(identityTimer);
      }
    }, 1000);
```

- [ ] **Step 4: Run tests + full suite + typecheck**

Run: `npx vitest run tests/preload-identity.test.ts && npx vitest run && npx tsc --noEmit`
Expected: new tests PASS; full suite PASS; no type errors.
> The helpers must stay importable under Node — they take a `doc` argument and never touch a global `document`, so Vitest (node env) loads them fine; the polling/focus code lives only inside the `typeof document !== 'undefined'` guard.

- [ ] **Step 5: Commit**

```bash
git add electron/preload.ts tests/preload-identity.test.ts
git commit -m "feat: scrape gmail identity and report editable focus from preload"
```

---

### Task 6: View manager — shortcut interception + identity/focus forwarding + settings hide/show

**Files:**
- Modify: `electron/account-view-manager.ts`

**Interfaces:**
- Consumes: `mapKey`, `toSendInputEvents`, `KeyInput` (Task 3); `IPC` (Task 1).
- Produces (new/changed on `AccountViewManager`):
  - Constructor gains two callbacks after the existing ones: `onIdentity: (accountId: string, identity: { email: string; name: string; avatarUrl: string }) => void`.
  - `setShortcutsEnabled(enabled: boolean): void`.
  - `hideAll(): void` and `showActive(): void` (for the settings panel).
  - Internal: per-account `editableFocused` map; a `before-input-event` handler per view using `mapKey` + `toSendInputEvents` + `sendInputEvent`, gated on `shortcutsEnabled` and the account's `editableFocused`.

- [ ] **Step 1: Add imports and fields**

In `electron/account-view-manager.ts` add to the imports:
```ts
import { mapKey, toSendInputEvents, type KeyInput } from './outlook-shortcuts';
```
Add fields to the class (near `private views` / `activeId`):
```ts
  private editableFocused = new Map<string, boolean>();
  private shortcutsEnabled = true;
```
Extend the constructor signature to accept `onIdentity` (add as the last parameter, keep the existing ones):
```ts
    private readonly onIdentity: (
      accountId: string,
      identity: { email: string; name: string; avatarUrl: string },
    ) => void,
```

- [ ] **Step 2: Handle the new ipc-messages and attach before-input-event**

In `ensureView`, extend the existing `view.webContents.on('ipc-message', ...)` handler to also route the new channels:
```ts
    view.webContents.on('ipc-message', (_e, channel, ...args) => {
      if (channel === IPC.UNREAD_UPDATE) {
        this.onUnread(account.id, Number(args[0]) || 0);
      } else if (channel === IPC.NOTIFICATION_ACTIVATE) {
        this.onActivate(account.id);
      } else if (channel === IPC.ACCOUNT_IDENTITY) {
        this.onIdentity(account.id, args[0]);
      } else if (channel === IPC.EDITABLE_FOCUS) {
        this.editableFocused.set(account.id, Boolean(args[0]));
      }
    });
```
Immediately after that handler (still inside `ensureView`), attach the shortcut interceptor:
```ts
    view.webContents.on('before-input-event', (event, input) => {
      if (!this.shortcutsEnabled) return;
      const editable = this.editableFocused.get(account.id) ?? false;
      const result = mapKey(input as unknown as KeyInput, editable);
      if (!result.preventDefault) return;
      event.preventDefault();
      if (!result.inject) return;
      for (const ev of toSendInputEvents(result.inject, process.platform)) {
        view.webContents.sendInputEvent({ type: 'keyDown', keyCode: ev.keyCode, modifiers: ev.modifiers as Electron.MouseInputEvent['modifiers'] });
        view.webContents.sendInputEvent({ type: 'keyUp', keyCode: ev.keyCode, modifiers: ev.modifiers as Electron.MouseInputEvent['modifiers'] });
      }
    });
```

- [ ] **Step 3: Add the control methods**

Add these methods to the class (after `relayout`):
```ts
  setShortcutsEnabled(enabled: boolean): void {
    this.shortcutsEnabled = enabled;
  }

  hideAll(): void {
    for (const v of this.views.values()) v.setVisible(false);
  }

  showActive(): void {
    if (this.activeId) this.show(this.activeId);
  }
```
Also clean up the focus map in `removeView` (add alongside the existing deletions):
```ts
    this.editableFocused.delete(accountId);
```

- [ ] **Step 4: Typecheck + build + full suite**

Run: `npx tsc --noEmit && npm run build && npx vitest run`
Expected: no type errors; build succeeds; suite green. (This file has no unit test of its own — it is thin Electron wiring over the tested `mapKey`; correctness of the mapping is covered by Task 3, and the wiring is verified by the build.)
> GUI runtime (actually pressing keys in Gmail) cannot be exercised in this sandbox — environment limitation, do not block.

- [ ] **Step 5: Commit**

```bash
git add electron/account-view-manager.ts
git commit -m "feat: intercept outlook shortcuts and forward identity/focus per view"
```

---

### Task 7: Main process — settings, menu, and new IPC handlers

**Files:**
- Modify: `electron/main.ts`

**Interfaces:**
- Consumes: `SettingsStore` (Task 2), `installMenu` (Task 4), `AccountViewManager` new API (Task 6), new `IPC` channels (Task 1).
- Produces: full IPC handling for update/settings/settings-toggle; identity → store → renderer; menu installed; shortcuts toggle wired live.

- [ ] **Step 1: Add imports and settings state**

In `electron/main.ts` add imports:
```ts
import { SettingsStore } from './settings-store';
import { installMenu } from './menu';
```
Add module-level state near `let store`:
```ts
let settings: SettingsStore | null = null;
```

- [ ] **Step 2: Initialise settings + pass identity callback to the manager**

Inside `createWindow`, where `store` and `manager` are created, initialise settings first and add the `onIdentity` callback as the new last argument to `new AccountViewManager(...)`:
```ts
  store = new AccountsStore(join(app.getPath('userData'), 'accounts.json'));
  settings = new SettingsStore(join(app.getPath('userData'), 'settings.json'));
  manager = new AccountViewManager(
    mainWindow,
    PRELOAD_PATH,
    (accountId, count) => {
      unreadCounts[accountId] = count;
      pushUnread();
      applyBadge(unreadCounts, (n) => app.setBadgeCount(n));
    },
    (accountId) => activate(accountId),
    (accountId, identity) => {
      const patch: { email: string; name: string; avatarUrl: string; label?: string } = { ...identity };
      const existing = store!.list().find((a) => a.id === accountId);
      if (existing && (existing.label === 'Account' || !existing.label)) patch.label = identity.email || existing.label;
      store!.update(accountId, patch);
      pushAccounts();
    },
  );
  manager.setShortcutsEnabled(settings.get().outlookShortcuts);
```

- [ ] **Step 3: Register the new IPC handlers**

In `registerIpc()`, add:
```ts
  ipcMain.handle(IPC.ACCOUNTS_UPDATE, (_e, id: string, patch: { label?: string; color?: string }) => {
    const updated = store!.update(id, patch);
    pushAccounts();
    return updated;
  });
  ipcMain.on(IPC.SETTINGS_TOGGLE, (_e, arg: { open: boolean }) => {
    if (arg.open) manager?.hideAll();
    else manager?.showActive();
  });
  ipcMain.handle(IPC.SETTINGS_GET, () => settings!.get());
  ipcMain.handle(IPC.SETTINGS_SET, (_e, patch: { outlookShortcuts?: boolean }) => {
    const next = settings!.set(patch);
    manager?.setShortcutsEnabled(next.outlookShortcuts);
    return next;
  });
```

- [ ] **Step 4: Install the menu**

In the `app.whenReady().then(...)` callback, add `installMenu();` immediately after `registerIpc();`:
```ts
  registerAppProtocol();
  registerIpc();
  installMenu();
  createWindow();
```

- [ ] **Step 5: Typecheck + build**

Run: `npx tsc --noEmit && npm run build && npx vitest run`
Expected: no type errors; build produces all three bundles; suite green.

- [ ] **Step 6: Commit**

```bash
git add electron/main.ts
git commit -m "feat: wire settings, menu, identity and account-update ipc in main"
```

---

### Task 8: Sidebar bridge — expose update/settings methods

**Files:**
- Modify: `electron/sidebar-preload.ts`

**Interfaces:**
- Consumes: `IPC` (Task 1).
- Produces: `window.desktop` gains `updateAccount(id, patch)`, `toggleSettings(open)`, `getSettings()`, `setSettings(patch)`.

- [ ] **Step 1: Add the bridge methods**

In `electron/sidebar-preload.ts`, add these inside the object passed to `contextBridge.exposeInMainWorld('desktop', { ... })`:
```ts
  updateAccount: (id: string, patch: { label?: string; color?: string }): Promise<Account | null> =>
    ipcRenderer.invoke(IPC.ACCOUNTS_UPDATE, id, patch),
  toggleSettings: (open: boolean): void => ipcRenderer.send(IPC.SETTINGS_TOGGLE, { open }),
  getSettings: (): Promise<{ outlookShortcuts: boolean }> => ipcRenderer.invoke(IPC.SETTINGS_GET),
  setSettings: (patch: { outlookShortcuts?: boolean }): Promise<{ outlookShortcuts: boolean }> =>
    ipcRenderer.invoke(IPC.SETTINGS_SET, patch),
```

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: no type errors; `dist-electron/sidebar-preload.js` rebuilt.

- [ ] **Step 3: Commit**

```bash
git add electron/sidebar-preload.ts
git commit -m "feat: expose account-update and settings methods on the sidebar bridge"
```

---

### Task 9: Renderer — avatars + settings panel

**Files:**
- Modify: `renderer/app/page.tsx`
- Create: `renderer/app/SettingsPanel.tsx`

**Interfaces:**
- Consumes: the `window.desktop` bridge (Tasks 1, 8) and the `Account` shape now carrying `email/name/avatarUrl`.
- Produces: sidebar buttons render the avatar image (fallback to the colored letter), the ⚙ opens the settings panel, and the panel manages accounts + the shortcuts toggle.

- [ ] **Step 1: Extend the bridge/type declarations in `page.tsx`**

In `renderer/app/page.tsx`, extend the `Account` interface and the `DesktopBridge` interface:
```ts
interface Account {
  id: string;
  label: string;
  color: string;
  email?: string;
  name?: string;
  avatarUrl?: string;
}
```
Add to `DesktopBridge`:
```ts
  updateAccount(id: string, patch: { label?: string; color?: string }): Promise<Account | null>;
  toggleSettings(open: boolean): void;
  getSettings(): Promise<{ outlookShortcuts: boolean }>;
  setSettings(patch: { outlookShortcuts?: boolean }): Promise<{ outlookShortcuts: boolean }>;
```

- [ ] **Step 2: Render avatars with a letter fallback**

In `renderer/app/page.tsx`, replace the account button's inner content (the `{a.label.charAt(0).toUpperCase()}` line) with an avatar-or-letter render, and set the tooltip to the email. Replace the button element's body:
```tsx
            title={a.email || a.label}
            className={`relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-full text-sm font-semibold text-white transition ${
              active === a.id ? 'ring-2 ring-white' : 'opacity-80 hover:opacity-100'
            }`}
            style={{ backgroundColor: a.color }}
          >
            {a.avatarUrl ? (
              <img
                src={a.avatarUrl}
                alt={a.email || a.label}
                referrerPolicy="no-referrer"
                className="h-full w-full object-cover"
              />
            ) : (
              (a.label || 'A').charAt(0).toUpperCase()
            )}
```
(Keep the existing unread badge `<span>` and the `key`/`onClick` on the button.)

- [ ] **Step 3: Add settings state and open the panel from ⚙**

In the `Sidebar` component add state and a handler:
```tsx
  const [settingsOpen, setSettingsOpen] = useState(false);
  function openSettings() {
    setSettingsOpen(true);
    window.desktop?.toggleSettings(true);
  }
  function closeSettings() {
    setSettingsOpen(false);
    window.desktop?.toggleSettings(false);
  }
```
Change the gear `<button>` to call `openSettings` (add `onClick={openSettings}`). After the `<nav>` element (still inside the root `<div>`), render the panel:
```tsx
      {settingsOpen && (
        <SettingsPanel
          accounts={accounts}
          onClose={closeSettings}
          onChanged={(list) => setAccounts(list)}
        />
      )}
```
Add the import at the top of `page.tsx`:
```tsx
import { SettingsPanel } from './SettingsPanel';
```

- [ ] **Step 4: Create the settings panel component**

`renderer/app/SettingsPanel.tsx`:
```tsx
'use client';

import { useEffect, useState } from 'react';

interface Account {
  id: string;
  label: string;
  color: string;
  email?: string;
  name?: string;
  avatarUrl?: string;
}

const SWATCHES = ['#4285F4', '#EA4335', '#34A853', '#FBBC05', '#A142F4', '#00ACC1'];

export function SettingsPanel({
  accounts,
  onClose,
  onChanged,
}: {
  accounts: Account[];
  onClose: () => void;
  onChanged: (list: Account[]) => void;
}) {
  const [shortcuts, setShortcuts] = useState(true);

  useEffect(() => {
    window.desktop?.getSettings().then((s) => setShortcuts(s.outlookShortcuts));
  }, []);

  async function rename(id: string, label: string) {
    await window.desktop?.updateAccount(id, { label });
    onChanged(accounts.map((a) => (a.id === id ? { ...a, label } : a)));
  }
  async function recolor(id: string, color: string) {
    await window.desktop?.updateAccount(id, { color });
    onChanged(accounts.map((a) => (a.id === id ? { ...a, color } : a)));
  }
  async function remove(id: string) {
    await window.desktop?.removeAccount(id);
    onChanged(accounts.filter((a) => a.id !== id));
  }
  async function toggleShortcuts(next: boolean) {
    setShortcuts(next);
    await window.desktop?.setSettings({ outlookShortcuts: next });
  }

  return (
    <div className="flex h-screen flex-1 flex-col overflow-y-auto bg-neutral-900 p-8 text-neutral-100">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Settings</h1>
        <button onClick={onClose} className="rounded bg-neutral-800 px-3 py-1 text-sm hover:bg-neutral-700">
          Close
        </button>
      </div>

      <h2 className="mb-2 text-sm uppercase tracking-wide text-neutral-400">Accounts</h2>
      <div className="mb-8 flex flex-col gap-3">
        {accounts.map((a) => (
          <div key={a.id} className="flex items-center gap-3 rounded bg-neutral-800 p-3">
            <span className="h-8 w-8 shrink-0 overflow-hidden rounded-full" style={{ backgroundColor: a.color }}>
              {a.avatarUrl && (
                <img src={a.avatarUrl} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
              )}
            </span>
            <input
              defaultValue={a.label}
              onBlur={(e) => rename(a.id, e.target.value)}
              className="flex-1 rounded bg-neutral-700 px-2 py-1 text-sm"
            />
            <div className="flex gap-1">
              {SWATCHES.map((c) => (
                <button
                  key={c}
                  onClick={() => recolor(a.id, c)}
                  aria-label={`color ${c}`}
                  className="h-5 w-5 rounded-full ring-white hover:ring-2"
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <button
              onClick={() => remove(a.id)}
              className="rounded bg-red-700 px-2 py-1 text-xs hover:bg-red-600"
            >
              Remove
            </button>
          </div>
        ))}
        {accounts.length === 0 && <p className="text-sm text-neutral-400">No accounts yet.</p>}
      </div>

      <h2 className="mb-2 text-sm uppercase tracking-wide text-neutral-400">Shortcuts</h2>
      <label className="flex items-center gap-3 text-sm">
        <input type="checkbox" checked={shortcuts} onChange={(e) => toggleShortcuts(e.target.checked)} />
        Enable Outlook keyboard shortcuts
      </label>
      <p className="mt-2 max-w-prose text-xs text-neutral-400">
        For these to work, turn on Gmail keyboard shortcuts in Gmail: Settings → See all settings →
        General → Keyboard shortcuts on.
      </p>
    </div>
  );
}
```

- [ ] **Step 5: Build the renderer and verify styles + component compile**

Run: `npm run build:renderer`
Expected: `✓ Compiled successfully`; no "content is missing or empty" warning; `renderer/out/index.html` present.

- [ ] **Step 6: Full build + typecheck + tests**

Run: `npm run build && npx tsc --noEmit && npx vitest run`
Expected: all bundles produced; no type errors; suite green.
> GUI verification (clicking ⚙, seeing avatars) is environment-limited in this sandbox.

- [ ] **Step 7: Commit**

```bash
git add renderer/app/page.tsx renderer/app/SettingsPanel.tsx
git commit -m "feat: render profile avatars and add the settings panel"
```

---

## Self-Review Notes

- **Spec coverage:** avatars + auto-label (Tasks 1,5,9) · identity IPC (1,5,6,7) · settings store (2) · settings panel with rename/recolor/remove + shortcuts toggle (7,8,9) · settings hide/show of Gmail view (6,7) · Outlook→Gmail context-aware mapper full tables (3) · before-input-event interception + inject (6) · menu hardening (4,7) · editable-focus disambiguation (5,6) · shortcut on/off live (2,7). All spec sections map to a task.
- **Placeholder scan:** every code step contains complete code; no TBD/TODO; the view-manager and main edits show exact code; no "similar to" references.
- **Type consistency:** `Account` (with `email/name/avatarUrl`) identical across `accounts-store.ts`, `page.tsx`, `SettingsPanel.tsx`. `mapKey`/`toSendInputEvents`/`KeyInput`/`InjectKey` names match between Task 3 and Task 6. `DesktopBridge` additions in Task 9 match the `window.desktop` methods exposed in Task 8. IPC channel constants (Task 1) are the single source used by preload (5), view manager (6), main (7), and sidebar bridge (8).
- **Known runtime caveat (carried from spec):** GUI/keyboard behavior can't be exercised in this sandbox; the pure mapper + stores carry the tested logic, Electron wiring is verified by build/typecheck.
