#!/usr/bin/env bash
# run-dev.sh — start the whole app locally for development.
#
# It bundles the Electron main/preload, starts the Next.js sidebar in dev
# mode (hot reload), waits for it to come up, then launches Electron pointed
# at the dev renderer. The Next.js dev server is stopped automatically on exit.
#
# Usage: ./run-dev.sh
set -euo pipefail

cd "$(dirname "$0")"

RENDERER_PORT="${RENDERER_PORT:-3000}"
RENDERER_URL="http://localhost:${RENDERER_PORT}"

# 1. Install dependencies if missing.
if [ ! -d node_modules ]; then
  echo "› Installing root dependencies…"
  npm install
fi
if [ ! -d renderer/node_modules ]; then
  echo "› Installing renderer dependencies…"
  (cd renderer && npm install)
fi

# 2. Bundle the Electron main + preload (dist-electron/).
echo "› Bundling Electron main/preload…"
npm run build:main

# 3. Start the Next.js dev server in the background.
# Run from inside renderer/ so Next picks up renderer's postcss/tailwind config
# and Tailwind's content globs resolve against the renderer directory.
echo "› Starting Next.js dev server on ${RENDERER_URL}…"
(cd renderer && ./node_modules/.bin/next dev -p "${RENDERER_PORT}") &
DEV_PID=$!

# Always stop the dev server when this script exits.
cleanup() {
  echo "› Stopping Next.js dev server…"
  kill "${DEV_PID}" 2>/dev/null || true
  wait "${DEV_PID}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# 4. Wait for the dev server to respond (max ~30s).
echo "› Waiting for renderer to be ready…"
for _ in $(seq 1 60); do
  if curl -sf -o /dev/null "${RENDERER_URL}"; then
    break
  fi
  sleep 0.5
done

# 5. Launch Electron against the dev renderer (hot reload of the sidebar).
echo "› Launching Electron…"
ELECTRON_RENDERER_URL="${RENDERER_URL}" ./node_modules/.bin/electron .
