import { describe, it, expect } from 'vitest';
import { createInjectionGuard } from '../electron/injection-guard';

describe('createInjectionGuard', () => {
  it('passes through exactly the number of injected keyDowns, then resumes mapping', () => {
    const g = createInjectionGuard();
    g.arm(2); // e.g. injected a two-key sequence like g,i
    expect(g.consume(true)).toBe(true); // injected #1 — skip mapping
    expect(g.consume(true)).toBe(true); // injected #2 — skip mapping
    expect(g.consume(true)).toBe(false); // a real user keyDown — map it
  });

  it('never consumes on non-keyDown events (keyUp must not decrement the count)', () => {
    const g = createInjectionGuard();
    g.arm(1);
    expect(g.consume(false)).toBe(false); // synthetic keyUp — not counted
    expect(g.consume(true)).toBe(true); // the matching keyDown is still skipped
  });

  it('does not skip anything when unarmed', () => {
    const g = createInjectionGuard();
    expect(g.consume(true)).toBe(false);
  });

  it('breaks a self-referential injection loop (Ctrl+Shift+D → Ctrl+Shift+D)', () => {
    // The mapper turns Ctrl+Shift+D into an inject of one key that re-matches
    // Ctrl+Shift+D. With the guard, that single injected keyDown is consumed
    // instead of re-mapped, so it cannot recurse.
    const g = createInjectionGuard();
    g.arm(1);
    expect(g.consume(true)).toBe(true); // the re-entrant injected key is swallowed
    expect(g.consume(true)).toBe(false); // no further injected keys pending → no loop
  });
});
