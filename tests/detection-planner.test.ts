import { describe, it, expect } from 'vitest';
import { planNext } from '../electron/detection-planner';

describe('planNext', () => {
  it('registers and continues on a new email', () => {
    expect(planNext(['a@x.com'], 1, { email: 'b@x.com' })).toEqual({ register: true, stop: false });
  });
  it('stops without registering on a repeated email (invalid index redirected)', () => {
    expect(planNext(['a@x.com'], 1, { email: 'a@x.com' })).toEqual({ register: false, stop: true });
  });
  it('stops without registering when no identity (login/chooser page)', () => {
    expect(planNext(['a@x.com'], 1, null)).toEqual({ register: false, stop: true });
  });
  it('registers but stops at the max-accounts cap', () => {
    expect(planNext([], 9, { email: 'z@x.com' }, 10)).toEqual({ register: true, stop: true });
  });
});
