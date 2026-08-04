# Default Mail Client on Windows — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "mail gaat door deze app" actually work on Windows — register Gmail Desktop as a mail client so Windows lists it, send the user to the one place that can grant the default, and report the true state instead of a self-reported one.

**Architecture:** Windows refuses to let an app award itself the `mailto:` default; only the shell can write the hashed `UserChoice` key. So we split the job in three: (1) two pure, unit-tested modules — one that builds the per-user registry plan for a mail-client registration, one that reads the real default out of `UserChoice`; (2) thin Electron wiring that runs those through `reg.exe` and opens the Windows Settings page; (3) the same registration written by the NSIS installer, so the app appears in the Windows list even before it is first launched.

**Tech Stack:** Electron 31 (main), Next.js 14 static export (renderer), vitest, esbuild, electron-builder 24 (NSIS, per-user one-click), `reg.exe` from the OS (no new npm dependency).

---

## Background — why the current code cannot work

Measured on Windows 11 Pro 26100 with 0.2.9 installed, 2026-08-04:

| Where | Value |
| --- | --- |
| `HKCU\Software\Classes\mailto\shell\open\command` | `"…\Programs\gmail-desktop\Gmail Desktop.exe" "%1"` |
| `HKCU\…\Shell\Associations\UrlAssociations\mailto\UserChoice` | `ProgId = Outlook.URL.mailto.15`, `Hash = JqSVLxHiRiM=` |
| `AssocQueryString("mailto", EXECUTABLE)` | `C:\Program Files\Microsoft Office\Root\Office16\OUTLOOK.EXE` |
| `HKCU\Software\Clients\Mail` | does not exist |
| `HKCU\Software\RegisteredApplications` | no Gmail Desktop entry |

Three separate defects follow from this:

1. **The write is inert.** `app.setAsDefaultProtocolClient('mailto')` writes `HKCU\Software\Classes\mailto`. Since Windows 8 the shell resolves `mailto:` through `UserChoice`, whose `Hash` is bound to the user SID + ProgId and can only be produced by the shell itself. Outlook keeps the protocol; our key is never consulted.
2. **The status lies.** Electron 31's `Browser::IsDefaultProtocolClient` (`shell/browser/browser_win.cc`) reads back the very key it just wrote and never looks at `UserChoice`. So `pushDefaultMailStatus()` reports `true` and the Switch in `GeneralSection` shows "on" while Outlook handles every link.
3. **There is no manual route either.** The Windows *Standaard-apps* list is built from `RegisteredApplications` → `Clients\Mail\<app>\Capabilities\URLAssociations`. Nobody writes those keys — not the app, and not the installer (`electron-builder.yml` has no `protocols:` section). The app is absent from the OS list, so the user cannot pick it by hand.

**What this plan does *not* promise:** the app still cannot take the default by itself. Success is: Windows lists us, one click takes the user to the page where they grant it, and our UI tells the truth before and after.

## Global Constraints

- **Comment policy:** one English block at the top of a file saying what it is for and which pitfall applies; no loose comments below it. `STRINGS_RENE` values stay Dutch.
- **No new runtime dependencies.** `dependencies` stays `ws` only. Registry access goes through `reg.exe` via `node:child_process`.
- Node >= 22, npm >= 10.
- **Registry scope is `HKCU` only.** The build is a per-user one-click NSIS install; never write `HKLM` and never require elevation.
- **Never write registration in a dev run.** `process.execPath` is `node_modules\electron\dist\electron.exe` there; guard every write with `app.isPackaged`.
- **Windows-only.** Every new call site must be behind `process.platform === 'win32'`; macOS/Linux keep the existing `setAsDefaultProtocolClient` path.
- ProgId is `GmailDesktop.Url.mailto`; the registered application name is `Gmail Desktop` (must match `productName` in `electron-builder.yml`).
- Verification for renderer changes is `npx tsc --noEmit -p renderer/tsconfig.json` — the root `tsconfig.json` excludes `renderer/`, so root `tsc` is a false pass there.
- Shell-wiring and installer tasks cannot be proven by unit tests; they are verified in a packaged build per Task 6.

## File Structure

