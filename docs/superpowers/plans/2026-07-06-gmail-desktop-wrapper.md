# Gmail Desktop Wrapper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a cross-platform Electron app that loads the real Gmail web UI in isolated per-account sessions, with a sidebar to switch accounts, desktop notifications, an unread badge, and system-tray background running.

**Architecture:** An Electron main process owns the window, tray, accounts config, and one `WebContentsView` per account (each on its own persistent session partition for isolated logins). A Next.js static-export renderer draws only the narrow sidebar "chrome". A preload script injected into each Gmail view reads the unread count from the document title and routes notification clicks back to the main process over IPC.

**Tech Stack:** Electron 31, TypeScript, Next.js 14 (static export), Tailwind CSS 3, Vitest, esbuild, electron-builder. Node 22 / npm 10.

## Global Constraints

- Node.js >= 22, npm >= 10 (verified in environment).
- TypeScript everywhere; `strict: true`.
- Renderer built with Next.js in static-export mode (`output: 'export'`) — no runtime Node server. Loaded in production via a custom `app://` protocol so Next's absolute `/_next/...` asset paths resolve.
- Electron main + preload bundled with esbuild to CommonJS in `dist-electron/`; `electron` is an external.
- Pure logic modules (`unread-parser`, `accounts-store`, `badge-math`, `layout`) contain **no** Electron imports so they are unit-testable with Vitest under plain Node.
- Account `WebContentsView`s use `contextIsolation: false` so the preload can both read `document.title` and wrap `window.Notification` in the page context. This is an accepted trade-off for a wrapper that loads only trusted `mail.google.com`.
- READMEs are written in English (user global preference).
- Commit after every task with a type-only Conventional Commit message (no scope): `feat: …`, `test: …`, `chore: …`, `docs: …`.

**Known deferral (agreed):** On Windows there is no numeric taskbar badge; `app.setBadgeCount()` is a no-op there. A Windows numeric *overlay icon* needs a designed icon asset and is deferred as an enhancement. Linux (Unity) and macOS get the full numeric badge now.

---

### Task 1: Project scaffolding + Vitest harness

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `src/sanity.ts`
- Test: `tests/sanity.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a working `npm test` (Vitest) and `tsconfig.json` with `strict: true` that later tasks rely on.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "gmail-desktop",
  "version": "0.1.0",
  "private": true,
  "description": "Cross-platform desktop wrapper for Gmail",
  "main": "dist-electron/main.js",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "build:renderer": "next build renderer",
    "build:main": "esbuild electron/main.ts electron/preload.ts --bundle --platform=node --target=node20 --external:electron --outdir=dist-electron --format=cjs",
    "build": "npm run build:renderer && npm run build:main",
    "start": "electron .",
    "dist": "npm run build && electron-builder"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "electron": "^31.0.0",
    "electron-builder": "^24.13.3",
    "esbuild": "^0.21.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["electron", "src", "tests"],
  "exclude": ["node_modules", "renderer", "dist-electron"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Create `.gitignore`**

```gitignore
node_modules/
dist-electron/
renderer/out/
renderer/.next/
dist/
*.log
```

- [ ] **Step 5: Write the failing sanity test**

`tests/sanity.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { greet } from '../src/sanity';

describe('sanity', () => {
  it('greets', () => {
    expect(greet('Gmail')).toBe('hello Gmail');
  });
});
```

- [ ] **Step 6: Install deps and run the test to verify it fails**

Run: `npm install && npx vitest run tests/sanity.test.ts`
Expected: FAIL — cannot resolve `../src/sanity`.

- [ ] **Step 7: Create the minimal implementation**

`src/sanity.ts`:
```ts
export function greet(name: string): string {
  return `hello ${name}`;
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx vitest run tests/sanity.test.ts`
Expected: PASS (1 test).

- [ ] **Step 9: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts .gitignore src/sanity.ts tests/sanity.test.ts package-lock.json
git commit -m "chore: scaffold project with vitest harness"
```

---

### Task 2: `unread-parser` — document title → unread count

**Files:**
- Create: `electron/unread-parser.ts`
- Test: `tests/unread-parser.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `parseUnreadCount(title: string | null | undefined): number` — returns the integer inside the first `(N)` in a Gmail title, else `0`.

- [ ] **Step 1: Write the failing tests**

`tests/unread-parser.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseUnreadCount } from '../electron/unread-parser';

