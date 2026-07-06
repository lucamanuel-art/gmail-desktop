export const SIDEBAR_WIDTH = 64;

export function contentBounds(win: { width: number; height: number }): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  return {
    x: SIDEBAR_WIDTH,
    y: 0,
    width: Math.max(0, win.width - SIDEBAR_WIDTH),
    height: win.height,
  };
}
