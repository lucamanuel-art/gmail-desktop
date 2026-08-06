# Delegated Mailboxes API — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a delegated mailbox a working drag *source* — both a whole label and individual threads — reading through the Gmail API with a relay-minted token.

**Architecture:** Phase 1 already built the token source and the `tokenForAccount` / `renewTokenFor` resolver. This phase routes the two read paths through it, and adds the one thing that is genuinely missing: single-thread drags have no API path at all today, and Gmail's session path cannot reach a delegated mailbox because `omUrl` only builds the `/mail/u/<n>/` form, never `/d/<opaque>/`. A small pure decision table becomes the single place that knows which of the two ways a given drag can use, so "no access" is reported as such instead of silently saving nothing.

**Tech Stack:** TypeScript, Electron main process, vitest.

Design: [`docs/superpowers/specs/2026-08-06-delegated-mailboxes-api-design.md`](../specs/2026-08-06-delegated-mailboxes-api-design.md) §"Phases", phase 2.
Phase 1 plan: [`2026-08-06-delegated-mailboxes-api-phase-1.md`](./2026-08-06-delegated-mailboxes-api-phase-1.md).

## Global Constraints

- One repository: the app worktree at `C:\Users\luca.manuel\gmail-desktop-build\.claude\worktrees\delegated-api-readme`, branch `docs/delegated-api`. Nothing in the relay changes — the relay only hands out a token; the mail bytes go straight between the app and `gmail.googleapis.com`.
- **New written artifacts are English** (code comments, commit messages). Existing Dutch files stay Dutch: user-facing strings in `main.ts` are Dutch, and comments *inside* `main.ts` follow that file and are Dutch too.
- **Own accounts keep the session path for single-thread drags.** Decided explicitly: the API path is added for delegated mailboxes only, so the most-used path does not change behaviour. Label drags already prefer the API for own accounts — that stays as it is.
- The feature stays off without configuration: no `delegatedTokenUrl` means no token, which means a delegated drag reports "Beheerdertoegang nodig" rather than half-working.
- No new npm dependencies.
- App code style: semicolons, single quotes, `describe`/`it`.
- Nothing at Google is configured yet, so no task may depend on a live mailbox.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `electron/drop-source.ts` (new) | Pure: which way a drag may read its mail — API, session, or neither. The only place that knows the session path cannot reach a delegated mailbox. |
| `electron/main.ts` (modify) | `collectLabelViaApi` through the resolver; `saveLabel` and `saveOneThread` consult the decision and fail honestly. |

---

## Task 1: The read-path decision

**Files:**
- Create: `electron/drop-source.ts`
- Test: `tests/drop-source.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type ReadPath = 'api' | 'session' | 'blocked'`, `NO_ADMIN_ACCESS: string`, `readPathFor(o: { drag: 'label' | 'thread'; delegated: boolean; hasToken: boolean }): ReadPath`.

The whole table, and why each row is what it is:

| drag | delegated | hasToken | → | why |
| --- | --- | --- | --- | --- |
| label | no | yes | `api` | today's behaviour: one request per thread beats waiting on Gmail's list view |
| label | no | no | `session` | today's behaviour: no OAuth coupling, so scrape |
| label | yes | yes | `api` | what this phase adds |
| label | yes | no | `blocked` | the session path cannot reach `/d/<opaque>/` |
| thread | no | yes | `session` | **unchanged by decision** — the most-used path keeps working exactly as it does |
| thread | no | no | `session` | unchanged |
| thread | yes | yes | `api` | what this phase adds |
| thread | yes | no | `blocked` | as above |

- [ ] **Step 1: Write the failing test**

