import { BrowserWindow, WebContentsView } from 'electron';
import type { Account } from './accounts-store';
import { contentBounds } from './layout';
import { IPC } from './ipc';

const GMAIL_URL = 'https://mail.google.com/';

export class AccountViewManager {
  private views = new Map<string, WebContentsView>();
  private activeId: string | null = null;

  constructor(
    private readonly win: BrowserWindow,
    private readonly preloadPath: string,
    private readonly onUnread: (accountId: string, count: number) => void,
    private readonly onActivate: (accountId: string) => void,
  ) {
    this.win.on('resize', () => this.relayout());
  }

  ensureView(account: Account): void {
    if (this.views.has(account.id)) return;
    const view = new WebContentsView({
      webPreferences: {
        preload: this.preloadPath,
        partition: `persist:account-${account.id}`,
        contextIsolation: false,
      },
    });
    view.webContents.on('ipc-message', (_e, channel, ...args) => {
      if (channel === IPC.UNREAD_UPDATE) {
        this.onUnread(account.id, Number(args[0]) || 0);
      } else if (channel === IPC.NOTIFICATION_ACTIVATE) {
        this.onActivate(account.id);
      }
    });
    void view.webContents.loadURL(GMAIL_URL);
    this.win.contentView.addChildView(view);
    view.setVisible(false);
    this.views.set(account.id, view);
  }

  show(accountId: string): void {
    const view = this.views.get(accountId);
    if (!view) return;
    for (const [id, v] of this.views) v.setVisible(id === accountId);
    this.activeId = accountId;
    this.applyBounds(view);
  }

  removeView(accountId: string): void {
    const view = this.views.get(accountId);
    if (!view) return;
    this.win.contentView.removeChildView(view);
    view.webContents.close();
    this.views.delete(accountId);
    if (this.activeId === accountId) this.activeId = null;
  }

  relayout(): void {
    if (this.activeId) {
      const view = this.views.get(this.activeId);
      if (view) this.applyBounds(view);
    }
  }

  accountIdForWebContents(id: number): string | null {
    for (const [accountId, view] of this.views) {
      if (view.webContents.id === id) return accountId;
    }
    return null;
  }

  private applyBounds(view: WebContentsView): void {
    const [width, height] = this.win.getContentSize();
    view.setBounds(contentBounds({ width, height }));
  }
}
