import { describe, it, expect } from 'vitest';
import { totalUnread } from '../electron/badge-math';

describe('totalUnread', () => {
  it('sums all account counts', () => {
    expect(totalUnread({ a: 3, b: 5 })).toBe(8);
  });
  it('is 0 for an empty map', () => {
    expect(totalUnread({})).toBe(0);
  });
  it('ignores non-finite values defensively', () => {
    expect(totalUnread({ a: 2, b: NaN as unknown as number })).toBe(2);
  });
});