Create `tests/drop-source.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readPathFor, NO_ADMIN_ACCESS } from '../electron/drop-source';

describe('readPathFor — own accounts', () => {
  it('reads a label through the api when there is a token, as it does today', () => {
    expect(readPathFor({ drag: 'label', delegated: false, hasToken: true })).toBe('api');
  });

  it('falls back to the session for a label when there is no token', () => {
    expect(readPathFor({ drag: 'label', delegated: false, hasToken: false })).toBe('session');
  });

  it('keeps single threads on the session path even when a token exists', () => {
    // Deliberate: the api path is added for delegated mailboxes only, so the
    // most-used drag keeps behaving exactly as it did.
    expect(readPathFor({ drag: 'thread', delegated: false, hasToken: true })).toBe('session');
    expect(readPathFor({ drag: 'thread', delegated: false, hasToken: false })).toBe('session');
  });
});

describe('readPathFor — delegated mailboxes', () => {
  it('uses the api for both kinds of drag when a token was minted', () => {
    expect(readPathFor({ drag: 'label', delegated: true, hasToken: true })).toBe('api');
    expect(readPathFor({ drag: 'thread', delegated: true, hasToken: true })).toBe('api');
  });

  it('is blocked without a token: the session cannot reach a delegated mailbox', () => {
    // omUrl only builds /mail/u/<n>/, never /d/<opaque>/ — so falling back would
    // read the owner's own mailbox with a foreign thread id, or nothing at all.
    expect(readPathFor({ drag: 'label', delegated: true, hasToken: false })).toBe('blocked');
    expect(readPathFor({ drag: 'thread', delegated: true, hasToken: false })).toBe('blocked');
  });

  it('never answers session for a delegated mailbox, whatever the inputs', () => {
    for (const drag of ['label', 'thread'] as const) {
      for (const hasToken of [true, false]) {
        expect(readPathFor({ drag, delegated: true, hasToken })).not.toBe('session');
      }
    }
  });
});

describe('NO_ADMIN_ACCESS', () => {
  it('is the one message a blocked drag reports', () => {
    expect(NO_ADMIN_ACCESS).toBe('Beheerdertoegang nodig');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd "C:\Users\luca.manuel\gmail-desktop-build\.claude\worktrees\delegated-api-readme" && npx vitest run tests/drop-source.test.ts
```

Expected: FAIL — cannot resolve `../electron/drop-source`.

- [ ] **Step 3: Write the implementation**

Create `electron/drop-source.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd "C:\Users\luca.manuel\gmail-desktop-build\.claude\worktrees\delegated-api-readme" && npx vitest run tests/drop-source.test.ts
```

Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
cd "C:\Users\luca.manuel\gmail-desktop-build\.claude\worktrees\delegated-api-readme" && git add electron/drop-source.ts tests/drop-source.test.ts && git commit -m "feat: decide which way a drag may read its mail

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: Label drags out of a delegated mailbox

**Files:**
- Modify: `electron/main.ts` — the import block near line 106; `collectLabelViaApi` at 1422–1494; `saveLabel` at 1497–1530.

**Interfaces:**
- Consumes: `readPathFor`, `NO_ADMIN_ACCESS` (Task 1); `tokenForAccount`, `renewTokenFor`, `isDelegatedAccount` (phase 1).
- Produces: nothing new.

**On testing:** `main.ts` is the Electron wiring layer and has no unit tests in this repo; this task adds none. Its correctness rests on Task 1's table, phase 1's tested resolver, plus `tsc`, the full suite and the bundle build in Step 5.

- [ ] **Step 1: Add the imports**

Next to the other electron-local imports (near `main.ts:106`, where `delegated-config` was added in phase 1):

```ts
import { readPathFor, NO_ADMIN_ACCESS } from './drop-source';
```

Task 3 also needs the `FetchedMessage` type, which `main.ts` does not import today
— line 64 pulls in only the function. Widen it now so Task 3 compiles:

```ts
import { fetchThreadEmls, type FetchedMessage } from './mail-fetch';
```

(`fetchThreadRaw` is already imported from `./gmail-api` at line 89; `SavedRef`,
`SavedMessage` and `LogRecord` are declared in `main.ts` itself.)

- [ ] **Step 2: Route collectLabelViaApi through the resolver**

Replace the head of `collectLabelViaApi` — currently:

```ts
  const cfg = oauthConfig();
  if (!cfg || !oauthTokens || !account) return null;
  const first = await accessTokenFor(cfg, oauthTokens, account);
  if (!first) return null;
  let token: string = first;
```

with:

```ts
  if (!account) return null;
  // Eigen account of gemachtigd postvak: de resolver weet waar het token
  // vandaan komt, en fetchThreadRaw hierna merkt het verschil niet.
  const first = await tokenForAccount(account);
  if (!first) return null;
  let token: string = first;
```

and replace the body of the `refreshed` helper just below it — currently:

```ts
    if (!mayRefresh || !(e instanceof GmailHttpError) || e.status !== 401) return false;
    mayRefresh = false;
    const fresh = await forceRefresh(cfg, oauthTokens!, account);
    if (!fresh) {
      refreshFailures.add(account);
      scheduleOAuthHealthCheck();
      return false;
    }
    token = fresh;
    refreshFailures.delete(account);
    return true;
```

with:

```ts
    if (!mayRefresh || !(e instanceof GmailHttpError) || e.status !== 401) return false;
    mayRefresh = false;
    // Voor een gemachtigd postvak is dit "opnieuw minten": een impersonatieflow
    // heeft geen refresh token.
    const fresh = await renewTokenFor(account);
    const delegated = isDelegatedAccount(account);
    if (!fresh) {
      // Alleen eigen accounts staan in de herverbind-melding.
      if (!delegated) {
        refreshFailures.add(account);
        scheduleOAuthHealthCheck();
      }
      return false;
    }
    token = fresh;
    if (!delegated) refreshFailures.delete(account);
    return true;
```