| File | Responsibility |
| --- | --- |
| `electron/win-mail-registration.ts` (new) | Pure. Builds the list of registry entries for a mail-client registration, and the `reg.exe` argv for adding/deleting each. Knows the ProgId and key layout, nothing else. |
| `electron/win-mail-default.ts` (new) | Pure. Parses `reg query` output for `UserChoice\ProgId`, decides whether that ProgId is ours, and builds the `ms-settings:` deep link. |
| `tests/win-mail-registration.test.ts` (new) | Unit tests for the entry list and argv quoting. |
| `tests/win-mail-default.test.ts` (new) | Unit tests for parsing, ownership and deep link. |
| `electron/main.ts` (modify) | Runs the two modules: register once on startup, re-read status on focus, handle the IPC claim by registering + opening Windows Settings. |
| `electron/ipc.ts` (modify) | `SET_DEFAULT_MAIL` (boolean) becomes `MAIL_CLAIM_DEFAULT` (no payload). |
| `electron/sidebar-preload.ts` (modify) | Bridge follows the channel rename. |
| `renderer/app/page.tsx`, `SettingsPanel.tsx`, `settings/GeneralSection.tsx` (modify) | The Switch becomes a truthful status + button row. |
| `renderer/app/strings.ts` (modify) | New EN + Rene strings for the row. |
| `build/installer.nsh` (new) | NSIS `customInstall`/`customUnInstall` writing and removing the same keys. |
| `electron-builder.yml` (modify) | `protocols:` for the scheme, `nsis.include` for the script. |
| `CHANGELOG.md` (modify) | User-facing note in both languages. |

---

### Task 1: Registry entry list (pure)

**Files:**
- Create: `electron/win-mail-registration.ts`
- Test: `tests/win-mail-registration.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export const MAIL_PROG_ID = 'GmailDesktop.Url.mailto'`
  - `export const MAIL_APP_NAME = 'Gmail Desktop'`
  - `export interface RegEntry { key: string; name: string | null; value: string }` — `name: null` means the key's default value.
  - `export function mailRegistrationEntries(exePath: string): RegEntry[]`
  - `export function regAddArgs(entry: RegEntry): string[]`
  - `export function regDeleteArgs(key: string): string[]`

- [ ] **Step 1: Write the failing test**

Create `tests/win-mail-registration.test.ts`:

```ts
// The per-user registry shape that makes Windows list us as a mail client. The
// values are asserted literally: a typo in a key path is invisible at runtime,
// it just means the app never appears in the Windows list.

import { describe, it, expect } from 'vitest';
import {
  MAIL_PROG_ID,
  MAIL_APP_NAME,
  mailRegistrationEntries,
  regAddArgs,
  regDeleteArgs,
} from '../electron/win-mail-registration';

const EXE = 'C:\\Users\\x\\AppData\\Local\\Programs\\gmail-desktop\\Gmail Desktop.exe';

describe('mailRegistrationEntries', () => {
  it('declares the ProgId as a URL protocol handler', () => {
    const e = mailRegistrationEntries(EXE);
    expect(e).toEqual(
      expect.arrayContaining([
        { key: `HKCU\\Software\\Classes\\${MAIL_PROG_ID}`, name: null, value: 'URL:Gmail Desktop mail link' },
        { key: `HKCU\\Software\\Classes\\${MAIL_PROG_ID}`, name: 'URL Protocol', value: '' },
      ]),
    );
  });

  it('points the ProgId open command at the executable with a quoted %1', () => {
    const e = mailRegistrationEntries(EXE);
    expect(e).toEqual(
      expect.arrayContaining([
        {
          key: `HKCU\\Software\\Classes\\${MAIL_PROG_ID}\\shell\\open\\command`,
          name: null,
          value: `"${EXE}" "%1"`,
        },
      ]),
    );
  });

  it('registers a mail-client capability that maps mailto to our ProgId', () => {
    const e = mailRegistrationEntries(EXE);
    const caps = `HKCU\\Software\\Clients\\Mail\\${MAIL_APP_NAME}\\Capabilities`;
    expect(e).toEqual(
      expect.arrayContaining([
        { key: caps, name: 'ApplicationName', value: MAIL_APP_NAME },
        { key: `${caps}\\URLAssociations`, name: 'mailto', value: MAIL_PROG_ID },
      ]),
    );
  });

  it('lists the capability path under RegisteredApplications, which is what fills the Windows list', () => {
    const e = mailRegistrationEntries(EXE);
    expect(e).toEqual(
      expect.arrayContaining([
        {
          key: 'HKCU\\Software\\RegisteredApplications',
          name: MAIL_APP_NAME,
          value: `Software\\Clients\\Mail\\${MAIL_APP_NAME}\\Capabilities`,
        },
      ]),
    );
  });

  it('uses an icon index on the executable so the Windows list shows an icon', () => {
    const e = mailRegistrationEntries(EXE);
    expect(e.map((x) => x.value)).toContain(`"${EXE}",0`);
  });
});

describe('regAddArgs', () => {
  it('adds a named value with /f so a re-register overwrites instead of prompting', () => {
    expect(regAddArgs({ key: 'HKCU\\Software\\X', name: 'A', value: 'b' })).toEqual([
      'add',
      'HKCU\\Software\\X',
      '/v',
      'A',
      '/t',
      'REG_SZ',
      '/d',
      'b',
      '/f',
    ]);
  });

  it('uses /ve for the default value of a key', () => {
    expect(regAddArgs({ key: 'HKCU\\Software\\X', name: null, value: 'b' })).toEqual([
      'add',
      'HKCU\\Software\\X',
      '/ve',
      '/t',
      'REG_SZ',
      '/d',
      'b',
      '/f',
    ]);
  });

  it('passes an empty value through as an empty /d argument', () => {
    expect(regAddArgs({ key: 'HKCU\\Software\\X', name: 'URL Protocol', value: '' })).toContain('');
  });
});

describe('regDeleteArgs', () => {
  it('deletes a whole key tree without prompting', () => {
    expect(regDeleteArgs('HKCU\\Software\\X')).toEqual(['delete', 'HKCU\\Software\\X', '/f']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/win-mail-registration.test.ts`
