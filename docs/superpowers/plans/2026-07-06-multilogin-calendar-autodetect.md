# Google Multi-Login, Auto-Detect & Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace manual isolated-session accounts with one shared Google session whose signed-in accounts are auto-detected as profiles, each exposing Gmail and Google Calendar surfaces toggled from the sidebar.

**Architecture:** All views share one `persist:google` session. A profile is `{index,email,name,avatarUrl,color}` detected by probing `/mail/u/N/` and scraping identity (existing preload). A rewritten `ProfileViewManager` owns lazily-created Mail + Calendar `WebContentsView`s keyed by `index:surface`. Main drives detection with a pure `detection-planner`; the sidebar renders one avatar + calendar icon per profile.

**Tech Stack:** Electron 31, TypeScript strict, Next.js 14 static export, Vitest, esbuild. Node 22.

## Global Constraints

- TypeScript `strict: true`; pure modules (`google-urls`, `palette`, `detection-planner`, `color-store`, existing identity parser) have NO Electron imports and are Vitest-tested under Node.
- One shared session partition `persist:google` for every view. Account addressing via authuser index: Mail `https://mail.google.com/mail/u/${index}/`, Calendar `https://calendar.google.com/calendar/u/${index}/r`.
- Account Gmail/Calendar views: `contextIsolation: false` (trusted Google domains only), reusing the existing `preload.js`.
- `Profile` shape is identical everywhere: `{ index: number; email: string; name: string; avatarUrl: string; color: string }`.
- Detection stops when a probed index yields an already-seen email (Google redirected an invalid index to account 0) or no identity within a timeout; hard cap 10.
- Run `next` from inside `renderer/` (`npm run build:renderer` already does `npm run build --prefix renderer`).
- Build gates each task: `npx tsc --noEmit` (root) + `cd renderer && npx tsc --noEmit` clean where the renderer changed; `npx vitest run` all pass; `npm run build` produces `dist-electron/{main,preload,sidebar-preload}.js` + `renderer/out/index.html` (no Tailwind "content missing" warning).
- GUI runtime is not launchable in the build sandbox — verify pure logic + build/typecheck; GUI behavior is verified by the user (Task 1 gate).
- Commit after each task with a type-only Conventional Commit (no scope).

---

### Task 1: PREREQUISITE GATE — verify identity/avatar detection works

**This task is a hard gate. Do NOT start Task 2+ until the user confirms it passes.** Everything downstream depends on scraping identity from the Gmail page; that has never been visually confirmed.

- [ ] **Step 1: Build and launch on the user's machine**

Ask the user to run:
```bash
./run-dev.sh
```
Log into Gmail in the account view.

- [ ] **Step 2: Confirm identity detection**

Expected within ~15s of the inbox loading: the sidebar account button shows the **real Google profile picture** (not the letter), and hovering shows the **email address** as tooltip.

- [ ] **Step 3: Decision gate**

- **PASS** (avatar + email appear) → identity scraping works; proceed to Task 2.
- **FAIL** (still a letter / no email) → STOP. The identity scraping is broken and must be fixed first. Report to the controller/human: the `extractIdentity` selector (`a[aria-label^="Google Account"]` + `img[src*="googleusercontent"]` in `electron/preload.ts`) likely needs updating against the live Gmail DOM. Do NOT proceed with the multi-login feature until this passes.

No code, no commit — this is a verification checkpoint.

---

### Task 2: Pure helpers — URLs, palette, detection planner

**Files:**
- Create: `electron/google-urls.ts`
- Create: `electron/palette.ts`
- Create: `electron/detection-planner.ts`
- Test: `tests/google-urls.test.ts`, `tests/palette.test.ts`, `tests/detection-planner.test.ts`

**Interfaces:**
- Produces:
  - `mailUrl(index: number): string`, `calendarUrl(index: number): string`
  - `PALETTE: readonly string[]`, `colorForIndex(index: number): string`
  - `planNext(seenEmails: string[], index: number, identity: { email: string } | null, maxAccounts?: number): { register: boolean; stop: boolean }`

- [ ] **Step 1: Write the failing tests**

