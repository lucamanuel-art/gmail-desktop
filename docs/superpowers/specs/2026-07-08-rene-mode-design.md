# Rene mode — design

## What

A hidden, toggleable "Rene mode" easter egg. Rene wears glasses and is young:
when the mode is on, everything is much bigger (200% zoom) and the app's own UI
uses simple Dutch words a 4-year-old could read.

## Activation

- Key sequence: `↑ ↓ ← → a b` (Konami-style), typed **on the settings page only**.
- The same sequence on the settings page toggles it off again.
- Keystrokes typed inside text/time inputs do not count toward the sequence.
- The listener lives in `SettingsPanel`, which only exists while the settings
  page is open — that is what scopes activation to settings.

## State

- New pref `reneMode: boolean` (default `false`) in `Prefs` (`prefs-store.ts`),
  persisted like every other pref, echoed to the renderer via `PREFS_CHANGED`.
- New IPC channel `prefs:rene-mode` (renderer → main, boolean), exposed on the
  sidebar bridge as `setReneMode(v)`.

## Effects when on

1. **Zoom 200%** (applied by the main process so it covers everything):
   - Sidebar/settings renderer: `mainWindow.webContents.setZoomFactor(2)`.
   - Every Gmail/Calendar `WebContentsView`: zoom level `log(2)/log(1.2) ≈ 3.80`
     (Chromium zoom level for factor 2.0). Applied to existing views on toggle
     and to new views via the existing `getZoom` callback.
   - Layout: the 72px sidebar renders 144px wide at factor 2, so
     `contentBounds()` takes a `scale` param and offsets the content view by
     `SIDEBAR_WIDTH * scale`. `ProfileViewManager` gets a `getUiScale` callback
     and relayouts on toggle.
   - Per-account zoom prefs are untouched on disk; leaving Rene mode restores
     each account's own stored zoom level and factor 1 for the renderer.

2. **Simple Dutch UI** (our chrome only — Gmail's own content is Google's):
   - `renderer/app/strings.ts` exports the full UI string table twice:
     `STRINGS_NORMAL` (current English) and `STRINGS_RENE` (simple Dutch,
     4-year-old vocabulary: "Piepjes" for notifications, "Dicht" for close,
     "Doe maar!" for update now, …). `getStrings(reneMode)` picks one.
   - `SettingsPanel` and the sidebar tooltips consume the table.
   - A visible banner on the settings page while the mode is on
     ("🤓 Rene-modus staat aan!") so the state is discoverable.

## Not in scope

- Translating/zooming Gmail's own page content beyond the zoom factor
  (the user's Gmail is already Dutch).
- Any visible UI to toggle the mode — the key sequence is the only way.

## Testing (vitest, pure logic — matches repo convention)

- `advanceReneSequence` state machine: full match, reset on wrong key,
  restart-on-ArrowUp, completion.
- `PrefsStore` round-trips `reneMode` and defaults it to `false`.
- `contentBounds` with scale 2 offsets x by 144 and shrinks width accordingly.
- The two string tables have identical key sets.
- Zoom-level constant maps to factor 2 (1.2^level ≈ 2).
