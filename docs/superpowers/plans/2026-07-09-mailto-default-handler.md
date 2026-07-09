# mailto: Default-Handler Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register the app as the system `mailto:` handler so clicking an email link opens a prefilled Gmail compose window in the app, sent from an account the user picks.

**Architecture:** Two pure, unit-tested modules — a `mailto:` parser and a compose-URL builder — plus thin Electron wiring on top of the existing single-instance lock, `openCompose`, and Settings/`window.desktop` bridge. The send-from account is chosen via a native `dialog.showMessageBox` when more than one account exists. Becoming the default handler happens on launch and via a Settings → General button.

**Tech Stack:** TypeScript, Electron (main + preload), Next.js/React renderer, Vitest.

## Global Constraints

- **No Gmail-DOM scraping and no keystroke injection** — both are known-fragile in this project. All logic lives at the Electron shell layer.
- Gmail compose URL uses `su` for subject (not `subject`) and `body`, `to`, `cc`, `bcc`. Base compose URL is exactly `https://mail.google.com/mail/u/${index}/?view=cm&fs=1&tf=1`.
- `mailto:` query values are **not** form-encoded: decode with `decodeURIComponent` (so `%20` → space) and treat `+` as a literal `+`. Never use `URLSearchParams` (it turns `+` into a space).
- All new user-facing text goes in `renderer/app/strings.ts` in BOTH flavors — English (`STRINGS_NORMAL`) and Rene-mode Dutch (`STRINGS_RENE`) — and in the `UiStrings` interface.
- `setAsDefaultProtocolClient('mailto')` is reliable only in packaged builds; unpackaged dev is not the test path. Verification for shell-wiring tasks is `npx tsc --noEmit` (root) + `-p renderer/tsconfig.json` for renderer files (the root tsconfig EXCLUDES `renderer/`, so root tsc is a false pass for renderer changes).
- Default behavior is additive: no existing feature changes. The `openCompose` refactor must keep the no-args URL byte-identical to today's.

---

### Task 1: mailto parser (pure)

**Files:**
- Create: `electron/mailto.ts`
- Test: `tests/mailto.test.ts`

**Interfaces:**
- Produces:
  - `interface MailtoFields { to: string; cc: string; bcc: string; subject: string; body: string }`
  - `parseMailto(url: string): MailtoFields | null`
  - `extractMailtoFromArgv(argv: string[]): string | null`

- [ ] **Step 1: Write the failing tests**

Create `tests/mailto.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseMailto, extractMailtoFromArgv } from '../electron/mailto';

describe('parseMailto', () => {
  it('returns null for a non-mailto url', () => {
    expect(parseMailto('https://example.com')).toBeNull();
  });
  it('parses a single recipient from the path', () => {
    expect(parseMailto('mailto:a@b.com')).toEqual({ to: 'a@b.com', cc: '', bcc: '', subject: '', body: '' });
  });
  it('parses multiple comma-separated path recipients', () => {
    expect(parseMailto('mailto:a@b.com,c@d.com').to).toBe('a@b.com,c@d.com');
  });
  it('reads subject and body from the query, percent-decoded', () => {
    const r = parseMailto('mailto:a@b.com?subject=Hi%20there&body=Line%20one');
    expect(r).toMatchObject({ subject: 'Hi there', body: 'Line one' });
  });
  it('reads cc and bcc from the query', () => {
    const r = parseMailto('mailto:a@b.com?cc=c@d.com&bcc=e@f.com');
    expect(r).toMatchObject({ cc: 'c@d.com', bcc: 'e@f.com' });
  });
  it('merges a to= query param with path recipients', () => {
    expect(parseMailto('mailto:a@b.com?to=c@d.com').to).toBe('a@b.com,c@d.com');
  });
  it('decodes an encoded ampersand in the body and treats + as literal', () => {
    const r = parseMailto('mailto:a@b.com?body=you%20%26%20me%20a+b');
    expect(r!.body).toBe('you & me a+b');
  });
  it('scheme-only mailto: yields all-empty fields', () => {
    expect(parseMailto('mailto:')).toEqual({ to: '', cc: '', bcc: '', subject: '', body: '' });
  });
  it('is case-insensitive on the scheme', () => {
    expect(parseMailto('MAILTO:a@b.com')!.to).toBe('a@b.com');
  });
});

describe('extractMailtoFromArgv', () => {
  it('finds a mailto arg among electron flags', () => {
    expect(extractMailtoFromArgv(['electron', '--flag', 'mailto:a@b.com'])).toBe('mailto:a@b.com');
  });
  it('returns null when no mailto arg is present', () => {
    expect(extractMailtoFromArgv(['electron', '.', '--foo'])).toBeNull();
  });
  it('returns the first mailto when several are present', () => {
    expect(extractMailtoFromArgv(['mailto:a@b.com', 'mailto:c@d.com'])).toBe('mailto:a@b.com');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/mailto.test.ts`
