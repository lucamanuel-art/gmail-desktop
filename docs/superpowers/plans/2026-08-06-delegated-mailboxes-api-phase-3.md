# Delegated Mailboxes API — Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real unread counts and push notifications for delegated mailboxes, read from Gmail instead of scraped from the webview's page title.

**Architecture:** A delegated mailbox cannot open its own relay connection — the relay identifies a socket by running `tokeninfo` on the token it is given, and a minted impersonation token carries only `gmail.readonly` and `gmail.insert`, no `userinfo.email`, so it would be closed with `4401`. Instead the socket authenticates as the **owning account** and then sends one new frame, `{"type":"subscribe","mailbox":"…"}`, which **re-points** that connection at the delegated mailbox. The relay verifies the delegation with the same machinery phase 1 built (mint a token, read `users/me/settings/delegates`) before honouring it. Arming the Gmail `watch` stays in the app, on the minted token.

**Tech Stack:** TypeScript, Node 20, vitest in both repos, Electron main process.

## Status — 2026-08-06

All four tasks are implemented. Relay: 88 tests (`feat/delegated-token`, pushed),
`tsc --noEmit` clean, `npm run delegated:check` still passes. App: 755 tests
(`docs/delegated-api`), `tsc --noEmit` clean, `npm run build:main` bundles.

Own accounts are covered by the pre-existing `push-manager` tests, which assert
the exact handshake order and were not edited; a fourth new test pins that an own
account sends no `subscribe` frame at all.

**Not verified:** everything under "Verification once an administrator has done
the grant" — it needs the Google-side setup, which does not exist yet. In
particular check 3 (mail to your own mailbox must not move the delegated tab's
counter) is the one that proves the re-point works end to end; it is covered by a
relay test but not against real Pub/Sub traffic.

Design: [`docs/superpowers/specs/2026-08-06-delegated-mailboxes-api-design.md`](../specs/2026-08-06-delegated-mailboxes-api-design.md) §"Phases", phase 3.
Phase 1: [`…-phase-1.md`](./2026-08-06-delegated-mailboxes-api-phase-1.md) · Phase 2: [`…-phase-2.md`](./2026-08-06-delegated-mailboxes-api-phase-2.md)

## Global Constraints

- **Two repositories.** Relay tasks run in the existing worktree `~/projects/gmail-push-relay-delegated` on branch `feat/delegated-token` (already created in phase 1). App tasks run in the app worktree on `docs/delegated-api`.
- **The relay toolchain cannot run from WSL** (no `node` there). Every relay command goes through a container:
  `wsl.exe -- bash -lc "docker run --rm -v /home/developer/projects/gmail-push-relay-delegated:/app -w /app node:20 sh -c '…'"`.
  Never pass `$PWD` from a Windows shell — it expands on the Windows side and mounts the wrong directory.
- **Leave `~/projects/gmail-push-relay` alone.** It still holds uncommitted work, and `git stash` is shared between worktrees.
- **`AuthResult` at this branch has no `detail` field** — that lives in the relay's uncommitted work. Log `reason` only.
- **New written artifacts are English.** Comments *inside* `main.ts` follow that file and stay Dutch.
- **Own accounts must not change behaviour.** `tests/push-manager.test.ts` asserts the exact handshake event order for an own account (`['watch:a@x.nl', 'cover:a@x.nl:true', 'sync:a@x.nl']`); that assertion must keep passing untouched.
- Notifications for delegated mailboxes ride the existing per-account notification settings, so they can be turned off per mailbox. No new setting.
- No new npm dependencies. Nothing may depend on a live Google setup.

## Two decisions already made

1. **A refused subscription closes that socket with `4403`.** `push-manager` opens one connection per account, so a delegated mailbox has its own socket and closing it does not touch the owner's. `4403` is already in `FATAL_CLOSE_CODES`, so the app stops retrying by itself — no new client-side message type is needed for the refusal case. A *failed* subscription (mint or lookup errored) closes without a fatal code instead, so a passing outage is retried rather than treated as "not allowed".
2. **`subscribe` re-points, it does not add.** A sync frame is `{"type":"sync","historyId":…}` and carries **no address**; the relay routes purely by which address a socket is registered under. If the delegated socket stayed registered under the owner's address as well, a change in the owner's own mailbox would be delivered on it, and the app would run a history sync against the wrong mailbox. So the handler does `registry.remove(socket)` before `registry.add(mailbox, socket)`.

## A security note to keep

