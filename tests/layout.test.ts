import { describe, it, expect } from 'vitest';
import { contentBounds, SIDEBAR_WIDTH, CONTENT_MARGIN } from '../electron/layout';

describe('contentBounds', () => {
  it('insets content past the sidebar and by the frame margin', () => {
    expect(contentBounds({ width: 1000, height: 800 })).toEqual({
      x: SIDEBAR_WIDTH + CONTENT_MARGIN,
      y: CONTENT_MARGIN,
      width: 1000 - SIDEBAR_WIDTH - CONTENT_MARGIN * 2,
      height: 800 - CONTENT_MARGIN * 2,
    });
  });
  it('never returns a negative width', () => {
    expect(contentBounds({ width: 10, height: 100 }).width).toBe(0);
  });
  it('offsets by the scaled sidebar when the UI is zoomed (Rene mode)', () => {
    expect(contentBounds({ width: 1000, height: 800 }, 2)).toEqual({
      x: SIDEBAR_WIDTH * 2 + CONTENT_MARGIN,
      y: CONTENT_MARGIN,
      width: 1000 - SIDEBAR_WIDTH * 2 - CONTENT_MARGIN * 2,
      height: 800 - CONTENT_MARGIN * 2,
    });
  });
});
