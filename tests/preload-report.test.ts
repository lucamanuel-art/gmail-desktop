import { describe, it, expect, vi } from 'vitest';
import { computeAndReport } from '../electron/preload';
import { IPC } from '../electron/ipc';

describe('computeAndReport', () => {
  it('sends the parsed unread count on the UNREAD_UPDATE channel', () => {
    const send = vi.fn();
    computeAndReport({ title: 'Inbox (7) - a@b.com - Gmail' }, send);
    expect(send).toHaveBeenCalledWith(IPC.UNREAD_UPDATE, 7);
  });
  it('sends 0 when there is no count', () => {
    const send = vi.fn();
    computeAndReport({ title: 'Inbox - a@b.com - Gmail' }, send);
    expect(send).toHaveBeenCalledWith(IPC.UNREAD_UPDATE, 0);
  });
});
