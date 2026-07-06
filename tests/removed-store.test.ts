import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RemovedStore } from '../electron/removed-store';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('RemovedStore', () => {
  let dir: string;
  let store: RemovedStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'removed-'));
    store = new RemovedStore(join(dir, 'removed.json'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('starts empty', () => {
    expect(store.list()).toEqual([]);
    expect(store.has('a@b.com')).toBe(false);
  });

  it('adds and persists, ignoring duplicates', () => {
    store.add('a@b.com');
    store.add('a@b.com');
    store.add('c@d.com');
    expect(new RemovedStore(join(dir, 'removed.json')).list()).toEqual(['a@b.com', 'c@d.com']);
    expect(store.has('a@b.com')).toBe(true);
  });

  it('removes an email', () => {
    store.add('a@b.com');
    store.add('c@d.com');
    store.remove('a@b.com');
    expect(store.list()).toEqual(['c@d.com']);
    expect(store.has('a@b.com')).toBe(false);
  });
});
