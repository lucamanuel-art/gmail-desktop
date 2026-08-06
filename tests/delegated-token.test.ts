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

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
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

  it('treats the mailbox case-insensitively, so one casing does not mint twice', async () => {
    const fetchMock = vi.fn(async () => ok('ya29.x', 100_000));
    const src = new DelegatedTokenSource(deps({ fetch: fetchMock }));
    await src.get('bart@abovomaxlead.nl');
    await src.get('Bart@Abovomaxlead.NL');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns null when the relay refuses, so callers degrade instead of crashing', async () => {
    for (const status of [400, 401, 403, 404, 502]) {
      const src = new DelegatedTokenSource(deps({ fetch: async () => new Response('no', { status }) }));
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

  it('returns null on an answer that is not shaped like a token', async () => {
    const src = new DelegatedTokenSource(
      deps({ fetch: async () => new Response(JSON.stringify({ accessToken: 'x' }), { status: 200 }) }),
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
