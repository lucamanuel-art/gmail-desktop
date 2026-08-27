// The preferences store: defaults, the patch per tab, and its file on disk.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrefsStore, DEFAULT_PREFS } from '../electron/core/prefs-store';

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'prefs-'));
  file = join(dir, 'prefs.json');
});

describe('PrefsStore', () => {
  it('returns defaults when the file is missing', () => {
    const store = new PrefsStore(file);
    expect(store.getAll()).toEqual(DEFAULT_PREFS);
  });

  it('persists and re-reads a window patch', () => {
    const store = new PrefsStore(file);
    store.setWindow({ width: 900, height: 700, x: 10, y: 20, maximized: true });
    expect(new PrefsStore(file).getAll().window).toEqual({
      width: 900, height: 700, x: 10, y: 20, maximized: true,
    });
  });

  it('defaults the beta channel to off', () => {
    expect(new PrefsStore(file).getAll().updates.beta).toBe(false);
  });

  // Every install that predates the setting has an updates block without the key. It must
  // read back as a real false, not undefined: an upgrade may never move someone onto the
  // beta channel, and the renderer switch reads the value directly.
  it('reads a pre-existing updates block as beta off', () => {
    writeFileSync(file, JSON.stringify({ updates: { autoCheck: false, notify: true } }), 'utf8');
    expect(new PrefsStore(file).getAll().updates).toEqual({
      autoCheck: false,
      notify: true,
      beta: false,
    });
  });

  it('persists the beta channel without dropping the other update prefs', () => {
    const store = new PrefsStore(file);
    store.setUpdates({ autoCheck: false });
    store.setUpdates({ beta: true });
    expect(new PrefsStore(file).getAll().updates).toEqual({
      autoCheck: false,
      notify: true,
      beta: true,
    });
  });

  it('merges partial account prefs without dropping siblings', () => {
    const store = new PrefsStore(file);
    store.setAccount('a@x.com', { zoom: 1 });
    store.setAccount('a@x.com', { label: 'Work' });
    expect(store.getAccount('a@x.com')).toEqual({ zoom: 1, label: 'Work' });
  });

  it('assigns 0..n-1 order from setOrder', () => {
    const store = new PrefsStore(file);
    store.setOrder(['b@x.com', 'a@x.com']);
    expect(store.getAccount('b@x.com').order).toBe(0);
    expect(store.getAccount('a@x.com').order).toBe(1);
  });

  it('round-trips a per-account badgeCount=false through save and load', () => {
    const store = new PrefsStore(file);
    store.setAccount('a@b.com', { badgeCount: false });
    expect(store.getAll().accounts['a@b.com'].badgeCount).toBe(false);
    expect(new PrefsStore(file).getAccount('a@b.com').badgeCount).toBe(false);
  });

  it('tolerates a corrupt file by returning defaults', () => {
    const store = new PrefsStore(file);
    store.setTheme('dark');
    require('node:fs').writeFileSync(file, '{not json', 'utf8');
    expect(new PrefsStore(file).getAll()).toEqual(DEFAULT_PREFS);
  });

  it('defaults reneMode to false and round-trips it', () => {
    const store = new PrefsStore(file);
    expect(store.getAll().reneMode).toBe(false);
    store.setReneMode(true);
    expect(new PrefsStore(file).getAll().reneMode).toBe(true);
    store.setReneMode(false);
    expect(new PrefsStore(file).getAll().reneMode).toBe(false);
  });

  it('ignores a non-boolean stored reneMode', () => {
    const store = new PrefsStore(file);
    store.setTheme('dark');
    const fs = require('node:fs');
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    raw.reneMode = 'yes';
    fs.writeFileSync(file, JSON.stringify(raw), 'utf8');
    expect(new PrefsStore(file).getAll().reneMode).toBe(false);
  });

  it('defaults launchMinimized to false and round-trips it without touching autoStart', () => {
    const store = new PrefsStore(file);
    expect(store.getAll().launchMinimized).toBe(false);
    store.setAutoStart(true);
    store.setLaunchMinimized(true);
    const back = new PrefsStore(file).getAll();
    expect(back.launchMinimized).toBe(true);
    expect(back.autoStart).toBe(true);
    store.setLaunchMinimized(false);
    expect(new PrefsStore(file).getAll().autoStart).toBe(true);
  });

  it('ignores a non-boolean stored launchMinimized', () => {
    const store = new PrefsStore(file);
    store.setTheme('dark');
    const fs = require('node:fs');
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    raw.launchMinimized = 'sure';
    fs.writeFileSync(file, JSON.stringify(raw), 'utf8');
    expect(new PrefsStore(file).getAll().launchMinimized).toBe(false);
  });

  it('deep-merges stored notifications over defaults', () => {
    const store = new PrefsStore(file);
    store.setNotifications({ dnd: true, quietHours: { enabled: true, start: '22:00', end: '07:00' } });
    expect(new PrefsStore(file).getAll().notifications.dnd).toBe(true);
  });

  it('defaults dndUntil to undefined when absent', () => {
    const store = new PrefsStore(file);
    store.setNotifications({ dnd: false, quietHours: { enabled: false, start: '18:00', end: '08:00' } });
    expect(new PrefsStore(file).getAll().notifications.dndUntil).toBeUndefined();
  });

  it('persists and re-reads a numeric dndUntil', () => {
    const store = new PrefsStore(file);
    store.setNotifications({ dnd: false, dndUntil: 1893456000000, quietHours: { enabled: false, start: '18:00', end: '08:00' } });
    expect(new PrefsStore(file).getAll().notifications.dndUntil).toBe(1893456000000);
  });

  it('ignores a non-numeric dndUntil on disk', () => {
    const store = new PrefsStore(file);
    store.setTheme('dark');
    require('node:fs').writeFileSync(
      file,
      JSON.stringify({ notifications: { dnd: false, dndUntil: 'soon', quietHours: { enabled: false, start: '18:00', end: '08:00' } } }),
      'utf8',
    );
    expect(new PrefsStore(file).getAll().notifications.dndUntil).toBeUndefined();
  });

  it('defaults the language to the system language', () => {
    const store = new PrefsStore(file);
    expect(store.getAll().language).toBe('system');
    expect(DEFAULT_PREFS.language).toBe('system');
  });

  it('stores an explicit language choice', () => {
    const store = new PrefsStore(file);
    store.setLanguage('nl');
    expect(store.getAll().language).toBe('nl');
    expect(new PrefsStore(file).getAll().language).toBe('nl');
  });

  it('rejects a language a prefs file from another version may hold', () => {
    const store = new PrefsStore(file);
    store.setLanguage('nl');
    writeFileSync(file, JSON.stringify({ ...store.getAll(), language: 'fr' }));
    expect(new PrefsStore(file).getAll().language).toBe('system');
  });
});

describe('PrefsStore mailDrop', () => {
  it('defaults to an empty folder (meaning: use the default location)', () => {
    expect(new PrefsStore(file).getAll().mailDrop).toEqual({ folder: '' });
  });

  it('persists a chosen folder across instances', () => {
    new PrefsStore(file).setMailDropFolder('D:\\Mail');
    expect(new PrefsStore(file).getAll().mailDrop.folder).toBe('D:\\Mail');
  });

  it('keeps other prefs intact when the folder changes', () => {
    const store = new PrefsStore(file);
    store.setTheme('dark');
    store.setMailDropFolder('D:\\Mail');
    expect(store.getAll().theme).toBe('dark');
  });

  it('ignores a non-string folder in a hand-edited file', () => {
    require('node:fs').writeFileSync(file, JSON.stringify({ mailDrop: { folder: 42 } }), 'utf8');
    expect(new PrefsStore(file).getAll().mailDrop.folder).toBe('');
  });
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));
