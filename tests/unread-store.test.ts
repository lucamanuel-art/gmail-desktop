import { describe, it, expect } from 'vitest';
import { UnreadStore } from '../electron/unread-store';
import { totalUnread } from '../electron/badge-math';

describe('UnreadStore', () => {
  it('sums reported counts in the snapshot', () => {
    const s = new UnreadStore();
    s.report('u0', 2);
    s.report('d:x@y.com', 3);
    expect(totalUnread(s.snapshot())).toBe(5);
  });

  it('forgets a key when a view reports zero — a discarded view must not stick', () => {
    const s = new UnreadStore();
    s.report('u0', 5);
    expect(totalUnread(s.snapshot())).toBe(5);
    // A discarded/torn-down mail view reports 0; its count must leave the total.
    s.report('u0', 0);
    expect(totalUnread(s.snapshot())).toBe(0);
    expect('u0' in s.snapshot()).toBe(false);
  });

  it('treats a negative/garbage count as zero and forgets the key', () => {
    const s = new UnreadStore();
    s.report('u0', 4);
    s.report('u0', -1);
    expect('u0' in s.snapshot()).toBe(false);
  });

  it('forget() drops a key even if it was counting', () => {
    const s = new UnreadStore();
    s.report('u0', 7);
    s.forget('u0');
    expect(totalUnread(s.snapshot())).toBe(0);
    expect('u0' in s.snapshot()).toBe(false);
  });

  it('snapshot is a copy — mutating it does not corrupt the store', () => {
    const s = new UnreadStore();
    s.report('u0', 3);
    const snap = s.snapshot();
    snap.u0 = 999;
    expect(s.snapshot().u0).toBe(3);
  });
});
