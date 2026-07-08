import { parseUnreadCount } from './unread-parser';
import { IPC } from './ipc';

export function computeAndReport(
  doc: { title: string },
  send: (channel: string, count: number) => void,
): void {
  send(IPC.UNREAD_UPDATE, parseUnreadCount(doc.title));
}

export function extractIdentity(
  doc: { querySelectorAll(sel: string): ArrayLike<any> },
): { email: string; name: string; avatarUrl: string } | null {
  // Locale-independent: the Google account button is an <a> whose aria-label
  // contains the signed-in email (an @-address) and which holds the avatar <img>.
  // (The old `aria-label^="Google Account"` match broke for non-English Gmail UIs.)
  const anchors = Array.from(doc.querySelectorAll('a[aria-label]'));
  let anchor: any = null;
  for (const a of anchors) {
    const lbl: string = a.getAttribute('aria-label') || '';
    if (/@[^\s@]+\.[^\s@]+/.test(lbl) && a.querySelector('img')) {
      anchor = a;
      break;
    }
  }
  if (!anchor) return null;
  const label: string = anchor.getAttribute('aria-label') || '';
  const email = (label.match(/[^\s()]+@[^\s()]+\.[^\s()]+/) || [''])[0];
  const name = label
    .replace(/^[^:]*:\s*/, '') // strip any leading "Xxx:" prefix (any language)
    .replace(/\s*\(.*\)\s*$/, '') // strip trailing "(email)"
    .trim();
  const img = anchor.querySelector('img');
  const avatarUrl: string = (img && img.getAttribute('src')) || '';
  if (!email && !avatarUrl) return null;
  return { email, name, avatarUrl };
}

// Gmail's new-mail notifications carry no thread id (tag = account email, data
// = null) and Gmail's own click handler never opens the message inside the
// wrapper (verified: it runs but no-ops even with user activation). The inbox
// list DOM marks each row's subject span with data-legacy-thread-id, so the
// notification body (= subject) identifies the thread to open. Rows are
// newest-first; the first match is the message that fired the notification.
export function findThreadIdBySubject(
  doc: { querySelectorAll(sel: string): ArrayLike<any> },
  subject: string,
): string | null {
  const wanted = (subject || '').trim();
  if (!wanted) return null;
  // Gmail may ellipsize long subjects in the notification body.
  const ellipsized = /(…|\.\.\.)$/.test(wanted);
  const prefix = wanted.replace(/(…|\.\.\.)$/, '');
  for (const el of Array.from(doc.querySelectorAll('[data-legacy-thread-id]'))) {
    const id = el.getAttribute('data-legacy-thread-id');
    if (!id) continue;
    const text = (el.textContent || '').trim();
    if (text === wanted || (ellipsized && text.startsWith(prefix))) return id;
  }
  return null;
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

  let notifyAllowed = true;
  ipcRenderer.on(IPC.NOTIFY_ALLOWED, (_e: unknown, allowed: boolean) => {
    notifyAllowed = allowed;
  });

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
        if (!notifyAllowed) {
          // Return a harmless stub so Gmail's code doesn't throw; nothing is shown.
          return { onclick: null, close() {}, addEventListener() {} } as unknown as Notification;
        }
        const n = new Original(title, options);
        n.addEventListener('click', () => {
          // Resolve the clicked thread at click time (the row exists by then).
          const threadId = findThreadIdBySubject(document, options?.body ?? '');
          ipcRenderer.send(IPC.NOTIFICATION_ACTIVATE, threadId ?? undefined);
        });
        return n;
      } as unknown as typeof Notification;
      // Delegate `permission` live via a getter — copying it once freezes it at
      // 'default', so Gmail would think notifications are disabled forever and
      // never fire one. The getter always reflects the real granted state.
      Object.defineProperty(Wrapped, 'permission', {
        configurable: true,
        get: () => Original.permission,
      });
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
