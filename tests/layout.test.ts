import { describe, it, expect } from 'vitest';
import { contentBounds, SIDEBAR_WIDTH } from '../electron/layout';

describe('contentBounds', () => {
  it('offsets content by the sidebar width', () => {
    expect(contentBounds({ width: 1000, height: 800 })).toEqual({
      x: SIDEBAR_WIDTH,
      y: 0,
      width: 1000 - SIDEBAR_WIDTH,
      height: 800,
    });
  });
  it('never returns a negative width', () => {
    expect(contentBounds({ width: 10, height: 100 }).width).toBe(0);
  });
});
