# Delegated mailboxes through the Gmail API

Copying mail **into** and dragging mail **out of** a delegated mailbox, plus real
unread counts and push for those mailboxes — without a service-account key ever
living inside the desktop app.

Background and the Google-side install steps are in
[`docs/delegated-api-setup.md`](../../delegated-api-setup.md) (Dutch). This spec
covers what we build; that document covers what an administrator must click.

## Problem

Everything the app does through the Gmail API runs on one access token per
account, against `users/me` (`electron/gmail-api.ts:17`). The Gmail API has no
concept of a delegate: `userId` must be the token's own user, so a delegated
mailbox answers `403 Delegation denied`. Delegation configured in Gmail's web
interface grants access to that web interface only — no API access comes with it.

Consequently a delegated mailbox cannot be a copy target and cannot be a drag
source over the API, and its unread count is scraped from the page title instead
of read from Gmail. The sidebar layer (`electron/delegation.ts`,
`electron/delegated-store.ts`) deliberately works on the web session and is not
affected by any of this.

The only way in is impersonation: a service account with domain-wide delegation
(DWD) signs a JWT carrying `sub = <mailbox>`, exchanges it for an access token,
and for that token `me` **is** the delegated mailbox. Every existing function in
`electron/gmail-api.ts` then works unchanged — they all already take an
`accessToken` argument. We need a second token source, not a second code path.

## Constraints

1. **The service-account key must not ship in the app.** That key is a password
   for every mailbox in the domain. The desktop app runs on user machines; a key
   there is extractable from `app.asar`. This is a different class of risk from
   the OAuth tokens already stored, which only reach mailboxes the user
   personally consented to.
2. **The feature is off unless configured.** With no relay URL in the config the
   app must behave exactly as it does today, the way push already does
   (`electron/push-config.ts:1`).
3. **Nothing at Google is arranged yet.** No service account, no admin
   authorization. Everything here must therefore be verifiable with tests and a
   fake Google; a live mailbox test waits on the administrator.
4. **Authorization cannot be taken on the client's word.** A DWD grant cannot be
   narrowed to a list of mailboxes or an OU — it covers every mailbox in the
   domain, including ones created tomorrow. The limiting must live in our code,
   on the server.

## Approach: the relay mints, the app calls Gmail

The existing push relay (`~/projects/gmail-push-relay`, deployed separately) is
the one place we already run that the app trusts and the user does not control.
The key lives there; the app asks it for a token for one mailbox at a time.

```
  app                          relay                        Google
   │                             │                             │
   │  POST /delegated/token      │                             │
   │  Bearer <user token>        │                             │
   │  { mailbox: bart@… }        │                             │
   ├────────────────────────────►│                             │
   │                             │  tokeninfo(user token)      │
   │                             ├────────────────────────────►│
   │                             │◄─── requester identity ─────┤
   │                             │                             │
   │                             │  JWT sub=bart@… → token     │
   │                             ├────────────────────────────►│
   │                             │◄─── access token (1 h) ─────┤
   │                             │                             │
   │                             │  users/me/settings/delegates│
   │                             ├────────────────────────────►│
   │                             │◄─── is requester a delegate?┤
   │  { accessToken, expiresAt } │                             │
   │◄────────────────────────────┤                             │
   │                                                           │
   │  Gmail calls, Bearer <minted token>, userId = me          │
   ├──────────────────────────────────────────────────────────►│
```

The alternative — proxying every Gmail call through the relay so the token never
leaves the server — was rejected. It would push raw RFC822 messages up to 50 MB
through the relay, making it see mail content (which it currently never does),
and would require a server-side twin of every function in `gmail-api.ts`.

The accepted cost: for up to an hour the app holds a token that can read and
insert in one delegated mailbox. That is narrower than the key itself, and it
cannot delete anything — the DWD grant is `gmail.readonly` + `gmail.insert`, not
`https://mail.google.com/`.

### Authorization: ask Google, do not keep a list

Before returning a token the relay checks the mailbox's own delegate list:

1. Mint the token for the mailbox (`sub = mailbox`).
2. `GET users/me/settings/delegates` with that token.
3. Allow only if the requester appears there with `verificationStatus`
   `accepted` — a `pending` delegate has no access in Gmail either.

Verified against Google's reference: `users.settings.delegates.list` accepts
`gmail.readonly`, and is *"only available to service account clients that have
been delegated domain-wide authority"*. So the check needs no extra scope and no
extra administrator action beyond the grant we already require.