The subscription is verified once, and the relay caches a mailbox's delegate list for five minutes. If a delegation is revoked, that socket keeps receiving `{type:'sync'}` triggers until it reconnects. Those triggers carry no mail content — only "something changed" — and actually reading the mailbox needs a token the relay would by then refuse to mint. Bounded, but real: write it into the README rather than leave it to be discovered.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/connection.ts` (relay, modify) | Accept and verify the `subscribe` frame; re-point the registry; acknowledge or refuse. |
| `src/server.ts` (relay, modify) | Pass the delegation deps down to `handleConnection`. |
| `src/index.ts` (relay, modify) | Reuse the phase 1 mint + `DelegationCheck` for connections, not just the route. |
| `README.md` (relay, modify) | Document the frame and the revocation window. |
| `electron/push-manager.ts` (app, modify) | `subscribeAs` dep; send the frame; gate coverage on the acknowledgement. |
| `electron/main.ts` (app, modify) | Delegated mailboxes become pushable: owner token for auth, minted token for `watch` and history sync. |

---

## Task 1: The `subscribe` frame

**Files:**
- Modify: `src/connection.ts`
- Test: `test/connection.test.ts` (append)

**Interfaces:**
- Consumes: `MintedToken` from `src/delegated.ts`; `DelegationCheck.isDelegate` from `src/delegated-auth.ts` (both phase 1).
- Produces: `HandleConnectionDeps.delegated?: { mint: (mailbox: string) => Promise<MintedToken>; isDelegate: (requester: string, mailbox: string, token: string) => Promise<boolean> }`, and the wire frames `{"type":"subscribe","mailbox":string}` → `{"type":"subscribed","mailbox":string}`.

- [ ] **Step 1: Write the failing test**

Append to `test/connection.test.ts`, reusing the `makeSocket()` helper and
`verifyOk` already at the top of that file (`makeSocket()` returns
`{ socket, sent, state, emit, emitClose }`, and refusals land in
`state.closedWith`):

```ts
const delegatedDeps = (over: Record<string, unknown> = {}) => ({
  mint: async () => ({ accessToken: 'ya29.minted', expiresAt: 1 }),
  isDelegate: async () => true,
  ...over,
})

test('a verified delegate re-points the connection at the mailbox', async () => {
  const registry = new Registry()
  const s = makeSocket()
  handleConnection(s.socket, {
    registry,
    verify: verifyOk('luca@abovomaxlead.nl'),
    delegated: delegatedDeps(),
  })
  s.emit(JSON.stringify({ type: 'auth', accessToken: 'owner-token' }))
  await vi.waitFor(() => expect(registry.socketsFor('luca@abovomaxlead.nl')).toHaveLength(1))

  s.emit(JSON.stringify({ type: 'subscribe', mailbox: 'bart@abovomaxlead.nl' }))
  await vi.waitFor(() =>
    expect(s.sent).toContain(JSON.stringify({ type: 'subscribed', mailbox: 'bart@abovomaxlead.nl' })),
  )
  // Re-pointed, not added: a sync for the owner's own mailbox must not arrive on
  // this connection, because the frame carries no address to tell them apart.
  expect(registry.socketsFor('luca@abovomaxlead.nl')).toHaveLength(0)
  expect(registry.socketsFor('bart@abovomaxlead.nl')).toContain(s.socket)
})

test('the mailbox is lowercased, so casing cannot dodge the check', async () => {
  const registry = new Registry()
  const s = makeSocket()
  let checked = ''
  handleConnection(s.socket, {
    registry,
    verify: verifyOk('luca@abovomaxlead.nl'),
    delegated: delegatedDeps({
      isDelegate: async (_r: string, m: string) => {
        checked = m
        return true
      },
    }),
  })
  s.emit(JSON.stringify({ type: 'auth', accessToken: 'owner-token' }))
  await vi.waitFor(() => expect(registry.size()).toBe(1))
  s.emit(JSON.stringify({ type: 'subscribe', mailbox: '  Bart@Abovomaxlead.NL ' }))
  await vi.waitFor(() => expect(checked).toBe('bart@abovomaxlead.nl'))
  expect(registry.socketsFor('bart@abovomaxlead.nl')).toContain(s.socket)
})

test('someone who is not a delegate is refused with 4403 and keeps no routing', async () => {
  const registry = new Registry()
  const s = makeSocket()
  handleConnection(s.socket, {
    registry,
    verify: verifyOk('luca@abovomaxlead.nl'),
    delegated: delegatedDeps({ isDelegate: async () => false }),
  })
  s.emit(JSON.stringify({ type: 'auth', accessToken: 'owner-token' }))
  await vi.waitFor(() => expect(registry.size()).toBe(1))
  s.emit(JSON.stringify({ type: 'subscribe', mailbox: 'bart@abovomaxlead.nl' }))
  await vi.waitFor(() => expect(s.state.closedWith).toBe(4403))
  expect(registry.socketsFor('bart@abovomaxlead.nl')).toHaveLength(0)
})

test('a failing check closes without a fatal code, so an outage is retried', async () => {
  const s = makeSocket()
  handleConnection(s.socket, {
    registry: new Registry(),
    verify: verifyOk('luca@abovomaxlead.nl'),
    delegated: delegatedDeps({
      isDelegate: async () => {
        throw new Error('delegates lookup failed: HTTP 500')
      },
    }),
  })
  s.emit(JSON.stringify({ type: 'auth', accessToken: 'owner-token' }))
  await vi.waitFor(() => expect(s.sent).toContain(JSON.stringify({ type: 'ready' })))
  s.emit(JSON.stringify({ type: 'subscribe', mailbox: 'bart@abovomaxlead.nl' }))
  // close() with no code at all — "we could not check" is not "you may not",
  // and 4403 would make the client give up for good.
  await vi.waitFor(() => expect(s.sent).not.toContain('never'))
  expect(s.state.closedWith).toBeUndefined()
})

test('subscribing is refused when this deployment does not mint at all', async () => {
  const s = makeSocket()
  handleConnection(s.socket, { registry: new Registry(), verify: verifyOk('luca@x.nl') })
  s.emit(JSON.stringify({ type: 'auth', accessToken: 'owner-token' }))
  await vi.waitFor(() => expect(s.sent).toContain(JSON.stringify({ type: 'ready' })))
  s.emit(JSON.stringify({ type: 'subscribe', mailbox: 'bart@x.nl' }))
  await vi.waitFor(() => expect(s.state.closedWith).toBe(4403))
})

test('subscribing before authenticating is a protocol error', () => {
  const s = makeSocket()
  handleConnection(s.socket, {
    registry: new Registry(),
    verify: verifyOk('luca@x.nl'),
    delegated: delegatedDeps(),
  })
  s.emit(JSON.stringify({ type: 'subscribe', mailbox: 'bart@x.nl' }))
  expect(s.state.closedWith).toBe(4400)
})

test('other frames after auth are still ignored', async () => {
  const registry = new Registry()
  const s = makeSocket()
  handleConnection(s.socket, {
    registry,
    verify: verifyOk('luca@x.nl'),
    delegated: delegatedDeps(),
  })
  s.emit(JSON.stringify({ type: 'auth', accessToken: 'owner-token' }))
  await vi.waitFor(() => expect(registry.size()).toBe(1))
  s.emit(JSON.stringify({ type: 'auth', accessToken: 'again' }))
  s.emit('not json at all')
  expect(s.state.closedWith).toBeUndefined()
  expect(registry.socketsFor('luca@x.nl')).toContain(s.socket)
})
```

