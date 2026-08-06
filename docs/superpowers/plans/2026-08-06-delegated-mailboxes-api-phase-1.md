# Delegated Mailboxes API — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a delegated mailbox a working copy target in the drop dialog, with its real Gmail labels, by having the push relay mint impersonation tokens on request.

**Architecture:** The relay holds a domain-wide-delegation service-account key and exposes `POST /delegated/token`. It authenticates the caller with their Google access token, mints a token for the requested mailbox (`sub = mailbox`), verifies through `users/me/settings/delegates` that the caller really is an accepted delegate, and only then returns the token. The desktop app caches those tokens in memory and feeds them to the unchanged functions in `electron/gmail-api.ts`.

**Tech Stack:** TypeScript, Node 20, `node:crypto` for RS256 (no JWT library), vitest in both repos, Electron main process on the app side.

Design: [`docs/superpowers/specs/2026-08-06-delegated-mailboxes-api-design.md`](../specs/2026-08-06-delegated-mailboxes-api-design.md).
Google-side install steps: [`docs/delegated-api-setup.md`](../../delegated-api-setup.md).

## Global Constraints

- **Two repositories.** Tasks 1–5 are in the relay repo at `~/projects/gmail-push-relay` **inside WSL** (reach it with `wsl.exe -- bash -lc "cd ~/projects/gmail-push-relay && …"`). Tasks 6–10 are in the app worktree at `C:\Users\luca.manuel\gmail-desktop-build\.claude\worktrees\delegated-api-readme`.
- **Relay branch:** the relay working tree has **uncommitted changes** in `src/auth.ts`, `src/index.ts`, `src/ai-proxy.ts`, `test/auth.test.ts`, `.env.example`, `README.md`, `DEPLOYMENT.md` and `scripts/dev-local.sh`. Leave every one of them alone — `git stash` is shared between worktrees and must not be used. Work instead in a **separate git worktree** at `~/projects/gmail-push-relay-delegated`, branched from commit `d445688`, so that tree stays untouched (Task 1, Step 1).
- **Do not depend on the uncommitted work.** In particular, at `d445688` the `AuthResult` failure shape is `{ ok: false; reason: 'invalid_token' | 'not_allowed' }` with **no `detail` field** — `detail` exists only in the uncommitted `src/auth.ts`. Log `auth.reason` alone; using `auth.detail` would not compile on this branch.
- **Do not edit `src/ai-proxy.ts`.** It carries in-flight work. Where its helpers are needed, new copies go in `src/http-util.ts` (Task 4).
- **New written artifacts are English** — code comments, commit messages, docs. Existing Dutch documents stay Dutch; if one must be edited, keep that file Dutch.
- **No new npm dependencies.** RS256 signing uses `node:crypto`.
- **The DWD scopes are exactly** `https://www.googleapis.com/auth/gmail.readonly` and `https://www.googleapis.com/auth/gmail.insert`. Never `https://mail.google.com/`.
- **The feature is off unless configured.** Relay without `DELEGATED_SA_KEY_FILE` → the route 404s and push is unaffected. App without `delegatedTokenUrl` → behaves exactly as today.
- **Minted tokens are memory-only** in the app and are never written to disk or logged. Never log a token or the private key in either repo.
- **Relay code style:** no semicolons, single quotes, `test()` from vitest. **App code style:** semicolons, single quotes, `describe`/`it`.
- Nothing is configured at Google yet, so no task may depend on a live mailbox. Every test uses an injected `fetch`.

---

## File Structure

**Relay (`~/projects/gmail-push-relay`)**

| File | Responsibility |
| --- | --- |
| `src/delegated.ts` (new) | Read and validate the service-account key; sign the RS256 assertion; exchange it for an access token. |
| `src/delegated-auth.ts` (new) | Fetch and cache a mailbox's delegate list; answer "is this requester an accepted delegate?" |
| `src/http-util.ts` (new) | `bearer()` and `readBody()` for plain-http routes. |
| `src/delegated-route.ts` (new) | `POST /delegated/token`: order of checks, status codes, mint logging. |
| `src/config.ts` (modify) | `DELEGATED_SA_KEY_FILE`, derived `delegatedEnabled`. |
| `src/server.ts` (modify) | Serve the route when configured, 404 otherwise. |
| `src/index.ts` (modify) | Load the key at boot, wire the deps, log the misconfiguration case. |

**App (worktree)**

| File | Responsibility |
| --- | --- |
| `electron/delegated-config.ts` (new) | Parse `delegatedTokenUrl` from config/env; enforce https-except-loopback. |
| `electron/delegated-token.ts` (new) | `DelegatedTokenSource`: request tokens from the relay, cache per mailbox on `expiresAt`. |
| `electron/delegated-owner.ts` (new) | Pure: which authuser account owns a delegated mailbox, from its `/mail/u/<n>/d/…` URL. |
| `electron/main.ts` (modify) | `tokenForAccount` / `renewTokenFor` resolver; `LABELS_GET`; the copy and duplicate-scan paths. |

---

## Task 1: Sign and mint an impersonation token

**Files:**
- Create: `src/delegated.ts`
- Test: `test/delegated.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ServiceAccountKey` (`{ client_email: string; private_key: string }`), `DELEGATED_SCOPES: string[]`, `TOKEN_ENDPOINT: string`, `parseServiceAccountKey(text: string): ServiceAccountKey`, `assertion(key: ServiceAccountKey, mailbox: string, nowSec: number): string`, `MintedToken` (`{ accessToken: string; expiresAt: number }`), `mintToken(mailbox: string, deps: MintDeps): Promise<MintedToken>` where `MintDeps = { key: ServiceAccountKey; fetch?: typeof fetch; now?: () => number; tokenEndpoint?: string }`.

- [ ] **Step 1: Create an isolated worktree**

A worktree, not a branch switch: the main checkout holds uncommitted work in
files this plan also touches (`src/index.ts`), and a checkout there would mix the
two. A worktree gives a clean tree at `d445688` and leaves theirs alone.

```bash
wsl.exe -- bash -lc "cd ~/projects/gmail-push-relay && git worktree add ~/projects/gmail-push-relay-delegated -b feat/delegated-token d445688"
wsl.exe -- bash -lc "ln -s ~/projects/gmail-push-relay/node_modules ~/projects/gmail-push-relay-delegated/node_modules"
wsl.exe -- bash -lc "cd ~/projects/gmail-push-relay-delegated && git status --short && npx vitest run"
```

Expected: a clean status, and the existing suite passes in the new worktree.
`node_modules` is symlinked rather than reinstalled — same dependencies, no
second download.

**Every later relay command in this plan runs in `~/projects/gmail-push-relay-delegated`**, not in `~/projects/gmail-push-relay`.

- [ ] **Step 2: Write the failing test**

Create `test/delegated.test.ts`:

```ts
import { generateKeyPairSync, createVerify } from 'node:crypto'
import { expect, test } from 'vitest'
import { assertion, mintToken, parseServiceAccountKey, DELEGATED_SCOPES, TOKEN_ENDPOINT } from '../src/delegated'

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const key = {
  client_email: 'gmail-delegated@proj.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
}
const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))

test('the assertion impersonates the mailbox, not the service account', () => {
  const [, claims] = assertion(key, 'bart@abovomaxlead.nl', 1_700_000_000).split('.')
  const c = decode(claims)
  expect(c.iss).toBe(key.client_email)
  expect(c.sub).toBe('bart@abovomaxlead.nl')
  expect(c.aud).toBe(TOKEN_ENDPOINT)
  expect(c.scope).toBe(DELEGATED_SCOPES.join(' '))
})

test('the assertion never asks for more than an hour, which Google would refuse', () => {
  const [, claims] = assertion(key, 'bart@abovomaxlead.nl', 1_700_000_000).split('.')
  const c = decode(claims)
  expect(c.iat).toBe(1_700_000_000)
  expect(c.exp - c.iat).toBe(3600)
})

test('the assertion is a verifiable RS256 signature over header.claims', () => {
  const jwt = assertion(key, 'bart@abovomaxlead.nl', 1_700_000_000)
  const [header, claims, sig] = jwt.split('.')
  expect(decode(header)).toEqual({ alg: 'RS256', typ: 'JWT' })
  const ok = createVerify('RSA-SHA256')
    .update(`${header}.${claims}`)
    .verify(publicKey, Buffer.from(sig, 'base64url'))
  expect(ok).toBe(true)
})

test('minting posts the jwt-bearer grant and returns an expiry with slack', async () => {
  let seen: { url: string; body: string } | null = null
  const fakeFetch = (async (url: string, init: RequestInit) => {
    seen = { url, body: String(init.body) }
    return new Response(JSON.stringify({ access_token: 'ya29.x', expires_in: 3600 }), { status: 200 })
  }) as unknown as typeof fetch

  const token = await mintToken('bart@abovomaxlead.nl', {
    key,
    fetch: fakeFetch,
    now: () => 1_700_000_000_000,
  })

  expect(token.accessToken).toBe('ya29.x')
  // an hour, minus a minute of slack so a token is never used at its edge
  expect(token.expiresAt).toBe(1_700_000_000_000 + 3600_000 - 60_000)
  expect(seen!.url).toBe(TOKEN_ENDPOINT)
  const body = new URLSearchParams(seen!.body)
  expect(body.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer')
  expect(body.get('assertion')).toContain('.')
})

test('minting reports Googles own reason, which is the only useful clue', async () => {
  const fakeFetch = (async () =>
    new Response(JSON.stringify({ error: 'unauthorized_client', error_description: 'Client is unauthorized' }), {
      status: 401,
    })) as unknown as typeof fetch

  await expect(mintToken('bart@abovomaxlead.nl', { key, fetch: fakeFetch })).rejects.toThrow(
    'Client is unauthorized',
  )
})

test('a key file without the two fields that matter is refused', () => {
  expect(() => parseServiceAccountKey('{"client_email":"a@b"}')).toThrow()
  expect(() => parseServiceAccountKey('not json')).toThrow()
  expect(parseServiceAccountKey(JSON.stringify(key)).client_email).toBe(key.client_email)
})
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
wsl.exe -- bash -lc "cd ~/projects/gmail-push-relay-delegated && npx vitest run test/delegated.test.ts"
```

