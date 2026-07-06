import { describe, it, expect } from 'vitest';
import { parseUnreadCount } from '../electron/unread-parser';

describe('parseUnreadCount', () => {
  it('reads the count from a Gmail inbox title', () => {
    expect(parseUnreadCount('Inbox (12) - user@gmail.com - Gmail')).toBe(12);
  });
  it('returns 0 when there is no count', () => {
    expect(parseUnreadCount('Inbox - user@gmail.com - Gmail')).toBe(0);
  });
  it('returns 0 for null/undefined/empty', () => {
    expect(parseUnreadCount(null)).toBe(0);
    expect(parseUnreadCount(undefined)).toBe(0);
    expect(parseUnreadCount('')).toBe(0);
  });
  it('takes the first parenthesised number only', () => {
    expect(parseUnreadCount('Inbox (3) - (spam) - Gmail')).toBe(3);
  });
});