Expected: FAIL — "Cannot find module '../electron/mailto'".

- [ ] **Step 3: Implement `electron/mailto.ts`**

```ts
export interface MailtoFields {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
}

// decodeURIComponent, but tolerant of malformed sequences (never throws).
function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

// Split a raw comma list into decoded, trimmed, non-empty addresses.
function recipients(raw: string): string[] {
  return raw
    .split(',')
    .map((t) => decode(t).trim())
    .filter(Boolean);
}

/** Parse a mailto: URL into Gmail compose fields, or null if not a mailto. */
export function parseMailto(url: string): MailtoFields | null {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!/^mailto:/i.test(trimmed)) return null;
  const rest = trimmed.slice('mailto:'.length);
  const q = rest.indexOf('?');
  const pathPart = q === -1 ? rest : rest.slice(0, q);
  const queryPart = q === -1 ? '' : rest.slice(q + 1);

  // Store RAW (undecoded) query values, first occurrence wins; decode per field.
  const query: Record<string, string> = {};
  for (const pair of queryPart.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const key = (eq === -1 ? pair : pair.slice(0, eq)).toLowerCase();
    const val = eq === -1 ? '' : pair.slice(eq + 1);
    if (!(key in query)) query[key] = val;
  }

  return {
    to: [...recipients(pathPart), ...recipients(query.to ?? '')].join(','),
    cc: recipients(query.cc ?? '').join(','),
    bcc: recipients(query.bcc ?? '').join(','),
    subject: decode(query.subject ?? ''),
    body: decode(query.body ?? ''),
  };
}

/** First argv entry that is a mailto: URL, else null. */
export function extractMailtoFromArgv(argv: string[]): string | null {
  if (!Array.isArray(argv)) return null;
  return argv.find((a) => typeof a === 'string' && /^mailto:/i.test(a.trim())) ?? null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/mailto.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add electron/mailto.ts tests/mailto.test.ts
git commit -m "feat: add mailto parser and argv extractor"
```

---

### Task 2: compose-URL builder + openCompose refactor

**Files:**
- Create: `electron/compose-url.ts`
- Test: `tests/compose-url.test.ts`
- Modify: `electron/compose-window.ts` (openCompose)

**Interfaces:**
- Consumes: `MailtoFields` from Task 1.
- Produces: `composeUrl(index: number, fields?: MailtoFields): string`; `openCompose(index: number, fields?: MailtoFields): void`.

- [ ] **Step 1: Write the failing tests**

