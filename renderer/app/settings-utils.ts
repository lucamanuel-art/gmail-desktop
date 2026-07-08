// Chromium's <input type="time"> fires onChange with '' while a segment is
// being typed; only complete HH:MM values may be persisted, otherwise the
// stored quiet-hours time gets cleared under the user's cursor.
export function isCompleteTime(v: string): boolean {
  return /^\d{2}:\d{2}$/.test(v);
}