Note the "failing check" test asserts `closedWith` is `undefined`: `makeSocket`
records whatever code `close()` was given, and this path calls `close()` with
none. That is the distinction the test exists for — a plain close reconnects,
`4403` does not.

- [ ] **Step 2: Run the test to verify it fails**

```bash
wsl.exe -- bash -lc "docker run --rm -v /home/developer/projects/gmail-push-relay-delegated:/app -w /app node:20 sh -c 'npx vitest run test/connection.test.ts 2>&1 | tail -20'"
```

Expected: FAIL — `delegated` is not a known dep and `subscribe` frames are ignored.

- [ ] **Step 3: Write the implementation**

In `src/connection.ts`, extend the deps and replace the message handler. The current handler starts with `if (authed) return`; that early return is what has to go.

```ts
import type { AuthResult } from './auth'
import type { MintedToken } from './delegated'
import type { Registry, Sink } from './registry'

export const CLOSE_BAD_FRAME = 4400
export const CLOSE_INVALID_TOKEN = 4401
export const CLOSE_NOT_ALLOWED = 4403

export interface Socket extends Sink {
  onMessage(cb: (data: string) => void): void
  onClose(cb: () => void): void
}

export interface HandleConnectionDeps {
  registry: Registry<Socket>
  verify: (accessToken: string) => Promise<AuthResult>
  log?: (msg: string, extra?: unknown) => void
  /**
   * Present only where delegated minting is configured. Without it a client
   * cannot subscribe to anything but its own mailbox.
   */
  delegated?: {
    mint: (mailbox: string) => Promise<MintedToken>
    isDelegate: (requester: string, mailbox: string, token: string) => Promise<boolean>
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function handleConnection(socket: Socket, deps: HandleConnectionDeps): void {
  let authed = false
  let requester = ''
  socket.onClose(() => deps.registry.remove(socket))

  socket.onMessage((data) => {
    let msg: { type?: string; accessToken?: string; mailbox?: string }
    try {
      msg = JSON.parse(data)
    } catch {
      // An unreadable frame before auth is a protocol error; after auth it is
      // noise from a client we have already accepted, so ignore it.
      if (!authed) socket.close(CLOSE_BAD_FRAME)
      return
    }

    if (!authed) {
      if (msg.type !== 'auth' || typeof msg.accessToken !== 'string') {
        socket.close(CLOSE_BAD_FRAME)
        return
      }
      void deps.verify(msg.accessToken).then((result) => {
        if (!result.ok) {
          socket.close(result.reason === 'not_allowed' ? CLOSE_NOT_ALLOWED : CLOSE_INVALID_TOKEN)
          return
        }
        authed = true
        requester = result.email
        deps.registry.add(result.email, socket)
        socket.send(JSON.stringify({ type: 'ready' }))
        deps.log?.('[auth] accepted', result.email)
      })
      return
    }

    // Re-point this connection at a mailbox that is delegated to the caller.
    //
    // Re-point, not add: a sync frame carries no address, so a socket routed for
    // two mailboxes could not tell which one changed — and the app would sync
    // the wrong one. The owner keeps its own separate connection for its own
    // mail.
    if (msg.type === 'subscribe') {
      const mailbox = typeof msg.mailbox === 'string' ? msg.mailbox.trim().toLowerCase() : ''
      if (!mailbox || !EMAIL.test(mailbox)) {
        socket.close(CLOSE_BAD_FRAME)
        return
      }
      if (!deps.delegated) {
        deps.log?.('[subscribe] refused', 'this deployment does not mint delegated tokens')
        socket.close(CLOSE_NOT_ALLOWED)
        return
      }
      const delegated = deps.delegated
      void (async () => {
        let allowed: boolean
        try {
          const minted = await delegated.mint(mailbox)
          allowed = await delegated.isDelegate(requester, mailbox, minted.accessToken)
        } catch (e) {
          // "We could not check" is not "you may not": close without a fatal
          // code so the client retries with backoff instead of giving up.
          deps.log?.('[subscribe] check failed', (e as Error).message)
          socket.close()
          return
        }
        if (!allowed) {
          deps.log?.('[subscribe] refused', `${requester} is not an accepted delegate of ${mailbox}`)
          socket.close(CLOSE_NOT_ALLOWED)
          return
        }
        deps.registry.remove(socket)
        deps.registry.add(mailbox, socket)
        socket.send(JSON.stringify({ type: 'subscribed', mailbox }))
        deps.log?.('[subscribe] accepted', `${requester} -> ${mailbox}`)
      })()
      return
    }

    // Anything else after auth: the client sends nothing we act on, so ignore it.
  })
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
wsl.exe -- bash -lc "docker run --rm -v /home/developer/projects/gmail-push-relay-delegated:/app -w /app node:20 sh -c 'npx vitest run 2>&1 | tail -12 && npx tsc --noEmit && echo TYPECHECK-OK'"
```