Expected: FAIL — cannot resolve `../src/delegated`.

- [ ] **Step 4: Write the implementation**

Create `src/delegated.ts`:

```ts
/**
 * Minting Gmail access tokens for a delegated mailbox, by impersonation.
 *
 * The Gmail API has no notion of a delegate: `userId` must be the token's own
 * user. So instead of "I am Luca and I may act for Bart", the signed assertion
 * says "I am Bart" — that is what `sub` does. For the resulting token `me` IS
 * Bart's mailbox, which is why every function in the app's gmail-api layer works
 * unchanged against it.
 *
 * The private key is the whole security boundary of this file: it is a password
 * for every mailbox in the domain. It only ever lives on this server, is never
 * logged, and is never returned to a caller.
 */

import { createSign } from 'node:crypto'

export interface ServiceAccountKey {
  client_email: string
  private_key: string
}

/**
 * Read + insert, deliberately not `https://mail.google.com/`. These two can read
 * a mailbox and add messages to it, but cannot delete anything. They must match
 * the scopes authorized in the Admin console character for character, or the
 * mint fails with `unauthorized_client`.
 */
export const DELEGATED_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.insert',
]

export const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'

/** Google refuses an assertion valid for longer than an hour. */
const LIFETIME_SEC = 3600

/** A minute of slack, so a token is never handed out at its own expiry edge. */
const SLACK_MS = 60_000

export function parseServiceAccountKey(text: string): ServiceAccountKey {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('service account key is not valid JSON')
  }
  const key = raw as Partial<ServiceAccountKey>
  if (typeof key.client_email !== 'string' || !key.client_email) {
    throw new Error('service account key has no client_email')
  }
  if (typeof key.private_key !== 'string' || !key.private_key) {
    throw new Error('service account key has no private_key')
  }
  return { client_email: key.client_email, private_key: key.private_key }
}

const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url')

export function assertion(key: ServiceAccountKey, mailbox: string, nowSec: number): string {
  const claims = {
    iss: key.client_email,
    sub: mailbox,
    scope: DELEGATED_SCOPES.join(' '),
    aud: TOKEN_ENDPOINT,
    iat: nowSec,
    exp: nowSec + LIFETIME_SEC,
  }
  const input = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(claims)}`
  const sig = createSign('RSA-SHA256').update(input).sign(key.private_key)
  return `${input}.${sig.toString('base64url')}`
}

export interface MintedToken {
  accessToken: string
  /** Epoch ms, already reduced by SLACK_MS. */
  expiresAt: number
}

export interface MintDeps {
  key: ServiceAccountKey
  fetch?: typeof fetch
  now?: () => number
  tokenEndpoint?: string
}

/**
 * There is no refresh token in this flow and none is needed: when a token
 * expires you simply mint another one.
 */
export async function mintToken(mailbox: string, deps: MintDeps): Promise<MintedToken> {
  const doFetch = deps.fetch ?? fetch
  const now = deps.now ?? Date.now
  const endpoint = deps.tokenEndpoint ?? TOKEN_ENDPOINT
  const startedAt = now()

  const res = await doFetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: assertion(deps.key, mailbox, Math.floor(startedAt / 1000)),
    }).toString(),
  })

  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string
    expires_in?: number
    error?: string
    error_description?: string
  }
  if (!res.ok || !json.access_token) {
    throw new Error(json.error_description ?? json.error ?? `mint failed: HTTP ${res.status}`)
  }
  return {
    accessToken: json.access_token,
    expiresAt: startedAt + (json.expires_in ?? LIFETIME_SEC) * 1000 - SLACK_MS,
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
wsl.exe -- bash -lc "cd ~/projects/gmail-push-relay-delegated && npx vitest run test/delegated.test.ts && npx tsc --noEmit"
```

Expected: 6 tests pass, no type errors.

- [ ] **Step 6: Commit**

```bash
wsl.exe -- bash -lc "cd ~/projects/gmail-push-relay-delegated && git add src/delegated.ts test/delegated.test.ts && git commit -m 'feat: mint impersonation tokens for a delegated mailbox

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>'"
```

---

## Task 2: Check the mailbox's own delegate list

**Files:**
- Create: `src/delegated-auth.ts`
- Test: `test/delegated-auth.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1 at runtime (it receives an already-minted token as an argument).
- Produces: `DELEGATES_URL: string`, `parseDelegates(json: unknown): string[]`, `class DelegationCheck` with `constructor(deps: DelegationCheckDeps)` and `isDelegate(requester: string, mailbox: string, token: string): Promise<boolean>`, where `DelegationCheckDeps = { fetch?: typeof fetch; now?: () => number; ttlMs?: number; delegatesUrl?: string }`.

**Why a cache keyed on the mailbox** (not on the pair): one fetch answers the question for every requester, so a label drag of hundreds of messages costs one delegates call instead of one per insert.

- [ ] **Step 1: Write the failing test**

Create `test/delegated-auth.test.ts`:

```ts
import { expect, test } from 'vitest'
import { DelegationCheck, parseDelegates } from '../src/delegated-auth'

const listBody = (delegates: unknown) => JSON.stringify({ delegates })

test('only an accepted delegate counts; pending has no access in Gmail either', () => {
  const out = parseDelegates({
    delegates: [
      { delegateEmail: 'Luca.Manuel@abovomaxlead.nl', verificationStatus: 'accepted' },
      { delegateEmail: 'pending@abovomaxlead.nl', verificationStatus: 'pending' },
      { delegateEmail: 'rejected@abovomaxlead.nl', verificationStatus: 'rejected' },
    ],
  })
  expect(out).toEqual(['luca.manuel@abovomaxlead.nl'])
})

test('a mailbox with no delegates parses as an empty list, not an error', () => {
  expect(parseDelegates({})).toEqual([])
  expect(parseDelegates(null)).toEqual([])
})

test('the requester is matched case-insensitively', async () => {
  const fakeFetch = (async () =>
    new Response(listBody([{ delegateEmail: 'luca.manuel@abovomaxlead.nl', verificationStatus: 'accepted' }]), {
      status: 200,
    })) as unknown as typeof fetch
  const check = new DelegationCheck({ fetch: fakeFetch })
  expect(await check.isDelegate('Luca.Manuel@abovomaxlead.nl', 'bart@abovomaxlead.nl', 't')).toBe(true)
})

test('someone who is not on the list is refused', async () => {
  const fakeFetch = (async () =>
    new Response(listBody([{ delegateEmail: 'someone@abovomaxlead.nl', verificationStatus: 'accepted' }]), {
      status: 200,
    })) as unknown as typeof fetch
  const check = new DelegationCheck({ fetch: fakeFetch })
  expect(await check.isDelegate('luca.manuel@abovomaxlead.nl', 'bart@abovomaxlead.nl', 't')).toBe(false)
})

test('the list is fetched once per mailbox within the ttl, then again after it', async () => {
  let calls = 0
  const fakeFetch = (async () => {
    calls += 1
    return new Response(listBody([{ delegateEmail: 'luca@x.nl', verificationStatus: 'accepted' }]), { status: 200 })
  }) as unknown as typeof fetch
  let clock = 1_000
  const check = new DelegationCheck({ fetch: fakeFetch, now: () => clock, ttlMs: 5_000 })

  await check.isDelegate('luca@x.nl', 'bart@x.nl', 't')
  await check.isDelegate('other@x.nl', 'bart@x.nl', 't')
  expect(calls).toBe(1)

  clock += 6_000
  await check.isDelegate('luca@x.nl', 'bart@x.nl', 't')
  expect(calls).toBe(2)
})

test('a failing delegates call refuses rather than allowing', async () => {
  const fakeFetch = (async () => new Response('nope', { status: 403 })) as unknown as typeof fetch
  const check = new DelegationCheck({ fetch: fakeFetch })
  await expect(check.isDelegate('luca@x.nl', 'bart@x.nl', 't')).rejects.toThrow()
})

