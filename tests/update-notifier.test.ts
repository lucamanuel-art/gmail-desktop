import { describe, it, expect } from 'vitest';
import { shouldNotifyUpdate } from '../electron/update-notifier';

describe('shouldNotifyUpdate', () => {
  const base = { state: 'available', version: '0.2.5', background: true, notifiedVersion: null };

  it('notifies for a new version found by a background check', () => {
    expect(shouldNotifyUpdate(base)).toBe(true);
  });
  it('stays silent for a version already notified this session', () => {
    expect(shouldNotifyUpdate({ ...base, notifiedVersion: '0.2.5' })).toBe(false);
  });
  it('stays silent for a manual (non-background) check', () => {
    expect(shouldNotifyUpdate({ ...base, background: false })).toBe(false);
  });
  it('stays silent for non-available states', () => {
    for (const state of ['checking', 'not-available', 'downloading', 'downloaded', 'error', 'dev', 'idle']) {
      expect(shouldNotifyUpdate({ ...base, state })).toBe(false);
    }
  });
  it('stays silent when the version is null or empty', () => {
    expect(shouldNotifyUpdate({ ...base, version: null })).toBe(false);
    expect(shouldNotifyUpdate({ ...base, version: '' })).toBe(false);
  });
  it('notifies for a newer version after a different one was already notified', () => {
    expect(shouldNotifyUpdate({ ...base, version: '0.2.6', notifiedVersion: '0.2.5' })).toBe(true);
  });
});
