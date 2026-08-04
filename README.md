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

For day-to-day work use `npm run dev` (cross-platform, no bash needed). It
starts the Next.js dev server, keeps esbuild watching the Electron bundles,
and launches Electron against the dev renderer. What happens on a change:

| You edit | What happens | Restart needed |
| --- | --- | --- |
| `renderer/` (sidebar, modal) | Next hot-reloads the page | no |
| `electron/preload.ts` | esbuild rebuilds; main reloads the Gmail views | no |
| `electron/main.ts` | esbuild rebuilds; Electron restarts itself | no (automatic) |

Close a running instance first — the app takes a single-instance lock, so a
second one exits immediately.

`./run-dev.sh` does the same thing on Linux/macOS and additionally starts a
notification daemon under WSL.

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

## Setup guides

- [Delegated postvakken via de Gmail API](docs/delegated-api-setup.md) — copying
  mail to or from a delegated mailbox. The Gmail API has no notion of a delegate,
  so this needs a service account with domain-wide delegation; the guide covers
  why, the install steps, and where the key must (and must not) live.

## Scope

This is a wrapper around Gmail's web UI, not a standalone mail client. Not
yet included: auto-updates, `mailto:` handling, global shortcuts, offline
storage.
