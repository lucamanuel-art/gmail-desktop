// Chromium's <input type="time"> fires onChange with '' while a segment is
// being typed; only complete HH:MM values may be persisted, otherwise the
// stored quiet-hours time gets cleared under the user's cursor.
export function isCompleteTime(v: string): boolean {
  return /^\d{2}:\d{2}$/.test(v);
}

// Rene mode's secret handshake, typed on the settings page: ↑ ↓ ← → a b.
export const RENE_SEQUENCE = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'a', 'b'];

// Advances the matcher by one keystroke and returns the new progress; the
// sequence is complete when the result equals RENE_SEQUENCE.length (the caller
// resets to 0). A mismatching ArrowUp starts a fresh attempt rather than
// discarding the keystroke, so mashing the combo still lands.
export function advanceReneSequence(progress: number, key: string): number {
  const got = key.length === 1 ? key.toLowerCase() : key;
  if (got === RENE_SEQUENCE[progress]) return progress + 1;
  return got === RENE_SEQUENCE[0] ? 1 : 0;
}