Expected: the whole relay suite passes — including the existing connection tests, which must not need editing — and no type errors.

- [ ] **Step 5: Commit**

```bash
wsl.exe -- bash -lc "cd ~/projects/gmail-push-relay-delegated && git add src/connection.ts test/connection.test.ts && git commit -m 'feat: let a connection subscribe to a delegated mailbox

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>'"
```

---

## Task 2: Wire the deps and document the frame

**Files:**
- Modify: `src/server.ts`, `src/index.ts`, `README.md`
- Test: `test/server.test.ts` (append)

**Interfaces:**
- Consumes: `HandleConnectionDeps['delegated']` (Task 1); `mintToken`, `DelegationCheck` (phase 1).
- Produces: `RelayServerDeps.delegatedConnections?: HandleConnectionDeps['delegated']`.

- [ ] **Step 1: Write the failing test**

Append to `test/server.test.ts`, in the style already used there (module-level `server`, `open(ws)`, `vi.waitFor`):

```ts
test('a websocket can subscribe to a delegated mailbox and is routed for it', async () => {
  server = createRelayServer({
    port: 0,
    heartbeatMs: 60_000,
    verify: async () => ({ ok: true, email: 'luca@abovomaxlead.nl' }),
    delegatedConnections: {
      mint: async () => ({ accessToken: 'ya29.minted', expiresAt: 1 }),
      isDelegate: async () => true,
    },
  })
  const port = await server.listening
  const ws = new WebSocket(`ws://localhost:${port}`)
  const messages: unknown[] = []
  ws.on('message', (d) => messages.push(JSON.parse(d.toString())))
  await open(ws)
  ws.send(JSON.stringify({ type: 'auth', accessToken: 'owner-token' }))
  await vi.waitFor(() => expect(messages).toContainEqual({ type: 'ready' }))
  ws.send(JSON.stringify({ type: 'subscribe', mailbox: 'bart@abovomaxlead.nl' }))
  await vi.waitFor(() =>
    expect(messages).toContainEqual({ type: 'subscribed', mailbox: 'bart@abovomaxlead.nl' }),
  )

  server.broadcastSync('luca@abovomaxlead.nl', '1') // the owner's own mail — must NOT arrive here
  server.broadcastSync('bart@abovomaxlead.nl', '42')
  await vi.waitFor(() => expect(messages).toContainEqual({ type: 'sync', historyId: '42' }))
  expect(messages).not.toContainEqual({ type: 'sync', historyId: '1' })
  ws.close()
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
wsl.exe -- bash -lc "docker run --rm -v /home/developer/projects/gmail-push-relay-delegated:/app -w /app node:20 sh -c 'npx vitest run test/server.test.ts 2>&1 | tail -20'"
```

Expected: FAIL — `delegatedConnections` is not a known dep, so no `subscribed` ever arrives.

- [ ] **Step 3: Thread the dep through the server**

In `src/server.ts`, add to `RelayServerDeps` (after `delegated`):

```ts
  /** When present, an authenticated socket may subscribe to a delegated mailbox. */
  delegatedConnections?: HandleConnectionDeps['delegated']
