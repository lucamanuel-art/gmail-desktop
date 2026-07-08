import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrefsStore, DEFAULT_PREFS } from '../electron/prefs-store';

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

  it('tolerates a corrupt file by returning defaults', () => {
    const store = new PrefsStore(file);
    store.setTheme('dark'); // create the file
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
    store.setTheme('dark'); // create the file
    const fs = require('node:fs');
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    raw.reneMode = 'yes';
    fs.writeFileSync(file, JSON.stringify(raw), 'utf8');
    expect(new PrefsStore(file).getAll().reneMode).toBe(false);
  });

  it('deep-merges stored notifications over defaults', () => {
    const store = new PrefsStore(file);
    store.setNotifications({ dnd: true, quietHours: { enabled: true, start: '22:00', end: '07:00' } });
    expect(new PrefsStore(file).getAll().notifications.dnd).toBe(true);
  });
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));
