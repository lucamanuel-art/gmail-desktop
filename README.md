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

The quickest way to run everything locally with hot reload is
`./run-dev.sh` — it installs dependencies if needed, bundles the Electron
main/preload, starts the Next.js dev server, and launches Electron against
it, tearing the dev server down again on exit.

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
