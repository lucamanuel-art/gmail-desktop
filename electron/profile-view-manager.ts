import { BrowserWindow, WebContentsView } from 'electron';
import { contentBounds } from './layout';
import { IPC } from './ipc';
import { mailUrl, calendarUrl } from './google-urls';
import { attachExternalLinkHandling } from './external-links';
import type { KeyInput } from './shortcuts';

export type Surface = 'mail' | 'calendar';

export interface Profile {
  index: number;
  email: string;
  name: string;
  avatarUrl: string;
  color: string;
  order?: number;
  label?: string;
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
    private readonly onActivate: (index: number, surface: Surface, threadId?: string) => void,
    private readonly onIdentity: (
      index: number,
      identity: { email: string; name: string; avatarUrl: string },
    ) => void,
    private readonly onInput: (index: number, input: KeyInput) => void,
    private readonly getZoom: (index: number) => number,
    private readonly getOpenMode: () => 'app' | 'window',
  ) {
    this.win.on('resize', () => this.relayout());
  }

  ensureView(index: number, surface: Surface, visible: boolean, urlOverride?: string): void {
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
        backgroundThrottling: surface === 'calendar' ? false : true,
      },
    });
    attachExternalLinkHandling(view.webContents, {
      getOpenMode: this.getOpenMode,
      openInApp: (url) => {
        this.onActivate(index, surface);
        void view.webContents.loadURL(url);
      },
    });
    view.webContents.on('ipc-message', (_e, channel, ...args) => {
      if (surface === 'mail') {
        if (channel === IPC.UNREAD_UPDATE) this.onUnread(index, Number(args[0]) || 0);
        else if (channel === IPC.ACCOUNT_IDENTITY) this.onIdentity(index, args[0]);
      }
      if (channel === IPC.NOTIFICATION_ACTIVATE) {
        this.onActivate(index, surface, typeof args[0] === 'string' ? args[0] : undefined);
      }
    });
    void view.webContents.loadURL(
      urlOverride ?? (surface === 'mail' ? mailUrl(index) : calendarUrl(index)),
    );
    view.webContents.on('before-input-event', (_e, input) => this.onInput(index, input as unknown as KeyInput));
    view.webContents.on('did-finish-load', () => {
      view.webContents.setZoomLevel(this.getZoom(index));
    });
    // A Google page can close itself (e.g. Gmail's full-page compose calls
    // window.close() after sending). Drop the dead view from the map so timers
    // like refreshNotifyAllowed don't crash on a destroyed webContents.
    view.webContents.once('destroyed', () => {
      if (this.views.get(k) !== view) return;
      this.win.contentView.removeChildView(view);
      this.views.delete(k);
      if (this.activeKey === k) this.activeKey = null;
    });
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

  activeIndex(): number | null {
    return this.activeKey ? Number(this.activeKey.split(':')[0]) : null;
  }

  isShowing(index: number, surface: Surface): boolean {
    return this.activeKey === key(index, surface);
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

  setZoomForIndex(index: number, level: number): void {
    for (const surface of ['mail', 'calendar'] as Surface[]) {
      const v = this.views.get(key(index, surface));
      if (v) v.webContents.setZoomLevel(level);
    }
  }
  getActiveZoomLevel(): number {
    if (!this.activeKey) return 0;
    return this.views.get(this.activeKey)?.webContents.getZoomLevel() ?? 0;
  }

  // Opens a specific Gmail thread in the account's mail view via a hash-only
  // navigation (instant SPA route, no reload).
  openMailThread(index: number, threadId: string): void {
    const wc = this.views.get(key(index, 'mail'))?.webContents;
    if (!wc || wc.isDestroyed()) return;
    void wc.executeJavaScript(`location.hash = ${JSON.stringify(`#inbox/${threadId}`)}`);
  }

  pushNotifyAllowed(index: number, surface: Surface, allowed: boolean): void {
    const wc = this.views.get(key(index, surface))?.webContents;
    if (!wc || wc.isDestroyed()) return;
    wc.send(IPC.NOTIFY_ALLOWED, allowed);
  }
}
