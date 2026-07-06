export const SIDEBAR_WIDTH = 72;
// Margin around the active Gmail/Calendar view so it reads as a framed card
// inside the app rather than a raw full-bleed webview. The renderer background
// shows through this margin as a border.
export const CONTENT_MARGIN = 10;

export function contentBounds(win: { width: number; height: number }): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  return {
    x: SIDEBAR_WIDTH + CONTENT_MARGIN,
    y: CONTENT_MARGIN,
    width: Math.max(0, win.width - SIDEBAR_WIDTH - CONTENT_MARGIN * 2),
    height: Math.max(0, win.height - CONTENT_MARGIN * 2),
  };
}
