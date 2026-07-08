import { describe, it, expect } from 'vitest';
import { updateCheckPopup } from '../electron/update-popup';

describe('updateCheckPopup', () => {
  it('returns null for non-terminal states (nothing to pop yet)', () => {
    expect(updateCheckPopup({ state: 'idle' })).toBeNull();
    expect(updateCheckPopup({ state: 'checking' })).toBeNull();
    expect(updateCheckPopup({ state: 'downloading', percent: 20 })).toBeNull();
    expect(updateCheckPopup({ state: 'downloaded' })).toBeNull();
  });

  it('announces a newer version with a Download action', () => {
    const p = updateCheckPopup({ state: 'available', version: '0.3.0', currentVersion: '0.2.0' });
    expect(p).not.toBeNull();
    expect(p!.message).toContain('0.3.0');
    expect(p!.detail).toContain('0.2.0');
    expect(p!.buttons).toEqual(['Download', 'Later']);
    expect(p!.downloadButtonIndex).toBe(0);
  });

  it('announces the newer version even without a currentVersion detail', () => {
    const p = updateCheckPopup({ state: 'available', version: '0.3.0' });
    expect(p!.message).toContain('0.3.0');
    expect(p!.detail).toBeUndefined();
    expect(p!.downloadButtonIndex).toBe(0);
  });

  it('confirms the latest version is installed, no download action', () => {
    const p = updateCheckPopup({ state: 'not-available', currentVersion: '0.2.0' });
    expect(p!.message.toLowerCase()).toContain('latest');
    expect(p!.message).toContain('0.2.0');
    expect(p!.buttons).toEqual(['OK']);
    expect(p!.downloadButtonIndex).toBeUndefined();
  });

  it('reports a check failure with the error detail', () => {
    const p = updateCheckPopup({ state: 'error', message: 'network down' });
    expect(p!.message.toLowerCase()).toContain("couldn't");
    expect(p!.detail).toBe('network down');
    expect(p!.buttons).toEqual(['OK']);
  });

  it('explains that update checks only work in the installed app (dev)', () => {
    const p = updateCheckPopup({ state: 'dev' });
    expect(p!.message.toLowerCase()).toContain('installed app');
    expect(p!.buttons).toEqual(['OK']);
    expect(p!.downloadButtonIndex).toBeUndefined();
  });
});