- [ ] **Step 3: Let saveLabel report a blocked drag instead of an empty one**

In `saveLabel`, next to the existing `empty()` helper, add:

```ts
  // Niet hetzelfde als leeg: het label is niet leeg, we kunnen er alleen niet
  // bij. Zonder dit zou een gemachtigd postvak zonder koppeling melden dat het
  // label geen mail bevat, wat niet waar is.
  const blocked = () => {
    try {
      appendLog(root, [{ ts, account, threadId: '', label, error: NO_ADMIN_ACCESS }]);
    } catch {
      /* map niet schrijfbaar */
    }
    return { items: [{ threadId: '', subject: label, saved: 0, error: NO_ADMIN_ACCESS }], saved: [] };
  };
```

Then replace the path choice — currently:

```ts
  const viaApi = await collectLabelViaApi(account, label);
  let collected: CollectedThread[];
  let capped: boolean;

  if (viaApi) {
    if (viaApi.collected.length === 0) return empty();
    collected = viaApi.collected;
    capped = viaApi.capped;
  } else {
```

with:

```ts
  const viaApi = await collectLabelViaApi(account, label);
  let collected: CollectedThread[];
  let capped: boolean;

  if (viaApi) {
    if (viaApi.collected.length === 0) return empty();
    collected = viaApi.collected;
    capped = viaApi.capped;
    // Hier is de API-weg niet gelukt, dus er is geen bruikbaar token — precies
    // wat readPathFor met hasToken:false beoordeelt. Voor een gemachtigd postvak
    // is de sessieweg geen terugval: omUrl bouwt alleen de /mail/u/<n>/-vorm.
  } else if (
    readPathFor({ drag: 'label', delegated: isDelegatedAccount(account), hasToken: false }) === 'blocked'
  ) {
    return blocked();
  } else {
```

Leave the session branch that follows unchanged.

- [ ] **Step 4: Update the stale comment above the path choice**

Directly above `const viaApi = …` the comment still claims the API cannot serve a delegated mailbox. Replace:

```ts
  // Liefst via de API: dat is één verzoek per gesprek in plaats van seconden
  // wachten per pagina tot Gmail's lijstweergave is omgeklapt. Lukt dat niet
  // (geen koppeling, gedelegeerd postvak), dan de oude weg.
```

with:

```ts
  // Liefst via de API: dat is één verzoek per gesprek in plaats van seconden
  // wachten per pagina tot Gmail's lijstweergave is omgeklapt. Lukt dat niet
  // (geen koppeling), dan de oude weg — behalve bij een gemachtigd postvak, want
  // daar kán de oude weg niet komen.
```

- [ ] **Step 5: Typecheck, test and bundle**

```bash
cd "C:\Users\luca.manuel\gmail-desktop-build\.claude\worktrees\delegated-api-readme" && npx tsc --noEmit && npx vitest run && npm run build:main
```

Expected: no type errors, the whole suite passes, `dist-electron/main.js` written.

- [ ] **Step 6: Commit**

```bash
cd "C:\Users\luca.manuel\gmail-desktop-build\.claude\worktrees\delegated-api-readme" && git add electron/main.ts && git commit -m "feat: drag a label out of a delegated mailbox

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: Single-thread drags out of a delegated mailbox

**Files:**
- Modify: `electron/main.ts` — `saveOneThread` at 976–1066.

**Interfaces:**
- Consumes: `readPathFor`, `NO_ADMIN_ACCESS` (Task 1); `tokenForAccount`, `isDelegatedAccount` (phase 1); `fetchThreadRaw` (already imported from `./gmail-api`); `FetchedMessage` (already imported from `./mail-fetch`).
- Produces: nothing new.

The shape: decide the path first, produce a `FetchedMessage[]` either way, then fall into the existing tail (`writeThread`, `appendLog`, `savedRefs`) unchanged. For an own account nothing about the flow changes — `delegated` is false, so no token is resolved and the session branch runs exactly as before.

- [ ] **Step 1: Insert the path choice before the fetch**

In `saveOneThread`, immediately after the `failed` helper and before `let result;`, insert:

```ts
  const delegated = isDelegatedAccount(account);
  // Alleen voor een gemachtigd postvak een token ophalen: eigen accounts houden
  // bewust de sessieweg, dus daar zou het token alleen verspild werk zijn.
  const token = delegated ? await tokenForAccount(account) : null;
  const path = readPathFor({ drag: 'thread', delegated, hasToken: token !== null });
  if (path === 'blocked') return failed(NO_ADMIN_ACCESS);