test('a refusal is not cached, so a fixed permission takes effect immediately', async () => {
  let calls = 0
  const fakeFetch = (async () => {
    calls += 1
    return new Response('nope', { status: 500 })
  }) as unknown as typeof fetch
  const check = new DelegationCheck({ fetch: fakeFetch })
  await check.isDelegate('luca@x.nl', 'bart@x.nl', 't').catch(() => {})
  await check.isDelegate('luca@x.nl', 'bart@x.nl', 't').catch(() => {})
  expect(calls).toBe(2)
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
wsl.exe -- bash -lc "cd ~/projects/gmail-push-relay-delegated && npx vitest run test/delegated-auth.test.ts"
```

Expected: FAIL — cannot resolve `../src/delegated-auth`.

- [ ] **Step 3: Write the implementation**

Create `src/delegated-auth.ts`:

```ts
/**
 * Who may impersonate whom — the only limit that exists on a domain-wide
 * delegation grant.
 *
 * A DWD grant cannot be narrowed to a list of mailboxes or an OU: it covers
 * every mailbox in the domain, including ones created tomorrow. So the limit has
 * to come from our code, and it must not come from the client's word for it.
 * Instead we ask Google: `users/me/settings/delegates`, on a token minted for the
 * target mailbox, lists exactly who Gmail itself considers a delegate. That call
 * needs only gmail.readonly and is available to DWD service accounts, so it costs
 * no extra scope and no extra administrator action.
 */

export const DELEGATES_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/settings/delegates'

/** Five minutes. A revoked delegation therefore stops working within that. */
const DEFAULT_TTL_MS = 5 * 60_000

/**
 * Accepted delegates only, lowercased. A `pending` delegate cannot open the
 * mailbox in Gmail either, so treating one as authorized here would hand out
 * more access than the web interface does.
 */
export function parseDelegates(json: unknown): string[] {
  const raw = (json as { delegates?: unknown })?.delegates
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const d of raw) {
    const email = typeof d?.delegateEmail === 'string' ? d.delegateEmail.trim().toLowerCase() : ''
    if (email && d?.verificationStatus === 'accepted') out.push(email)
  }
  return out
}

export interface DelegationCheckDeps {
  fetch?: typeof fetch
  now?: () => number
  ttlMs?: number
  delegatesUrl?: string
}

interface Entry {
  delegates: string[]
  expiresAt: number
}

export class DelegationCheck {
  private cache = new Map<string, Entry>()

  constructor(private readonly deps: DelegationCheckDeps = {}) {}

  async isDelegate(requester: string, mailbox: string, token: string): Promise<boolean> {
    const delegates = await this.delegatesFor(mailbox, token)
    return delegates.includes(requester.trim().toLowerCase())
  }

  private async delegatesFor(mailbox: string, token: string): Promise<string[]> {
    const now = (this.deps.now ?? Date.now)()
    const key = mailbox.trim().toLowerCase()
    const hit = this.cache.get(key)
    if (hit && now < hit.expiresAt) return hit.delegates

    const doFetch = this.deps.fetch ?? fetch
    const res = await doFetch(this.deps.delegatesUrl ?? DELEGATES_URL, {
      headers: { Authorization: `Bearer ${token}` },
    })
    // Deliberately not cached as "no delegates": a failed lookup is not evidence
    // that nobody is authorized, and caching it would extend an outage into a
    // five-minute lockout.
    if (!res.ok) throw new Error(`delegates lookup failed: HTTP ${res.status}`)

    const delegates = parseDelegates(await res.json().catch(() => ({})))
    this.cache.set(key, { delegates, expiresAt: now + (this.deps.ttlMs ?? DEFAULT_TTL_MS) })
    return delegates
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
wsl.exe -- bash -lc "cd ~/projects/gmail-push-relay-delegated && npx vitest run test/delegated-auth.test.ts && npx tsc --noEmit"
```

Expected: 7 tests pass, no type errors.

- [ ] **Step 5: Commit**

```bash
wsl.exe -- bash -lc "cd ~/projects/gmail-push-relay-delegated && git add src/delegated-auth.ts test/delegated-auth.test.ts && git commit -m 'feat: authorize impersonation against the mailbox delegate list

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>'"
```

---

## Task 3: Configure the key

**Files:**
- Modify: `src/config.ts` (the `RelayConfig` interface and `loadConfig`)
- Test: `test/config.test.ts` (append)

**Interfaces:**
- Consumes: nothing.
- Produces: `RelayConfig.delegatedKeyFile: string | null` and `RelayConfig.delegatedEnabled: boolean`.

**Why `delegatedEnabled` needs `oauthClientId`:** the `aud` check is what keeps tokens minted by *any* other Google OAuth app from reaching this route. Without it configured the route must not serve at all — but the relay must still boot, because push deployments do not use this feature.

- [ ] **Step 1: Write the failing test**

Append to `test/config.test.ts`:

```ts
test('delegated minting is off unless a key file is configured', () => {
  const base = {
    PUBSUB_SUBSCRIPTION: 'sub',
    ALLOWED_EMAILS: 'a@b.nl',
    GOOGLE_APPLICATION_CREDENTIALS: '/secrets/sa.json',
  }
  expect(loadConfig(base).delegatedEnabled).toBe(false)
  expect(loadConfig(base).delegatedKeyFile).toBeNull()
})

test('delegated minting needs the oauth client id too, since aud is its only gate against foreign tokens', () => {
  const base = {
    PUBSUB_SUBSCRIPTION: 'sub',
    ALLOWED_EMAILS: 'a@b.nl',
    GOOGLE_APPLICATION_CREDENTIALS: '/secrets/sa.json',
    DELEGATED_SA_KEY_FILE: '/secrets/delegated-sa.json',
  }
  expect(loadConfig(base).delegatedEnabled).toBe(false)
  expect(loadConfig({ ...base, OAUTH_CLIENT_ID: 'client.apps.googleusercontent.com' }).delegatedEnabled).toBe(true)
  expect(loadConfig({ ...base, OAUTH_CLIENT_ID: 'client.apps.googleusercontent.com' }).delegatedKeyFile).toBe(
    '/secrets/delegated-sa.json',
  )
})
```

If `test/config.test.ts` does not already import `loadConfig` and `test`/`expect` from vitest, add those imports at the top of the file to match the existing style there.

- [ ] **Step 2: Run the test to verify it fails**

```bash
wsl.exe -- bash -lc "cd ~/projects/gmail-push-relay-delegated && npx vitest run test/config.test.ts"
```

Expected: FAIL — `delegatedEnabled` is undefined.

- [ ] **Step 3: Write the implementation**

In `src/config.ts`, add to the `RelayConfig` interface, after `oauthClientId`:

```ts
  /** Path to the domain-wide-delegation key. Separate from the push key on purpose. */
  delegatedKeyFile: string | null
  /** Derived: POST /delegated/token is served only with both a key and an aud to check. */
  delegatedEnabled: boolean
```

In `loadConfig`, before the `return`:

```ts
  // A second, separate service-account key. Not the push key: that one only holds
  // pubsub.subscriber, while this one can read and insert in every mailbox of the
  // domain. Keeping them apart means they rotate and get revoked apart.
  const delegatedKeyFile = env.DELEGATED_SA_KEY_FILE?.trim() || null
```

and add to the returned object:

```ts
    delegatedKeyFile,
    // Without OAUTH_CLIENT_ID there is no `aud` to check, and tokens from any
    // other Google app would be accepted. Fail closed — but do not refuse to
    // boot, because push deployments do not use this at all.
    delegatedEnabled: Boolean(delegatedKeyFile) && Boolean(env.OAUTH_CLIENT_ID?.trim()),
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
wsl.exe -- bash -lc "cd ~/projects/gmail-push-relay-delegated && npx vitest run && npx tsc --noEmit"
```

Expected: the whole suite passes, no type errors.

- [ ] **Step 5: Commit**

```bash
wsl.exe -- bash -lc "cd ~/projects/gmail-push-relay-delegated && git add src/config.ts test/config.test.ts && git commit -m 'feat: configure the delegated service account key

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>'"
```

---

## Task 4: The `POST /delegated/token` handler

**Files:**
- Create: `src/http-util.ts`
- Create: `src/delegated-route.ts`
- Test: `test/delegated-route.test.ts`

**Interfaces:**
- Consumes: `MintedToken` from Task 1; `isDelegate` shaped like `DelegationCheck.isDelegate` from Task 2; `AuthResult` from the existing `src/auth.ts`.
- Produces: `bearer(req: IncomingMessage): string | null`, `readBody(req: IncomingMessage, maxBytes: number): Promise<{ ok: true; text: string } | { ok: false }>`, `handleDelegatedToken(req: IncomingMessage, res: ServerResponse, deps: DelegatedRouteDeps): Promise<void>` where `DelegatedRouteDeps = { verify: (accessToken: string) => Promise<AuthResult>; mint: (mailbox: string) => Promise<MintedToken>; isDelegate: (requester: string, mailbox: string, token: string) => Promise<boolean>; log?: (msg: string, extra?: unknown) => void }`.

**Order of checks matters:** mint *before* the delegates lookup (the lookup needs that token), but never write the token to the response until the lookup has passed.

- [ ] **Step 1: Write the failing test**

Create `test/delegated-route.test.ts`:

```ts
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { expect, test } from 'vitest'
import { handleDelegatedToken } from '../src/delegated-route'

function makeReq(body: string, auth?: string) {
  const req = new PassThrough() as any
  req.method = 'POST'
  req.url = '/delegated/token'
  req.headers = auth ? { authorization: auth } : {}
  req.end(body)
  return req
}

function makeRes() {
  const chunks: string[] = []
  let status = 0
  const res = new EventEmitter() as any
  res.writeHead = (s: number) => {
    status = s
    return res
  }
  res.write = (c: string) => {
    chunks.push(c)
    return true
  }
  res.end = (c?: string) => {
    if (c) chunks.push(c)
    return res
  }
  Object.defineProperties(res, {
    status: { get: () => status },
    body: { get: () => chunks.join('') },
  })
  return res
}

const deps = (over: Record<string, unknown> = {}) =>
  ({
    verify: async () => ({ ok: true as const, email: 'luca.manuel@abovomaxlead.nl' }),
    mint: async () => ({ accessToken: 'ya29.x', expiresAt: 1_700_000_000_000 }),
    isDelegate: async () => true,
    ...over,
  }) as any

const body = JSON.stringify({ mailbox: 'bart@abovomaxlead.nl' })

test('an authorized delegate gets a token', async () => {
  const res = makeRes()
  await handleDelegatedToken(makeReq(body, 'Bearer t'), res, deps())
  expect(res.status).toBe(200)
  expect(JSON.parse(res.body)).toEqual({ accessToken: 'ya29.x', expiresAt: 1_700_000_000_000 })
})

test('no bearer header is 401', async () => {
  const res = makeRes()
  await handleDelegatedToken(makeReq(body), res, deps())
  expect(res.status).toBe(401)
})

test('a token Google rejects is 401', async () => {
  const res = makeRes()
  await handleDelegatedToken(
    makeReq(body, 'Bearer t'),
    res,
    deps({ verify: async () => ({ ok: false, reason: 'invalid_token' }) }),
  )
  expect(res.status).toBe(401)
})

test('a caller outside ALLOWED_EMAILS is 403', async () => {
  const res = makeRes()
  await handleDelegatedToken(
    makeReq(body, 'Bearer t'),
    res,
    deps({ verify: async () => ({ ok: false, reason: 'not_allowed' }) }),
  )
  expect(res.status).toBe(403)
})

test('a caller who is not a delegate is 403 and gets no token', async () => {
  const res = makeRes()
  await handleDelegatedToken(makeReq(body, 'Bearer t'), res, deps({ isDelegate: async () => false }))
  expect(res.status).toBe(403)
  expect(res.body).not.toContain('ya29')
})

test('a missing or malformed mailbox is 400', async () => {
  for (const bad of ['{}', 'not json', JSON.stringify({ mailbox: 'not-an-email' }), JSON.stringify({ mailbox: 5 })]) {
    const res = makeRes()
    await handleDelegatedToken(makeReq(bad, 'Bearer t'), res, deps())
    expect(res.status).toBe(400)
  }
})

test('a failing mint is 502, not 500 — the fault is upstream', async () => {
  const res = makeRes()
  await handleDelegatedToken(
    makeReq(body, 'Bearer t'),
    res,
    deps({
      mint: async () => {
        throw new Error('unauthorized_client')
      },
    }),
  )
  expect(res.status).toBe(502)
})

test('a failing delegates lookup is 502 and hands out nothing', async () => {
  const res = makeRes()
  await handleDelegatedToken(
    makeReq(body, 'Bearer t'),
    res,
    deps({
      isDelegate: async () => {
        throw new Error('delegates lookup failed: HTTP 500')
      },
    }),
  )
  expect(res.status).toBe(502)
  expect(res.body).not.toContain('ya29')
})

test('every mint is logged with who asked for which mailbox, and never the token', async () => {
  const lines: string[] = []
  const res = makeRes()
  await handleDelegatedToken(
    makeReq(body, 'Bearer t'),
    res,
    deps({ log: (msg: string, extra?: unknown) => lines.push(`${msg} ${String(extra ?? '')}`) }),
  )
  const joined = lines.join('\n')
  expect(joined).toContain('luca.manuel@abovomaxlead.nl')
  expect(joined).toContain('bart@abovomaxlead.nl')
  expect(joined).not.toContain('ya29.x')
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
wsl.exe -- bash -lc "cd ~/projects/gmail-push-relay-delegated && npx vitest run test/delegated-route.test.ts"
```

Expected: FAIL — cannot resolve `../src/delegated-route`.

- [ ] **Step 3: Write the http helpers**

Create `src/http-util.ts`:

```ts
/**
 * Small helpers for plain-http routes. `ai-proxy.ts` has its own copies; these
 * live separately on purpose, so that adding a route does not mean editing a
 * file that carries unrelated in-flight work.
 */

import type { IncomingMessage } from 'node:http'

export function bearer(req: IncomingMessage): string | null {
  const h = req.headers['authorization']
  if (typeof h !== 'string' || !h.startsWith('Bearer ')) return null
  return h.slice('Bearer '.length).trim() || null
}

export type BodyResult = { ok: true; text: string } | { ok: false }

export function readBody(req: IncomingMessage, maxBytes: number): Promise<BodyResult> {
  return new Promise((resolve) => {
    let data = ''
    let size = 0
    let settled = false
    const settle = (r: BodyResult): void => {
      if (settled) return
      settled = true
      resolve(r)
    }
    req.on('data', (c: Buffer | string) => {
      if (settled) return
      size += typeof c === 'string' ? Buffer.byteLength(c) : c.length
      if (size > maxBytes) {
        req.destroy()
        settle({ ok: false })
        return
      }
      data += c
    })
    req.on('end', () => settle({ ok: true, text: data }))
    req.on('error', () => settle({ ok: false }))
  })
}
```

- [ ] **Step 4: Write the route**

Create `src/delegated-route.ts`:

```ts
/**
 * POST /delegated/token — hand the desktop app a Gmail access token for a
 * mailbox that is delegated to it.
 *
 * Exists so the domain-wide-delegation key stays on this server. A key shipped
 * inside the Electron build would be extractable from app.asar, and it is a
 * password for every mailbox in the domain.
 *
 * Two gates, in this order: the caller must be a verified, allowlisted user of
 * this app (`verify`), and Gmail itself must list them as an accepted delegate of
 * the mailbox they are asking for (`isDelegate`). The token is minted before the
 * second gate because the lookup needs it, but it is never written to the
 * response until that gate passes.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AuthResult } from './auth'
import type { MintedToken } from './delegated'
import { bearer, readBody } from './http-util'

export interface DelegatedRouteDeps {
  verify: (accessToken: string) => Promise<AuthResult>
  mint: (mailbox: string) => Promise<MintedToken>
  isDelegate: (requester: string, mailbox: string, token: string) => Promise<boolean>
  /** Coarse metadata only — never a token, never the key. */
  log?: (msg: string, extra?: unknown) => void
}

/** The body is one email address; anything larger is not a real request. */
const MAX_BODY_BYTES = 4096

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const send = (res: ServerResponse, status: number, body?: unknown): void => {
  if (body === undefined) {
    res.writeHead(status)
    res.end()
    return
  }
  const text = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(text)) })
  res.end(text)
}

export async function handleDelegatedToken(
  req: IncomingMessage,
  res: ServerResponse,
  deps: DelegatedRouteDeps,
): Promise<void> {
  const token = bearer(req)
  if (!token) {
    send(res, 401)
    return
  }

  const auth = await deps.verify(token)
  if (!auth.ok) {
    // Only `reason`: the richer `detail` field exists on a branch that has not
    // landed yet, and this must compile without it.
    deps.log?.('[delegated] auth rejected', auth.reason)
    send(res, auth.reason === 'not_allowed' ? 403 : 401)
    return
  }
  // This route authorizes on identity, so an anonymous caller is useless here
  // even if the token itself is valid.
  if (!auth.email) {
    deps.log?.('[delegated] auth rejected', 'no_email_claim')
    send(res, 401)
    return
  }

  const body = await readBody(req, MAX_BODY_BYTES)
  if (!body.ok) {
    send(res, 400)
    return
  }
  let mailbox: unknown
  try {
    mailbox = (JSON.parse(body.text) as { mailbox?: unknown }).mailbox
  } catch {
    send(res, 400)
    return
  }
  if (typeof mailbox !== 'string' || !EMAIL.test(mailbox.trim())) {
    send(res, 400)
    return
  }
  const target = mailbox.trim().toLowerCase()

  let minted: MintedToken
  try {
    minted = await deps.mint(target)
  } catch (e) {
    deps.log?.('[delegated] mint failed', (e as Error).message)
    send(res, 502)
    return
  }

  let allowed: boolean
  try {
    allowed = await deps.isDelegate(auth.email, target, minted.accessToken)
  } catch (e) {
    deps.log?.('[delegated] delegates lookup failed', (e as Error).message)
    send(res, 502)
    return
  }
  if (!allowed) {
    deps.log?.('[delegated] refused', `${auth.email} is not an accepted delegate of ${target}`)
    send(res, 403)
    return
  }

  // The audit trail. In Google's own logs this access appears as the service
  // account, not as the person who asked for it; that link exists only here.
  deps.log?.('[delegated] minted', `${auth.email} -> ${target}`)
  send(res, 200, { accessToken: minted.accessToken, expiresAt: minted.expiresAt })
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
wsl.exe -- bash -lc "cd ~/projects/gmail-push-relay-delegated && npx vitest run test/delegated-route.test.ts && npx tsc --noEmit"
```

Expected: 9 tests pass, no type errors.

- [ ] **Step 6: Commit**

```bash
wsl.exe -- bash -lc "cd ~/projects/gmail-push-relay-delegated && git add src/http-util.ts src/delegated-route.ts test/delegated-route.test.ts && git commit -m 'feat: serve POST /delegated/token behind two gates

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>'"
```

---

## Task 5: Serve the route and document it

**Files:**
- Modify: `src/server.ts` (`RelayServerDeps`, the `createServer` callback)
- Modify: `src/index.ts` (`main`)
- Modify: `.env.example`
- Modify: `README.md`
- Test: `test/server.test.ts` (append)

**Interfaces:**
- Consumes: `handleDelegatedToken` and `DelegatedRouteDeps` (Task 4), `mintToken`/`parseServiceAccountKey` (Task 1), `DelegationCheck` (Task 2), `config.delegatedEnabled`/`config.delegatedKeyFile` (Task 3).
- Produces: `RelayServerDeps.delegated?: DelegatedRouteDeps`.

- [ ] **Step 1: Write the failing test**

Append to `test/server.test.ts` (reuse whatever helper the file already has for starting a server; if it starts one via `createRelayServer` and fetches `http://127.0.0.1:<port>`, follow that shape exactly):

```ts
test('POST /delegated/token is 404 on a push-only deployment', async () => {
  const server = createRelayServer({ port: 0, heartbeatMs: 60_000, verify: async () => ({ ok: true, email: 'a@b.nl' }) })
  const port = await server.listening
  const res = await fetch(`http://127.0.0.1:${port}/delegated/token`, {
    method: 'POST',
    headers: { authorization: 'Bearer t' },
    body: JSON.stringify({ mailbox: 'bart@abovomaxlead.nl' }),
  })
  expect(res.status).toBe(404)
  await server.close()
})

