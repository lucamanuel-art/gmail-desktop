export const SIDEBAR_WIDTH = 72;
// No margin around the active Gmail/Calendar view: the webview sits flush
// against the sidebar so there is no dark frame from the renderer background.
export const CONTENT_MARGIN = 0;

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
