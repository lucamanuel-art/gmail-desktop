import { parseUnreadCount } from './unread-parser';
import { IPC } from './ipc';

export function computeAndReport(
  doc: { title: string },
  send: (channel: string, count: number) => void,
): void {
  send(IPC.UNREAD_UPDATE, parseUnreadCount(doc.title));
}

// Electron-only wiring. Guarded so the module is importable under plain Node (tests).
if (typeof document !== 'undefined') {
  // Lazy require avoids bundling issues and keeps the top of the module Node-safe.
  const { ipcRenderer } = require('electron') as typeof import('electron');

  const report = () =>
    computeAndReport(document, (channel, count) => ipcRenderer.send(channel, count));

  const start = () => {
    report();
    const titleEl = document.querySelector('title');
    if (titleEl) {
      new MutationObserver(report).observe(titleEl, { childList: true });
    }
    // Fallback: Gmail sometimes replaces the title element wholesale.
    setInterval(report, 5000);

    const Original = window.Notification;
    if (Original) {
      const Wrapped = function (this: Notification, title: string, options?: NotificationOptions) {
        const n = new Original(title, options);
        n.addEventListener('click', () => ipcRenderer.send(IPC.NOTIFICATION_ACTIVATE));
        return n;
      } as unknown as typeof Notification;
      (Wrapped as unknown as { permission: NotificationPermission }).permission = Original.permission;
      Wrapped.requestPermission = Original.requestPermission.bind(Original);
      window.Notification = Wrapped;
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
}
