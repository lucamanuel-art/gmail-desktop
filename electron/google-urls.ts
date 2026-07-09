import { SURFACES, SURFACE_CONFIG } from '../renderer/lib/surfaces';

export function mailUrl(index: number): string {
  return SURFACE_CONFIG.mail.url({ kind: 'authuser', index });
}

export function calendarUrl(index: number): string {
  return SURFACE_CONFIG.calendar.url({ kind: 'authuser', index });
}

// Gmail's focused single-message reading window lives under a /popout path.
// Such a window.open must always be allowed through as a real window (never
// suppressed or redirected in-app), since only Gmail can open a working one.
export function isPopoutUrl(url: string): boolean {
  try {
    return new URL(url).pathname.includes('/popout');
  } catch {
    return false;
  }
}

// Hosts served inside the app windows themselves: every hosted surface
// (Gmail, Calendar, Drive, Docs, …) plus the Google auth flow. Navigations and
// popups to these stay in-app; everything else (links clicked inside an email,
// including Google's www.google.com/url redirect wrapper) opens in the user's
// default browser instead.
const IN_APP_HOSTS = new Set([
  ...SURFACES.map((s) => SURFACE_CONFIG[s].host),
  'accounts.google.com',
]);

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

// True when a URL belongs to a surface the app hosts itself (Gmail/Calendar/
// auth), so its popups and navigation should be kept in-app.
export function isInAppUrl(url: string): boolean {
  const host = hostOf(url);
  return host !== null && IN_APP_HOSTS.has(host);
}

// True for any google.com host. Used as a safety net for top-frame navigation:
// Google's own login/redirect flows may hop between google.com subdomains, so
// those stay in-app; only genuinely off-Google navigation is externalised.
export function isGoogleUrl(url: string): boolean {
  const host = hostOf(url);
  return host !== null && (host === 'google.com' || host.endsWith('.google.com'));
}

// Identity-provider hosts a Google Workspace sign-in can redirect the embedded
// view to. When a domain federates Google sign-in to Microsoft Entra ID, the
// login flow leaves google.com for login.microsoftonline.com (and friends)
// mid-handshake. Such a navigation must stay in-app: externalising it via
// shell.openExternal drops the federation form POST and re-issues it as a bare
// GET, which Entra rejects with "AADSTS900561: The endpoint only accepts POST
// requests. Received a GET request." — leaving the account impossible to add.
const FEDERATED_LOGIN_HOSTS = new Set([
  'login.microsoftonline.com',
  'login.microsoft.com',
  'login.windows.net',
  'login.live.com',
]);

// True for a Microsoft Entra login host used during federated Workspace SSO, so
// its top-frame navigation is kept in-app rather than bounced to the browser.
export function isFederatedLoginUrl(url: string): boolean {
  const host = hostOf(url);
  if (host === null) return false;
  return FEDERATED_LOGIN_HOSTS.has(host) || host.endsWith('.microsoftonline.com');
}

// Opens Google's "add another account" flow and lands back in Gmail once the
// new session is signed in. Used by the sidebar "+" button: unlike a hidden
// re-detect probe, this shows a real login page so a not-yet-signed-in account
// can actually be added; auto-detection then registers it via its identity.
export function addAccountUrl(): string {
  return 'https://accounts.google.com/AddSession?continue=https://mail.google.com/mail/';
}
