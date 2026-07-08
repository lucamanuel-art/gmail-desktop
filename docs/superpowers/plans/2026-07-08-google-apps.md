# Google Apps Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-account in-app access to Drive, Docs, Sheets, Slides, Keep, Contacts and Chat via a waffle flyout in the sidebar, with one shared `Surface` source of truth.

**Architecture:** A new pure-data module `renderer/lib/surfaces.ts` defines the `Surface` union and a `SURFACE_CONFIG` lookup (label, host, URL builder, throttling). Electron main/preload and the Next sidebar all import it. `ProfileViewManager` already keys views by `index:surface`, so new surfaces are mostly config; link routing sends in-app popups to their owning surface's view.

**Tech Stack:** Electron 31 (esbuild-bundled main), Next 14 static-export sidebar, vitest.

## Global Constraints

- New surfaces never fire notifications in v1 (`notificationsAllowed` → false, so the preload gate suppresses them).
- Sidebar flyout must stay inside the 72 px sidebar column (WebContentsViews composite above the window's own web content).
- Changelog entries in Dutch and English, like existing entries.
- Spec: `docs/superpowers/specs/2026-07-08-google-apps-design.md`.

---

### Task 1: Shared surfaces module

**Files:**
- Create: `renderer/lib/surfaces.ts`
- Test: `tests/surfaces.test.ts`

**Interfaces:**
- Produces: `SURFACES: readonly Surface[]`, `type Surface`, `APP_SURFACES` (surfaces minus mail/calendar), `SURFACE_CONFIG: Record<Surface, {label, host, path?, url(i), backgroundThrottling}>`, `surfaceForUrl(url: string): Surface | null`.

- [ ] **Step 1: Write failing tests** — config completeness, URL index embedding, `surfaceForUrl` round-trip for every surface URL, docs.google.com path disambiguation (document/spreadsheets/presentation), null for `https://example.com/`, `https://www.google.com/url?q=x`, malformed input.
- [ ] **Step 2: Run** `npx vitest run tests/surfaces.test.ts` — fails (module missing).
- [ ] **Step 3: Implement `renderer/lib/surfaces.ts`** with the URL table from the spec; `surfaceForUrl` matches host, then (for shared hosts) the first path segment; mail/calendar included so mail URLs resolve to the mail view.
- [ ] **Step 4: Run tests — pass.**
- [ ] **Step 5: Commit** `feat: add shared Surface type and SURFACE_CONFIG lookup`

### Task 2: In-app hosts from config

**Files:**
- Modify: `electron/google-urls.ts` (derive `IN_APP_HOSTS` from `SURFACE_CONFIG` + `accounts.google.com`; `mailUrl`/`calendarUrl` delegate to config)
- Test: `tests/google-urls.test.ts`

- [ ] **Step 1: Update tests** — drive/docs/keep/contacts/chat URLs are now in-app; redirect wrapper (`www.google.com/url`) and off-Google hosts stay external. (The old `docs.google.com → false` expectation flips per spec.)
- [ ] **Step 2: Run — fails.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run — passes.**
- [ ] **Step 5: Commit** `feat: keep Google app hosts in-app for link routing`

### Task 3: Notification policy covers all surfaces

**Files:**
- Modify: `electron/notification-policy.ts` (surface param becomes `Surface`; non-mail/calendar → `false`)
- Test: `tests/notification-policy.test.ts`

- [ ] **Step 1: Add failing tests** — `drive`/`chat` blocked even with `notify: true` + `calendarNotify: true`.
- [ ] **Step 2–5:** red → implement → green → commit `feat: gate notifications off for non-mail/calendar surfaces`

### Task 4: View manager honours SURFACE_CONFIG + surface-aware openInApp

**Files:**
- Modify: `electron/profile-view-manager.ts`

**Interfaces:**
- Consumes: `SURFACE_CONFIG`, `SURFACES`, `surfaceForUrl` from Task 1.
- Produces: unchanged public API; `openInApp` now targets `surfaceForUrl(url) ?? originating surface`.

- [ ] Import `Surface` from the shared module (drop the local union); `ensureView` loads `SURFACE_CONFIG[surface].url(index)` and uses config `backgroundThrottling`; `setZoomForIndex` loops `SURFACES`; `openInApp` ensures the target surface's view, loads the URL there, then calls `onActivate(index, targetSurface)`.
- [ ] `npx tsc --noEmit` + `npx vitest run` green; commit `feat: drive profile views from SURFACE_CONFIG and route popups to their surface`

### Task 5: Main process + sidebar preload plumbing

**Files:**
- Modify: `electron/main.ts` (`removeAccount` discards all `SURFACES`; `refreshNotifyAllowed` loops `SURFACES`; `switchSurface` calls `refreshNotifyAllowed()` so new app views are gated immediately)
- Modify: `electron/sidebar-preload.ts` (import shared `Surface`)

- [ ] Implement; `npx tsc --noEmit` green; commit `feat: manage app-surface views in account lifecycle and notify gating`

### Task 6: Sidebar waffle UI

**Files:**
- Create: `renderer/app/app-icons.tsx` (monochrome stroke SVGs per app + 3×3-dot waffle icon, gear-icon style)
- Modify: `renderer/app/page.tsx` (import shared `Surface`; per-account waffle button under the calendar button; inline 2-column accordion grid of `APP_SURFACES`; one open at a time; closes on account switch/settings; waffle highlights when an app surface is active; profiles column scrollable)

- [ ] Implement; `npx tsc --noEmit -p renderer/tsconfig.json` + `npm run build` green; commit `feat: per-account waffle flyout with Google app surfaces`

### Task 7: Changelog + full verification

**Files:**
- Modify: `CHANGELOG.md` (Unreleased section, NL + EN)

- [ ] `npm run build`, `npx tsc --noEmit`, `npx tsc --noEmit -p renderer/tsconfig.json`, `npx vitest run` all green; runtime smoke via `DISPLAY=:0` if feasible; commit `docs: changelog for Google apps integration`