Create `tests/compose-url.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { composeUrl } from '../electron/compose-url';

const BASE = 'https://mail.google.com/mail/u/0/?view=cm&fs=1&tf=1';

describe('composeUrl', () => {
  it('with no fields returns exactly the current compose URL', () => {
    expect(composeUrl(0)).toBe(BASE);
  });
  it('puts the account index in the path', () => {
    expect(composeUrl(3)).toBe('https://mail.google.com/mail/u/3/?view=cm&fs=1&tf=1');
  });
  it('appends and encodes non-empty fields, subject as su', () => {
    const u = composeUrl(0, { to: 'a@b.com', cc: '', bcc: '', subject: 'Hi there', body: 'x&y' });
    expect(u).toBe(`${BASE}&to=a%40b.com&su=Hi%20there&body=x%26y`);
  });
  it('omits empty fields', () => {
    const u = composeUrl(0, { to: 'a@b.com', cc: '', bcc: '', subject: '', body: '' });
    expect(u).toBe(`${BASE}&to=a%40b.com`);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/compose-url.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `electron/compose-url.ts`**

```ts
import type { MailtoFields } from './mailto';

// Builds Gmail's standalone compose URL for account `index`, optionally
// prefilled from mailto fields. With no fields this equals the plain compose URL.
export function composeUrl(index: number, fields?: MailtoFields): string {
  const base = `https://mail.google.com/mail/u/${index}/?view=cm&fs=1&tf=1`;
  if (!fields) return base;
  const params: Array<[string, string]> = [
    ['to', fields.to],
    ['su', fields.subject],
    ['body', fields.body],
    ['cc', fields.cc],
    ['bcc', fields.bcc],
  ];
  return (
    base +
    params
      .filter(([, v]) => v !== '')
      .map(([k, v]) => `&${k}=${encodeURIComponent(v)}`)
      .join('')
  );
}
```

- [ ] **Step 4: Refactor `openCompose` in `electron/compose-window.ts`**

Add the imports at the top:

```ts
import { composeUrl } from './compose-url';
import type { MailtoFields } from './mailto';
```

Replace the current `openCompose` function body with:

```ts
export function openCompose(index: number, fields?: MailtoFields): void {
  const win = new BrowserWindow({
    width: 720,
    height: 640,
    title: 'New message',
    backgroundColor: '#ffffff',
    webPreferences: { partition: SESSION_PARTITION, contextIsolation: true },
  });
  attachExternalLinkHandling(win.webContents);
  void win.loadURL(composeUrl(index, fields));
}
```

(Leave `openFullThreadWindow` unchanged.)

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run tests/compose-url.test.ts && npx tsc --noEmit`
Expected: tests PASS; tsc PASS (openCompose's existing single-arg caller in main.ts still typechecks because `fields` is optional).

- [ ] **Step 6: Commit**

```bash
git add electron/compose-url.ts tests/compose-url.test.ts electron/compose-window.ts
git commit -m "feat: build compose URL from mailto fields; openCompose takes optional fields"
```

---

### Task 3: Become the default mail handler (register + Settings IPC/bridge/status)

**Files:**
- Modify: `electron/ipc.ts` (two channels), `electron/main.ts` (register on launch, handler, status push), `electron/sidebar-preload.ts` (bridge), `renderer/app/page.tsx` (bridge type + status state)

**Interfaces:**
- Produces: IPC `SET_DEFAULT_MAIL` (renderer→main), `MAIL_DEFAULT_STATUS` (main→renderer, boolean); bridge `window.desktop.setDefaultMail()` and `onDefaultMailStatus(cb: (isDefault: boolean) => void)`; a renderer `isDefaultMail` state.
- Consumes: nothing from Tasks 1–2.

No unit test (Electron/renderer singletons); verify via `npx tsc --noEmit` and `-p renderer/tsconfig.json`.

- [ ] **Step 1: Add IPC channels in `electron/ipc.ts`**

In the renderer→main group (near `SET_RENE_MODE`), add:

```ts
  SET_DEFAULT_MAIL: 'mail:set-default', // send() — (re)claim the OS mailto: default
```

In the main→renderer group (near `PREFS_CHANGED`), add:

```ts
  MAIL_DEFAULT_STATUS: 'mail:default-status', // main -> renderer: boolean (is default mailto client)
```

- [ ] **Step 2: main.ts — register on launch + status push + handler**

Add a push helper near `pushPrefs` (main.ts ~262):

```ts
function pushDefaultMailStatus(): void {
  mainWindow?.webContents.send(IPC.MAIL_DEFAULT_STATUS, app.isDefaultProtocolClient('mailto'));
}
```

In the `app.whenReady().then(() => { ... })` block, right after `registerIpc();` add:

```ts
  app.setAsDefaultProtocolClient('mailto');
```

Add the IPC handler inside `registerIpc()` (alongside the other `ipcMain.on` handlers, e.g. next to `SET_AUTO_START`):

```ts
  ipcMain.on(IPC.SET_DEFAULT_MAIL, () => {
    app.setAsDefaultProtocolClient('mailto');
    pushDefaultMailStatus();
  });
```

Push the initial status wherever the renderer (re)load pushes profiles/prefs — add `pushDefaultMailStatus();` immediately after the existing `pushPrefs();` call in the window's `did-finish-load`/load handler (main.ts ~704).

- [ ] **Step 3: sidebar-preload.ts — bridge**

In the `window.desktop` object, add:

```ts
  setDefaultMail: (): void => ipcRenderer.send(IPC.SET_DEFAULT_MAIL),
  onDefaultMailStatus: (cb: (isDefault: boolean) => void): void => {
    ipcRenderer.on(IPC.MAIL_DEFAULT_STATUS, (_e, v) => cb(Boolean(v)));
  },
```

- [ ] **Step 4: page.tsx — bridge type + status state**

In the `DesktopBridge`/`window.desktop` type declaration, add:

```ts
  setDefaultMail(): void;
  onDefaultMailStatus(cb: (isDefault: boolean) => void): void;
```

In the page component, add state and subscribe (next to the other `bridge.onXxx` subscriptions in the mount `useEffect`):

```ts
  const [isDefaultMail, setIsDefaultMail] = useState(false);
  // inside the existing mount useEffect:
  bridge.onDefaultMailStatus(setIsDefaultMail);
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit && npx tsc --noEmit -p renderer/tsconfig.json`
Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add electron/ipc.ts electron/main.ts electron/sidebar-preload.ts renderer/app/page.tsx
git commit -m "feat: register as default mailto client and expose status to renderer"
```

---

### Task 4: mailto delivery + account chooser + compose dispatch

**Files:**
- Modify: `electron/main.ts` (imports, `pendingMailto`, `chooseComposeAccount`, `dispatchMailto`, `flushPendingMailto`, cold-start argv, `second-instance`, `open-url`)

**Interfaces:**
- Consumes: `parseMailto`, `extractMailtoFromArgv` (Task 1); `openCompose(index, fields)` (Task 2); the default-client registration (Task 3); existing `profiles`, `manager`, `authIdx`, `mainWindow`, `prefs`, `showAccount`.

No unit test (Electron singletons + native dialog). Verify via `npx tsc --noEmit` and the manual smoke test at the end of this plan.

- [ ] **Step 1: Add imports and module state in `electron/main.ts`**

Add to the electron import (which already imports `app`, `BrowserWindow`, etc.) the `dialog` member, and import the pure helpers:

```ts
import { dialog } from 'electron'; // add `dialog` to the existing electron import line
import { parseMailto, extractMailtoFromArgv } from './mailto';
```

Add module-level state near the other `let` singletons (e.g. by `let mainWindow`):

```ts
let pendingMailto: string | null = null;
```

- [ ] **Step 2: Add the account chooser (native dialog)**

Add near `handleInput`/`openCompose` usage (main.ts ~430):

```ts
// Picks the authuser index to compose from for an incoming mailto. One account →
// that account; several → a native chooser (labels come from prefs/name/email);
// none / cancelled → null.
function chooseComposeAccount(): number | null {
  const authusers = profiles.filter((p) => p.ref.kind === 'authuser');
  if (authusers.length === 0) return null;
  if (authusers.length === 1) return authIdx(authusers[0]);
  const labels = authusers.map((p) => prefs?.getAccount(p.email).label ?? p.name ?? p.email);
  const cancelId = labels.length;
  const chosen = dialog.showMessageBoxSync(mainWindow!, {
    type: 'question',
    title: 'New message',
    message: 'Send from which account?',
    buttons: [...labels, 'Cancel'],
    cancelId,
    defaultId: 0,
  });
  return chosen === cancelId ? null : authIdx(authusers[chosen]);
}
```

- [ ] **Step 3: Add dispatch + pending flush**

```ts
// Focuses the window, then composes from the chosen account. If no account/mail
// view is ready yet (e.g. cold start still logging in), queues until one is.
function dispatchMailto(mailtoUrl: string): void {
  const fields = parseMailto(mailtoUrl);
  if (!fields) return;
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  }
  const ready =
    manager?.activeKey() != null && profiles.some((p) => p.ref.kind === 'authuser');
  if (!ready) {
    pendingMailto = mailtoUrl;
    return;
  }
  const index = chooseComposeAccount();
  if (index == null) return;
  openCompose(index, fields);
}

