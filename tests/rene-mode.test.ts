import { describe, it, expect } from 'vitest';
import { advanceReneSequence, RENE_SEQUENCE } from '../renderer/app/settings-utils';
import { RENE_ZOOM_FACTOR, RENE_ZOOM_LEVEL } from '../electron/rene';
import { STRINGS_NORMAL, STRINGS_RENE, getStrings } from '../renderer/app/strings';

describe('advanceReneSequence', () => {
  const feed = (keys: string[]) => keys.reduce((p, k) => advanceReneSequence(p, k), 0);

  it('completes on the exact sequence', () => {
    expect(feed(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'a', 'b'])).toBe(
      RENE_SEQUENCE.length,
    );
  });

  it('accepts uppercase letters (shift held)', () => {
    expect(feed(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'A', 'B'])).toBe(
      RENE_SEQUENCE.length,
    );
  });

  it('resets on a wrong key', () => {
    expect(feed(['ArrowUp', 'ArrowDown', 'x'])).toBe(0);
  });

  it('a wrong key that is ArrowUp restarts the match instead of dropping it', () => {
    // ↑ ↓ ↑ ↓ ← → a b — the second ↑ begins a fresh attempt that completes.
    expect(
      feed(['ArrowUp', 'ArrowDown', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'a', 'b']),
    ).toBe(RENE_SEQUENCE.length);
  });

  it('does not complete a partial sequence', () => {
    expect(feed(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'a'])).toBe(5);
  });
});

describe('Rene zoom constants', () => {
  it('zoom level maps to the 200% factor (Chromium: factor = 1.2^level)', () => {
    expect(Math.pow(1.2, RENE_ZOOM_LEVEL)).toBeCloseTo(RENE_ZOOM_FACTOR, 10);
    expect(RENE_ZOOM_FACTOR).toBe(2);
  });
});

describe('UI strings', () => {
  it('both tables define exactly the same keys', () => {
    expect(Object.keys(STRINGS_RENE).sort()).toEqual(Object.keys(STRINGS_NORMAL).sort());
  });

  it('getStrings picks the table by mode', () => {
    expect(getStrings(false)).toBe(STRINGS_NORMAL);
    expect(getStrings(true)).toBe(STRINGS_RENE);
  });
});