test('POST /delegated/token is served when it is configured', async () => {
  const server = createRelayServer({
    port: 0,
    heartbeatMs: 60_000,
    verify: async () => ({ ok: true, email: 'a@b.nl' }),
    delegated: {
      verify: async () => ({ ok: true, email: 'luca@abovomaxlead.nl' }),
      mint: async () => ({ accessToken: 'ya29.x', expiresAt: 42 }),
      isDelegate: async () => true,
    },
  })
  const port = await server.listening
  const res = await fetch(`http://127.0.0.1:${port}/delegated/token`, {
    method: 'POST',
    headers: { authorization: 'Bearer t' },
    body: JSON.stringify({ mailbox: 'bart@abovomaxlead.nl' }),
  })
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ accessToken: 'ya29.x', expiresAt: 42 })
  await server.close()
})

test('a GET on the delegated route is not served', async () => {
  const server = createRelayServer({
    port: 0,
    heartbeatMs: 60_000,
    verify: async () => ({ ok: true, email: 'a@b.nl' }),
    delegated: {
      verify: async () => ({ ok: true, email: 'luca@abovomaxlead.nl' }),
      mint: async () => ({ accessToken: 'ya29.x', expiresAt: 42 }),
      isDelegate: async () => true,
    },
  })
  const port = await server.listening
  const res = await fetch(`http://127.0.0.1:${port}/delegated/token`)
  expect(res.status).toBe(404)
  await server.close()
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
wsl.exe -- bash -lc "cd ~/projects/gmail-push-relay-delegated && npx vitest run test/server.test.ts"
```

Expected: FAIL — the second test gets 404, and `delegated` is not a known dep.

- [ ] **Step 3: Wire the route into the server**

In `src/server.ts`, add the import:

```ts
import { handleDelegatedToken, type DelegatedRouteDeps } from './delegated-route'
```

Add to `RelayServerDeps`, after `ai`:

```ts
  /** When present, `POST /delegated/token` is served. Absent = no minting here. */
  delegated?: DelegatedRouteDeps
```

In the `createServer` callback, directly after the existing `/ai/chat` block:

```ts
    if (req.method === 'POST' && req.url === '/delegated/token') {
      if (!deps.delegated) {
        res.writeHead(404)
        res.end()
        return
      }
      void handleDelegatedToken(req, res, { ...deps.delegated, log: deps.delegated.log ?? deps.log })
      return
    }
```

- [ ] **Step 4: Wire it up at boot**

In `src/index.ts`, add the imports:

```ts
import { readFileSync } from 'node:fs'
import { mintToken, parseServiceAccountKey, type ServiceAccountKey } from './delegated'
import { DelegationCheck } from './delegated-auth'
```

In `main()`, after the existing `if (config.aiEnabled) { … }` block:

```ts
  // The delegated-token route is optional in the same way the AI proxy is: a
  // push-only deployment has no key and serves 404. A key without an
  // OAUTH_CLIENT_ID is a misconfiguration, not a reason to take push down, so it
  // is loud in the log and the route simply stays off.
  if (config.delegatedKeyFile && !config.delegatedEnabled) {
    log(
      '[relay] ERROR: DELEGATED_SA_KEY_FILE is set but OAUTH_CLIENT_ID is not — ' +
        'POST /delegated/token stays disabled. The `aud` check is what keeps tokens from other ' +
        "Google apps out; set OAUTH_CLIENT_ID to the desktop app's OAuth client ID.",
    )
  }

  let delegatedKey: ServiceAccountKey | null = null
  if (config.delegatedEnabled) {
    try {
      delegatedKey = parseServiceAccountKey(readFileSync(config.delegatedKeyFile!, 'utf8'))
      log(`[relay] delegated minting enabled as ${delegatedKey.client_email}`)
    } catch (e) {
      // Same reasoning: an unreadable key disables one feature, it does not stop
      // the relay from forwarding push notifications.
      log(`[relay] ERROR: cannot read DELEGATED_SA_KEY_FILE — POST /delegated/token stays disabled`, (e as Error).message)
    }
  }
  const delegationCheck = new DelegationCheck()
```

Then in the `createRelayServer({ … })` call, after the `ai:` property:

```ts
    delegated: delegatedKey
      ? {
          // Identity matters here, so no allowAny: the caller must carry a
          // verified, allowlisted email, and `aud` must be this app's client.
          verify: (token) =>
            verifyToken(token, {
              tokeninfoUrl: config.tokeninfoUrl,
              allowedEmails: config.allowedEmails,
              expectedAud: config.oauthClientId ?? undefined,
            }),
          mint: (mailbox) => mintToken(mailbox, { key: delegatedKey! }),
          isDelegate: (requester, mailbox, token) => delegationCheck.isDelegate(requester, mailbox, token),
        }
      : undefined,
```

- [ ] **Step 5: Run the whole suite**

```bash
wsl.exe -- bash -lc "cd ~/projects/gmail-push-relay-delegated && npx vitest run && npx tsc --noEmit"
```

Expected: everything passes, no type errors.

- [ ] **Step 6: Document the env var**

Append to `.env.example`:

```
# --- Delegated mailbox tokens (optional) ---
# When set, the relay also serves POST /delegated/token, handing the desktop app
# a Gmail access token for a mailbox that is delegated to the caller.
#
# This is a SECOND service-account key, separate from GOOGLE_APPLICATION_CREDENTIALS
# above. It needs domain-wide delegation, authorized in the Admin console for
# exactly these scopes:
#   https://www.googleapis.com/auth/gmail.readonly,https://www.googleapis.com/auth/gmail.insert
# It is a password for every mailbox in the domain: keep it in secrets/ (gitignored),
# chmod 600, and rotate it by adding a new key before deleting the old one.
#
# OAUTH_CLIENT_ID above is REQUIRED for this route; without it the route stays
# disabled, because the `aud` check is what keeps tokens from other Google apps out.
DELEGATED_SA_KEY_FILE=
```

- [ ] **Step 7: Document the route**

Append to `README.md`, after the "AI proxy" section:

```markdown
## Delegated mailbox tokens (`POST /delegated/token`)

Optional third job: the relay mints Gmail access tokens for mailboxes that are
delegated to the caller, so the desktop app can copy mail into them. The
domain-wide-delegation key lives **only** here — inside the Electron build it
would be extractable from `app.asar`, and it is a password for every mailbox in
the domain.

Enabled by `DELEGATED_SA_KEY_FILE` (plus `OAUTH_CLIENT_ID`); unset means 404.

```
POST /delegated/token
Authorization: Bearer <caller's Google access token>
{ "mailbox": "bart@example.com" }

200 { "accessToken": "ya29…", "expiresAt": 1754… }   epoch ms, minus a minute of slack
400  missing or malformed mailbox
401  token rejected, wrong aud, or no verified email claim
403  caller not in ALLOWED_EMAILS, or not an accepted delegate of that mailbox
404  not configured on this deployment
502  Google refused the mint or the delegates lookup
```

Two gates, both server-side. The caller must be a verified, allowlisted user of
the app, **and** Gmail must list them as an `accepted` delegate of that mailbox
(`users/me/settings/delegates`, looked up on a token minted for the mailbox and
cached for five minutes). A domain-wide grant cannot be narrowed to a list of
mailboxes, so this check is the only limit that exists — do not weaken it.

Every mint is logged as `[delegated] minted <caller> -> <mailbox>`. In Google's
audit log the access appears as the service account, so this log is the only
place the requester is recorded.
```

- [ ] **Step 8: Commit**

```bash
wsl.exe -- bash -lc "cd ~/projects/gmail-push-relay-delegated && git add src/server.ts src/index.ts test/server.test.ts .env.example README.md && git commit -m 'feat: enable the delegated token route when a key is configured

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>'"
```

---

## Task 6: App config for the token URL

**Files:**
- Create: `electron/delegated-config.ts`
- Test: `tests/delegated-config.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `DelegatedConfig` (`{ tokenUrl: string }`), `parseDelegatedConfig(raw: unknown, env: NodeJS.ProcessEnv): DelegatedConfig | null`.

From here on, work in the app worktree: `C:\Users\luca.manuel\gmail-desktop-build\.claude\worktrees\delegated-api-readme`, on the existing branch `docs/delegated-api`.

- [ ] **Step 1: Write the failing test**

Create `tests/delegated-config.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseDelegatedConfig } from '../electron/delegated-config';

const file = { delegatedTokenUrl: 'https://relay.example.com/delegated/token' };

describe('parseDelegatedConfig', () => {
  it('reads the url from the config file', () => {
    expect(parseDelegatedConfig(file, {})).toEqual({ tokenUrl: file.delegatedTokenUrl });
  });

  it('returns null when it is missing, so the feature simply stays off', () => {
    expect(parseDelegatedConfig({}, {})).toBeNull();
    expect(parseDelegatedConfig(null, {})).toBeNull();
    expect(parseDelegatedConfig({ delegatedTokenUrl: '   ' }, {})).toBeNull();
  });

  it('lets the environment win, so a local relay can be tested without editing the file', () => {
    expect(
      parseDelegatedConfig(file, { GMAIL_DELEGATED_TOKEN_URL: 'http://localhost:8099/delegated/token' })?.tokenUrl,
    ).toBe('http://localhost:8099/delegated/token');
  });

  it('refuses plain http off-machine: the request carries a live Google token', () => {
    expect(parseDelegatedConfig({ delegatedTokenUrl: 'http://relay.example.com/delegated/token' }, {})).toBeNull();
  });

  it('accepts plain http on loopback, which is what local testing needs', () => {
    for (const url of [
      'http://localhost:8099/delegated/token',
      'http://127.0.0.1:8099/delegated/token',
      'http://[::1]:8099/delegated/token',
    ]) {
      expect(parseDelegatedConfig({ delegatedTokenUrl: url }, {})?.tokenUrl).toBe(url);
    }
  });

  it('refuses something that is not a url at all', () => {
    expect(parseDelegatedConfig({ delegatedTokenUrl: 'wss://relay.example.com' }, {})).toBeNull();
    expect(parseDelegatedConfig({ delegatedTokenUrl: 'relay.example.com' }, {})).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd "C:\Users\luca.manuel\gmail-desktop-build\.claude\worktrees\delegated-api-readme" && npx vitest run tests/delegated-config.test.ts
```

Expected: FAIL — cannot resolve `../electron/delegated-config`.

- [ ] **Step 3: Write the implementation**

Create `electron/delegated-config.ts`:

```ts
// Where the app can ask for a token for a delegated mailbox. Is this missing,
// then copying into delegated mailboxes stays off and the app behaves exactly as
// it did before — the same pattern as push (`push-config.ts`).
//
// The config itself sits with the OAuth details in userData and not in the repo:
// the repo is public. Environment wins, so a local relay can be tested without
// touching the file.
export interface DelegatedConfig {
  tokenUrl: string;
}

const HTTP_SCHEME = /^https?:\/\//i;
const PLAIN_SCHEME = /^http:\/\//i;

// The request carries a live Google access token in its Authorization header, so
// plain http may only go to this machine — which is exactly what testing against
// a local relay needs. Same rule, same reason, as push-config's ws:// check.
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1']);

function isLoopback(url: string): boolean {
  try {
    // URL gives an IPv6 host back WITH its brackets ('[::1]'), which we strip
    // here rather than putting bracketed forms in the set.
    const hostname = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return LOOPBACK.has(hostname);
  } catch {
    return false; // unreadable url: certainly not a deliberate local test
  }
}

export function parseDelegatedConfig(raw: unknown, env: NodeJS.ProcessEnv): DelegatedConfig | null {
  const file = (raw ?? {}) as { delegatedTokenUrl?: unknown };
  const fromEnv = (env.GMAIL_DELEGATED_TOKEN_URL ?? '').trim();
  const fromFile = typeof file.delegatedTokenUrl === 'string' ? file.delegatedTokenUrl.trim() : '';
  const tokenUrl = fromEnv || fromFile;
  if (!tokenUrl) return null;
  if (!HTTP_SCHEME.test(tokenUrl)) return null;
  if (PLAIN_SCHEME.test(tokenUrl) && !isLoopback(tokenUrl)) return null;
  return { tokenUrl };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd "C:\Users\luca.manuel\gmail-desktop-build\.claude\worktrees\delegated-api-readme" && npx vitest run tests/delegated-config.test.ts
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
cd "C:\Users\luca.manuel\gmail-desktop-build\.claude\worktrees\delegated-api-readme" && git add electron/delegated-config.ts tests/delegated-config.test.ts && git commit -m "feat: read where delegated tokens can be requested

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: The token source

**Files:**
- Create: `electron/delegated-token.ts`
- Test: `tests/delegated-token.test.ts`

**Interfaces:**
- Consumes: `DelegatedConfig.tokenUrl` from Task 6.
- Produces: `MintedToken` (`{ accessToken: string; expiresAt: number }`), `DelegatedTokenDeps` (`{ tokenUrl: string; ownerToken: (mailbox: string) => Promise<string | null>; fetch?: typeof fetch; now?: () => number; log?: (msg: string) => void }`), `class DelegatedTokenSource` with `get(mailbox: string): Promise<string | null>`, `forceMint(mailbox: string): Promise<string | null>`, `forget(mailbox: string): void`.

- [ ] **Step 1: Write the failing test**

Create `tests/delegated-token.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { DelegatedTokenSource } from '../electron/delegated-token';

const ok = (accessToken: string, expiresAt: number) =>
  new Response(JSON.stringify({ accessToken, expiresAt }), { status: 200 });

const deps = (over: Record<string, unknown> = {}) =>
  ({
    tokenUrl: 'https://relay.example.com/delegated/token',
    ownerToken: async () => 'owner-token',
    now: () => 1_000,
    ...over,
  }) as any;

describe('DelegatedTokenSource', () => {
  it('asks the relay for a token and returns it', async () => {
    const fetchMock = vi.fn(async () => ok('ya29.x', 100_000));
    const src = new DelegatedTokenSource(deps({ fetch: fetchMock }));
    expect(await src.get('bart@abovomaxlead.nl')).toBe('ya29.x');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://relay.example.com/delegated/token');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer owner-token');
    expect(JSON.parse(String(init.body))).toEqual({ mailbox: 'bart@abovomaxlead.nl' });
  });

  it('reuses a cached token instead of minting per insert', async () => {
    const fetchMock = vi.fn(async () => ok('ya29.x', 100_000));
    const src = new DelegatedTokenSource(deps({ fetch: fetchMock }));
    await src.get('bart@abovomaxlead.nl');
    await src.get('bart@abovomaxlead.nl');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('mints again once the cached token has expired', async () => {
    let clock = 1_000;
    const fetchMock = vi.fn(async () => ok('ya29.x', 5_000));
    const src = new DelegatedTokenSource(deps({ fetch: fetchMock, now: () => clock }));
    await src.get('bart@abovomaxlead.nl');
    clock = 6_000;
    await src.get('bart@abovomaxlead.nl');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('forceMint ignores the cache — a 401 means the token is dead, whatever our clock says', async () => {
    const fetchMock = vi.fn(async () => ok('ya29.fresh', 100_000));
    const src = new DelegatedTokenSource(deps({ fetch: fetchMock }));
    await src.get('bart@abovomaxlead.nl');
    expect(await src.forceMint('bart@abovomaxlead.nl')).toBe('ya29.fresh');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('caches per mailbox, never across mailboxes', async () => {
    const fetchMock = vi.fn(async (_u: string, init: RequestInit) =>
      ok(`token-for-${JSON.parse(String(init.body)).mailbox}`, 100_000),
    );
    const src = new DelegatedTokenSource(deps({ fetch: fetchMock }));
    expect(await src.get('bart@abovomaxlead.nl')).toBe('token-for-bart@abovomaxlead.nl');
    expect(await src.get('ans@abovomaxlead.nl')).toBe('token-for-ans@abovomaxlead.nl');
  });

  it('returns null when the relay refuses, so callers degrade instead of crashing', async () => {
    for (const status of [400, 401, 403, 404, 502]) {
      const src = new DelegatedTokenSource(
        deps({ fetch: async () => new Response('no', { status }) }),
      );
      expect(await src.get('bart@abovomaxlead.nl')).toBeNull();
    }
  });

  it('returns null when the relay cannot be reached at all', async () => {
    const src = new DelegatedTokenSource(
      deps({
        fetch: async () => {
          throw new Error('ECONNREFUSED');
        },
      }),
    );
    expect(await src.get('bart@abovomaxlead.nl')).toBeNull();
  });

  it('does not even ask when the owning account has no token', async () => {
    const fetchMock = vi.fn(async () => ok('ya29.x', 100_000));
    const src = new DelegatedTokenSource(deps({ fetch: fetchMock, ownerToken: async () => null }));
    expect(await src.get('bart@abovomaxlead.nl')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forget drops a mailbox from the cache', async () => {
    const fetchMock = vi.fn(async () => ok('ya29.x', 100_000));
    const src = new DelegatedTokenSource(deps({ fetch: fetchMock }));
    await src.get('bart@abovomaxlead.nl');
    src.forget('bart@abovomaxlead.nl');
    await src.get('bart@abovomaxlead.nl');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd "C:\Users\luca.manuel\gmail-desktop-build\.claude\worktrees\delegated-api-readme" && npx vitest run tests/delegated-token.test.ts
```

Expected: FAIL — cannot resolve `../electron/delegated-token`.

- [ ] **Step 3: Write the implementation**

Create `electron/delegated-token.ts`:

```ts
// Tokens for delegated mailboxes, minted by the relay.
//
// Why not simply an access token like every other account: the Gmail API has no
// notion of a delegate, so reading or writing in a delegated mailbox needs a
// token that impersonates it. That takes a service-account key with domain-wide
// delegation, and such a key is a password for every mailbox in the domain — far
// too dangerous to ship inside the app. So the relay holds the key, checks with
// Google whether the requester really is a delegate, and only then mints.
//
// Deliberately NOT stored on disk, unlike OAuthStore: these last an hour and can
// always be re-minted, so writing them down would add risk and buy nothing.

export interface MintedToken {
  accessToken: string;
  /** Epoch ms; the relay already subtracted a minute of slack. */
  expiresAt: number;
}

export interface DelegatedTokenDeps {
  tokenUrl: string;
  // The relay authorizes on who is asking, so the request must carry the token
  // of the account that actually holds the delegation — see delegated-owner.ts.
  ownerToken: (mailbox: string) => Promise<string | null>;
  fetch?: typeof fetch;
  now?: () => number;
  log?: (msg: string) => void;
}

export class DelegatedTokenSource {
  private cache = new Map<string, MintedToken>();

  constructor(private readonly deps: DelegatedTokenDeps) {}

  /** A valid token for this mailbox, minted only if the cached one is gone. */
  async get(mailbox: string): Promise<string | null> {
    const key = mailbox.trim().toLowerCase();
    const hit = this.cache.get(key);
    if (hit && (this.deps.now ?? Date.now)() < hit.expiresAt) return hit.accessToken;
    return this.mint(key);
  }

  /**
   * Mint regardless of the cache. For the 401 path: Google rejecting a token is
   * the final word on whether it is alive, whatever our own clock believes.
   */
  async forceMint(mailbox: string): Promise<string | null> {
    return this.mint(mailbox.trim().toLowerCase());
  }

  forget(mailbox: string): void {
    this.cache.delete(mailbox.trim().toLowerCase());
  }

  private async mint(mailbox: string): Promise<string | null> {
    const owner = await this.deps.ownerToken(mailbox);
    // No token for the owning account means there is nothing to authenticate the
    // request with; asking anyway would only earn a 401.
    if (!owner) return null;

    const doFetch = this.deps.fetch ?? fetch;
    let res: Response;
    try {
      res = await doFetch(this.deps.tokenUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${owner}` },
        body: JSON.stringify({ mailbox }),
      });
    } catch {
      this.deps.log?.(`[delegated] relay unreachable for ${mailbox}`);
      return null;
    }
    if (!res.ok) {
      // 403 is the normal answer for a mailbox that is not delegated to us; the
      // caller turns this into a message in the interface, not a crash.
      this.deps.log?.(`[delegated] relay refused ${mailbox}: HTTP ${res.status}`);
      return null;
    }

    let json: Partial<MintedToken>;
    try {
      json = (await res.json()) as Partial<MintedToken>;
    } catch {
      return null;
    }
    if (typeof json.accessToken !== 'string' || typeof json.expiresAt !== 'number') return null;

    this.cache.set(mailbox, { accessToken: json.accessToken, expiresAt: json.expiresAt });
    return json.accessToken;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd "C:\Users\luca.manuel\gmail-desktop-build\.claude\worktrees\delegated-api-readme" && npx vitest run tests/delegated-token.test.ts
```

Expected: 9 tests pass.

- [ ] **Step 5: Commit**

```bash
cd "C:\Users\luca.manuel\gmail-desktop-build\.claude\worktrees\delegated-api-readme" && git add electron/delegated-token.ts tests/delegated-token.test.ts && git commit -m "feat: request and cache tokens for delegated mailboxes

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 8: Which account owns a delegated mailbox

**Files:**
- Create: `electron/delegated-owner.ts`
- Test: `tests/delegated-owner.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `delegatedHostIndex(mailUrl: string): number | null`, `ownerFor(mailUrl: string, authusers: Array<{ index: number; email: string }>): string | null`.

**Why:** the relay checks whether *the requester* is a delegate, so the request must be authenticated as the account that holds the delegation. A delegated mailbox URL is `https://mail.google.com/mail/u/<n>/d/<opaque>/` (`electron/delegation.ts:8`), and `<n>` is the authuser index of the owning account.

- [ ] **Step 1: Write the failing test**

Create `tests/delegated-owner.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { delegatedHostIndex, ownerFor } from '../electron/delegated-owner';

const url = (n: number) => `https://mail.google.com/mail/u/${n}/d/AEoRXRTxxxEvLsatGZu6d_R/`;
const authusers = [
  { index: 0, email: 'luca.manuel@abovomaxlead.nl' },
  { index: 1, email: 'info@abovomaxlead.nl' },
];

describe('delegatedHostIndex', () => {
  it('reads the authuser index the delegated mailbox hangs under', () => {
    expect(delegatedHostIndex(url(0))).toBe(0);
    expect(delegatedHostIndex(url(2))).toBe(2);
  });

  it('returns null for a normal inbox url, which has no /d/ segment', () => {
    expect(delegatedHostIndex('https://mail.google.com/mail/u/0/')).toBeNull();
  });

  it('returns null for nonsense instead of guessing', () => {
    expect(delegatedHostIndex('')).toBeNull();
    expect(delegatedHostIndex('not a url')).toBeNull();
    expect(delegatedHostIndex('https://example.com/mail/u/0/d/x/')).toBeNull();
  });
});

describe('ownerFor', () => {
  it('resolves the mailbox to the account it hangs under', () => {
    expect(ownerFor(url(1), authusers)).toBe('info@abovomaxlead.nl');
  });

  it('returns null when that account is not connected, so the caller can fall back', () => {
    expect(ownerFor(url(7), authusers)).toBeNull();
    expect(ownerFor('https://mail.google.com/mail/u/0/', authusers)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd "C:\Users\luca.manuel\gmail-desktop-build\.claude\worktrees\delegated-api-readme" && npx vitest run tests/delegated-owner.test.ts
```

Expected: FAIL — cannot resolve `../electron/delegated-owner`.

- [ ] **Step 3: Write the implementation**

Create `electron/delegated-owner.ts`:

```ts
// Which of your own accounts holds the delegation for a delegated mailbox.
//
// The relay decides whether a token may be minted by asking Google who the
// mailbox's delegates are, and comparing that with whoever authenticated the
// request. So the request has to go out as the account that actually holds the
// delegation, not just any connected account.
//
// Google's own url tells us: a delegated mailbox lives at
// `/mail/u/<n>/d/<opaque>/`, where <n> is the authuser index of the account it
// hangs under (see the observations at the top of delegation.ts).

const DELEGATED_PATH = /^\/mail\/u\/(\d+)\/d\/[^/]+/;

export function delegatedHostIndex(mailUrl: string): number | null {
  try {
    const u = new URL(mailUrl);
    if (u.hostname !== 'mail.google.com') return null;
    const m = DELEGATED_PATH.exec(u.pathname);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

/**
 * The email of the account the mailbox hangs under, or null when it cannot be
 * determined — the caller then falls back to trying the connected accounts, and
 * a wrong guess simply earns a clean 403 from the relay.
 */
export function ownerFor(
  mailUrl: string,
  authusers: Array<{ index: number; email: string }>,
): string | null {
  const index = delegatedHostIndex(mailUrl);
  if (index === null) return null;
  return authusers.find((a) => a.index === index)?.email ?? null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd "C:\Users\luca.manuel\gmail-desktop-build\.claude\worktrees\delegated-api-readme" && npx vitest run tests/delegated-owner.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
cd "C:\Users\luca.manuel\gmail-desktop-build\.claude\worktrees\delegated-api-readme" && git add electron/delegated-owner.ts tests/delegated-owner.test.ts && git commit -m "feat: resolve which account holds a delegated mailbox

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 9: One resolver, and delegated mailboxes in the copy dialog

**Files:**
- Modify: `electron/main.ts` — imports near line 103; the config helpers next to `pushConfig()` at 1178–1185; the `IPC.LABELS_GET` handler at 2226–2273.

**Interfaces:**
- Consumes: `parseDelegatedConfig` (Task 6), `DelegatedTokenSource` (Task 7), `ownerFor` (Task 8).
- Produces: `tokenForAccount(email: string): Promise<string | null>` and `renewTokenFor(email: string): Promise<string | null>` as module-level functions in `main.ts`, used by Task 10.

**On testing:** `main.ts` has no unit tests in this repo (it is the Electron wiring layer), and this task adds none. Its correctness rests on the units already tested in Tasks 6–8, plus `tsc` and the manual check in Step 6.

- [ ] **Step 1: Add the imports**

Near the other electron-local imports around `main.ts:103`:

```ts
import { parseDelegatedConfig, type DelegatedConfig } from './delegated-config';
import { DelegatedTokenSource } from './delegated-token';
import { ownerFor } from './delegated-owner';
```

- [ ] **Step 2: Add the config helper and the source**

Directly below `pushConfig()` (which ends around `main.ts:1185`). Note that `pushConfig()` deliberately re-reads the file on every call so the relay lines can be added without restarting the app; this follows that, and rebuilds the source when the url changes.

```ts
// Same file as the client id, and re-read per call for the same reason as
// pushConfig above: you can add the line without restarting the app.
function delegatedConfig(): DelegatedConfig | null {
  try {
    return parseDelegatedConfig(JSON.parse(readFileSync(OAUTH_CONFIG_PATH, 'utf8')), process.env);
  } catch {
    // File missing or unreadable: then this is simply not configured.
    return parseDelegatedConfig(null, process.env);
  }
}

// The relay checks whether the *requester* is a delegate of the mailbox, so the
// request has to go out as the account that actually holds the delegation.
// Google's own url says which one that is; if it cannot be resolved, try the
// connected accounts, because a wrong guess earns a clean 403 and nothing worse.
async function ownerTokenFor(mailbox: string): Promise<string | null> {
  const cfg = oauthConfig();
  if (!cfg || !oauthTokens) return null;
  const p = profiles.find(
    (x) => x.kind === 'delegated' && x.email.toLowerCase() === mailbox.toLowerCase(),
  );
  const authusers = profiles
    .filter((x) => x.ref.kind === 'authuser')
    .map((x) => ({ index: x.ref.kind === 'authuser' ? x.ref.index : -1, email: x.email }));
  const owner = p && p.ref.kind === 'delegated' ? ownerFor(p.ref.mailUrl, authusers) : null;
  for (const email of owner ? [owner] : authusers.map((a) => a.email)) {
    const token = await accessTokenFor(cfg, oauthTokens, email);
    if (token) return token;
  }
  return null;
}

// Tokens for delegated mailboxes, minted by the relay. Null when nothing is
// configured — then delegated mailboxes have no labels and cannot be copied to,
// exactly as before. Rebuilt when the url changes, which also empties the token
// cache: pointing the app at another relay must not reuse the old one's tokens.
let delegatedTokens: DelegatedTokenSource | null = null;
let delegatedTokenUrl = '';

function delegatedSource(): DelegatedTokenSource | null {
  const cfg = delegatedConfig();
  if (!cfg) {
    delegatedTokens = null;
    delegatedTokenUrl = '';
    return null;
  }
  if (!delegatedTokens || delegatedTokenUrl !== cfg.tokenUrl) {
    delegatedTokenUrl = cfg.tokenUrl;
    delegatedTokens = new DelegatedTokenSource({
      tokenUrl: cfg.tokenUrl,
      ownerToken: ownerTokenFor,
      log: (msg) => console.log(msg),
    });
  }
  return delegatedTokens;
}
```

- [ ] **Step 3: Add the resolver**

Next to the other token helpers in `main.ts` (anywhere above the IPC handlers):

```ts
// One place that decides where an account's token comes from: OAuth for your own
// accounts, the relay for delegated mailboxes. Every call site that used to call
// accessTokenFor directly goes through here, so neither needs to know which kind
// of account it is holding.
function isDelegatedAccount(email: string): boolean {
  return profiles.some(
    (p) => p.kind === 'delegated' && p.email.toLowerCase() === email.toLowerCase(),
  );
}

async function tokenForAccount(email: string): Promise<string | null> {
  if (isDelegatedAccount(email)) {
    const src = delegatedSource();
    return src ? src.get(email) : null;
  }
  const cfg = oauthConfig();
  if (!cfg || !oauthTokens) return null;
  return accessTokenFor(cfg, oauthTokens, email);
}

// What to do when Google answers 401. For a delegated mailbox that means "mint
// again" — there is no refresh token in an impersonation flow — and for your own
// accounts it means the refresh we already did.
async function renewTokenFor(email: string): Promise<string | null> {
  if (isDelegatedAccount(email)) {
    const src = delegatedSource();
    return src ? src.forceMint(email) : null;
  }
  const cfg = oauthConfig();
  if (!cfg || !oauthTokens) return null;
  return forceRefresh(cfg, oauthTokens, email);
}
```

- [ ] **Step 4: Let delegated mailboxes into the copy dialog**

In the `IPC.LABELS_GET` handler, replace the `own` filter so delegated mailboxes are included:

```ts
    // Delegated mailboxes belong here too: with a relay token they are a real
    // copy target. The source account is still left out — a copy inside the same
    // mailbox is a duplicate.
    const own = profiles.filter((p) => !lastDropSource || p.email !== lastDropSource);
```

Replace the early return so it no longer depends on OAuth alone:

```ts
    if ((!cfg || !oauthTokens) && !delegatedSource()) {
      return { accounts: own.map((p) => ({ email: p.email, labels: [], error: 'Niet gekoppeld' })) };
    }
```

Replace `const token = await accessTokenFor(cfg, oauthTokens, p.email);` with:

```ts
      const token = await tokenForAccount(p.email);
```

and the failure line just below it with:

```ts
      if (!token) {
        // A delegated mailbox has no OAuth connection to renew: either the relay
        // is not configured, or it says this mailbox is not delegated to us.
        // Showing the row with a reason is honest — the mailbox IS in the sidebar,
        // so leaving it out would read as a bug.
        accounts.push({
          email: p.email,
          labels: [],
          error: p.kind === 'delegated' ? 'Beheerdertoegang nodig' : 'Verbinding verlopen',
        });
        continue;
      }
```

In the `catch` block of the same handler, replace the refresh line

```ts
        const fresh = unauthorized ? await forceRefresh(cfg, oauthTokens, p.email) : null;
```

with

```ts
        const fresh = unauthorized ? await renewTokenFor(p.email) : null;
```

and guard the reconnect bookkeeping below it, which only makes sense for your own accounts:

```ts
        if (unauthorized) {
          if (p.kind !== 'delegated') {
            refreshFailures.add(p.email);
            scheduleOAuthHealthCheck();
          }
          accounts.push({
            email: p.email,
            labels: [],
            error: p.kind === 'delegated' ? 'Beheerdertoegang nodig' : 'Verbinding verlopen',
          });
        } else {
```

Leave the `refreshFailures.delete(p.email)` on the success path as it is.

- [ ] **Step 5: Typecheck and run the suite**

```bash
cd "C:\Users\luca.manuel\gmail-desktop-build\.claude\worktrees\delegated-api-readme" && npx tsc --noEmit && npx vitest run
```

Expected: no type errors, the whole suite passes.

- [ ] **Step 6: Check the off-state by hand**

With no `delegatedTokenUrl` configured, start the app and open the copy dialog on a drag.

Expected: your own accounts behave exactly as before, and each delegated mailbox appears as a row carrying "Beheerdertoegang nodig" instead of being absent. If a delegated mailbox is missing from the list entirely, Step 4's filter change did not take.

- [ ] **Step 7: Commit**

```bash
cd "C:\Users\luca.manuel\gmail-desktop-build\.claude\worktrees\delegated-api-readme" && git add electron/main.ts && git commit -m "feat: offer delegated mailboxes as copy targets

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 10: Copy into a delegated mailbox

**Files:**
- Modify: `electron/main.ts` — `findDuplicates` around line 1099; the `IPC.MAIL_DROP_COPY` handler around 2342–2400.

**Interfaces:**
- Consumes: `tokenForAccount` and `renewTokenFor` (Task 9).
- Produces: nothing new.

- [ ] **Step 1: Route the duplicate scan through the resolver**

At `main.ts:1099`, replace

```ts
    const token = await accessTokenFor(cfg, oauthTokens, t.email);
```

with

```ts
    // Delegated targets are scanned like any other: messageExistsInLabel does not
    // care where the token came from.
    const token = await tokenForAccount(t.email);
```

If the surrounding code then no longer uses its `cfg` or `oauthTokens` parameters, leave the signature alone — Task 9's helpers read the module state themselves, and changing the signature would touch call sites this plan does not cover.

- [ ] **Step 2: Route the copy itself**

In the `IPC.MAIL_DROP_COPY` handler, replace

```ts
      let token = await accessTokenFor(cfg, oauthTokens, target.email);
```

with

```ts
      let token = await tokenForAccount(target.email);
```

and the failure branch directly below it with:

```ts
      if (!token) {
        const delegated = isDelegatedAccount(target.email);
        if (!delegated) {
          refreshFailures.add(target.email);
          scheduleOAuthHealthCheck();
        }
        done += files.length;
        progress('copy', target.email);
        accounts.push({
          email: target.email,
          copied: 0,
          skipped: 0,
          total: files.length,
          error: delegated ? 'Beheerdertoegang nodig' : 'Verbinding verlopen',
        });
        continue;
      }
```

- [ ] **Step 3: Make the 401 retry re-mint**

In the same handler's insert loop, replace

```ts
            const fresh = await forceRefresh(cfg, oauthTokens, target.email);
```

with

```ts
            // For a delegated mailbox a 401 means "mint again", not "refresh":
            // an impersonation flow has no refresh token.
            const fresh = await renewTokenFor(target.email);
```

and guard the bookkeeping in that branch:

```ts
            if (!fresh) {
              const delegated = isDelegatedAccount(target.email);
              if (!delegated) {
                refreshFailures.add(target.email);
                scheduleOAuthHealthCheck();
              }
              throw new Error(delegated ? 'Beheerdertoegang nodig' : 'Verbinding verlopen');
            }
            token = fresh;
            // Only own accounts sit in the reconnect list; a delegated mailbox
            // has no OAuth connection that could be "restored" here.
            if (!isDelegatedAccount(target.email)) refreshFailures.delete(target.email);
```

- [ ] **Step 4: Typecheck and run the suite**

```bash
cd "C:\Users\luca.manuel\gmail-desktop-build\.claude\worktrees\delegated-api-readme" && npx tsc --noEmit && npx vitest run
```

Expected: no type errors, the whole suite passes.

- [ ] **Step 5: Commit**

```bash
cd "C:\Users\luca.manuel\gmail-desktop-build\.claude\worktrees\delegated-api-readme" && git add electron/main.ts && git commit -m "feat: copy mail into a delegated mailbox

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Verification once an administrator has done the grant

None of this can be proven against a real mailbox until the Google-side setup in
[`docs/delegated-api-setup.md`](../../delegated-api-setup.md) §5 steps 1–2 exists.
When it does, in this order:

1. **Whose mailbox is `me`?** With a token from the relay:

   ```bash
   curl -s -H "Authorization: Bearer $TOKEN" https://gmail.googleapis.com/gmail/v1/users/me/profile
   ```

   It must return the delegated mailbox's address. If it returns your own, the
   `sub` claim did not arrive and every copy would land in the wrong mailbox.
   **Do this before the first insert.**

2. **The refusal path.** Ask the relay for a token for a mailbox that is *not*
   delegated to you. Expect `403` and no token in the response body.

3. **A copy.** Drag one message onto a delegated mailbox, then check in Gmail
   that it landed under the chosen label and kept its original date (if it shows
   today's date, `internalDateSource=dateHeader` is missing from `INSERT_URL`).

4. **The log.** `[delegated] minted <you> -> <mailbox>` must appear in the relay
   log, and no token may appear anywhere in it.

## Not in this plan

Phase 2 (dragging *out of* delegated mailboxes) and phase 3 (unread counts and
push) get their own plans, written once phase 1 has landed. See the spec's
"Phases" section.
