import { describe, it, expect, vi } from 'vitest';
import { applyBadge } from '../electron/badge-controller';

describe('applyBadge', () => {
  it('sets the badge to the summed unread total', () => {
    const setBadge = vi.fn();
    const total = applyBadge({ a: 2, b: 3 }, setBadge);
    expect(total).toBe(5);
    expect(setBadge).toHaveBeenCalledWith(5);
  });
  it('sets 0 when nothing is unread', () => {
    const setBadge = vi.fn();
    applyBadge({ a: 0 }, setBadge);
    expect(setBadge).toHaveBeenCalledWith(0);
  });
  it('excludes the given keys from the badge total', () => {
    const setBadge = vi.fn();
    const total = applyBadge({ u0: 2, 'd:x@y.com': 3 }, setBadge, new Set(['d:x@y.com']));
    expect(total).toBe(2);
    expect(setBadge).toHaveBeenCalledWith(2);
  });
  it('clears the overlay when the total is zero', () => {
    const clearOverlay = vi.fn();
    applyBadge({ a: 0 }, vi.fn(), new Set(), clearOverlay);
    expect(clearOverlay).toHaveBeenCalledOnce();
  });
  it('does not clear the overlay when something is unread', () => {
    const clearOverlay = vi.fn();
    applyBadge({ a: 3 }, vi.fn(), new Set(), clearOverlay);
    expect(clearOverlay).not.toHaveBeenCalled();
  });
});
