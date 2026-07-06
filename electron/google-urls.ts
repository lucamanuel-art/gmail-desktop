export function mailUrl(index: number): string {
  return `https://mail.google.com/mail/u/${index}/`;
}

export function calendarUrl(index: number): string {
  return `https://calendar.google.com/calendar/u/${index}/r`;
}

// Opens Google's "add another account" flow and lands back in Gmail once the
// new session is signed in. Used by the sidebar "+" button: unlike a hidden
// re-detect probe, this shows a real login page so a not-yet-signed-in account
// can actually be added; auto-detection then registers it via its identity.
export function addAccountUrl(): string {
  return 'https://accounts.google.com/AddSession?continue=https://mail.google.com/mail/';
}
