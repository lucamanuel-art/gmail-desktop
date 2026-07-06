import { describe, it, expect } from 'vitest';
import { greet } from '../src/sanity';

describe('sanity', () => {
  it('greets', () => {
    expect(greet('Gmail')).toBe('hello Gmail');
  });
});
