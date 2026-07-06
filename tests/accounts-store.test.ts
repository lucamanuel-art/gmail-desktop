import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountsStore } from '../electron/accounts-store';

function newStore() {
  const dir = mkdtempSync(join(tmpdir(), 'accts-'));
  return new AccountsStore(join(dir, 'accounts.json'));
}

describe('AccountsStore', () => {
  let store: AccountsStore;
  beforeEach(() => {
    store = newStore();
  });

  it('starts empty', () => {
    expect(store.list()).toEqual([]);
  });

  it('adds an account with a generated id and persists it', () => {
    const created = store.add({ label: 'Work', color: '#EA4335' });
    expect(created.id).toBeTruthy();
    expect(created.label).toBe('Work');
    expect(store.list()).toHaveLength(1);
  });

  it('reads persisted accounts from disk in a fresh instance', () => {
    const created = store.add({ label: 'Home', color: '#4285F4' });
    const reopened = new AccountsStore((store as unknown as { filePath: string }).filePath);
    expect(reopened.list()).toEqual([created]);
  });

  it('removes an account by id', () => {
    const a = store.add({ label: 'A', color: '#000' });
    const b = store.add({ label: 'B', color: '#111' });
    store.remove(a.id);
    expect(store.list()).toEqual([b]);
  });

  it('updates label and color of an existing account', () => {
    const a = store.add({ label: 'A', color: '#000' });
    const updated = store.update(a.id, { label: 'Work', color: '#EA4335' });
    expect(updated).toEqual({ ...a, label: 'Work', color: '#EA4335' });
    expect(store.list()[0]).toEqual({ ...a, label: 'Work', color: '#EA4335' });
  });

  it('persists identity fields via update', () => {
    const a = store.add({ label: 'A', color: '#000' });
    store.update(a.id, { email: 'me@gmail.com', name: 'Me', avatarUrl: 'https://x/y.png' });
    const reopened = new AccountsStore((store as unknown as { filePath: string }).filePath);
    expect(reopened.list()[0]).toMatchObject({
      email: 'me@gmail.com',
      name: 'Me',
      avatarUrl: 'https://x/y.png',
    });
  });

  it('returns null when updating a missing id', () => {
    expect(store.update('nope', { label: 'X' })).toBeNull();
  });
});
