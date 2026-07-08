// Rene mode: everything renders at 200%. Chromium zoom levels relate to the
// visual factor as factor = 1.2 ** level, so factor 2 needs level ~3.80 —
// outside the ±3 range the manual zoom shortcuts use, on purpose.
export const RENE_ZOOM_FACTOR = 2;
export const RENE_ZOOM_LEVEL = Math.log(RENE_ZOOM_FACTOR) / Math.log(1.2);
