import { describe, expect, it } from 'vitest';
import { isCompleteTime } from '../renderer/app/settings-utils';

// Chromium's <input type="time"> reports '' while a segment is half-typed;
// saving that would clear the stored quiet-hours time under the user's cursor.
describe('isCompleteTime', () => {
  it('accepts complete HH:MM values', () => {
    expect(isCompleteTime('08:00')).toBe(true);
    expect(isCompleteTime('23:59')).toBe(true);
  });
  it('rejects empty and partial values', () => {
    expect(isCompleteTime('')).toBe(false);
    expect(isCompleteTime('8:00')).toBe(false);
    expect(isCompleteTime('08:0')).toBe(false);
    expect(isCompleteTime('0800')).toBe(false);
  });
});
