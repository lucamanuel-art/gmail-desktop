import { parseUnreadCount } from './unread-parser';
import { IPC } from './ipc';

export function computeAndReport(
  doc: { title: string },
  send: (channel: string, count: number) => void,
): void {
  send(IPC.UNREAD_UPDATE, parseUnreadCount(doc.title));
}

export function extractIdentity(
  doc: { querySelector(sel: string): any },
): { email: string; name: string; avatarUrl: string } | null {
  const anchor = doc.querySelector('a[aria-label^="Google Account"]');
  if (!anchor) return null;
  const label: string = anchor.getAttribute('aria-label') || '';
  const email = (label.match(/\S+@\S+\.\S+/) || [''])[0].replace(/[()]/g, '');
  const name = label
    .replace(/^Google Account:?\s*/i, '')
    .split('(')[0]
    .trim();
  const img = anchor.querySelector('img');
  const avatarUrl: string = (img && img.getAttribute('src')) || '';
  if (!email && !avatarUrl) return null;
  return { email, name, avatarUrl };
}

export function isEditableTarget(
  el: { tagName?: string; isContentEditable?: boolean } | null | undefined,
): boolean {
  if (!el) return false;
  const tag = (el.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || el.isContentEditable === true;
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

    // Poll for the signed-in identity and report it once found.
    let identityTries = 0;
    const identityTimer = setInterval(() => {
      identityTries += 1;
      const identity = extractIdentity(document);
      if (identity) {
        ipcRenderer.send(IPC.ACCOUNT_IDENTITY, identity);
        clearInterval(identityTimer);
      } else if (identityTries >= 15) {
        clearInterval(identityTimer);
      }
    }, 1000);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
}
