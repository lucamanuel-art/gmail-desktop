import { describe, it, expect } from 'vitest';
import { sortByOrder } from '../electron/account-order';

describe('sortByOrder', () => {
  it('falls back to index when no order set', () => {
    const items = [{ index: 2 }, { index: 0 }, { index: 1 }];
    expect(sortByOrder(items).map((i) => i.index)).toEqual([0, 1, 2]);
  });
  it('honours explicit order over index', () => {
    const items = [{ index: 0, order: 2 }, { index: 1, order: 0 }, { index: 2, order: 1 }];
    expect(sortByOrder(items).map((i) => i.index)).toEqual([1, 2, 0]);
  });
  it('does not mutate the input', () => {
    const items = [{ index: 1 }, { index: 0 }];
    sortByOrder(items);
    expect(items.map((i) => i.index)).toEqual([1, 0]);
  });
});