```

Import the type:

```ts
import { handleConnection, type HandleConnectionDeps, type Socket } from './connection'
```

and pass it on in the `wss.on('connection', …)` handler:

```ts
    handleConnection(socket, {
      registry,
      verify: deps.verify,
      log: deps.log,
      delegated: deps.delegatedConnections,
    })
```

- [ ] **Step 4: Wire it at boot**

In `src/index.ts`, inside the `createRelayServer({ … })` call, after the `delegated:` property:

```ts
    // Same key and same check as the token route: a socket may only be re-pointed
    // at a mailbox its authenticated user is really a delegate of.
    delegatedConnections: delegatedKey
      ? {
          mint: (mailbox) => mintToken(mailbox, { key: delegatedKey! }),
          isDelegate: (requester, mailbox, token) => delegationCheck.isDelegate(requester, mailbox, token),
        }
      : undefined,
```

- [ ] **Step 5: Document it**

In `README.md`, extend the "Wire protocol" section:

```markdown
- Client → relay: `{"type":"auth","accessToken":"..."}` (first frame).
- Relay → client: `{"type":"ready"}`, or close `4401`/`4403`/`4400`.
- Client → relay: `{"type":"subscribe","mailbox":"bart@example.com"}` (optional,
  after `ready`) — **re-points** this connection at a mailbox delegated to the
  authenticated user. Answered with `{"type":"subscribed","mailbox":"..."}`, or
  close `4403` if the user is not an accepted delegate (or this deployment does
  not mint at all). A failed *check* closes without a fatal code, so a passing
  outage is retried rather than treated as a refusal.
- Relay → client: `{"type":"sync","historyId":"..."}` on mailbox change.

A sync frame carries no address, which is why `subscribe` re-points rather than
adds: one socket routed for two mailboxes could not tell which one changed.
A delegated mailbox therefore uses its own connection, authenticated as the
owning account, and the owner keeps a separate one for its own mail.