function flushPendingMailto(): void {
  if (!pendingMailto) return;
  if (manager?.activeKey() == null) return; // still not ready
  const url = pendingMailto;
  pendingMailto = null;
  dispatchMailto(url);
}
```

- [ ] **Step 4: Flush when a mail view becomes active**

In `showAccount` (main.ts ~366), add `flushPendingMailto();` as the last line of the function (after `refreshNotifyAllowed();`). This runs the queued mailto once the first mail surface is live. (Safe against loops: `flushPendingMailto` clears `pendingMailto` before dispatch, and `dispatchMailto` only re-queues when no mail view is active — which is false here.)

- [ ] **Step 5: Cold-start argv**

In `app.whenReady().then(...)`, after `createWindow();`, add:

```ts
  const initialMailto = extractMailtoFromArgv(process.argv);
  if (initialMailto) pendingMailto = initialMailto;
```

- [ ] **Step 6: Running-instance argv (Windows/Linux)**

Change the existing `second-instance` handler (main.ts ~873) to receive argv and dispatch:

```ts
  app.on('second-instance', (_e, argv) => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
    const url = extractMailtoFromArgv(argv);
    if (url) dispatchMailto(url);
  });
```

- [ ] **Step 7: macOS open-url**

Register a top-level handler (outside `whenReady`, next to the single-instance block so it is set before ready fires):

```ts
app.on('open-url', (event, url) => {
  event.preventDefault();
  dispatchMailto(url); // queues itself if the app isn't ready yet
});
```

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add electron/main.ts
git commit -m "feat: handle mailto links via argv/open-url with an account chooser"
```

