// Which way a drag can read its mail, and the one place that knows the session
// path cannot reach a delegated mailbox.
//
// There are two ways to get the raw bytes of a message:
//
//   'api'      the Gmail API with an access token — for a delegated mailbox that
//              token is minted by the relay (see delegated-token.ts)
//   'session'  Gmail's own "view original" pages on the logged-in session
//              (mail-fetch.ts), which needs no token at all
//
// The catch: `omUrl` builds only the `/mail/u/<n>/` form. A delegated mailbox
// lives at `/mail/u/<n>/d/<opaque>/`, and that opaque id exists nowhere but in
// Google's own UI. So for a delegated mailbox the session path is not a fallback
// — it would read the owning account's mailbox with a thread id from someone
// else's. Hence 'blocked': say so, rather than save nothing and call it empty.

export type ReadPath = 'api' | 'session' | 'blocked';

/** What a blocked drag reports. Same wording as the copy dialog uses. */
export const NO_ADMIN_ACCESS = 'Beheerdertoegang nodig';

export function readPathFor(o: {
  drag: 'label' | 'thread';
  delegated: boolean;
  hasToken: boolean;
}): ReadPath {
  if (o.delegated) return o.hasToken ? 'api' : 'blocked';
  // Own accounts: a label drag prefers the api (one request per thread instead
  // of seconds per page of Gmail's list view), while a single thread keeps the
  // session path it has always used — deliberately, so the most-used drag does
  // not change behaviour.
  if (o.drag === 'label') return o.hasToken ? 'api' : 'session';
  return 'session';
}
