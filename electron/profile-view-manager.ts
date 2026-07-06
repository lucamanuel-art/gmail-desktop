import { BrowserWindow, WebContentsView } from 'electron';
import { contentBounds } from './layout';
import { IPC } from './ipc';
import { mailUrl, calendarUrl } from './google-urls';

export type Surface = 'mail' | 'calendar';

export interface Profile {
  index: number;
  email: string;
  name: string;
  avatarUrl: string;
  color: string;
}

const SESSION_PARTITION = 'persist:google';
const key = (index: number, surface: Surface) => `${index}:${surface}`;

export class ProfileViewManager {
  private views = new Map<string, WebContentsView>();
  private activeKey: string | null = null;

  constructor(
    private readonly win: BrowserWindow,
    private readonly preloadPath: string,
    private readonly onUnread: (index: number, count: number) => void,
    private readonly onActivate: (index: number) => void,
    private readonly onIdentity: (
      index: number,
      identity: { email: string; name: string; avatarUrl: string },
    ) => void,
  ) {
    this.win.on('resize', () => this.relayout());
  }

  ensureView(index: number, surface: Surface, visible: boolean): void {
    const k = key(index, surface);
    if (this.views.has(k)) {
      if (visible) this.show(index, surface);
      return;
    }
    const view = new WebContentsView({
      webPreferences: {
        preload: this.preloadPath,
        partition: SESSION_PARTITION,
        contextIsolation: false,
      },
    });
    if (surface === 'mail') {
      view.webContents.on('ipc-message', (_e, channel, ...args) => {
        if (channel === IPC.UNREAD_UPDATE) this.onUnread(index, Number(args[0]) || 0);
        else if (channel === IPC.NOTIFICATION_ACTIVATE) this.onActivate(index);
        else if (channel === IPC.ACCOUNT_IDENTITY) this.onIdentity(index, args[0]);
      });
    }
    void view.webContents.loadURL(surface === 'mail' ? mailUrl(index) : calendarUrl(index));
    this.win.contentView.addChildView(view);
    view.setVisible(false);
    this.views.set(k, view);
    if (visible) this.show(index, surface);
  }

  show(index: number, surface: Surface): void {
    this.ensureView(index, surface, false);
    const k = key(index, surface);
    const view = this.views.get(k);
    if (!view) return;
    for (const [vk, v] of this.views) v.setVisible(vk === k);
    this.activeKey = k;
    this.applyBounds(view);
  }

  discardView(index: number, surface: Surface): void {
    const k = key(index, surface);
    const view = this.views.get(k);
    if (!view) return;
    this.win.contentView.removeChildView(view);
    view.webContents.close();
    this.views.delete(k);
    if (this.activeKey === k) this.activeKey = null;
  }

  hideAll(): void {
    for (const v of this.views.values()) v.setVisible(false);
  }

  showActive(): void {
    if (this.activeKey) {
      const view = this.views.get(this.activeKey);
      if (view) {
        view.setVisible(true);
        this.applyBounds(view);
      }
    }
  }

  relayout(): void {
    if (this.activeKey) {
      const view = this.views.get(this.activeKey);
      if (view) this.applyBounds(view);
    }
  }

  private applyBounds(view: WebContentsView): void {
    const [width, height] = this.win.getContentSize();
    view.setBounds(contentBounds({ width, height }));
  }
}
