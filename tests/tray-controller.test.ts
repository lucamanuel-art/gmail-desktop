import { describe, it, expect } from 'vitest';
import { shouldHideOnClose } from '../electron/tray-controller';

describe('shouldHideOnClose', () => {
  it('hides to tray during a normal close', () => {
    expect(shouldHideOnClose({ isQuitting: false, platform: 'linux' })).toBe(true);
  });
  it('does not hide when the app is quitting', () => {
    expect(shouldHideOnClose({ isQuitting: true, platform: 'linux' })).toBe(false);
  });
});
