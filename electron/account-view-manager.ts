import { BrowserWindow, WebContentsView } from 'electron';
import type { Account } from './accounts-store';
import { contentBounds } from './layout';
import { IPC } from './ipc';
import { mapKey, toSendInputEvents, type KeyInput } from './outlook-shortcuts';
import { createInjectionGuard } from './injection-guard';

const GMAIL_URL = 'https://mail.google.com/';

export class AccountViewManager {
  private views = new Map<string, WebContentsView>();
  private activeId: string | null = null;
  private editableFocused = new Map<string, boolean>();
  private shortcutsEnabled = true;

  constructor(
    private readonly win: BrowserWindow,
    private readonly preloadPath: string,
    private readonly onUnread: (accountId: string, count: number) => void,
    private readonly onActivate: (accountId: string) => void,
    private readonly onIdentity: (
      accountId: string,
      identity: { email: string; name: string; avatarUrl: string },
    ) => void,
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
      } else if (channel === IPC.ACCOUNT_IDENTITY) {
        this.onIdentity(account.id, args[0]);
      } else if (channel === IPC.EDITABLE_FOCUS) {
        this.editableFocused.set(account.id, Boolean(args[0]));
      }
    });
    // Keys we synthesize via sendInputEvent re-enter before-input-event; the
    // guard lets exactly the injected keyDowns pass through unmapped so a
    // self-referential combo (e.g. Ctrl+Shift+D) cannot loop or mis-fire.
    const guard = createInjectionGuard();
    view.webContents.on('before-input-event', (event, input) => {
      if (!this.shortcutsEnabled) return;
      if (guard.consume(input.type === 'keyDown')) return;
      const editable = this.editableFocused.get(account.id) ?? false;
      const result = mapKey(input as unknown as KeyInput, editable);
      if (!result.preventDefault) return;
      event.preventDefault();
      if (!result.inject) return;
      const events = toSendInputEvents(result.inject, process.platform);
      guard.arm(events.length); // one keyDown per injected key
      for (const ev of events) {
        const modifiers = ev.modifiers as Electron.KeyboardInputEvent['modifiers'];
        view.webContents.sendInputEvent({ type: 'keyDown', keyCode: ev.keyCode, modifiers });
        view.webContents.sendInputEvent({ type: 'keyUp', keyCode: ev.keyCode, modifiers });
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
    this.editableFocused.delete(accountId);
    if (this.activeId === accountId) this.activeId = null;
  }

  relayout(): void {
    if (this.activeId) {
      const view = this.views.get(this.activeId);
      if (view) this.applyBounds(view);
    }
  }

  setShortcutsEnabled(enabled: boolean): void {
    this.shortcutsEnabled = enabled;
  }

  hideAll(): void {
    for (const v of this.views.values()) v.setVisible(false);
  }

  showActive(): void {
    if (this.activeId) this.show(this.activeId);
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
