import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ColorStore } from '../electron/color-store';

function newStore() {
  const dir = mkdtempSync(join(tmpdir(), 'colors-'));
  return new ColorStore(join(dir, 'colors.json'));
}

describe('ColorStore', () => {
  let store: ColorStore;
  beforeEach(() => {
    store = newStore();
  });
  it('returns undefined for an unknown email', () => {
    expect(store.get('a@x.com')).toBeUndefined();
  });
  it('persists a color across instances', () => {
    store.set('a@x.com', '#EA4335');
    const reopened = new ColorStore((store as unknown as { filePath: string }).filePath);
    expect(reopened.get('a@x.com')).toBe('#EA4335');
  });
  it('tolerates a corrupt or non-object file (returns undefined, then can still write)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'colors-'));
    const fp = join(dir, 'colors.json');
    writeFileSync(fp, '[1,2,3]', 'utf8'); // valid JSON but not a Record
    const s = new ColorStore(fp);
    expect(s.get('a@x.com')).toBeUndefined();
    s.set('a@x.com', '#000');
    expect(new ColorStore(fp).get('a@x.com')).toBe('#000');
  });
});