---

### Task 5: Settings → General "Set as default mail app" button + strings

**Files:**
- Modify: `renderer/app/strings.ts` (4 keys ×2 flavors + interface), `renderer/app/SettingsPanel.tsx` (props + General-section row), `renderer/app/page.tsx` (pass props to SettingsPanel)

**Interfaces:**
- Consumes: `window.desktop.setDefaultMail()` and the `isDefaultMail` state from Task 3.
- Produces: the user-visible button. Final task.

- [ ] **Step 1: Add strings to `renderer/app/strings.ts`**

In the `UiStrings` interface (near `autoStart`), add:

```ts
  setDefaultMail: string;
  setDefaultMailHint: string;
  isDefaultMail: string;
  notDefaultMail: string;
```

In `STRINGS_NORMAL` (English), add:

```ts
  setDefaultMail: 'Set as default mail app',
  setDefaultMailHint: 'Windows may ask you to confirm the change.',
  isDefaultMail: 'This is your default mail app',
  notDefaultMail: 'Not your default mail app',
```

In `STRINGS_RENE` (simple Dutch), add:

```ts
  setDefaultMail: 'Maak dit je standaard-mailprogramma',
  setDefaultMailHint: 'Windows vraagt misschien of je het zeker weet.',
  isDefaultMail: 'Dit is je standaard-mailprogramma',
  notDefaultMail: 'Nog niet je standaard-mailprogramma',
```

