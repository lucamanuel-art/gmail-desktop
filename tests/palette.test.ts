import { describe, it, expect } from 'vitest';
import { PALETTE, colorForIndex } from '../electron/palette';

describe('colorForIndex', () => {
  it('returns the palette entry for the index', () => {
    expect(colorForIndex(0)).toBe(PALETTE[0]);
    expect(colorForIndex(1)).toBe(PALETTE[1]);
  });
  it('wraps around the palette', () => {
    expect(colorForIndex(PALETTE.length)).toBe(PALETTE[0]);
  });
});
