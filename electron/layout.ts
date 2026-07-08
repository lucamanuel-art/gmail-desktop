export const SIDEBAR_WIDTH = 72;
// No margin around the active Gmail/Calendar view: the webview sits flush
// against the sidebar so there is no dark frame from the renderer background.
export const CONTENT_MARGIN = 0;

// `scale` is the sidebar renderer's zoom factor (2 in Rene mode): the fixed
// 72px nav paints scale× wider, so the content view must start past that.
export function contentBounds(
  win: { width: number; height: number },
  scale = 1,
): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const sidebar = Math.round(SIDEBAR_WIDTH * scale);
  return {
    x: sidebar + CONTENT_MARGIN,
    y: CONTENT_MARGIN,
    width: Math.max(0, win.width - sidebar - CONTENT_MARGIN * 2),
    height: Math.max(0, win.height - CONTENT_MARGIN * 2),
  };
}