`tests/google-urls.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { mailUrl, calendarUrl } from '../electron/google-urls';

describe('google urls', () => {
  it('builds mail url per authuser index', () => {
    expect(mailUrl(0)).toBe('https://mail.google.com/mail/u/0/');
    expect(mailUrl(2)).toBe('https://mail.google.com/mail/u/2/');
  });
  it('builds calendar url per authuser index', () => {
    expect(calendarUrl(0)).toBe('https://calendar.google.com/calendar/u/0/r');
    expect(calendarUrl(1)).toBe('https://calendar.google.com/calendar/u/1/r');
  });
});
```

`tests/palette.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { PALETTE, colorForIndex } from '../electron/palette';

describe('colorForIndex', () => {
  it('returns the palette entry for the index', () => {
    expect(colorForIndex(0)).toBe(PALETTE[0]);
    expect(colorForIndex(1)).toBe(PALETTE[1]);
  });
  it('wraps around the palette', () => {
    expect(colorForIndex(PALETTE.length)).toBe(PALETTE[0]);
  });
});
```

`tests/detection-planner.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { planNext } from '../electron/detection-planner';

describe('planNext', () => {
  it('registers and continues on a new email', () => {
    expect(planNext(['a@x.com'], 1, { email: 'b@x.com' })).toEqual({ register: true, stop: false });
  });
  it('stops without registering on a repeated email (invalid index redirected)', () => {
    expect(planNext(['a@x.com'], 1, { email: 'a@x.com' })).toEqual({ register: false, stop: true });
  });
  it('stops without registering when no identity (login/chooser page)', () => {
    expect(planNext(['a@x.com'], 1, null)).toEqual({ register: false, stop: true });
  });
  it('registers but stops at the max-accounts cap', () => {
    expect(planNext([], 9, { email: 'z@x.com' }, 10)).toEqual({ register: true, stop: true });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/google-urls.test.ts tests/palette.test.ts tests/detection-planner.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`electron/google-urls.ts`:
```ts
export function mailUrl(index: number): string {
  return `https://mail.google.com/mail/u/${index}/`;
}

export function calendarUrl(index: number): string {
  return `https://calendar.google.com/calendar/u/${index}/r`;
}
```

`electron/palette.ts`:
```ts
export const PALETTE = ['#4285F4', '#EA4335', '#34A853', '#FBBC05', '#A142F4', '#00ACC1'] as const;

export function colorForIndex(index: number): string {
  return PALETTE[index % PALETTE.length];
}
```

`electron/detection-planner.ts`:
```ts
export function planNext(
  seenEmails: string[],
  index: number,
  identity: { email: string } | null,
  maxAccounts = 10,
): { register: boolean; stop: boolean } {
  if (!identity || !identity.email) return { register: false, stop: true };
  if (seenEmails.includes(identity.email)) return { register: false, stop: true };
  return { register: true, stop: index + 1 >= maxAccounts };
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/google-urls.test.ts tests/palette.test.ts tests/detection-planner.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/google-urls.ts electron/palette.ts electron/detection-planner.ts tests/google-urls.test.ts tests/palette.test.ts tests/detection-planner.test.ts
git commit -m "feat: add url, palette and detection-planner helpers"
```

---

### Task 3: `color-store` — persist per-email color overrides

**Files:**
- Create: `electron/color-store.ts`
- Test: `tests/color-store.test.ts`

**Interfaces:**
- Produces: `class ColorStore` — `new ColorStore(filePath)`, `get(email: string): string | undefined`, `set(email: string, color: string): void`. Backing JSON is `Record<string, string>`.

- [ ] **Step 1: Write the failing tests**

`tests/color-store.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ColorStore } from '../electron/color-store';

function newStore() {
  const dir = mkdtempSync(join(tmpdir(), 'colors-'));
  return new ColorStore(join(dir, 'colors.json'));
}