describe('parseUnreadCount', () => {
  it('reads the count from a Gmail inbox title', () => {
    expect(parseUnreadCount('Inbox (12) - user@gmail.com - Gmail')).toBe(12);
  });
  it('returns 0 when there is no count', () => {
    expect(parseUnreadCount('Inbox - user@gmail.com - Gmail')).toBe(0);
  });
  it('returns 0 for null/undefined/empty', () => {
    expect(parseUnreadCount(null)).toBe(0);
    expect(parseUnreadCount(undefined)).toBe(0);
    expect(parseUnreadCount('')).toBe(0);
  });
  it('takes the first parenthesised number only', () => {
    expect(parseUnreadCount('Inbox (3) - (spam) - Gmail')).toBe(3);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unread-parser.test.ts`
Expected: FAIL — cannot resolve `../electron/unread-parser`.

- [ ] **Step 3: Write the minimal implementation**

`electron/unread-parser.ts`:
```ts
export function parseUnreadCount(title: string | null | undefined): number {
  if (!title) return 0;
  const match = title.match(/\((\d+)\)/);
  if (!match) return 0;
  const n = parseInt(match[1], 10);
  return Number.isFinite(n) ? n : 0;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unread-parser.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/unread-parser.ts tests/unread-parser.test.ts
git commit -m "feat: add unread count title parser"
```

---

### Task 3: `accounts-store` — persist the accounts list as JSON

**Files:**
- Create: `electron/accounts-store.ts`
- Test: `tests/accounts-store.test.ts`

**Interfaces:**
- Consumes: nothing (Node `fs`, `crypto` only).
- Produces:
  - `interface Account { id: string; label: string; color: string }`
  - `class AccountsStore` constructed with `new AccountsStore(filePath: string)`, methods:
    - `list(): Account[]`
    - `add(input: { label: string; color: string }): Account` (generates `id` via `crypto.randomUUID()`, persists, returns the created account)
    - `remove(id: string): void`

- [ ] **Step 1: Write the failing tests**

`tests/accounts-store.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountsStore } from '../electron/accounts-store';

function newStore() {
  const dir = mkdtempSync(join(tmpdir(), 'accts-'));
  return new AccountsStore(join(dir, 'accounts.json'));
}

describe('AccountsStore', () => {
  let store: AccountsStore;
  beforeEach(() => {
    store = newStore();
  });

  it('starts empty', () => {
    expect(store.list()).toEqual([]);
  });

  it('adds an account with a generated id and persists it', () => {
    const created = store.add({ label: 'Work', color: '#EA4335' });
    expect(created.id).toBeTruthy();
    expect(created.label).toBe('Work');
    expect(store.list()).toHaveLength(1);
  });

  it('reads persisted accounts from disk in a fresh instance', () => {
    const created = store.add({ label: 'Home', color: '#4285F4' });
    const reopened = new AccountsStore((store as unknown as { filePath: string }).filePath);
    expect(reopened.list()).toEqual([created]);
  });

  it('removes an account by id', () => {
    const a = store.add({ label: 'A', color: '#000' });
    const b = store.add({ label: 'B', color: '#111' });
    store.remove(a.id);
    expect(store.list()).toEqual([b]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/accounts-store.test.ts`
Expected: FAIL — cannot resolve `../electron/accounts-store`.

- [ ] **Step 3: Write the minimal implementation**

`electron/accounts-store.ts`:
```ts
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface Account {
  id: string;
  label: string;
  color: string;
}

export class AccountsStore {
  constructor(private readonly filePath: string) {}

  list(): Account[] {
    if (!existsSync(this.filePath)) return [];
    try {
      const raw = readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as Account[]) : [];
    } catch {
      return [];
    }
  }

  add(input: { label: string; color: string }): Account {
    const account: Account = { id: randomUUID(), label: input.label, color: input.color };
    const next = [...this.list(), account];
    this.persist(next);
    return account;
  }

  remove(id: string): void {
    this.persist(this.list().filter((a) => a.id !== id));
  }

  private persist(accounts: Account[]): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(accounts, null, 2), 'utf8');
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/accounts-store.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/accounts-store.ts tests/accounts-store.test.ts
git commit -m "feat: add persistent accounts store"
```

---

### Task 4: `badge-math` and `layout` — pure helpers for main process

**Files:**
- Create: `electron/badge-math.ts`
- Create: `electron/layout.ts`
- Test: `tests/badge-math.test.ts`
- Test: `tests/layout.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `totalUnread(counts: Record<string, number>): number`
  - `SIDEBAR_WIDTH: number` (constant, `64`)
  - `contentBounds(win: { width: number; height: number }): { x: number; y: number; width: number; height: number }` — the area a Gmail view should occupy (window minus sidebar).

- [ ] **Step 1: Write the failing tests**

`tests/badge-math.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { totalUnread } from '../electron/badge-math';

describe('totalUnread', () => {
  it('sums all account counts', () => {
    expect(totalUnread({ a: 3, b: 5 })).toBe(8);
  });
  it('is 0 for an empty map', () => {
    expect(totalUnread({})).toBe(0);
  });
  it('ignores non-finite values defensively', () => {
    expect(totalUnread({ a: 2, b: NaN as unknown as number })).toBe(2);
  });
});
```

`tests/layout.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { contentBounds, SIDEBAR_WIDTH } from '../electron/layout';

describe('contentBounds', () => {
  it('offsets content by the sidebar width', () => {
    expect(contentBounds({ width: 1000, height: 800 })).toEqual({
      x: SIDEBAR_WIDTH,
      y: 0,
      width: 1000 - SIDEBAR_WIDTH,
      height: 800,
    });
  });
  it('never returns a negative width', () => {
    expect(contentBounds({ width: 10, height: 100 }).width).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/badge-math.test.ts tests/layout.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementations**

`electron/badge-math.ts`:
```ts
export function totalUnread(counts: Record<string, number>): number {
  return Object.values(counts).reduce(
    (sum, n) => sum + (Number.isFinite(n) ? n : 0),
    0,
  );
}
```

`electron/layout.ts`:
```ts
export const SIDEBAR_WIDTH = 64;

export function contentBounds(win: { width: number; height: number }): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  return {
    x: SIDEBAR_WIDTH,
    y: 0,
    width: Math.max(0, win.width - SIDEBAR_WIDTH),
    height: win.height,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/badge-math.test.ts tests/layout.test.ts`
Expected: PASS (5 tests total).

- [ ] **Step 5: Commit**

```bash
git add electron/badge-math.ts electron/layout.ts tests/badge-math.test.ts tests/layout.test.ts
git commit -m "feat: add badge and layout math helpers"
```

---

### Task 5: Shared IPC contract

**Files:**
- Create: `electron/ipc.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the `IPC` channel-name constants used by main, preload, and renderer.

- [ ] **Step 1: Create the IPC contract**

`electron/ipc.ts`:
```ts
// Channel names shared between main, preload, and renderer.
export const IPC = {
  // renderer (sidebar) -> main
  ACCOUNTS_LIST: 'accounts:list', // invoke, returns Account[]
  ACCOUNTS_ADD: 'accounts:add', // invoke({label,color}), returns Account
  ACCOUNTS_REMOVE: 'accounts:remove', // invoke(id)
  ACCOUNTS_SWITCH: 'accounts:switch', // send(id)
  // preload (Gmail view) -> main
  UNREAD_UPDATE: 'unread:update', // send(count:number)
  NOTIFICATION_ACTIVATE: 'notification:activate', // send()
  // main -> renderer (sidebar)
  ACCOUNTS_CHANGED: 'accounts:changed', // Account[]
  UNREAD_CHANGED: 'unread:changed', // Record<accountId, number>
} as const;
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add electron/ipc.ts
git commit -m "feat: define shared ipc channel contract"
```

---

### Task 6: Next.js renderer — the sidebar chrome (static export)

**Files:**
- Create: `renderer/package.json`
- Create: `renderer/next.config.mjs`
- Create: `renderer/tsconfig.json`
- Create: `renderer/next-env.d.ts`
- Create: `renderer/postcss.config.mjs`
- Create: `renderer/tailwind.config.ts`
- Create: `renderer/app/globals.css`
- Create: `renderer/app/layout.tsx`
- Create: `renderer/app/page.tsx`

**Interfaces:**
- Consumes: nothing yet (uses `window.desktop` if present; falls back to empty list so it renders standalone).
- Produces: a static export at `renderer/out/index.html` showing a vertical sidebar with account buttons, an "add" (`+`) button, and a settings (`⚙`) button.

- [ ] **Step 1: Create the renderer package manifest**

`renderer/package.json`:
```json
{
  "name": "gmail-desktop-renderer",
  "version": "0.1.0",
  "private": true,
  "dependencies": {
    "next": "^14.2.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 2: Create Next config for static export**

`renderer/next.config.mjs`:
```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  images: { unoptimized: true },
};

export default nextConfig;
```

- [ ] **Step 3: Create renderer tsconfig and env types**

`renderer/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`renderer/next-env.d.ts`:
```ts
/// <reference types="next" />
/// <reference types="next/image-types/global" />
```

- [ ] **Step 4: Create Tailwind + PostCSS config**

`renderer/postcss.config.mjs`:
```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

`renderer/tailwind.config.ts`:
```ts
import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
};

export default config;
```

- [ ] **Step 5: Create global styles and layout**

`renderer/app/globals.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

html,
body {
  margin: 0;
  height: 100%;
  overflow: hidden;
}
```

`renderer/app/layout.tsx`:
```tsx
import './globals.css';
import type { ReactNode } from 'react';

export const metadata = { title: 'Gmail Desktop' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 6: Create the sidebar page**

`renderer/app/page.tsx`:
```tsx
'use client';

import { useEffect, useState } from 'react';

interface Account {
  id: string;
  label: string;
  color: string;
}

// Bridge exposed by the Electron preload for the sidebar (Task 11).
interface DesktopBridge {
  listAccounts(): Promise<Account[]>;
  addAccount(input: { label: string; color: string }): Promise<Account>;
  removeAccount(id: string): Promise<void>;
  switchAccount(id: string): void;
  onAccountsChanged(cb: (accounts: Account[]) => void): void;
  onUnreadChanged(cb: (counts: Record<string, number>) => void): void;
}

declare global {
  interface Window {
    desktop?: DesktopBridge;
  }
}

export default function Sidebar() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const bridge = window.desktop;
    if (!bridge) return;
    bridge.listAccounts().then((list) => {
      setAccounts(list);
      setActive(list[0]?.id ?? null);
    });
    bridge.onAccountsChanged(setAccounts);
    bridge.onUnreadChanged(setUnread);
  }, []);

  function select(id: string) {
    setActive(id);
    window.desktop?.switchAccount(id);
  }

  async function addAccount() {
    const created = await window.desktop?.addAccount({ label: 'Account', color: '#4285F4' });
    if (created) select(created.id);
  }

  return (
    <div className="flex h-screen w-full bg-neutral-900">
      <nav className="flex w-16 shrink-0 flex-col items-center gap-3 bg-neutral-950 py-3">
        {accounts.map((a) => (
          <button
            key={a.id}
            onClick={() => select(a.id)}
            title={a.label}
            className={`relative flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold text-white transition ${
              active === a.id ? 'ring-2 ring-white' : 'opacity-80 hover:opacity-100'
            }`}
            style={{ backgroundColor: a.color }}
          >
            {a.label.charAt(0).toUpperCase()}
            {unread[a.id] > 0 && (
              <span className="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-red-600 px-1 text-center text-[10px] leading-[18px] text-white">
                {unread[a.id]}
              </span>
            )}
          </button>
        ))}
        <button
          onClick={addAccount}
          title="Add account"
          className="mt-1 flex h-10 w-10 items-center justify-center rounded-full bg-neutral-800 text-xl text-neutral-300 hover:bg-neutral-700"
        >
          +
        </button>
        <div className="mt-auto">
          <button
            title="Settings"
            className="flex h-10 w-10 items-center justify-center rounded-full text-xl text-neutral-400 hover:text-white"
          >
            ⚙
          </button>
        </div>
      </nav>
    </div>
  );
}
```

- [ ] **Step 7: Install renderer deps and build**

Run: `cd renderer && npm install && npm run build 2>/dev/null || npx next build`
(Or from repo root: `npm run build:renderer` after installing renderer deps.)
Expected: build succeeds; `renderer/out/index.html` exists.

- [ ] **Step 8: Verify the export exists**

Run: `test -f renderer/out/index.html && echo OK`
Expected: `OK`.

- [ ] **Step 9: Commit**

```bash
git add renderer/package.json renderer/next.config.mjs renderer/tsconfig.json renderer/next-env.d.ts renderer/postcss.config.mjs renderer/tailwind.config.ts renderer/app renderer/package-lock.json
git commit -m "feat: add next.js sidebar renderer with tailwind"
```

---

### Task 7: Electron main — window + load the sidebar via `app://` protocol

**Files:**
- Create: `electron/main.ts`

**Interfaces:**
- Consumes: `renderer/out/` (from Task 6).
- Produces: an Electron app that opens a window showing the sidebar. Later tasks extend this same file with view management, tray, and IPC handlers.

- [ ] **Step 1: Write the main entry**

`electron/main.ts`:
```ts
import { app, BrowserWindow, protocol, net } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const RENDERER_DIST = join(__dirname, '..', 'renderer', 'out');
const DEV_URL = process.env.ELECTRON_RENDERER_URL;

let mainWindow: BrowserWindow | null = null;

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function registerAppProtocol(): void {
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const filePath = join(RENDERER_DIST, rel);
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    backgroundColor: '#0a0a0a',
    webPreferences: {},
  });

  if (DEV_URL) {
    void mainWindow.loadURL(DEV_URL);
  } else {
    void mainWindow.loadURL('app://bundle/');
  }
}

app.whenReady().then(() => {
  registerAppProtocol();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

- [ ] **Step 2: Build main and renderer**

Run: `npm run build`
Expected: `dist-electron/main.js` and `renderer/out/index.html` exist.

- [ ] **Step 3: Manual verification — launch the app**

Run: `npm start`
Expected: a window opens showing the dark sidebar with a `+` and `⚙` button (no account buttons yet — the store is empty). Close the window to exit.
> If running headless, set a virtual display first: `xvfb-run -a npm start`.

- [ ] **Step 4: Commit**

```bash
git add electron/main.ts
git commit -m "feat: add electron main process loading the sidebar"
```

---

### Task 8: Preload — report unread count and route notification clicks

**Files:**
- Create: `electron/preload.ts`
- Test: `tests/preload-report.test.ts`

**Interfaces:**
- Consumes: `parseUnreadCount` (Task 2), `IPC` (Task 5).
- Produces:
  - `computeAndReport(doc: { title: string }, send: (channel: string, count: number) => void): void` — exported pure-ish helper (testable) that parses the title and sends `IPC.UNREAD_UPDATE`.
  - Side effects on load: observes `document.title` changes and wraps `window.Notification` to emit `IPC.NOTIFICATION_ACTIVATE` on click.

- [ ] **Step 1: Write the failing test for the reporter helper**

`tests/preload-report.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { computeAndReport } from '../electron/preload';
import { IPC } from '../electron/ipc';

describe('computeAndReport', () => {
  it('sends the parsed unread count on the UNREAD_UPDATE channel', () => {
    const send = vi.fn();
    computeAndReport({ title: 'Inbox (7) - a@b.com - Gmail' }, send);
    expect(send).toHaveBeenCalledWith(IPC.UNREAD_UPDATE, 7);
  });
  it('sends 0 when there is no count', () => {
    const send = vi.fn();
    computeAndReport({ title: 'Inbox - a@b.com - Gmail' }, send);
    expect(send).toHaveBeenCalledWith(IPC.UNREAD_UPDATE, 0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/preload-report.test.ts`
Expected: FAIL — module/`computeAndReport` not found.

> Note: the test imports only the pure helper. The Electron side effects below run guarded by `typeof document !== 'undefined'`, so importing this module under Node (Vitest) does not touch Electron APIs.

- [ ] **Step 3: Write the preload**

`electron/preload.ts`:
```ts
import { parseUnreadCount } from './unread-parser';
import { IPC } from './ipc';

export function computeAndReport(
  doc: { title: string },
  send: (channel: string, count: number) => void,
): void {
  send(IPC.UNREAD_UPDATE, parseUnreadCount(doc.title));
}

// Electron-only wiring. Guarded so the module is importable under plain Node (tests).
if (typeof document !== 'undefined') {
  // Lazy require avoids bundling issues and keeps the top of the module Node-safe.
  const { ipcRenderer } = require('electron') as typeof import('electron');

  const report = () =>
    computeAndReport(document, (channel, count) => ipcRenderer.send(channel, count));

  const start = () => {
    report();
    const titleEl = document.querySelector('title');
    if (titleEl) {
      new MutationObserver(report).observe(titleEl, { childList: true });
    }
    // Fallback: Gmail sometimes replaces the title element wholesale.
    setInterval(report, 5000);

    const Original = window.Notification;
    if (Original) {
      const Wrapped = function (this: Notification, title: string, options?: NotificationOptions) {
        const n = new Original(title, options);
        n.addEventListener('click', () => ipcRenderer.send(IPC.NOTIFICATION_ACTIVATE));
        return n;
      } as unknown as typeof Notification;
      Wrapped.permission = Original.permission;
      Wrapped.requestPermission = Original.requestPermission.bind(Original);
      window.Notification = Wrapped;
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/preload-report.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Full test + type-check**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all tests PASS; no type errors.

- [ ] **Step 6: Commit**

```bash
git add electron/preload.ts tests/preload-report.test.ts
git commit -m "feat: add preload reporting unread count and notification clicks"
```

---

### Task 9: `account-view-manager` — a Gmail `WebContentsView` per account

**Files:**
- Create: `electron/account-view-manager.ts`
- Modify: `electron/main.ts` (instantiate the manager, wire IPC handlers)

**Interfaces:**
- Consumes: `Account` + `AccountsStore` (Task 3), `contentBounds`/`SIDEBAR_WIDTH` (Task 4), `IPC` (Task 5), the built preload at `dist-electron/preload.js`.
- Produces:
  - `class AccountViewManager` with `new AccountViewManager(win: BrowserWindow, preloadPath: string, onUnread: (accountId: string, count: number) => void, onActivate: (accountId: string) => void)`.
  - Methods: `ensureView(account: Account): void`, `show(accountId: string): void`, `removeView(accountId: string): void`, `relayout(): void`, `accountIdForWebContents(id: number): string | null`.

- [ ] **Step 1: Write the manager**

`electron/account-view-manager.ts`:
```ts
import { BrowserWindow, WebContentsView } from 'electron';
import type { Account } from './accounts-store';
import { contentBounds } from './layout';
import { IPC } from './ipc';

const GMAIL_URL = 'https://mail.google.com/';

export class AccountViewManager {
  private views = new Map<string, WebContentsView>();
  private activeId: string | null = null;

  constructor(
    private readonly win: BrowserWindow,
    private readonly preloadPath: string,
    private readonly onUnread: (accountId: string, count: number) => void,
    private readonly onActivate: (accountId: string) => void,
  ) {
    this.win.on('resize', () => this.relayout());
  }

  ensureView(account: Account): void {
    if (this.views.has(account.id)) return;
    const view = new WebContentsView({
      webPreferences: {
        preload: this.preloadPath,
        partition: `persist:account-${account.id}`,
        contextIsolation: false,
      },
    });
    view.webContents.on('ipc-message', (_e, channel, ...args) => {
      if (channel === IPC.UNREAD_UPDATE) {
        this.onUnread(account.id, Number(args[0]) || 0);
      } else if (channel === IPC.NOTIFICATION_ACTIVATE) {
        this.onActivate(account.id);
      }
    });
    void view.webContents.loadURL(GMAIL_URL);
    this.win.contentView.addChildView(view);
    view.setVisible(false);
    this.views.set(account.id, view);
  }

  show(accountId: string): void {
    const view = this.views.get(accountId);
    if (!view) return;
    for (const [id, v] of this.views) v.setVisible(id === accountId);
    this.activeId = accountId;
    this.applyBounds(view);
  }

  removeView(accountId: string): void {
    const view = this.views.get(accountId);
    if (!view) return;
    this.win.contentView.removeChildView(view);
    view.webContents.close();
    this.views.delete(accountId);
    if (this.activeId === accountId) this.activeId = null;
  }

  relayout(): void {
    if (this.activeId) {
      const view = this.views.get(this.activeId);
      if (view) this.applyBounds(view);
    }
  }

  accountIdForWebContents(id: number): string | null {
    for (const [accountId, view] of this.views) {
      if (view.webContents.id === id) return accountId;
    }
    return null;
  }

  private applyBounds(view: WebContentsView): void {
    const [width, height] = this.win.getContentSize();
    view.setBounds(contentBounds({ width, height }));
  }
}
```

- [ ] **Step 2: Wire the manager and IPC handlers into `main.ts`**

Replace the contents of `electron/main.ts` with:
```ts
import { app, BrowserWindow, protocol, net, ipcMain } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AccountsStore, type Account } from './accounts-store';
import { AccountViewManager } from './account-view-manager';
import { totalUnread } from './badge-math';
import { IPC } from './ipc';

const RENDERER_DIST = join(__dirname, '..', 'renderer', 'out');
const PRELOAD_PATH = join(__dirname, 'preload.js');
const DEV_URL = process.env.ELECTRON_RENDERER_URL;

let mainWindow: BrowserWindow | null = null;
let manager: AccountViewManager | null = null;
let store: AccountsStore | null = null;
const unreadCounts: Record<string, number> = {};

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

function pushUnread(): void {
  mainWindow?.webContents.send(IPC.UNREAD_CHANGED, { ...unreadCounts });
}

function pushAccounts(): void {
  mainWindow?.webContents.send(IPC.ACCOUNTS_CHANGED, store?.list() ?? []);
}

function activate(accountId: string): void {
  mainWindow?.show();
  manager?.show(accountId);
  mainWindow?.webContents.send(IPC.ACCOUNTS_CHANGED, store?.list() ?? []);
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    backgroundColor: '#0a0a0a',
    webPreferences: { preload: PRELOAD_PATH },
  });

  store = new AccountsStore(join(app.getPath('userData'), 'accounts.json'));
  manager = new AccountViewManager(
    mainWindow,
    PRELOAD_PATH,
    (accountId, count) => {
      unreadCounts[accountId] = count;
      pushUnread();
    },
    (accountId) => activate(accountId),
  );

  for (const account of store.list()) manager.ensureView(account);
  const first = store.list()[0];
  if (first) manager.show(first.id);

  if (DEV_URL) void mainWindow.loadURL(DEV_URL);
  else void mainWindow.loadURL('app://bundle/');
}

function registerIpc(): void {
  ipcMain.handle(IPC.ACCOUNTS_LIST, () => store?.list() ?? []);
  ipcMain.handle(IPC.ACCOUNTS_ADD, (_e, input: { label: string; color: string }) => {
    const account = store!.add(input) as Account;
    manager!.ensureView(account);
    pushAccounts();
    return account;
  });
  ipcMain.handle(IPC.ACCOUNTS_REMOVE, (_e, id: string) => {
    manager!.removeView(id);
    store!.remove(id);
    delete unreadCounts[id];
    pushAccounts();
    pushUnread();
  });
  ipcMain.on(IPC.ACCOUNTS_SWITCH, (_e, id: string) => manager?.show(id));
}

app.whenReady().then(() => {
  registerAppProtocol();
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

export { totalUnread };
```

- [ ] **Step 3: Type-check and build**

Run: `npx tsc --noEmit && npm run build`
Expected: no type errors; build succeeds.

- [ ] **Step 4: Manual verification**

Run: `npm start` (or `xvfb-run -a npm start`).
Expected: window opens with the sidebar. Clicking `+` adds an account button and a Gmail `WebContentsView` appears to the right showing Google's sign-in / Gmail page. Adding a second account shows an isolated login (not sharing the first account's session).

- [ ] **Step 5: Commit**

```bash
git add electron/account-view-manager.ts electron/main.ts
git commit -m "feat: manage isolated gmail views per account"
```

---

### Task 10: `badge-controller` — aggregate unread into the app badge

**Files:**
- Create: `electron/badge-controller.ts`
- Test: `tests/badge-controller.test.ts`
- Modify: `electron/main.ts` (call the controller from the unread callback)

**Interfaces:**
- Consumes: `totalUnread` (Task 4).
- Produces: `applyBadge(counts: Record<string, number>, setBadge: (n: number) => void): number` — computes the total, calls `setBadge`, and returns the total (returned value makes it testable).

- [ ] **Step 1: Write the failing test**

`tests/badge-controller.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { applyBadge } from '../electron/badge-controller';

describe('applyBadge', () => {
  it('sets the badge to the summed unread total', () => {
    const setBadge = vi.fn();
    const total = applyBadge({ a: 2, b: 3 }, setBadge);
    expect(total).toBe(5);
    expect(setBadge).toHaveBeenCalledWith(5);
  });
  it('sets 0 when nothing is unread', () => {
    const setBadge = vi.fn();
    applyBadge({ a: 0 }, setBadge);
    expect(setBadge).toHaveBeenCalledWith(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/badge-controller.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`electron/badge-controller.ts`:
```ts
import { totalUnread } from './badge-math';

export function applyBadge(
  counts: Record<string, number>,
  setBadge: (n: number) => void,
): number {
  const total = totalUnread(counts);
  setBadge(total);
  return total;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/badge-controller.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire it into `main.ts`**

In `electron/main.ts`, add the import near the other imports:
```ts
import { applyBadge } from './badge-controller';
```

Then update the unread callback inside `createWindow` (the arrow passed to `AccountViewManager`) so it also updates the badge:
```ts
    (accountId, count) => {
      unreadCounts[accountId] = count;
      pushUnread();
      applyBadge(unreadCounts, (n) => app.setBadgeCount(n));
    },
```

- [ ] **Step 6: Type-check and build**

Run: `npx tsc --noEmit && npm run build`
Expected: no errors; build succeeds.

- [ ] **Step 7: Commit**

```bash
git add electron/badge-controller.ts tests/badge-controller.test.ts electron/main.ts
git commit -m "feat: reflect total unread count in the app badge"
```

---

### Task 11: Sidebar bridge — expose IPC to the renderer via a second preload

**Files:**
- Create: `electron/sidebar-preload.ts`
- Modify: `package.json` (add `sidebar-preload.ts` to the esbuild entry list)
- Modify: `electron/main.ts` (use `sidebar-preload.js` for the main window)

**Interfaces:**
- Consumes: `IPC` (Task 5).
- Produces: `window.desktop` implementing the `DesktopBridge` interface the renderer (Task 6) already expects: `listAccounts`, `addAccount`, `removeAccount`, `switchAccount`, `onAccountsChanged`, `onUnreadChanged`.

- [ ] **Step 1: Write the sidebar preload**

`electron/sidebar-preload.ts`:
```ts
import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from './ipc';

interface Account {
  id: string;
  label: string;
  color: string;
}

contextBridge.exposeInMainWorld('desktop', {
  listAccounts: (): Promise<Account[]> => ipcRenderer.invoke(IPC.ACCOUNTS_LIST),
  addAccount: (input: { label: string; color: string }): Promise<Account> =>
    ipcRenderer.invoke(IPC.ACCOUNTS_ADD, input),
  removeAccount: (id: string): Promise<void> => ipcRenderer.invoke(IPC.ACCOUNTS_REMOVE, id),
  switchAccount: (id: string): void => ipcRenderer.send(IPC.ACCOUNTS_SWITCH, id),
  onAccountsChanged: (cb: (accounts: Account[]) => void): void => {
    ipcRenderer.on(IPC.ACCOUNTS_CHANGED, (_e, accounts) => cb(accounts));
  },
  onUnreadChanged: (cb: (counts: Record<string, number>) => void): void => {
    ipcRenderer.on(IPC.UNREAD_CHANGED, (_e, counts) => cb(counts));
  },
});
```

- [ ] **Step 2: Add it to the esbuild entry list**

In `package.json`, change the `build:main` script to include the new file:
```json
    "build:main": "esbuild electron/main.ts electron/preload.ts electron/sidebar-preload.ts --bundle --platform=node --target=node20 --external:electron --outdir=dist-electron --format=cjs",
```

- [ ] **Step 3: Point the main window at the sidebar preload**

In `electron/main.ts`, add a constant next to `PRELOAD_PATH`:
```ts
const SIDEBAR_PRELOAD_PATH = join(__dirname, 'sidebar-preload.js');
```
and change the `BrowserWindow` `webPreferences` in `createWindow` to:
```ts
    webPreferences: { preload: SIDEBAR_PRELOAD_PATH, contextIsolation: true },
```
(The account Gmail views keep using `PRELOAD_PATH` — leave the `AccountViewManager` construction unchanged.)

- [ ] **Step 4: Type-check and build**

Run: `npx tsc --noEmit && npm run build`
Expected: no errors; `dist-electron/sidebar-preload.js` exists.

- [ ] **Step 5: Manual verification — end-to-end account flow**

Run: `npm start` (or `xvfb-run -a npm start`).
Expected:
- Sidebar shows persisted accounts on launch.
- Clicking `+` adds an account, its Gmail view loads, and the button appears.
- Switching accounts swaps the visible Gmail view.
- Signing into Gmail and receiving/reading mail updates the red unread badge on that account's button (title-driven), and the OS app badge (macOS/Linux) reflects the total.

- [ ] **Step 6: Commit**

```bash
git add electron/sidebar-preload.ts package.json electron/main.ts
git commit -m "feat: bridge account IPC to the sidebar renderer"
```

---

### Task 12: `tray-controller` — tray icon and hide-to-tray background running

**Files:**
- Create: `electron/tray-controller.ts`
- Modify: `electron/main.ts` (create the tray; intercept window close)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `shouldHideOnClose(state: { isQuitting: boolean; platform: NodeJS.Platform }): boolean` — pure decision helper (testable): hide-to-tray unless the app is actually quitting.
  - `createTray(opts: { onOpen: () => void; onQuit: () => void }): Tray` — builds the tray with "Open" / "Quit".
- Test: `tests/tray-controller.test.ts`

- [ ] **Step 1: Write the failing test for the pure helper**

`tests/tray-controller.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { shouldHideOnClose } from '../electron/tray-controller';

describe('shouldHideOnClose', () => {
  it('hides to tray during a normal close', () => {
    expect(shouldHideOnClose({ isQuitting: false, platform: 'linux' })).toBe(true);
  });
  it('does not hide when the app is quitting', () => {
    expect(shouldHideOnClose({ isQuitting: true, platform: 'linux' })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/tray-controller.test.ts`
Expected: FAIL — module/`shouldHideOnClose` not found.

> The test imports only `shouldHideOnClose`, which has no Electron import, so it runs under Node. `createTray` imports Electron lazily inside the function body.

- [ ] **Step 3: Write the implementation**

`electron/tray-controller.ts`:
```ts
import type { Tray } from 'electron';

export function shouldHideOnClose(state: {
  isQuitting: boolean;
  platform: NodeJS.Platform;
}): boolean {
  return !state.isQuitting;
}

export function createTray(opts: { onOpen: () => void; onQuit: () => void }): Tray {
  const { Tray, Menu, nativeImage } = require('electron') as typeof import('electron');
  // Empty image => platform default tray icon; a real icon can be added later.
  const tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip('Gmail Desktop');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open', click: opts.onOpen },
      { type: 'separator' },
      { label: 'Quit', click: opts.onQuit },
    ]),
  );
  tray.on('click', opts.onOpen);
  return tray;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/tray-controller.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire the tray and close-interception into `main.ts`**

In `electron/main.ts`:

Add imports:
```ts
import type { Tray } from 'electron';
import { shouldHideOnClose, createTray } from './tray-controller';
```

Add module-level state:
```ts
let tray: Tray | null = null;
let isQuitting = false;
```

At the end of `createWindow()` (after the `loadURL` calls), add the close interceptor:
```ts
  mainWindow.on('close', (e) => {
    if (shouldHideOnClose({ isQuitting, platform: process.platform })) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
```

Inside the `app.whenReady().then(...)` callback, after `createWindow()`, create the tray:
```ts
  tray = createTray({
    onOpen: () => mainWindow?.show(),
    onQuit: () => {
      isQuitting = true;
      app.quit();
    },
  });
  void tray; // retained for lifetime of the app
```

Replace the `window-all-closed` handler so background running works (do not quit when the window is merely hidden):
```ts
app.on('window-all-closed', () => {
  // Intentionally left running in the tray; quit only via the tray menu.
});

app.on('before-quit', () => {
  isQuitting = true;
});
```

- [ ] **Step 6: Type-check, build, full test run**

Run: `npx tsc --noEmit && npm run build && npx vitest run`
Expected: no type errors; build succeeds; all tests PASS.

- [ ] **Step 7: Manual verification**

Run: `npm start` (or `xvfb-run -a npm start`).
Expected: closing the window hides it to the tray (process keeps running); the tray "Open" entry restores it; "Quit" exits the app.

- [ ] **Step 8: Commit**

```bash
git add electron/tray-controller.ts tests/tray-controller.test.ts electron/main.ts
git commit -m "feat: add system tray with hide-to-tray background running"
```

---

### Task 13: Packaging config + README

**Files:**
- Create: `electron-builder.yml`
- Create: `README.md`
- Modify: `package.json` (add `build` metadata / files list if needed)

**Interfaces:**
- Consumes: `dist-electron/`, `renderer/out/` (build outputs).
- Produces: a `npm run dist` that produces installers/packages for the current platform. (electron-builder falls back to a default Electron icon when no custom art is supplied.)

- [ ] **Step 1: Create the electron-builder config**

`electron-builder.yml`:
```yaml
appId: com.gmaildesktop.app
productName: Gmail Desktop
directories:
  output: dist
files:
  - dist-electron/**/*
  - renderer/out/**/*
  - package.json
linux:
  target:
    - AppImage
    - deb
  category: Network
win:
  target:
    - nsis
mac:
  target:
    - dmg
  category: public.app-category.productivity
```

- [ ] **Step 2: Write the README (English — user preference)**

`README.md`:
```markdown
# Gmail Desktop

A cross-platform desktop wrapper for Gmail. It loads the real Gmail web
interface in isolated per-account sessions and adds a native shell:
account sidebar, desktop notifications, an unread badge, and a system tray
that keeps the app running in the background.

## Requirements

- Node.js >= 22
- npm >= 10

## Development

```bash
npm install
cd renderer && npm install && cd ..
npm run build      # builds the Next.js sidebar and the Electron bundles
npm start          # launches the app
```

## Tests

```bash
npm test
```

## Packaging

```bash
npm run dist       # builds installers for the current platform via electron-builder
```

Outputs are written to `dist/`.

## Architecture

- **Electron main** owns the window, tray, accounts store, and one
  `WebContentsView` per account (isolated `persist:` session partitions).
- **Next.js (static export)** renders the sidebar chrome only.
- A **preload** injected into each Gmail view reports the unread count
  (parsed from the document title) and routes notification clicks over IPC.

## Scope

This is a wrapper around Gmail's web UI, not a standalone mail client. Not
yet included: auto-updates, `mailto:` handling, global shortcuts, offline
storage.
```

- [ ] **Step 3: Verify a build produces output**

Run: `npm run build && npm run dist`
Expected: electron-builder completes; artifacts appear in `dist/` (e.g. an AppImage / deb on Linux).
> Packaging downloads platform tooling on first run and needs network access. If unavailable in this environment, verify `npm run build` succeeds and note that `npm run dist` requires network.

- [ ] **Step 4: Commit**

```bash
git add electron-builder.yml README.md package.json
git commit -m "chore: add packaging config and readme"
```

---

## Self-Review Notes

- **Spec coverage:** wrapper (Task 7,9) · Electron (all) · cross-platform packaging (Task 13) · Next.js+TS+Tailwind sidebar (Task 6) · isolated multi-account sessions (Task 9) · sidebar with per-account badges (Task 6,11) · unread title parser (Task 2) · app badge with Windows deferral noted (Task 10 + Global Constraints) · notifications routed on click (Task 8) · tray + background (Task 12) · pure testable modules (Tasks 2,3,4,8,10,12). All spec sections map to a task.
- **Placeholder scan:** no TBD/TODO; every code step contains complete code; the tray uses an empty native image (valid, documented) rather than a placeholder asset; packaging relies on electron-builder's default icon fallback.
- **Type consistency:** `Account { id,label,color }` identical across `accounts-store`, renderer bridge, and `sidebar-preload`. `IPC` channel names are the single source used by main, preload, and renderer. `DesktopBridge` methods in the renderer (Task 6) match the `window.desktop` shape exposed in Task 11 exactly.
```