Expected: FAIL — `Failed to resolve import "../electron/win-mail-registration"`.

- [ ] **Step 3: Write minimal implementation**

Create `electron/win-mail-registration.ts`:

```ts
// The HKCU registry shape that makes Windows list Gmail Desktop as a mail client.
// Windows builds its Standaard-apps list from RegisteredApplications ->
// Clients\Mail\<app>\Capabilities\URLAssociations, so all four groups below are
// required before the app is even selectable; writing Software\Classes\mailto
// alone does nothing. Values are plain strings here and are handed to reg.exe as
// separate argv entries, so nothing in this file needs shell quoting.

export const MAIL_PROG_ID = 'GmailDesktop.Url.mailto';
export const MAIL_APP_NAME = 'Gmail Desktop';

export interface RegEntry {
  key: string;
  name: string | null;
  value: string;
}

export function mailRegistrationEntries(exePath: string): RegEntry[] {
  const progId = `HKCU\\Software\\Classes\\${MAIL_PROG_ID}`;
  const client = `HKCU\\Software\\Clients\\Mail\\${MAIL_APP_NAME}`;
  const caps = `${client}\\Capabilities`;
  const icon = `"${exePath}",0`;
  return [
    { key: progId, name: null, value: 'URL:Gmail Desktop mail link' },
    { key: progId, name: 'URL Protocol', value: '' },
    { key: `${progId}\\DefaultIcon`, name: null, value: icon },
    { key: `${progId}\\shell\\open\\command`, name: null, value: `"${exePath}" "%1"` },
    { key: client, name: null, value: MAIL_APP_NAME },
    { key: caps, name: 'ApplicationName', value: MAIL_APP_NAME },
    { key: caps, name: 'ApplicationDescription', value: 'Gmail in a desktop window.' },
    { key: caps, name: 'ApplicationIcon', value: icon },
    { key: `${caps}\\URLAssociations`, name: 'mailto', value: MAIL_PROG_ID },
    {
      key: 'HKCU\\Software\\RegisteredApplications',
      name: MAIL_APP_NAME,
      value: `Software\\Clients\\Mail\\${MAIL_APP_NAME}\\Capabilities`,
    },
  ];
}

export function regAddArgs(entry: RegEntry): string[] {
  const target = entry.name === null ? ['/ve'] : ['/v', entry.name];
  return ['add', entry.key, ...target, '/t', 'REG_SZ', '/d', entry.value, '/f'];
}

export function regDeleteArgs(key: string): string[] {
  return ['delete', key, '/f'];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/win-mail-registration.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Type-check and commit**

```bash
npx tsc --noEmit
git add electron/win-mail-registration.ts tests/win-mail-registration.test.ts
git commit -m "feat: de registersleutels waarmee Windows ons als mailclient kent"
```

---

### Task 2: Reading the real default (pure)

**Files:**
- Create: `electron/win-mail-default.ts`
- Test: `tests/win-mail-default.test.ts`

**Interfaces:**
- Consumes: `MAIL_PROG_ID`, `MAIL_APP_NAME` from `electron/win-mail-registration`.
- Produces:
  - `export const USER_CHOICE_KEY: string`
  - `export function userChoiceQueryArgs(): string[]`
  - `export function parseUserChoiceProgId(regOutput: string): string | null`
  - `export function isOurProgId(progId: string | null): boolean`
  - `export function defaultAppsDeepLink(): string`

- [ ] **Step 1: Write the failing test**

Create `tests/win-mail-default.test.ts`:

```ts
// Reading the default that Windows actually honours. The UserChoice key wins over
// Software\Classes\mailto, so this - not app.isDefaultProtocolClient - is the only
// honest source for the Settings row.

