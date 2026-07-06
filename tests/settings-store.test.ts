import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SettingsStore } from '../electron/settings-store';

function newStore() {
  const dir = mkdtempSync(join(tmpdir(), 'settings-'));
  return new SettingsStore(join(dir, 'settings.json'));
}

describe('SettingsStore', () => {
  let store: SettingsStore;
  beforeEach(() => {
    store = newStore();
  });

  it('defaults outlookShortcuts to true', () => {
    expect(store.get()).toEqual({ outlookShortcuts: true });
  });

  it('persists a changed setting across instances', () => {
    store.set({ outlookShortcuts: false });
    const reopened = new SettingsStore((store as unknown as { filePath: string }).filePath);
    expect(reopened.get()).toEqual({ outlookShortcuts: false });
  });

  it('returns the merged settings from set', () => {
    expect(store.set({ outlookShortcuts: false })).toEqual({ outlookShortcuts: false });
  });

  it('falls back to defaults on a corrupt file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'settings-'));
    const fp = join(dir, 'settings.json');
    writeFileSync(fp, '{ not valid json', 'utf8');
    expect(new SettingsStore(fp).get()).toEqual({ outlookShortcuts: true });
  });
});