This hangs authorization on Google's own delegation administration.
`delegated.json` in the app stays what it is: a list for the interface, never a
right.

## Relay: `POST /delegated/token`

New route beside `/ai/chat`, which already demonstrates the pattern of an
optional, key-holding endpoint that 404s when unconfigured (`src/server.ts:45`).

```
POST /delegated/token
Authorization: Bearer <a connected account's Google access token>
Content-Type: application/json

{ "mailbox": "bart@abovomaxlead.nl" }
```

| Status | Meaning |
| --- | --- |
| `200` | `{ "accessToken": "ya29…", "expiresAt": 1754… }` — epoch ms, already reduced by a minute of slack |
| `400` | Unparseable body or missing/invalid `mailbox` |
| `401` | Token rejected by tokeninfo, wrong `aud`, or no verified email claim |
| `403` | Requester not in `ALLOWED_EMAILS`, or not an accepted delegate of `mailbox` |
| `404` | Endpoint not configured on this deployment |
| `502` | Google refused the mint or the delegates call |

**Identity.** `verifyToken` is reused with `allowedEmails` and
`expectedAud: OAUTH_CLIENT_ID` — not `allowAny`, because this route authorizes on
who the caller is. The app requests `userinfo.email` (`electron/google-oauth.ts:27`),
so tokeninfo returns the address; without that scope the route cannot work, which
is the same dependency push already has.

**Configuration.** `DELEGATED_SA_KEY_FILE` points at a key file; absent means the
route 404s and the relay boots as a push-only deployment. When it *is* set but
`OAUTH_CLIENT_ID` is empty, the relay logs an error and keeps the route at 404 —
fail closed, without taking push down over a misconfiguration.

**A separate key.** Not the existing `secrets/sa.json` (that one only holds
`pubsub.subscriber`). A DWD key is domain-wide powerful; keeping it separate
means it rotates and revokes separately. `secrets/` is already gitignored.

**Modules.**

- `src/delegated.ts` — read the key, sign the RS256 assertion with `node:crypto`,
  exchange it at `https://oauth2.googleapis.com/token`. No library. Claims:
  `iss` = `client_email`, `sub` = mailbox, `scope` = readonly + insert,
  `aud` = the token endpoint, `iat`/`exp` one hour apart.
- `src/delegated-auth.ts` — `mayImpersonate(requester, mailbox)`, the delegates
  check plus its cache.
- `src/delegated-route.ts` — body parsing, status mapping, logging.

**Caching.** Minted tokens are cached per mailbox until `expiresAt` — a label
drag inserts hundreds of messages and must not mint per insert. Authorization
outcomes are cached per `(requester, mailbox)` for 5 minutes, positive and
negative alike. The consequence, and it is deliberate: revoking a delegation in
Gmail takes up to 5 minutes plus the token's remaining life to take effect here.

**Logging.** One line per mint: requester, mailbox, timestamp. In Google's audit
log the access appears as the service account, not as the person who asked for
it; that link exists only in this log. Never log a token.

## App: a second token source

**`electron/delegated-config.ts`** — mirrors `push-config.ts`. Reads
`delegatedTokenUrl` from `google-oauth.json` in `userData`, with
`GMAIL_DELEGATED_TOKEN_URL` taking precedence so a local relay can be tested
without touching the file. Requires `https://`, except on loopback, for the same
reason push refuses plain `ws://` off-machine: the request carries a live Google
access token.

**`electron/delegated-token.ts`** — `DelegatedTokenSource`, with a cache per
mailbox keyed on `expiresAt` and a `forceMint` for the 401 path. Tokens are held
**in memory only**: they last an hour and can always be re-minted, so writing
them to disk would add risk and buy nothing. Deliberately not stored in
`OAuthStore`, whose entries are long-lived refresh tokens with a different
lifecycle.

**Which account authenticates the request.** The relay checks whether *the
requester* is a delegate, so the request must carry the token of the account that
actually holds the delegation. A delegated mailbox's `mailUrl` has the form
`/mail/u/<n>/d/<token>/` (`electron/delegation.ts:8`), and `<n>` is the authuser
index of the owning account. Resolve the owner through that index against the
`authuser` profiles; if it cannot be resolved, fall back to trying the connected
accounts in order — a wrong one gets a clean 403, and there are only a handful.