- [ ] **Step 2: Thread the prop into SettingsPanel**

In `renderer/app/SettingsPanel.tsx`, add to the destructured props (near `onSetAutoStart`) and to the props type:

```ts
  isDefaultMail,
  onSetDefaultMail,
```

Props type (near `onSetAutoStart: (v: boolean) => void;`):

```ts
  isDefaultMail: boolean;
  onSetDefaultMail: () => void;
```

- [ ] **Step 3: Add the General-section row**

In the General section, right after the auto-start `<label>` block (SettingsPanel.tsx ~286), add:

```tsx
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 flex-col">
              <span className="text-sm">{S.setDefaultMail}</span>
              <span className="text-xs text-neutral-400">
                {isDefaultMail ? S.isDefaultMail : S.notDefaultMail} — {S.setDefaultMailHint}
              </span>
            </div>
            <button
              onClick={onSetDefaultMail}
              disabled={isDefaultMail}
              className="shrink-0 rounded bg-neutral-200 px-3 py-1 text-sm hover:bg-neutral-300 disabled:opacity-50 dark:bg-neutral-800 dark:hover:bg-neutral-700"
            >
              {S.setDefaultMail}
            </button>
          </div>
```

- [ ] **Step 4: Pass the props from page.tsx**

In `renderer/app/page.tsx` at the `<SettingsPanel` render (page.tsx ~478), add:

```tsx
          isDefaultMail={isDefaultMail}
          onSetDefaultMail={() => window.desktop?.setDefaultMail()}
```

- [ ] **Step 5: Typecheck + full test suite**

Run: `npx tsc --noEmit -p renderer/tsconfig.json && npx vitest run`
Expected: renderer tsc PASS; all tests PASS (no regressions).

- [ ] **Step 6: Commit**

```bash
git add renderer/app/strings.ts renderer/app/SettingsPanel.tsx renderer/app/page.tsx
git commit -m "feat: add 'Set as default mail app' button to settings"
```

---

## Verification (after all tasks — manual, on a packaged Windows build)

The `mailto:` registration and dialog can't be exercised in WSL; smoke-test on the installed Windows build:

1. Build/install the app (`build.cmd` on Windows).
2. Settings → General: click **"Set as default mail app"**; confirm Windows' prompt if shown; the status line flips to "This is your default mail app" and the button disables.
3. With the app **running**, click a `mailto:test@example.com?subject=Hi&body=Hello` link in a browser → the window focuses; with one account, a compose window opens prefilled (To/Subject/Body); with several accounts, the native chooser lists them and the picked one composes.
4. **Quit** the app fully (tray → Quit), then click a mailto link → the app cold-starts, signs in/detects, and once the inbox is live the queued compose opens.
5. Confirm the plain compose shortcut still opens an empty compose (openCompose refactor regression).

## Self-Review Notes

- **Spec coverage:** parser (Task 1), compose URL + openCompose refactor (Task 2), default-client registration + status IPC/bridge (Task 3), delivery via argv/open-url/second-instance + chooser + pending flush (Task 4), Settings button + strings (Task 5), manual verification (above). All spec sections mapped.
- **Type consistency:** `MailtoFields` defined in Task 1 is imported by Task 2 (`compose-url.ts`, `compose-window.ts`) and used by `parseMailto`/`openCompose` in Task 4. `composeUrl(index, fields?)` / `openCompose(index, fields?)` signatures match across Tasks 2 and 4. IPC names `SET_DEFAULT_MAIL` / `MAIL_DEFAULT_STATUS` and bridge methods `setDefaultMail` / `onDefaultMailStatus` are identical across Tasks 3 and 5. `isDefaultMail: boolean` prop shape matches page.tsx → SettingsPanel.
- **No placeholders:** every code and command step is concrete.