```

- [ ] **Step 2: Give the API path its own branch**

Replace — currently:

```ts
  let result;
  try {
    result = await fetchThreadEmls(session.fromPartition('persist:google'), { threadId, authuser, ik });
  } catch (e) {
    return failed(`Ophalen mislukt (${(e as Error).message})`);
  }
  const fetched = result.messages;
  if (fetched.length === 0) {
```

with:

```ts
  // De API-weg: één verzoek, geen HTML om te ontleden. Dit is de enige manier om
  // bij een gemachtigd postvak te komen, want de sessieweg kent alleen de
  // /mail/u/<n>/-vorm en niet het /d/<token>/-pad.
  let fetched: FetchedMessage[];
  if (path === 'api') {
    try {
      fetched = (await fetchThreadRaw(token!, threadId)).map((raw) => ({ raw }));
    } catch (e) {
      return failed(`Ophalen mislukt (${(e as Error).message})`);
    }
    if (fetched.length === 0) return failed('Geen bericht in dit gesprek');
    return persist(fetched);
  }

  let result;
  try {
    result = await fetchThreadEmls(session.fromPartition('persist:google'), { threadId, authuser, ik });
  } catch (e) {
    return failed(`Ophalen mislukt (${(e as Error).message})`);
  }
  fetched = result.messages;
  if (fetched.length === 0) {
```

- [ ] **Step 3: Lift the shared tail into `persist`**

Both paths end the same way. Wrap the existing tail — everything from `const ok: SavedMessage[] = [];` down to the closing `};` of the return — in a local function, and call it from the session path too.

Replace — currently:

```ts
  const ok: SavedMessage[] = [];
  const failedRecords: LogRecord[] = [];
  for (const f of fetched) {
```

with:

```ts
  return persist(fetched);

  // Wat beide wegen delen: wegschrijven, loggen en teruggeven. Als functie zodat
  // de API-weg hierboven er ook in kan vallen zonder het te herhalen.
  function persist(all: FetchedMessage[]): { count: number; total: number; error?: string; saved: SavedRef[] } {
    const ok: SavedMessage[] = [];
    const failedRecords: LogRecord[] = [];
    for (const f of all) {
```

Then, inside that block, rename the remaining references to the parameter and close the function:

- `if (ok.length === 0) return failed(fetched[0]?.error ?? 'Geen bericht opgehaald', fetched.length);`
  becomes `if (ok.length === 0) return failed(all[0]?.error ?? 'Geen bericht opgehaald', all.length);`
- both `return failed(\`Kan niet schrijven naar ${root}\`, fetched.length);` and the final
  `total: fetched.length,` become `all.length`
- add a closing `}` for `persist` after the final `return { count: ok.length, total: all.length, saved: savedRefs(root, files, ok) };`

`persist` is a function declaration, so it is hoisted and may be called from above its definition. Keep it inside `saveOneThread` — it closes over `ts`, `account`, `root`, `threadId` and `failed`.

- [ ] **Step 4: Typecheck, test and bundle**

```bash
cd "C:\Users\luca.manuel\gmail-desktop-build\.claude\worktrees\delegated-api-readme" && npx tsc --noEmit && npx vitest run && npm run build:main
```

Expected: no type errors, the whole suite passes, `dist-electron/main.js` written.

- [ ] **Step 5: Commit**

```bash
cd "C:\Users\luca.manuel\gmail-desktop-build\.claude\worktrees\delegated-api-readme" && git add electron/main.ts && git commit -m "feat: drag single threads out of a delegated mailbox

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Verification once an administrator has done the grant

Phase 1's checks come first (`users/me/profile` must return the delegated
mailbox's address). Then, for this phase:

1. **A label drag out of a delegated mailbox** saves `.eml` files in the drop
   folder, and the log records them against that mailbox's address.
2. **A single-thread drag out of a delegated mailbox** saves the same way. Check
   the `.eml` really is the delegated mailbox's message and not one from the
   owning account — that is what a wrongly-built session URL would produce.
3. **Own accounts are untouched:** drag a single thread from your own mailbox and
   confirm it still goes through the "view original" page (no behaviour change,
   no new errors).
4. **The blocked path:** with `delegatedTokenUrl` removed from
   `google-oauth.json`, drag from a delegated mailbox. Expect one item reading
   "Beheerdertoegang nodig" — not "Geen mail gevonden in label …", which would be
   a lie.

## Not in this plan

Phase 3 (unread counts and push for delegated mailboxes) gets its own plan. See
the spec's "Phases" section.

`docs/delegated-api-setup.md` §3 still recommends testing whether `view=om` works
behind a `/d/<token>/` path before building anything. This phase settles that
question the other way — with domain-wide delegation the API covers reading, so
that experiment is unnecessary. The document is Dutch and was left as it is by
decision; update it separately if you want it to stop pointing that way.
