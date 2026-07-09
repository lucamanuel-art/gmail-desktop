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
  it('skips keys present in the excluded set', () => {
    expect(totalUnread({ u0: 3, 'd:x@y.com': 5 }, new Set(['d:x@y.com']))).toBe(3);
  });
  it('an empty excluded set sums everything (default behavior)', () => {
    expect(totalUnread({ a: 3, b: 5 }, new Set())).toBe(8);
  });
});