import { describe, it, expect } from 'vitest';
import {
  USER_CHOICE_KEY,
  userChoiceQueryArgs,
  parseUserChoiceProgId,
  isOurProgId,
  defaultAppsDeepLink,
} from '../electron/win-mail-default';
import { MAIL_PROG_ID } from '../electron/win-mail-registration';

const OUTLOOK_OUT = `
HKEY_CURRENT_USER\\SOFTWARE\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\mailto\\UserChoice
    ProgId    REG_SZ    Outlook.URL.mailto.15
    Hash    REG_SZ    JqSVLxHiRiM=
`;

const OURS_OUT = `
HKEY_CURRENT_USER\\SOFTWARE\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\mailto\\UserChoice
    ProgId    REG_SZ    ${MAIL_PROG_ID}
    Hash    REG_SZ    aBcDeF12=
`;

describe('userChoiceQueryArgs', () => {
  it('queries only the ProgId value of the UserChoice key', () => {
    expect(userChoiceQueryArgs()).toEqual(['query', USER_CHOICE_KEY, '/v', 'ProgId']);
  });
});

describe('parseUserChoiceProgId', () => {
  it('reads the ProgId out of reg query output', () => {
    expect(parseUserChoiceProgId(OUTLOOK_OUT)).toBe('Outlook.URL.mailto.15');
  });
  it('ignores the Hash line', () => {
    expect(parseUserChoiceProgId(OUTLOOK_OUT)).not.toContain('=');
  });
  it('returns null when the key does not exist', () => {
    expect(parseUserChoiceProgId('ERROR: The system was unable to find the specified registry key or value.')).toBeNull();
  });
  it('returns null on empty output', () => {
    expect(parseUserChoiceProgId('')).toBeNull();
  });
  it('tolerates tabs instead of spaces between columns', () => {
    expect(parseUserChoiceProgId('    ProgId\tREG_SZ\tOutlook.URL.mailto.15')).toBe('Outlook.URL.mailto.15');
  });
});

describe('isOurProgId', () => {
  it('recognises our own ProgId', () => {
    expect(isOurProgId(parseUserChoiceProgId(OURS_OUT))).toBe(true);
  });
  it('compares case-insensitively, since the registry does', () => {
    expect(isOurProgId(MAIL_PROG_ID.toUpperCase())).toBe(true);
  });
  it('rejects another mail client', () => {
    expect(isOurProgId('Outlook.URL.mailto.15')).toBe(false);
  });
  it('treats a missing ProgId as not ours', () => {
    expect(isOurProgId(null)).toBe(false);
  });
});