**Revocation window:** a subscription is verified once, and a mailbox's delegate
list is cached for five minutes. If a delegation is revoked, that socket keeps
receiving sync triggers until it reconnects. Those triggers carry no mail
content, and reading the mailbox needs a token the relay would by then refuse to
mint — but it is a window, and it is deliberate.
```

- [ ] **Step 6: Run the suite and the boot check**

```bash
wsl.exe -- bash -lc "docker run --rm --network host -v /home/developer/projects/gmail-push-relay-delegated:/app -w /app node:20 sh -c 'npx vitest run 2>&1 | tail -10 && npx tsc --noEmit && echo TYPECHECK-OK && npm run delegated:check 2>&1 | tail -10'"
```

Expected: whole suite passes, no type errors, `BOOT-CHECK PASS`.

- [ ] **Step 7: Commit and push**

```bash
wsl.exe -- bash -lc "cd ~/projects/gmail-push-relay-delegated && git add src/server.ts src/index.ts test/server.test.ts README.md && git commit -m 'feat: serve delegated subscriptions on websocket connections

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>' && git push origin feat/delegated-token"
```

---

## Task 3: The manager learns to subscribe

**Files:**
- Modify: `electron/push-manager.ts`
- Test: `tests/push-manager.test.ts` (append)

**Interfaces:**
- Consumes: nothing new.
- Produces: `PushManagerDeps.subscribeAs?(email: string): string | null`.

**The contract:** `subscribeAs` returns the mailbox this connection should be re-pointed at, or `null` for an own account. When it returns a mailbox, coverage is claimed **only** after the relay answers `{"type":"subscribed"}` — coverage silences the webview's own counter, so claiming it for a mailbox nothing routes to would make that mailbox quietly stop updating.

- [ ] **Step 1: Write the failing test**

Append to `tests/push-manager.test.ts`:

```ts
describe('delegated mailboxes', () => {
  it('authenticates as the owner and then asks to be re-pointed', async () => {
    const h = harness({
      accounts: () => ['bart@x.nl'],
      accessToken: async () => 'owner-token',
      subscribeAs: (email: string) => email,
    });
    h.sockets[0].fireOpen();
    await settle();
    expect(JSON.parse(h.sockets[0].sent[0])).toEqual({ type: 'auth', accessToken: 'owner-token' });
    expect(JSON.parse(h.sockets[0].sent[1])).toEqual({ type: 'subscribe', mailbox: 'bart@x.nl' });
    h.manager.stop();
  });

  it('claims no coverage until the relay confirms the subscription', async () => {
    const h = harness({
      accounts: () => ['bart@x.nl'],
      subscribeAs: (email: string) => email,
    });
    h.sockets[0].fireOpen();
    await settle();
    // The watch is armed, but nothing routes here yet — so the webview must keep
    // owning the count.
    expect(h.events).toEqual(['watch:bart@x.nl']);

    h.sockets[0].fireMessage(JSON.stringify({ type: 'subscribed', mailbox: 'bart@x.nl' }));
    expect(h.events).toEqual(['watch:bart@x.nl', 'cover:bart@x.nl:true', 'sync:bart@x.nl']);
    h.manager.stop();
  });

  it('leaves an own account exactly as it was', async () => {
    const h = harness({ subscribeAs: () => null });
    h.sockets[0].fireOpen();
    await settle();
    expect(h.sockets[0].sent).toHaveLength(1); // auth only, no subscribe
    expect(h.events).toEqual(['watch:a@x.nl', 'cover:a@x.nl:true', 'sync:a@x.nl']);
    h.manager.stop();
  });

  it('stops trying when the relay refuses the subscription', async () => {
    const h = harness({
      accounts: () => ['bart@x.nl'],
      subscribeAs: (email: string) => email,
    });
    h.sockets[0].fireOpen();
    await settle();
    h.sockets[0].fireClose(4403);
    expect(h.events).toContain('fatal:bart@x.nl:4403');
    h.manager.stop();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd "C:\Users\luca.manuel\gmail-desktop-build\.claude\worktrees\delegated-api-readme" && npx vitest run tests/push-manager.test.ts
```

Expected: FAIL — no `subscribe` frame is ever sent.

- [ ] **Step 3: Add the dep**

In `electron/push-manager.ts`, add to `PushManagerDeps` (after `armWatch`):

```ts
  // Voor een gemachtigd postvak: het adres waarop deze verbinding moet luisteren.
  // De socket logt in met het token van de eigenaar — een gemint token draagt
  // geen e-mailscope en zou door de relay geweigerd worden — en vraagt daarna om
  // omgelegd te worden. Null voor een eigen account: die luistert op zichzelf.
  subscribeAs?(email: string): string | null;
```

- [ ] **Step 4: Send the frame and hold back coverage**

In the `sock.onOpen` handler, replace — currently:

```ts
          sock.send(JSON.stringify({ type: 'auth', accessToken: token }));
          const armed = await deps.armWatch(email);
```

with:

```ts
          sock.send(JSON.stringify({ type: 'auth', accessToken: token }));
          // Een gemachtigd postvak: deze verbinding omleggen. De relay
          // controleert de machtiging en antwoordt met {type:'subscribed'};
          // weigert hij, dan sluit hij met 4403 en is dat al fataal.
          const mailbox = deps.subscribeAs?.(email) ?? null;
          if (mailbox) sock.send(JSON.stringify({ type: 'subscribe', mailbox }));
          const armed = await deps.armWatch(email);
```

and further down in the same handler, replace:

```ts
          // Dekking vóór de catch-up: de meldingsregel meet vanaf dit moment, en
          // mail die daarvoor kwam heeft de webview al gemeld.
          setCovered(email, state, true);
          deps.onSync(email);
```

with:

```ts
          // Dekking vóór de catch-up: de meldingsregel meet vanaf dit moment, en
          // mail die daarvoor kwam heeft de webview al gemeld.
          //
          // Bij een omgelegde verbinding wachten we daar juist mee tot de relay
          // bevestigt: dekking zet de webview-teller uit, en die uitzetten voor
          // een postvak waar niets naartoe routeert zou hem stil laten vallen.
          if (!mailbox) {
            setCovered(email, state, true);
            deps.onSync(email);
          }
```

- [ ] **Step 5: Act on the acknowledgement**

In the `sock.onMessage` handler, next to the existing `ready`/`sync` lines:

```ts
      if (msg.type === 'ready') state.retriedAuth = false;
      // De relay heeft de machtiging gecontroleerd en deze verbinding omgelegd.
      // Pas nu is dit postvak echt gedekt.
      if (msg.type === 'subscribed') {
        setCovered(email, state, true);
        deps.onSync(email);
      }
      if (msg.type === 'sync') deps.onSync(email);
```

- [ ] **Step 6: Run the suite**

```bash
cd "C:\Users\luca.manuel\gmail-desktop-build\.claude\worktrees\delegated-api-readme" && npx tsc --noEmit && npx vitest run
```

Expected: no type errors and the whole suite passes — including every pre-existing `push-manager` test, unedited.

- [ ] **Step 7: Commit**

```bash
cd "C:\Users\luca.manuel\gmail-desktop-build\.claude\worktrees\delegated-api-readme" && git add electron/push-manager.ts tests/push-manager.test.ts && git commit -m "feat: re-point a push connection at a delegated mailbox

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: Delegated mailboxes become pushable

**Files:**
- Modify: `electron/main.ts` — `pushableEmails` at ~1920; `syncRunnerFor` at ~1871; the `startPushManager({…})` call at ~1944.

**Interfaces:**
- Consumes: `subscribeAs` (Task 3); `tokenForAccount`, `renewTokenFor`, `isDelegatedAccount`, `ownerTokenFor`, `delegatedSource` (phase 1).
- Produces: `delegatedOwnerEmail(mailbox: string): string | null` as a module-level helper in `main.ts`.

**Which token goes where** — the thing to get right:

| Purpose | Own account | Delegated mailbox |
| --- | --- | --- |
| `accessToken` (authenticates the socket) | its own OAuth token | the **owner's** OAuth token |
| `refreshToken` (the one 4401 retry) | `forceRefresh` on itself | `forceRefresh` on the **owner** |
| `armWatch` (`users.watch`) | its own OAuth token | the **minted** token |
| history sync (`syncRunnerFor`) | its own OAuth token | the **minted** token |

- [ ] **Step 1: Name the owner**

`ownerTokenFor` (phase 1) already resolves the owning account and returns its token; the manager also needs the owner's *address* for the refresh path. Next to `ownerTokenFor` in `main.ts`, add:

```ts
// Het adres van de account waar een gemachtigd postvak onder hangt. Null als dat
// niet te bepalen is — dan valt ownerTokenFor terug op de gekoppelde accounts.
function delegatedOwnerEmail(mailbox: string): string | null {
  const p = profiles.find(
    (x) => x.kind === 'delegated' && x.email.toLowerCase() === mailbox.toLowerCase(),
  );
  if (!p || p.ref.kind !== 'delegated') return null;
  const authusers = profiles
    .filter((x) => x.ref.kind === 'authuser')
    .map((x) => ({ index: x.ref.kind === 'authuser' ? x.ref.index : -1, email: x.email }));
  return ownerFor(p.ref.mailUrl, authusers);
}
```

- [ ] **Step 2: Let delegated mailboxes into the pushable list**

Replace `pushableEmails` — currently:

```ts
// Welke accounts push kán dekken: eigen accounts met een token dat de vereiste
// scopes heeft. Een gedelegeerd postvak heeft geen eigen token en blijft dus de
// webview gebruiken.
function pushableEmails(): string[] {
  if (!oauthTokens) return [];
  return profiles
    .filter((p) => p.kind === 'authuser')
    .map((p) => p.email)
    .filter((email) => {
      const token = oauthTokens!.get(email);
      return token !== undefined && hasScopes(token);
    });
}
```

with:

```ts
// Welke accounts push kán dekken: eigen accounts met een token dat de vereiste
// scopes heeft, plus gemachtigde postvakken zodra de relay daar tokens voor kan
// minten. Zonder die koppeling blijft een gemachtigd postvak de webview
// gebruiken, precies zoals het altijd deed.
function pushableEmails(): string[] {
  if (!oauthTokens) return [];
  const ownHasScopes = (email: string): boolean => {
    const token = oauthTokens!.get(email);
    return token !== undefined && hasScopes(token);
  };
  const out: string[] = [];
  for (const p of profiles) {
    if (p.kind === 'authuser') {
      if (ownHasScopes(p.email)) out.push(p.email);
      continue;
    }
    // Een gemachtigd postvak leunt op de eigenaar: die tekent de verbinding, en
    // zonder diens scopes komt er sowieso geen token.
    const owner = delegatedOwnerEmail(p.email);
    if (delegatedSource() && owner && ownHasScopes(owner)) out.push(p.email);
  }
  return out;
}
```

- [ ] **Step 3: Route the sync runner through the resolver**

In `syncRunnerFor`, replace the `withToken` helper — currently:

```ts
  const withToken = async <T>(fn: (token: string) => Promise<T>): Promise<T> => {
    const token = await accessTokenFor(cfg, oauthTokens!, email);
    if (!token) throw new Error('geen token');
    try {
      return await fn(token);
    } catch (e) {
      if (!(e instanceof GmailHttpError) || e.status !== 401) throw e;
      const fresh = await forceRefresh(cfg, oauthTokens!, email);
      if (!fresh) {
        refreshFailures.add(email);
        scheduleOAuthHealthCheck();
        throw e;
      }
      refreshFailures.delete(email);
      return await fn(fresh);
    }
  };
```

with:

```ts
  const withToken = async <T>(fn: (token: string) => Promise<T>): Promise<T> => {
    // Voor een gemachtigd postvak levert dit het geminte token: history.list en
    // labels.get draaien dan tegen dát postvak, want `me` ís dat postvak.
    const token = await tokenForAccount(email);
    if (!token) throw new Error('geen token');
    try {
      return await fn(token);
    } catch (e) {
      if (!(e instanceof GmailHttpError) || e.status !== 401) throw e;
      const fresh = await renewTokenFor(email);
      const delegated = isDelegatedAccount(email);
      if (!fresh) {
        if (!delegated) {
          refreshFailures.add(email);
          scheduleOAuthHealthCheck();
        }
        throw e;
      }
      if (!delegated) refreshFailures.delete(email);
      return await fn(fresh);
    }
  };
```

Note the guard directly above it (`if (!cfg || !oauthTokens || !history) return null;`) stays: a delegated mailbox still needs the owner's OAuth to exist at all.

- [ ] **Step 4: Give the manager the right tokens**

In the `startPushManager({…})` call, replace `accessToken`, `refreshToken` and `armWatch`, and add `subscribeAs`:

```ts
    // De verbinding wordt getekend door de eigenaar: een gemint token draagt geen
    // e-mailscope, dus de relay zou het niet kunnen thuisbrengen.
    accessToken: (email) =>
      isDelegatedAccount(email) ? ownerTokenFor(email) : accessTokenFor(cfg, oauthTokens!, email),
    subscribeAs: (email) => (isDelegatedAccount(email) ? email : null),
    // Voor de ene herkansing na een 4401. Bewust forceRefresh en niet
    // accessTokenFor: die laatste geeft het opgeslagen token terug zolang onze
    // eigen klok zegt dat het nog geldig is, en dat is precies het token dat net
    // geweigerd is. Het verse token wordt opgeslagen, dus de nieuwe handdruk
    // pakt het via de gewone weg op.
    refreshToken: async (email) => {
      // Bij een gemachtigd postvak ging het geweigerde token van de eigenaar
      // over de lijn, dus die moet ververst worden — niet het geminte token.
      const target = isDelegatedAccount(email) ? delegatedOwnerEmail(email) : email;
      if (!target) return null;
      const fresh = await forceRefresh(cfg, oauthTokens!, target);
      if (fresh) refreshFailures.delete(target);
      else refreshFailures.add(target);
      return fresh;
    },
    armWatch: async (email) => {
      // Hier juist wél het geminte token: users.watch moet op het gemachtigde
      // postvak staan, niet op dat van de eigenaar. `watch` mag met
      // gmail.readonly, dus de bestaande DWD-scopes volstaan.
      const token = await tokenForAccount(email);
      if (!token) return false;
      try {
        return (await watchMailbox(token, config.pushTopic)) !== null;
      } catch (e) {
        console.warn(`[push] watch mislukte voor ${email}:`, e);
        return false;
      }
    },
```

`onSync`, `onCoverage` and `onFatal` need no change: they key on the email, and `reportApiUnread` already resolves any profile — delegated included — through `profiles.find` and `keyOf`.

- [ ] **Step 5: Typecheck, test and bundle**

```bash
cd "C:\Users\luca.manuel\gmail-desktop-build\.claude\worktrees\delegated-api-readme" && npx tsc --noEmit && npx vitest run && npm run build:main
```

Expected: no type errors, whole suite passes, bundle written.

- [ ] **Step 6: Commit and push**

```bash
cd "C:\Users\luca.manuel\gmail-desktop-build\.claude\worktrees\delegated-api-readme" && git add electron/main.ts && git commit -m "feat: real unread counts and push for delegated mailboxes

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" && git push origin docs/delegated-api
```

---

## Verification once an administrator has done the grant

Phases 1 and 2 come first. Then:

1. **The relay log** shows `[subscribe] accepted <you> -> <mailbox>` when the app starts, and the delegated mailbox's tab stops taking its number from the page title.
2. **Send mail to the delegated mailbox.** A notification should arrive within a few seconds, and the tab counter should change without the webview being visible. That is the whole point: today the count only moves when the view is loaded.
3. **Cross-routing must not happen.** Send mail to your *own* mailbox and confirm the delegated tab's counter does not move. That is what the re-point is for; if it does move, the socket is registered under two addresses.
4. **Refusal is quiet and final.** Point the app at a mailbox that is not delegated to you: expect close `4403`, one `[push] push definitief uit` line, and the webview quietly keeping the count — not a reconnect loop.
5. **Turn the feature off** (remove `delegatedTokenUrl`): delegated mailboxes must fall back to the webview count exactly as before.

## Not in this plan

- Renewing a subscription when a delegation is revoked mid-connection (see the security note; the window is one reconnect).
- Delegated calendars, and the account-switcher scrape — still out of scope for the whole feature.