**One resolver.** `main.ts` calls `accessTokenFor(cfg, oauthTokens, email)` at six
sites (1099, 1221, 1333, 1721, 2240, 2342). A single `tokenForAccount(email)`
dispatches on whether the address is an own account or a delegated mailbox, and a
matching `renewTokenFor(email)` chooses between `forceRefresh` and `forceMint`
for the 401 retry those sites already implement. For a delegated mailbox a 401
means "mint again", never "refresh".

**Failure surface.** `LABELS_GET` currently filters to `p.kind === 'authuser'`
(`electron/main.ts:2232`), which drops delegated mailboxes from the copy dialog.
They join the list; when no token can be obtained the row is returned with
`labels: []` and an error ("Beheerdertoegang nodig"), the way `'Niet gekoppeld'`
works now. Silently omitting them would be worse — the mailbox *is* visible in
the sidebar, so its absence would read as a bug.

## Phases

Each phase stands on its own and is useful when it lands.

**Phase 1 — copying into delegated mailboxes.** Relay endpoint and its tests;
`delegated-config.ts`, `delegated-token.ts`, the resolver; `LABELS_GET` and the
copy path in `MAIL_DROP_COPY`. After this, a delegated mailbox is a copy target
with its real labels.

**Phase 2 — dragging out of delegated mailboxes.** Route `collectLabelViaApi`
(`electron/main.ts:1324`) and the drag-source handling through the resolver.
Because DWD gives us `gmail.readonly` anyway, the API path simply covers
delegated mailboxes; the `view=om` session workaround explored in §3 of
`delegated-api-setup.md` becomes unnecessary.

**Phase 3 — unread counts and push.** `history.list` and `users.watch` work on a
minted token (`watch` accepts `gmail.readonly`, verified), so arming the watch
stays in the app. Routing is the relay's part: notifications arrive carrying the
delegated mailbox's address, while the socket is authenticated as its owner.

The wire protocol gains one client frame. Today `handleConnection` ignores
everything after `auth` (`src/connection.ts:59`); it will accept
`{"type":"watch","mailbox":"bart@…"}`, run the same `mayImpersonate` check, and
on success `registry.add(mailbox, socket)` so the existing `broadcastSync` reaches
it unchanged. It answers `{"type":"watching","mailbox":…}` or closes `4403`.
`push-manager.ts` gains the notion of a connection that authenticates as one
address and subscribes to another; it cannot open a connection *as* the delegated
mailbox, because a minted token carries no `userinfo.email` scope and would be
refused with `4401`.

## Security

- **Domain-wide really is domain-wide.** The relay's authorization check is the
  only limit that exists. It must be the first thing reviewed and the last thing
  weakened.
- The key never enters this repo, a build script, an `.env` that ships, or a log.
- Rotate by creating a second key, switching the relay, then deleting the first.
- Minted tokens stay in memory in the app, are never logged, and are never sent
  anywhere except `gmail.googleapis.com`.
- Removing the feature means removing the DWD grant in the Admin console. A
  forgotten grant is an open door with no user attached.

## Testing

Everything is testable without a DWD grant, which matters because there is not
going to be one for a while.

- **Relay** (vitest, injected `fetch`): claim shape of the signed assertion,
  including that `sub` is the mailbox; `accepted` versus `pending` delegates;
  every status in the table above; the 404 when unconfigured and when
  `OAUTH_CLIENT_ID` is missing; token and authorization cache behaviour, and that
  a token is never returned before the delegates check passes.
- **App** (vitest, `tests/`): `parseDelegatedConfig` including the https/loopback
  rule; `DelegatedTokenSource` caching, expiry and re-mint on 401; resolver
  dispatch between own accounts and delegated mailboxes; owner resolution from a
  `/mail/u/<n>/d/<token>/` URL and its fallback.
- **Live**, once an administrator has done the grant: `users/me/profile` with a
  minted token must return the delegated mailbox's address. If it returns your
  own, the `sub` claim did not arrive and a copy would land in the wrong mailbox.
  This check comes before the first insert.

## Out of scope

- The Admin SDK Directory API. Enumerating mailboxes in the domain is a separate
  capability with its own admin authorization, and nothing here needs it.
- Replacing the account-switcher scrape. It stays what §11 of
  `delegated-api-setup.md` concluded: a discovery problem, not an access problem.
- Delegated calendars.
- Deleting or modifying mail in a delegated mailbox. The grant is read + insert,
  and it should stay that way.