describe('defaultAppsDeepLink', () => {
  it('deep-links to our own entry on the Standaard-apps page', () => {
    expect(defaultAppsDeepLink()).toBe('ms-settings:defaultapps?registeredAppUser=Gmail%20Desktop');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/win-mail-default.test.ts`
Expected: FAIL — cannot resolve `../electron/win-mail-default`.

- [ ] **Step 3: Write minimal implementation**

Create `electron/win-mail-default.ts`:

```ts
// The default mail app as Windows actually resolves it. Since Windows 8 the shell
// reads UrlAssociations\mailto\UserChoice, whose Hash is bound to the user SID and
// can only be written by the shell itself - so an app can never grant itself the
// default, and Electron's isDefaultProtocolClient (which reads back its own
// Software\Classes\mailto key) reports success that the OS ignores. Reading ProgId
// here is the only honest check; the deep link sends the user to the one UI that
// may change it.

import { MAIL_PROG_ID, MAIL_APP_NAME } from './win-mail-registration';

export const USER_CHOICE_KEY =
  'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\mailto\\UserChoice';

export function userChoiceQueryArgs(): string[] {
  return ['query', USER_CHOICE_KEY, '/v', 'ProgId'];
}

export function parseUserChoiceProgId(regOutput: string): string | null {
  for (const line of regOutput.split(/\r?\n/)) {
    const m = /^\s*ProgId\s+REG_SZ\s+(.+?)\s*$/i.exec(line);
    if (m) return m[1];
  }
  return null;
}

export function isOurProgId(progId: string | null): boolean {
  return progId != null && progId.toLowerCase() === MAIL_PROG_ID.toLowerCase();
}

export function defaultAppsDeepLink(): string {
  return `ms-settings:defaultapps?registeredAppUser=${encodeURIComponent(MAIL_APP_NAME)}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/win-mail-default.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Type-check and commit**

```bash
npx tsc --noEmit
git add electron/win-mail-default.ts tests/win-mail-default.test.ts
git commit -m "feat: de echte standaard-mailclient uitlezen in plaats van onze eigen sleutel"
```

---

### Task 3: Main-process wiring

**Files:**
- Modify: `electron/ipc.ts:57` (`SET_DEFAULT_MAIL` → `MAIL_CLAIM_DEFAULT`)
- Modify: `electron/sidebar-preload.ts:99`
- Modify: `electron/main.ts:446-448` (`pushDefaultMailStatus`), `electron/main.ts:1813-1817` (`setDefaultMail`), `electron/main.ts:2292` (IPC handler), `electron/main.ts:2597` (`whenReady`)
- Test: none — this is shell wiring; the logic it calls is already covered by Tasks 1 and 2. Verified per Task 6.

**Interfaces:**
- Consumes: everything exported by `electron/win-mail-registration` and `electron/win-mail-default`.
- Produces: `IPC.MAIL_CLAIM_DEFAULT` (renderer → main, no payload); `IPC.MAIL_DEFAULT_STATUS` (main → renderer, `boolean`) keeps its name and shape.

- [ ] **Step 1: Rename the channel**

In `electron/ipc.ts`, replace line 57:

```ts
  MAIL_CLAIM_DEFAULT: 'mail:claim-default',
```

In `electron/sidebar-preload.ts`, replace line 99:

```ts
  claimDefaultMail: (): void => ipcRenderer.send(IPC.MAIL_CLAIM_DEFAULT),
```

- [ ] **Step 2: Replace the status push with the real check**

In `electron/main.ts`, add to the import block near the other local imports:

```ts
import { mailRegistrationEntries, regAddArgs } from './win-mail-registration';
import {
  userChoiceQueryArgs,
  parseUserChoiceProgId,
  isOurProgId,
  defaultAppsDeepLink,
} from './win-mail-default';
import { execFile } from 'node:child_process';
```

`shell` is already in the `electron` import on `main.ts:20` — do not add a second import for it. `node:child_process` is new to this file.

Replace `pushDefaultMailStatus` (lines 446-448) with:

```ts
function reg(args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile('reg.exe', args, { windowsHide: true }, (err, stdout) => resolve(err ? '' : stdout));
  });
}
async function isDefaultMailClient(): Promise<boolean> {
  if (process.platform !== 'win32') return app.isDefaultProtocolClient('mailto');
  return isOurProgId(parseUserChoiceProgId(await reg(userChoiceQueryArgs())));
}
async function pushDefaultMailStatus(): Promise<void> {
  const v = await isDefaultMailClient();
  mainWindow?.webContents.send(IPC.MAIL_DEFAULT_STATUS, v);
}
```

At line 1685 the call becomes `void pushDefaultMailStatus();`.

- [ ] **Step 3: Register on startup, once, packaged only**

In `electron/main.ts`, add above `setDefaultMail`:

```ts
async function registerAsMailClient(): Promise<void> {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  for (const entry of mailRegistrationEntries(process.execPath)) await reg(regAddArgs(entry));
}
```

In the `app.whenReady()` block (line 2597), after `registerIpc();`:

```ts
  void registerAsMailClient();
  app.setAsDefaultProtocolClient('mailto');
```

- [ ] **Step 4: Turn the claim into "register, then ask Windows"**

Replace `setDefaultMail` (lines 1813-1817) with:

```ts
async function claimDefaultMail(): Promise<void> {
  await registerAsMailClient();
  if (process.platform === 'win32') await shell.openExternal(defaultAppsDeepLink());
  else app.setAsDefaultProtocolClient('mailto');
  void pushDefaultMailStatus();
}
```

Replace the handler at line 2292 with:

```ts
  ipcMain.on(IPC.MAIL_CLAIM_DEFAULT, () => void claimDefaultMail());
```

- [ ] **Step 5: Re-read the status when the window regains focus**

The user grants the default in Windows Settings, outside our window, so the row must refresh on return. In `createWindow`, next to the other `mainWindow.on(...)` handlers:

```ts
  mainWindow.on('focus', () => void pushDefaultMailStatus());
```

- [ ] **Step 6: Verify nothing regressed and commit**

Run: `npx tsc --noEmit && npm test`
Expected: tsc silent; the full suite passes (no test referenced the old channel name — confirm with `git grep -n "SET_DEFAULT_MAIL" -- tests electron renderer`, which must print nothing).

```bash
git add electron/ipc.ts electron/main.ts electron/sidebar-preload.ts
git commit -m "feat: de knop registreert ons en stuurt je naar Windows, de status komt van Windows"
```

---

### Task 4: A settings row that tells the truth

**Files:**
- Modify: `renderer/app/settings/GeneralSection.tsx:29-38`
- Modify: `renderer/app/page.tsx:222` (bridge type), `renderer/app/page.tsx:419` (callback)
- Modify: `renderer/app/SettingsPanel.tsx:139`
- Modify: `renderer/app/strings.ts:33-34, 345-347, 624-626`
- Test: none — presentational; the states are exercised by hand in Task 6.

**Interfaces:**
- Consumes: `IPC.MAIL_CLAIM_DEFAULT` via `window.desktop.claimDefaultMail()`.
- Produces: `onClaimDefaultMail: () => void` prop through `SettingsPanel` → `GeneralSection`.

A `Switch` is the wrong control here: it implies the app can turn the setting on, and it cannot. Replace it with the true state plus a button that opens the Windows page.

- [ ] **Step 1: New strings**

In `renderer/app/strings.ts`, replace the `defaultMailClient` pair in the `UiStrings` interface (lines 33-34) with:

```ts
  defaultMailClient: string;
  defaultMailClientDescription: string;
  defaultMailClientOn: string;
  defaultMailClientOff: string;
  defaultMailClientAction: string;
```

In the English table (around line 345):

```ts
  defaultMailClient: 'Default Mail Client',
  defaultMailClientDescription:
    'Windows decides which app opens email links. Gmail Desktop registers itself, then you confirm it in Windows Settings.',
  defaultMailClientOn: 'Windows opens email links in Gmail Desktop',
  defaultMailClientOff: 'Windows opens email links in another app',
  defaultMailClientAction: 'Set in Windows…',
```

In `STRINGS_RENE` (around line 624, Dutch by design):

```ts
  defaultMailClient: 'Mail gaat door deze app',
  defaultMailClientDescription:
    'Windows kiest zelf welk programma mailtjes opent. Wij melden ons aan, jij zegt in Windows nog even ja.',
  defaultMailClientOn: 'Mailtjes gaan open in deze app',
  defaultMailClientOff: 'Mailtjes gaan nog naar een ander programma',
  defaultMailClientAction: 'Regel het in Windows…',
```

- [ ] **Step 2: Row without a Switch**

In `renderer/app/settings/GeneralSection.tsx`, keep the `Switch` import only if the other rows still use it (they do — `autoStart` and `launchMinimized`), add `import { BUTTON, VALUE } from './tokens';`, rename the prop, and replace the first `SettingRow` (lines 29-38):

```tsx
        <SettingRow label={S.defaultMailClient} description={S.defaultMailClientDescription}>
          <span className={VALUE}>
            {isDefaultMail ? S.defaultMailClientOn : S.defaultMailClientOff}
          </span>
          <button type="button" onClick={onClaimDefaultMail} className={BUTTON}>
            {S.defaultMailClientAction}
          </button>
        </SettingRow>
```

`VALUE` and `BUTTON` come from `renderer/app/settings/tokens.ts` — the panel's shared tokens, so this row cannot drift from the others; do not hand-write Tailwind classes here. Note the token file's own warning: Tailwind 3 needs bracketed fractional opacity.

Signature changes: `onSetDefaultMail: (v: boolean) => void` becomes `onClaimDefaultMail: () => void`. Keep `isDefaultMail: boolean`. The `htmlFor` prop goes: `SettingRow` only wraps the row in a `<label>` when `htmlFor` is given, and this row has two targets rather than one control, so it must stay a plain row.

- [ ] **Step 3: Follow the rename up the tree**

`renderer/app/page.tsx` line 222 becomes `claimDefaultMail(): void;`, and line 419 becomes:

```tsx
          onClaimDefaultMail={() => window.desktop?.claimDefaultMail()}
```

`renderer/app/SettingsPanel.tsx` passes `onClaimDefaultMail` through in place of `onSetDefaultMail` (declaration and line 139).

- [ ] **Step 4: Type-check both projects and commit**

Run: `npx tsc --noEmit -p renderer/tsconfig.json && npx tsc --noEmit && npm test`
Expected: both silent, suite green. Also `git grep -n "onSetDefaultMail\|setDefaultMail" -- renderer electron` must print nothing.

```bash
git add renderer/app
git commit -m "feat: de instelling zegt wat Windows echt doet, en stuurt je erheen"
```

---

### Task 5: The installer registers it too

**Files:**
- Create: `build/installer.nsh`
- Modify: `electron-builder.yml`
- Test: none — verified by Task 6.

Registering at first launch is not enough: a user who looks in *Standaard-apps* before ever opening the app finds nothing. The installer writes the same keys. `HKCU` matches the per-user one-click target, so no elevation is involved.

- [ ] **Step 1: NSIS include**

Create `build/installer.nsh`:

```nsis
; Registers Gmail Desktop as a Windows mail client at install time, so it appears
; in Standaard-apps before the app has ever run. Keys mirror
; electron/win-mail-registration.ts exactly - change both together. HKCU only: the
; target is a per-user one-click install, so nothing here may need elevation.

!macro customInstall
  WriteRegStr HKCU "Software\Classes\GmailDesktop.Url.mailto" "" "URL:Gmail Desktop mail link"
  WriteRegStr HKCU "Software\Classes\GmailDesktop.Url.mailto" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\GmailDesktop.Url.mailto\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr HKCU "Software\Classes\GmailDesktop.Url.mailto\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'

  WriteRegStr HKCU "Software\Clients\Mail\Gmail Desktop" "" "Gmail Desktop"
  WriteRegStr HKCU "Software\Clients\Mail\Gmail Desktop\Capabilities" "ApplicationName" "Gmail Desktop"
  WriteRegStr HKCU "Software\Clients\Mail\Gmail Desktop\Capabilities" "ApplicationDescription" "Gmail in a desktop window."
  WriteRegStr HKCU "Software\Clients\Mail\Gmail Desktop\Capabilities" "ApplicationIcon" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr HKCU "Software\Clients\Mail\Gmail Desktop\Capabilities\URLAssociations" "mailto" "GmailDesktop.Url.mailto"

  WriteRegStr HKCU "Software\RegisteredApplications" "Gmail Desktop" "Software\Clients\Mail\Gmail Desktop\Capabilities"
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\GmailDesktop.Url.mailto"
  DeleteRegKey HKCU "Software\Clients\Mail\Gmail Desktop"
  DeleteRegValue HKCU "Software\RegisteredApplications" "Gmail Desktop"
!macroend
```

- [ ] **Step 2: Point electron-builder at it and declare the scheme**

In `electron-builder.yml`, add at top level (keep the existing `win:` block as it is):

```yaml
protocols:
  - name: Mail link
    schemes:
      - mailto
nsis:
  include: build/installer.nsh
```

- [ ] **Step 3: Prove the installer still builds**

Run: `npm run build && npx electron-builder --win nsis --publish never`
Expected: exit 0, `dist/Gmail Desktop Setup <version>.exe` written. A syntax error in `installer.nsh` fails this step loudly — that is the check.

- [ ] **Step 4: Commit**

```bash
git add build/installer.nsh electron-builder.yml
git commit -m "feat: de installer meldt ons aan als mailprogramma bij Windows"
```

---

### Task 6: Verify in a packaged build, then write it down

**Files:**
- Modify: `CHANGELOG.md`

Nothing in Tasks 3-5 can be proven by a unit test: the behaviour lives in the Windows registry and in a shell that ignores unpackaged apps. Run this list on a real install, from a machine where another mail app currently holds `mailto:`.

- [ ] **Step 1: Install and check the registration exists**

Install the built `.exe`, then:

```bash
reg query "HKCU\Software\RegisteredApplications" /v "Gmail Desktop"
reg query "HKCU\Software\Clients\Mail\Gmail Desktop\Capabilities\URLAssociations" /v mailto
```

Expected: the capability path, and `mailto = GmailDesktop.Url.mailto`.

- [ ] **Step 2: Check the app appears in the Windows list**

Open *Instellingen → Apps → Standaard-apps*, search `Gmail Desktop`. Expected: it is listed (before this change it was absent).

- [ ] **Step 3: Check the row is honest while another app holds the default**

Open Settings → General. Expected: "Mailtjes gaan nog naar een ander programma" — not "on". Before this change it claimed the app was already the default.

- [ ] **Step 4: Claim it**

Click *Regel het in Windows…*. Expected: the Windows Standaard-apps page opens on the Gmail Desktop entry. Set `mailto` to Gmail Desktop there, then return to the app window.

Expected on focus: the row flips to "Mailtjes gaan open in deze app". Confirm the OS agrees:

```bash
reg query "HKCU\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\mailto\UserChoice" /v ProgId
```

Expected: `GmailDesktop.Url.mailto`.

- [ ] **Step 5: Check a real link end to end**

From a browser or PDF, click a `mailto:someone@example.com?subject=Hi` link. Expected: Gmail Desktop focuses and a compose window opens with recipient and subject filled in (the existing `parseMailto` → `openCompose` path).

- [ ] **Step 6: Check the uninstall leaves nothing behind**

Uninstall, then re-run the two queries from Step 1. Expected: both report the value cannot be found.

- [ ] **Step 7: Changelog and commit**

Add to `CHANGELOG.md` under the unreleased section, in the existing two-language style:

```markdown
- **Mail gaat nu echt door deze app.** De schakelaar beweerde eerder dat het gelukt
  was terwijl Windows de mailtjes nog naar Outlook stuurde: Windows laat een app zijn
  eigen standaard niet zetten, dat mag alleen de gebruiker in Windows zelf. De app
  meldt zich nu netjes aan als mailprogramma — bij het installeren én bij het starten —
  de instelling laat zien wat Windows werkelijk doet, en één knop brengt je naar de
  plek waar je het mag toestaan.
```

```bash
git add CHANGELOG.md
git commit -m "docs: changelog voor de standaard-mailclient"
```

---

## Self-Review

**Spec coverage** — the three measured defects each have an owner: the inert write → Tasks 1 and 5 (a ProgId + capability registration Windows actually reads); the lying status → Task 2 and Task 3 Step 2 (`UserChoice`, not `isDefaultProtocolClient`); the missing manual route → Task 5 (installer registration) and Task 4 (a button to the OS page). Task 6 verifies all three on a real install.

**Placeholders** — every code step carries real code; no TBD, no "add error handling". The one deliberate judgement call left to the implementer is the button's Tailwind classes, which must match neighbouring sections rather than the sample.

**Type consistency** — `MAIL_PROG_ID`/`MAIL_APP_NAME` are defined in Task 1 and imported in Task 2 and Task 3. `RegEntry` is used by `regAddArgs` in the same file. `pushDefaultMailStatus` becomes `async` and every call site is prefixed with `void` (Task 3 Steps 2, 4, 5). The channel is `MAIL_CLAIM_DEFAULT` in `ipc.ts`, `sidebar-preload.ts` and `main.ts`; the bridge method is `claimDefaultMail` in `sidebar-preload.ts` and `page.tsx`; the prop is `onClaimDefaultMail` in `page.tsx`, `SettingsPanel.tsx` and `GeneralSection.tsx`. `IPC.MAIL_DEFAULT_STATUS` keeps its name and boolean payload, so `sidebar-preload.ts:125` needs no change.

## Open decisions for the human

- **Base branch.** This plan is written against `worktree-settings-redesign` (the newest line of work, 13 commits ahead of `dev`), because that branch already turned this setting into a `Switch` and moved the handler to `main.ts:1813`. Written against `dev` instead, every line reference in Tasks 3 and 4 would be wrong.
- **No "turn it off".** `removeAsDefaultProtocolClient` disappears with the Switch. Un-defaulting is equally the OS's call, and the same button leads to the page where the user can pick another app. If an explicit off is wanted, it should delete the registration keys (`regDeleteArgs` from Task 1 is already there for it) and the row needs a fourth string.
- **`registeredAppUser` deep link.** Supported on Windows 11 22H2 and later. On older builds the parameter is ignored and the plain Standaard-apps page opens, which is still a working route. If Windows 10 support matters, verify there and consider falling back to `ms-settings:defaultapps`.
