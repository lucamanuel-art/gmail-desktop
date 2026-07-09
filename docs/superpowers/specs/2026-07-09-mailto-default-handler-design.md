# mailto: default-handler support — design

**Date:** 2026-07-09
**Status:** Approved, ready for implementation plan

## Problem

The app is a full Gmail desktop client but is not registered as a system mail
handler. Clicking a `mailto:` link anywhere (browser, PDF, Slack, another app)
opens whatever the OS default is — not this app. A desktop mail app should
catch those links and open a prefilled compose window.

## Goal

Register the app as the `mailto:` handler so that clicking an email link opens a
Gmail compose window in the app, prefilled with the link's recipients/subject/
body, sent from an account the user picks.

## Scope

**In scope**
- Register as default `mailto:` client on launch + a "Set as default mail app"
  button in Settings → General.
- Handle mailto delivery on cold start (argv), while running on Windows/Linux
  (`second-instance` argv), and on macOS (`open-url`).
- Parse the mailto URL into Gmail compose fields (to/cc/bcc/subject/body).
- Account chooser: when >1 account exists, ask which account sends via a native
  `dialog.showMessageBox`; with a single account, skip the prompt.

**Out of scope**
- A styled in-renderer chooser modal (native dialog chosen for v1).
- Rich compose (attachments, templates) — Gmail's compose owns that.
- Parsing multiple mailto links at once (take the first).

## Behavior

Clicking a `mailto:foo@bar.com?subject=Hi&body=Hello` link:
1. If the app is closed, it launches; if running, its window is focused.
2. Once at least one account is signed in and its mail view is active, the app
   determines the send-from account: with one account, that account; with
   several, a native dialog lists the account labels and the user picks (or
   cancels, which aborts).
3. A Gmail compose window opens for that account, prefilled from the link.

## Data flow

```
OS mailto click
  → cold start:      process.argv           ─┐
  → running (Win/Lin): second-instance argv  ├─► extractMailtoFromArgv → mailto string
  → macOS:           app 'open-url' event   ─┘        (open-url passes the URL directly)
        → parseMailto(url) → MailtoFields
        → (queue if no account ready yet; flush when first mail view is active)
        → chooseAccount()  (native dialog if >1, else the sole account)
        → openCompose(index, fields) → composeUrl(index, fields) loaded in popup
```

## Pure modules (unit-tested)

### `electron/mailto.ts`

```ts
export interface MailtoFields {
  to: string;    // comma-joined recipients
  cc: string;
  bcc: string;
  subject: string;
  body: string;
}

// Returns null if `url` is not a mailto: URL.
export function parseMailto(url: string): MailtoFields | null;

// First argv entry that is a mailto: URL, else null (skips Electron's own flags).
export function extractMailtoFromArgv(argv: string[]): string | null;
```

Parsing rules:
- Case-insensitive `mailto:` scheme check; non-mailto → `null`.
- Recipients before `?` are comma-separated and percent-decoded; a `to=` query
  param is appended to them.
- `cc`, `bcc`, `subject`, `body` come from the query, percent-decoded. `subject`
  and `body` map to Gmail's `su` and `body` at URL-build time (Task 2), not here.
- Missing parts become empty strings (never `undefined`).
- Percent-encoding decoded via `decodeURIComponent`; `+` in query values is
  treated as a literal `+` (mailto is not form-encoded).

### `electron/compose-url.ts`

```ts
import type { MailtoFields } from './mailto';
export function composeUrl(index: number, fields?: MailtoFields): string;
```

- Base: `https://mail.google.com/mail/u/${index}/?view=cm&fs=1&tf=1`.
- Appends `&to=`, `&su=` (from `fields.subject`), `&body=`, `&cc=`, `&bcc=` only
  for non-empty values, each `encodeURIComponent`-ed.
- `openCompose(index)` in `compose-window.ts` is refactored to
  `openCompose(index, fields?)` and builds its URL via `composeUrl`.

## Electron wiring (thin; manual smoke test)

- `app.setAsDefaultProtocolClient('mailto')` in the `whenReady` block.
- **Cold start:** in `whenReady`, `extractMailtoFromArgv(process.argv)`; if
  present, store as `pendingMailto`. A flush function runs it once the first
  account is registered and a mail view is active (hook into the existing
  point where `switchSurface`/`showAccount` first makes a mail view active).
- **Running (Win/Linux):** extend the existing `second-instance(event, argv)`
  handler (main.ts ~873) to `extractMailtoFromArgv(argv)`, focus the window
  (it already does), then dispatch the mailto.
- **macOS:** `app.on('open-url', (e, url) => …)` — same dispatch path.
- **Dispatch:** `parseMailto` → choose account → `openCompose(index, fields)`.
  If no account is ready, set `pendingMailto`.

Note (dev vs packaged): `setAsDefaultProtocolClient('mailto')` is reliable in
packaged builds; unpackaged dev needs execPath + args and is not the test path.
Windows may still surface its own "Default apps" confirmation.

## Account chooser

`chooseComposeAccount(): number | null` (main process):
- 0 accounts → `null` (nothing to compose from; drop or re-queue).
- 1 account → that account's authuser index.
- >1 → `dialog.showMessageBox` with `buttons` = each account's display label
  (label ?? name ?? email) plus a Cancel button; `cancelId` set. Returns the
  chosen account's index, or `null` on cancel.
- The window is shown/focused before the dialog so it isn't lost behind other
  apps.

## Settings (General)

- New IPC `SET_DEFAULT_MAIL` (renderer → main): calls
  `setAsDefaultProtocolClient('mailto')`.
- Default-handler status (`app.isDefaultProtocolClient('mailto')`) is added to
  the pushed prefs/status payload so the button can reflect current state.
- SettingsPanel General section gains a "Set as default mail app" row: a button
  + status text ("Default mail app" / "Not the default") + a one-line hint that
  Windows may ask to confirm.
- New strings `setDefaultMail`, `setDefaultMailHint`, `isDefaultMail`,
  `notDefaultMail` in English and Rene-Dutch.

## Testing

- `parseMailto`: single & multiple path recipients; `to`/`cc`/`bcc`/`subject`/
  `body` query params; percent-encoded spaces and specials (`%20`, `%26`);
  `to=` query merged with path; non-mailto → null; scheme-only (`mailto:`) →
  all-empty.
- `extractMailtoFromArgv`: mailto present among other flags; absent → null;
  first-wins with two mailtos.
- `composeUrl`: index in path; each field encoded; empty fields omitted;
  no-fields base URL equals the current compose URL exactly (regression guard
  for the `openCompose` refactor).

## Files touched

- Create: `electron/mailto.ts`, `electron/compose-url.ts`,
  `tests/mailto.test.ts`, `tests/compose-url.test.ts`.
- Modify: `electron/compose-window.ts` (refactor `openCompose`),
  `electron/main.ts` (register, argv/open-url/second-instance, chooser,
  pending-mailto flush, IPC), `electron/ipc.ts` (SET_DEFAULT_MAIL),
  `electron/sidebar-preload.ts` + `renderer/app/page.tsx` (bridge),
  `renderer/app/SettingsPanel.tsx` (button + status),
  `renderer/app/strings.ts` (4 strings ×2 flavors).
