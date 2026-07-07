import { describe, it, expect } from 'vitest';
import { resolveShortcut } from '../electron/shortcuts';

const base = { type: 'keyDown', control: false, meta: false, shift: false, alt: false };

describe('resolveShortcut', () => {
  it('maps Ctrl+3 to switch account 3', () => {
    expect(resolveShortcut({ ...base, control: true, key: '3' })).toEqual({ type: 'switch', n: 3 });
  });
  it('maps Cmd+1 (meta) to switch account 1', () => {
    expect(resolveShortcut({ ...base, meta: true, key: '1' })).toEqual({ type: 'switch', n: 1 });
  });
  it('maps Ctrl+N to compose', () => {
    expect(resolveShortcut({ ...base, control: true, key: 'n' })).toEqual({ type: 'compose' });
  });
  it('maps Ctrl+= and Ctrl+- and Ctrl+0 to zoom', () => {
    expect(resolveShortcut({ ...base, control: true, key: '=' })).toEqual({ type: 'zoom', dir: 'in' });
    expect(resolveShortcut({ ...base, control: true, key: '-' })).toEqual({ type: 'zoom', dir: 'out' });
    expect(resolveShortcut({ ...base, control: true, key: '0' })).toEqual({ type: 'zoom', dir: 'reset' });
  });
  it('ignores keyUp events', () => {
    expect(resolveShortcut({ ...base, type: 'keyUp', control: true, key: '1' })).toBeNull();
  });
  it('ignores plain keys without a modifier', () => {
    expect(resolveShortcut({ ...base, key: '1' })).toBeNull();
  });
  it('ignores Ctrl+0 reserved digit as switch (0 is zoom-reset only)', () => {
    // '0' with modifier is zoom-reset, never switch
    expect(resolveShortcut({ ...base, control: true, key: '0' })).toEqual({ type: 'zoom', dir: 'reset' });
  });
});
