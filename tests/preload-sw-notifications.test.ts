import { describe, expect, it, vi } from 'vitest';
import { rerouteServiceWorkerNotifications } from '../electron/preload';

// Google Calendar fires event reminders via ServiceWorkerRegistration.showNotification
// (a "persistent" notification). Electron never displays those, and they bypass the
// app's window.Notification gate. The reroute helper replaces showNotification with a
// shim that constructs the (wrapped, gated) window.Notification instead.
describe('rerouteServiceWorkerNotifications', () => {
  function setup() {
    const constructed: Array<{ title: string; options?: NotificationOptions }> = [];
    const Ctor = vi.fn(function (this: unknown, title: string, options?: NotificationOptions) {
      constructed.push({ title, options });
    });
    const proto: { showNotification?: (title: string, options?: NotificationOptions) => Promise<void> } = {
      showNotification: vi.fn(),
    };
    const original = proto.showNotification;
    return { constructed, Ctor, proto, original };
  }

  it('replaces showNotification and never calls the original', async () => {
    const { constructed, Ctor, proto, original } = setup();
    rerouteServiceWorkerNotifications(proto, () => Ctor as unknown as typeof Notification);
    expect(proto.showNotification).not.toBe(original);
    await proto.showNotification!('Reminder', { body: '09:31 – 10:01' });
    expect(original).not.toHaveBeenCalled();
    expect(constructed).toEqual([{ title: 'Reminder', options: { body: '09:31 – 10:01' } }]);
  });

  it('resolves the returned promise (Calendar awaits it)', async () => {
    const { Ctor, proto } = setup();
    rerouteServiceWorkerNotifications(proto, () => Ctor as unknown as typeof Notification);
    await expect(proto.showNotification!('t')).resolves.toBeUndefined();
  });

  it('strips persistent-only options that the Notification constructor rejects', async () => {
    const { constructed, Ctor, proto } = setup();
    rerouteServiceWorkerNotifications(proto, () => Ctor as unknown as typeof Notification);
    await proto.showNotification!('t', {
      body: 'b',
      tag: 'x',
      actions: [{ action: 'open', title: 'Open' }],
    } as NotificationOptions);
    expect(constructed[0].options).toEqual({ body: 'b', tag: 'x' });
  });

  it('resolves the Notification constructor at call time, not install time', async () => {
    const { proto } = setup();
    const calls: string[] = [];
    let current = function () {
      calls.push('first');
    };
    rerouteServiceWorkerNotifications(proto, () => current as unknown as typeof Notification);
    current = function () {
      calls.push('second');
    };
    await proto.showNotification!('t');
    expect(calls).toEqual(['second']);
  });

  it('is a no-op on environments without showNotification', () => {
    expect(() =>
      rerouteServiceWorkerNotifications({}, () => (function () {}) as unknown as typeof Notification),
    ).not.toThrow();
    expect(() =>
      rerouteServiceWorkerNotifications(undefined, () => (function () {}) as unknown as typeof Notification),
    ).not.toThrow();
  });
});
