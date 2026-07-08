# Google apps (Drive/Docs/Sheets/…) — design

Date: 2026-07-08. Implements Backlog-feature A from `docs/feature 8-7-2026.md`.
The open design questions in that spec were answered with its own recommendations
(this session ran autonomously): 7 safe apps in v1, per-account waffle flyout,
no notifications for the new surfaces.

## Goal

Each detected account gets, next to Mail and Calendar, in-app access to the
other Google apps that follow the same `/u/<N>/` account-index URL pattern:

| Surface  | URL |
|----------|-----|
| drive    | `https://drive.google.com/drive/u/<N>/my-drive` |
| docs     | `https://docs.google.com/document/u/<N>/` |
| sheets   | `https://docs.google.com/spreadsheets/u/<N>/` |
| slides   | `https://docs.google.com/presentation/u/<N>/` |
| keep     | `https://keep.google.com/u/<N>/` |
| contacts | `https://contacts.google.com/u/<N>/` |
| chat     | `https://chat.google.com/u/<N>/` |

Out of scope (v2+): Meet and Tasks (different URL shapes), notifications or
unread badges for the new surfaces (Chat possibly later), remembering the last
active surface.

## Architecture: one shared `Surface` source of truth

Today `Surface = 'mail' | 'calendar'` is duplicated in
`electron/profile-view-manager.ts`, `renderer/app/page.tsx`,
`electron/sidebar-preload.ts` and hardcoded in `electron/notification-policy.ts`.
With 9 values that becomes a silent-fallthrough hazard, so (per the spec's
refactor note) a new module **`renderer/lib/surfaces.ts`** becomes the single
source:

```ts
export const SURFACES = ['mail','calendar','drive','docs','sheets','slides','keep','contacts','chat'] as const;
export type Surface = (typeof SURFACES)[number];
export const APP_SURFACES: readonly Surface[]; // all except mail + calendar (waffle contents)
export interface SurfaceConfig {
  label: string;              // 'Drive', 'Docs', …
  host: string;               // in-app host, e.g. 'drive.google.com'
  path?: string;              // first path segment when the host is shared (docs.google.com)
  url(index: number): string; // per-account URL
  backgroundThrottling: boolean; // false only for calendar (reminder timing)
}
export const SURFACE_CONFIG: Record<Surface, SurfaceConfig>;
export function surfaceForUrl(url: string): Surface | null; // host(+path) → surface
```

It lives under `renderer/` (pure data, no Electron imports) because Next.js
cannot compile imports from outside its root without experimental flags, while
esbuild (main-process bundle) and vitest import from anywhere. Electron files
import it via `../renderer/lib/surfaces`; the root `tsc` still typechecks it as
an imported file.

`electron/google-urls.ts` keeps `mailUrl`/`calendarUrl` (delegating to the
config) and derives `IN_APP_HOSTS` from `SURFACE_CONFIG` + `accounts.google.com`.

## Views

`ProfileViewManager` already keys views by `index:surface`; it needs only:

- `ensureView` loads `SURFACE_CONFIG[surface].url(index)` and takes
  `backgroundThrottling` from the config instead of `surface === 'calendar'`.
- `setZoomForIndex` loops `SURFACES` instead of `['mail','calendar']`.
- Unread/identity IPC stays mail-only (that is genuinely mail-specific).

App views are created lazily on first click and then kept alive (same policy as
mail/calendar views today). `removeAccount` in `main.ts` loops `SURFACES` when
discarding views.

## Link routing (behavior change)

`IN_APP_HOSTS` now includes drive/docs/keep/contacts/chat hosts, so a Docs link
clicked in an email opens **in-app** instead of in the external browser.

To avoid clobbering the mail view, `openInApp` in `ProfileViewManager` routes
the URL to its *owning* surface: `surfaceForUrl(url)` picks the target surface
(fallback: the view that opened it, e.g. for `accounts.google.com` popups), the
target view is ensured, the URL loads there, and `onActivate` brings it on
screen. So: doc link in an email → the account's Docs surface shows the doc;
opening a spreadsheet from Drive → the Sheets surface. Existing mail
notification routing is unaffected (mail URLs resolve to the mail view as
before). "Open in a new window" mode still opens a real window (unchanged
`windowOpenAction` logic).

## Notifications

v1 policy: the new surfaces never notify. `notificationsAllowed` takes the full
`Surface` type and returns `false` for anything that is not mail/calendar —
this also *suppresses* pages that try (Chat), because the preload notification
gate receives `false`. `refreshNotifyAllowed` in `main.ts` loops all `SURFACES`,
and `switchSurface` triggers a refresh so a freshly created app view is gated
immediately instead of after the next 60s tick.

## Sidebar UX: per-account waffle

Per account the avatar (mail) and the calendar button stay pinned. Below the
calendar button comes a **waffle button** (3×3 dots). Clicking it expands an
inline 2-column grid of the 7 app icons under that account (accordion inside
the 72 px sidebar — a floating flyout is impossible because WebContentsViews
composite above the window's own content). Only one account's waffle is open at
a time; it closes on account switch or settings. The waffle button highlights
when the account's active surface is one of the apps. Icons are simple inline
monochrome SVGs (same style as the existing gear icon) in a new
`renderer/app/app-icons.tsx`. The profiles column becomes scrollable so
expansion never pushes the settings gear off-screen.

## Testing

- `tests/surfaces.test.ts` — every surface has a config; URLs embed the account
  index; `surfaceForUrl` maps every config URL back to its surface, disambiguates
  the shared docs.google.com host by path, returns null for external/unknown URLs.
- `tests/google-urls.test.ts` — new hosts are in-app; `www.google.com/url`
  redirect wrapper and off-Google hosts stay external (existing docs.google.com
  expectation flips, documented above).
- `tests/notification-policy.test.ts` — app surfaces are never allowed, even
  with `notify: true`.
- Sidebar UI verified by typecheck + build (no component test rig exists).
