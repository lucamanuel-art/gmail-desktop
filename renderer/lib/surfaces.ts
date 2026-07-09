// Single source of truth for the Google surfaces the app hosts, shared by the
// Electron main process, the preloads and the sidebar renderer. It lives under
// renderer/ because Next.js cannot compile imports from outside its root,
// while esbuild (main bundle) and vitest import from anywhere. Keep this
// module pure data — no Electron or DOM imports.

import type { AccountRef } from './account-ref';

export const SURFACES = [
  'mail',
  'calendar',
  'drive',
  'docs',
  'sheets',
  'slides',
  'keep',
  'contacts',
  'chat',
] as const;

export type Surface = (typeof SURFACES)[number];

export interface SurfaceConfig {
  label: string;
  // Host the surface lives on; navigations/popups to it stay in-app.
  host: string;
  // First path segment when the host is shared between surfaces
  // (docs.google.com serves Docs, Sheets and Slides).
  path?: string;
  // Build the surface URL for an account. Authuser accounts derive it from
  // their /u/<index>/ slot; delegated mailboxes carry Google's own captured
  // URL (mail/calendar only — other surfaces are not offered for delegates and
  // throw if asked, guarded by surfacesForRef).
  url(ref: AccountRef): string;
  // Only calendar needs background timers to keep firing (reminder timing).
  backgroundThrottling: boolean;
}

// A surface that only exists for the user's own accounts: reject delegated refs
// loudly rather than emit a wrong URL. surfacesForRef never offers these for a
// delegated mailbox, so this only fires on a programming error.
function ownedIndex(ref: AccountRef, surface: string): number {
  if (ref.kind !== 'authuser') {
    throw new Error(`surface "${surface}" is not available for delegated mailboxes`);
  }
  return ref.index;
}

export const SURFACE_CONFIG: Record<Surface, SurfaceConfig> = {
  mail: {
    label: 'Mail',
    host: 'mail.google.com',
    // Delegated mailboxes use Google's own captured href, adopted verbatim.
    url: (ref) =>
      ref.kind === 'delegated' ? ref.mailUrl : `https://mail.google.com/mail/u/${ref.index}/`,
    backgroundThrottling: true,
  },
  calendar: {
    label: 'Calendar',
    host: 'calendar.google.com',
    // Delegated calendar URL is the captured one (only present when reachable).
    url: (ref) =>
      ref.kind === 'delegated'
        ? ref.calendarUrl!
        : `https://calendar.google.com/calendar/u/${ref.index}/r`,
    backgroundThrottling: false,
  },
  drive: {
    label: 'Drive',
    host: 'drive.google.com',
    url: (ref) => `https://drive.google.com/drive/u/${ownedIndex(ref, 'drive')}/my-drive`,
    backgroundThrottling: true,
  },
  docs: {
    label: 'Docs',
    host: 'docs.google.com',
    path: 'document',
    url: (ref) => `https://docs.google.com/document/u/${ownedIndex(ref, 'docs')}/`,
    backgroundThrottling: true,
  },
  sheets: {
    label: 'Sheets',
    host: 'docs.google.com',
    path: 'spreadsheets',
    url: (ref) => `https://docs.google.com/spreadsheets/u/${ownedIndex(ref, 'sheets')}/`,
    backgroundThrottling: true,
  },
  slides: {
    label: 'Slides',
    host: 'docs.google.com',
    path: 'presentation',
    url: (ref) => `https://docs.google.com/presentation/u/${ownedIndex(ref, 'slides')}/`,
    backgroundThrottling: true,
  },
  keep: {
    label: 'Keep',
    host: 'keep.google.com',
    url: (ref) => `https://keep.google.com/u/${ownedIndex(ref, 'keep')}/`,
    backgroundThrottling: true,
  },
  contacts: {
    label: 'Contacts',
    host: 'contacts.google.com',
    url: (ref) => `https://contacts.google.com/u/${ownedIndex(ref, 'contacts')}/`,
    backgroundThrottling: true,
  },
  chat: {
    label: 'Chat',
    host: 'chat.google.com',
    url: (ref) => `https://chat.google.com/u/${ownedIndex(ref, 'chat')}/`,
    backgroundThrottling: true,
  },
};

// Which surfaces an account offers: all of them for an authuser account; mail
// (and calendar only when reachable) for a delegated mailbox.
export function surfacesForRef(ref: AccountRef): Surface[] {
  if (ref.kind === 'authuser') return [...SURFACES];
  return ref.calendarUrl ? ['mail', 'calendar'] : ['mail'];
}

// The waffle flyout's contents: every surface except the pinned mail avatar
// and calendar button.
export const APP_SURFACES: readonly Surface[] = SURFACES.filter(
  (s) => s !== 'mail' && s !== 'calendar',
);

// Which hosted surface owns a URL, so an in-app popup (e.g. a Docs link in an
// email) opens in that surface's view instead of clobbering the view it was
// clicked in. Null for anything the app doesn't host as a surface.
export function surfaceForUrl(url: string): Surface | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  const firstSegment = parsed.pathname.split('/').filter(Boolean)[0] ?? '';
  for (const s of SURFACES) {
    const cfg = SURFACE_CONFIG[s];
    if (cfg.host !== host) continue;
    if (cfg.path === undefined || cfg.path === firstSegment) return s;
  }
  return null;
}
