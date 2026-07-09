import { describe, it, expect } from 'vitest';
import { planDelegated } from '../electron/delegation-planner';

const e = (email: string) => ({ email, mailUrl: `https://m/${email}` });

describe('planDelegated', () => {
  it('registers new delegated entries', () => {
    expect(planDelegated([e('a@x.com')], [], []).map((r) => r.email)).toEqual(['a@x.com']);
  });
  it('skips a delegate that is also an owned authuser account', () => {
    expect(planDelegated([e('me@x.com')], ['me@x.com'], [])).toEqual([]);
  });
  it('skips entries removed by the user', () => {
    expect(planDelegated([e('a@x.com')], [], ['d:a@x.com'])).toEqual([]);
  });
  it('dedupes repeated entries case-insensitively', () => {
    expect(planDelegated([e('A@x.com'), e('a@x.com')], [], []).length).toBe(1);
  });
});