describe('ColorStore', () => {
  let store: ColorStore;
  beforeEach(() => {
    store = newStore();
  });
  it('returns undefined for an unknown email', () => {
    expect(store.get('a@x.com')).toBeUndefined();
  });
  it('persists a color across instances', () => {
    store.set('a@x.com', '#EA4335');
    const reopened = new ColorStore((store as unknown as { filePath: string }).filePath);
    expect(reopened.get('a@x.com')).toBe('#EA4335');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/color-store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`electron/color-store.ts`:
```ts
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export class ColorStore {
  constructor(private readonly filePath: string) {}

  private read(): Record<string, string> {
    if (!existsSync(this.filePath)) return {};
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8'));
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
    } catch {
      return {};
    }
  }

  get(email: string): string | undefined {
    return this.read()[email];
  }

  set(email: string, color: string): void {
    const next = { ...this.read(), [email]: color };
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(next, null, 2), 'utf8');
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/color-store.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/color-store.ts tests/color-store.test.ts
git commit -m "feat: add per-email color override store"
```

---

### Task 4: IPC channels for profiles/surfaces/detect/color

**Files:**
- Modify: `electron/ipc.ts`

**Interfaces:**
- Produces the new `IPC` object (removes the manual-account channels, adds profile channels).

- [ ] **Step 1: Replace `electron/ipc.ts` with**

```ts
// Channel names shared between main, preload, and renderer.
export const IPC = {
  // Gmail view -> main
  UNREAD_UPDATE: 'unread:update', // send(count:number)
  NOTIFICATION_ACTIVATE: 'notification:activate', // send()
  ACCOUNT_IDENTITY: 'account:identity', // send({email,name,avatarUrl})
  // renderer (sidebar) -> main
  SWITCH_SURFACE: 'switch:surface', // send({index, surface:'mail'|'calendar'})
  REDETECT: 'accounts:redetect', // send()
  SET_COLOR: 'color:set', // send({email, color})
  SETTINGS_TOGGLE: 'settings:toggle', // send({open:boolean})
  // main -> renderer (sidebar)
  PROFILES_CHANGED: 'profiles:changed', // Profile[]
  UNREAD_CHANGED: 'unread:changed', // Record<index, number>
  SETTINGS_FORCE_CLOSE: 'settings:force-close',
} as const;
```

- [ ] **Step 2: Type-check (will fail elsewhere until Task 5/6 — that's expected)**

Run: `npx tsc --noEmit`
Expected: errors ONLY in `account-view-manager.ts`, `main.ts`, `sidebar-preload.ts` referencing removed channels. Those files are rewritten in Tasks 5–6. Do not fix them here.
> Because this task alone leaves the tree non-compiling, commit it together with Task 5 (see Task 5 Step commit). Skip a standalone commit here.

---

### Task 5: `ProfileViewManager` + main-process rewrite (detection, IPC, session)

**Files:**
- Rewrite: `electron/account-view-manager.ts` → rename responsibility to `electron/profile-view-manager.ts` (create new, `git rm` the old)
- Rewrite: `electron/main.ts`
- Remove: `electron/accounts-store.ts` + `tests/accounts-store.test.ts` (`git rm` — manual account list no longer used)

**Interfaces:**
- Consumes: `mailUrl`/`calendarUrl` (Task 2), `colorForIndex` (Task 2), `planNext` (Task 2), `ColorStore` (Task 3), `IPC` (Task 4), existing `preload.js` identity/unread.
- Produces:
  - `type Surface = 'mail' | 'calendar'`
  - `interface Profile { index: number; email: string; name: string; avatarUrl: string; color: string }`
  - `class ProfileViewManager` with `new ProfileViewManager(win, preloadPath, onUnread:(index:number,count:number)=>void, onActivate:(index:number)=>void, onIdentity:(index:number,identity:{email:string;name:string;avatarUrl:string})=>void)`; methods `ensureView(index:number, surface:Surface, visible:boolean): void`, `show(index:number, surface:Surface): void`, `discardView(index:number, surface:Surface): void`, `hideAll(): void`, `showActive(): void`, `relayout(): void`.

- [ ] **Step 1: Create `electron/profile-view-manager.ts`**

```ts
import { BrowserWindow, WebContentsView } from 'electron';
import { contentBounds } from './layout';
import { IPC } from './ipc';
import { mailUrl, calendarUrl } from './google-urls';

export type Surface = 'mail' | 'calendar';

export interface Profile {
  index: number;
  email: string;
  name: string;
  avatarUrl: string;
  color: string;
}

const SESSION_PARTITION = 'persist:google';
const key = (index: number, surface: Surface) => `${index}:${surface}`;

export class ProfileViewManager {
  private views = new Map<string, WebContentsView>();
  private activeKey: string | null = null;

  constructor(
    private readonly win: BrowserWindow,
    private readonly preloadPath: string,
    private readonly onUnread: (index: number, count: number) => void,
    private readonly onActivate: (index: number) => void,
    private readonly onIdentity: (
      index: number,
      identity: { email: string; name: string; avatarUrl: string },
    ) => void,
  ) {
    this.win.on('resize', () => this.relayout());
  }

  ensureView(index: number, surface: Surface, visible: boolean): void {
    const k = key(index, surface);
    if (this.views.has(k)) {
      if (visible) this.show(index, surface);
      return;
    }
    const view = new WebContentsView({
      webPreferences: {
        preload: this.preloadPath,
        partition: SESSION_PARTITION,
        contextIsolation: false,
      },
    });
    if (surface === 'mail') {
      view.webContents.on('ipc-message', (_e, channel, ...args) => {
        if (channel === IPC.UNREAD_UPDATE) this.onUnread(index, Number(args[0]) || 0);
        else if (channel === IPC.NOTIFICATION_ACTIVATE) this.onActivate(index);
        else if (channel === IPC.ACCOUNT_IDENTITY) this.onIdentity(index, args[0]);
      });
    }
    void view.webContents.loadURL(surface === 'mail' ? mailUrl(index) : calendarUrl(index));
    this.win.contentView.addChildView(view);
    view.setVisible(false);
    this.views.set(k, view);
    if (visible) this.show(index, surface);
  }

  show(index: number, surface: Surface): void {
    this.ensureView(index, surface, false);
    const k = key(index, surface);
    const view = this.views.get(k);
    if (!view) return;
    for (const [vk, v] of this.views) v.setVisible(vk === k);
    this.activeKey = k;
    this.applyBounds(view);
  }

  discardView(index: number, surface: Surface): void {
    const k = key(index, surface);
    const view = this.views.get(k);
    if (!view) return;
    this.win.contentView.removeChildView(view);
    view.webContents.close();
    this.views.delete(k);
    if (this.activeKey === k) this.activeKey = null;
  }

  hideAll(): void {
    for (const v of this.views.values()) v.setVisible(false);
  }

  showActive(): void {
    if (this.activeKey) {
      const view = this.views.get(this.activeKey);
      if (view) {
        view.setVisible(true);
        this.applyBounds(view);
      }
    }
  }

  relayout(): void {
    if (this.activeKey) {
      const view = this.views.get(this.activeKey);
      if (view) this.applyBounds(view);
    }
  }

  private applyBounds(view: WebContentsView): void {
    const [width, height] = this.win.getContentSize();
    view.setBounds(contentBounds({ width, height }));
  }
}
```

- [ ] **Step 2: `git rm` the obsolete files**

Run:
```bash
git rm electron/account-view-manager.ts electron/accounts-store.ts tests/accounts-store.test.ts
```

- [ ] **Step 3: Rewrite `electron/main.ts`**

Replace the whole file with:
```ts
import { app, BrowserWindow, protocol, net, ipcMain } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Tray } from 'electron';
import { ProfileViewManager, type Profile, type Surface } from './profile-view-manager';
import { ColorStore } from './color-store';
import { colorForIndex } from './palette';
import { planNext } from './detection-planner';
import { IPC } from './ipc';
import { shouldHideOnClose, createTray } from './tray-controller';

const RENDERER_DIST = join(__dirname, '..', 'renderer', 'out');
const PRELOAD_PATH = join(__dirname, 'preload.js');
const SIDEBAR_PRELOAD_PATH = join(__dirname, 'sidebar-preload.js');
const DEV_URL = process.env.ELECTRON_RENDERER_URL;
const PROBE_TIMEOUT_MS = 8000;

let mainWindow: BrowserWindow | null = null;
let manager: ProfileViewManager | null = null;
let colors: ColorStore | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let settingsPanelOpen = false;

const profiles: Profile[] = [];
const seenEmails = new Set<string>();
const unreadCounts: Record<number, number> = {};
let active: { index: number; surface: Surface } | null = null;
let probeTimer: ReturnType<typeof setTimeout> | null = null;

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function registerAppProtocol(): void {
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    return net.fetch(pathToFileURL(join(RENDERER_DIST, rel)).toString());
  });
}

function pushProfiles(): void {
  mainWindow?.webContents.send(IPC.PROFILES_CHANGED, [...profiles]);
}
function pushUnread(): void {
  mainWindow?.webContents.send(IPC.UNREAD_CHANGED, { ...unreadCounts });
}

function clearProbeTimer(): void {
  if (probeTimer) {
    clearTimeout(probeTimer);
    probeTimer = null;
  }
}

function probe(index: number): void {
  manager?.ensureView(index, 'mail', false); // hidden probe; identity arrives via onIdentity
  clearProbeTimer();
  probeTimer = setTimeout(() => {
    // No identity within the timeout: no account at this index. Discard and stop.
    manager?.discardView(index, 'mail');
    probeTimer = null;
  }, PROBE_TIMEOUT_MS);
}

function onIdentity(index: number, identity: { email: string; name: string; avatarUrl: string }): void {
  const decision = planNext([...seenEmails], index, identity);
  clearProbeTimer();
  if (decision.register && identity.email && !profiles.some((p) => p.index === index)) {
    seenEmails.add(identity.email);
    const color = colors!.get(identity.email) ?? colorForIndex(index);
    profiles.push({ index, email: identity.email, name: identity.name, avatarUrl: identity.avatarUrl, color });
    profiles.sort((a, b) => a.index - b.index);
    pushProfiles();
  } else if (!decision.register && index > 0 && !profiles.some((p) => p.index === index)) {
    manager?.discardView(index, 'mail'); // duplicate/empty probe view
  }
  if (!decision.stop) probe(index + 1);
}

function switchSurface(index: number, surface: Surface): void {
  active = { index, surface };
  manager?.show(index, surface);
}

function startDetection(): void {
  switchSurface(0, 'mail'); // visible; user logs in; onIdentity(0,...) drives the rest
}

function redetect(): void {
  clearProbeTimer();
  const maxIndex = profiles.length ? Math.max(...profiles.map((p) => p.index)) : -1;
  probe(maxIndex + 1);
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    backgroundColor: '#0a0a0a',
    webPreferences: { preload: SIDEBAR_PRELOAD_PATH, contextIsolation: true },
  });
  colors = new ColorStore(join(app.getPath('userData'), 'colors.json'));
  manager = new ProfileViewManager(
    mainWindow,
    PRELOAD_PATH,
    (index, count) => {
      unreadCounts[index] = count;
      pushUnread();
    },
    (index) => {
      mainWindow?.show();
      if (settingsPanelOpen) {
        settingsPanelOpen = false;
        mainWindow?.webContents.send(IPC.SETTINGS_FORCE_CLOSE);
      }
      switchSurface(index, 'mail');
    },
    (index, identity) => onIdentity(index, identity),
  );

  if (DEV_URL) void mainWindow.loadURL(DEV_URL);
  else void mainWindow.loadURL('app://bundle/');

  mainWindow.webContents.once('did-finish-load', () => {
    pushProfiles();
    startDetection();
  });

  mainWindow.on('close', (e) => {
    if (shouldHideOnClose({ isQuitting, platform: process.platform })) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
}

function registerIpc(): void {
  ipcMain.on(IPC.SWITCH_SURFACE, (_e, arg: { index: number; surface: Surface }) =>
    switchSurface(arg.index, arg.surface),
  );
  ipcMain.on(IPC.REDETECT, () => redetect());
  ipcMain.on(IPC.SET_COLOR, (_e, arg: { email: string; color: string }) => {
    colors!.set(arg.email, arg.color);
    const p = profiles.find((x) => x.email === arg.email);
    if (p) {
      p.color = arg.color;
      pushProfiles();
    }
  });
  ipcMain.on(IPC.SETTINGS_TOGGLE, (_e, arg: { open: boolean }) => {
    settingsPanelOpen = arg.open;
    if (arg.open) manager?.hideAll();
    else manager?.showActive();
  });
}

app.whenReady().then(() => {
  registerAppProtocol();
  registerIpc();
  createWindow();
  tray = createTray({
    onOpen: () => mainWindow?.show(),
    onQuit: () => {
      isQuitting = true;
      app.quit();
    },
  });
  void tray;
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // Kept running in the tray; quit only via the tray menu.
});
app.on('before-quit', () => {
  isQuitting = true;
});
```

- [ ] **Step 4: Type-check, build, tests**

Run: `npx tsc --noEmit && npm run build:main && npx vitest run`
Expected: no type errors; `dist-electron/{main,preload,sidebar-preload}.js` produced; the account-store tests are gone and the remaining suite passes.
> `sidebar-preload.ts` still references removed channels until Task 6 — if `build:main` fails on it, do Task 6's edits in the same working session before this build gate (they are one logical change). Prefer to commit Tasks 4+5+6 together.

- [ ] **Step 5: Commit (folds in Task 4 and Task 6)**

After Task 6's edits are in place and the build is green:
```bash
git add electron/ipc.ts electron/profile-view-manager.ts electron/main.ts electron/sidebar-preload.ts
git rm --cached electron/account-view-manager.ts electron/accounts-store.ts tests/accounts-store.test.ts 2>/dev/null || true
git commit -m "feat: shared-session profiles with auto-detect and calendar surfaces"
```

---

### Task 6: Sidebar bridge for profiles/surfaces

**Files:**
- Rewrite: `electron/sidebar-preload.ts`

**Interfaces:**
- Produces `window.desktop` with: `onProfilesChanged(cb)`, `onUnreadChanged(cb)`, `switchSurface(index, surface)`, `redetect()`, `setColor(email, color)`, `toggleSettings(open)`, `onSettingsForceClose(cb)`.

- [ ] **Step 1: Replace `electron/sidebar-preload.ts` with**

```ts
import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from './ipc';

interface Profile {
  index: number;
  email: string;
  name: string;
  avatarUrl: string;
  color: string;
}
type Surface = 'mail' | 'calendar';

contextBridge.exposeInMainWorld('desktop', {
  onProfilesChanged: (cb: (profiles: Profile[]) => void): void => {
    ipcRenderer.on(IPC.PROFILES_CHANGED, (_e, profiles) => cb(profiles));
  },
  onUnreadChanged: (cb: (counts: Record<number, number>) => void): void => {
    ipcRenderer.on(IPC.UNREAD_CHANGED, (_e, counts) => cb(counts));
  },
  switchSurface: (index: number, surface: Surface): void =>
    ipcRenderer.send(IPC.SWITCH_SURFACE, { index, surface }),
  redetect: (): void => ipcRenderer.send(IPC.REDETECT),
  setColor: (email: string, color: string): void =>
    ipcRenderer.send(IPC.SET_COLOR, { email, color }),
  toggleSettings: (open: boolean): void => ipcRenderer.send(IPC.SETTINGS_TOGGLE, { open }),
  onSettingsForceClose: (cb: () => void): void => {
    ipcRenderer.on(IPC.SETTINGS_FORCE_CLOSE, () => cb());
  },
});
```

- [ ] **Step 2: Build (shared gate with Task 5)**

Run: `npx tsc --noEmit && npm run build:main`
Expected: `dist-electron/sidebar-preload.js` produced; no type errors. Commit with Task 5's commit.

---

### Task 7: Renderer — profile sidebar (avatar + calendar icon) & settings

**Files:**
- Rewrite: `renderer/app/page.tsx`
- Rewrite: `renderer/app/SettingsPanel.tsx`

**Interfaces:**
- Consumes `window.desktop` (Task 6). `Profile` shape `{index,email,name,avatarUrl,color}`.

- [ ] **Step 1: Replace `renderer/app/page.tsx` with**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { SettingsPanel } from './SettingsPanel';

export interface Profile {
  index: number;
  email: string;
  name: string;
  avatarUrl: string;
  color: string;
}
export type Surface = 'mail' | 'calendar';

interface DesktopBridge {
  onProfilesChanged(cb: (profiles: Profile[]) => void): void;
  onUnreadChanged(cb: (counts: Record<number, number>) => void): void;
  switchSurface(index: number, surface: Surface): void;
  redetect(): void;
  setColor(email: string, color: string): void;
  toggleSettings(open: boolean): void;
  onSettingsForceClose(cb: () => void): void;
}

declare global {
  interface Window {
    desktop?: DesktopBridge;
  }
}

export default function Sidebar() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [unread, setUnread] = useState<Record<number, number>>({});
  const [active, setActive] = useState<{ index: number; surface: Surface } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    const bridge = window.desktop;
    if (!bridge) return;
    bridge.onProfilesChanged((list) => {
      setProfiles(list);
      setActive((cur) => cur ?? (list[0] ? { index: list[0].index, surface: 'mail' } : null));
    });
    bridge.onUnreadChanged(setUnread);
    bridge.onSettingsForceClose(() => setSettingsOpen(false));
  }, []);

  function open(index: number, surface: Surface) {
    if (settingsOpen) setSettingsOpen(false);
    setActive({ index, surface });
    window.desktop?.switchSurface(index, surface);
  }
  function redetect() {
    if (settingsOpen) setSettingsOpen(false);
    window.desktop?.redetect();
  }
  function openSettings() {
    setSettingsOpen(true);
    window.desktop?.toggleSettings(true);
  }
  function closeSettings() {
    setSettingsOpen(false);
    window.desktop?.toggleSettings(false);
  }

  return (
    <div className="flex h-screen w-full bg-neutral-900">
      <nav className="flex w-16 shrink-0 flex-col items-center gap-2 bg-neutral-950 py-3">
        {profiles.map((p) => {
          const mailActive = active?.index === p.index && active.surface === 'mail';
          const calActive = active?.index === p.index && active.surface === 'calendar';
          return (
            <div key={p.index} className="flex flex-col items-center gap-1">
              <button
                onClick={() => open(p.index, 'mail')}
                title={p.email}
                className={`relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-full text-sm font-semibold text-white transition ${
                  mailActive ? 'ring-2 ring-white' : 'opacity-80 hover:opacity-100'
                }`}
                style={{ backgroundColor: p.color }}
              >
                {p.avatarUrl ? (
                  <img
                    src={p.avatarUrl}
                    alt={p.email}
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  (p.name || p.email || 'A').charAt(0).toUpperCase()
                )}
                {unread[p.index] > 0 && (
                  <span className="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-red-600 px-1 text-center text-[10px] leading-[18px] text-white">
                    {unread[p.index]}
                  </span>
                )}
              </button>
              <button
                onClick={() => open(p.index, 'calendar')}
                title={`${p.email} — Calendar`}
                className={`flex h-5 w-10 items-center justify-center rounded text-[13px] leading-none transition ${
                  calActive ? 'text-white' : 'text-neutral-500 hover:text-neutral-200'
                }`}
              >
                📅
              </button>
            </div>
          );
        })}
        <button
          onClick={redetect}
          title="Detect accounts"
          className="mt-1 flex h-10 w-10 items-center justify-center rounded-full bg-neutral-800 text-xl text-neutral-300 hover:bg-neutral-700"
        >
          +
        </button>
        <div className="mt-auto">
          <button
            onClick={openSettings}
            title="Settings"
            className="flex h-10 w-10 items-center justify-center rounded-full text-xl text-neutral-400 hover:text-white"
          >
            ⚙
          </button>
        </div>
      </nav>
      {settingsOpen && (
        <SettingsPanel profiles={profiles} onClose={closeSettings} onRedetect={redetect} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Replace `renderer/app/SettingsPanel.tsx` with**

```tsx
'use client';

interface Profile {
  index: number;
  email: string;
  name: string;
  avatarUrl: string;
  color: string;
}

const SWATCHES = ['#4285F4', '#EA4335', '#34A853', '#FBBC05', '#A142F4', '#00ACC1'];

export function SettingsPanel({
  profiles,
  onClose,
  onRedetect,
}: {
  profiles: Profile[];
  onClose: () => void;
  onRedetect: () => void;
}) {
  return (
    <div className="flex h-screen flex-1 flex-col overflow-y-auto bg-neutral-900 p-8 text-neutral-100">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Settings</h1>
        <button onClick={onClose} className="rounded bg-neutral-800 px-3 py-1 text-sm hover:bg-neutral-700">
          Close
        </button>
      </div>

      <h2 className="mb-2 text-sm uppercase tracking-wide text-neutral-400">Accounts</h2>
      <div className="mb-6 flex flex-col gap-3">
        {profiles.map((p) => (
          <div key={p.index} className="flex items-center gap-3 rounded bg-neutral-800 p-3">
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-semibold text-white"
              style={{ backgroundColor: p.color }}
            >
              {p.avatarUrl ? (
                <img src={p.avatarUrl} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
              ) : (
                (p.name || p.email || 'A').charAt(0).toUpperCase()
              )}
            </span>
            <span className="flex-1 truncate text-sm">{p.email}</span>
            <div className="flex gap-1">
              {SWATCHES.map((c) => (
                <button
                  key={c}
                  onClick={() => window.desktop?.setColor(p.email, c)}
                  aria-label={`color ${c}`}
                  className="h-5 w-5 rounded-full ring-white hover:ring-2"
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
        ))}
        {profiles.length === 0 && <p className="text-sm text-neutral-400">No accounts detected yet.</p>}
      </div>

      <button
        onClick={onRedetect}
        className="w-fit rounded bg-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-600"
      >
        Re-detect accounts
      </button>
      <p className="mt-3 max-w-prose text-xs text-neutral-400">
        Accounts are detected from the Google accounts you are signed into. Add another via Gmail&apos;s own
        account switcher, then re-detect.
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Build renderer + typecheck**

Run: `npm run build:renderer && (cd renderer && npx tsc --noEmit)`
Expected: `✓ Compiled successfully`, no Tailwind "content missing" warning, `renderer/out/index.html` present; renderer tsc clean.

- [ ] **Step 4: Full build + suite**

Run: `npm run build && npx tsc --noEmit && npx vitest run`
Expected: all bundles produced; no type errors; suite green.

- [ ] **Step 5: Commit**

```bash
git add renderer/app/page.tsx renderer/app/SettingsPanel.tsx
git commit -m "feat: render auto-detected profiles with mail/calendar switch"
```

- [ ] **Step 6: Manual verification (user's machine)**

Run `./run-dev.sh`, log into Gmail. Expected: your account appears automatically (avatar + email); if you have multiple Google accounts signed in, they each appear; the 📅 icon under an avatar switches that account to Google Calendar; the avatar switches back to Mail; "+" re-detects; ⚙ opens color settings.

---

## Self-Review Notes

- **Spec coverage:** shared `persist:google` session (Task 5) · auto-detect via index probing + planner (Tasks 2,5) · Mail+Calendar lazy views (Task 5) · sidebar avatar + calendar icon (Task 7) · "+" = re-detect (Tasks 5,7) · color override persisted by email (Tasks 3,5,7) · verify-avatars-first gate (Task 1) · IPC rework (Task 4) · removal of manual accounts-store/channels (Tasks 4,5). All spec sections mapped.
- **Placeholder scan:** complete code in every code step; the only no-code task is the Task 1 verification gate (intentional). Tasks 4+5+6 share one commit because a mid-rewrite tree does not compile — called out explicitly, not a hidden gap.
- **Type consistency:** `Profile {index,email,name,avatarUrl,color}` and `Surface` identical across `profile-view-manager.ts`, `main.ts`, `sidebar-preload.ts`, `page.tsx`, `SettingsPanel.tsx`. `planNext` signature matches between Task 2 and its use in Task 5. IPC channel names (Task 4) are the single source used by main (5), sidebar bridge (6), and renderer (7). Unread is keyed by numeric `index` everywhere.
- **Dependency risk (carried from spec):** all detection rests on the identity scraping verified in Task 1; do not proceed past the gate if it fails.
```
