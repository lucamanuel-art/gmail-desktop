import { BrowserWindow, WebContentsView } from 'electron';
import { contentBounds } from './layout';
import { IPC } from './ipc';
import { attachExternalLinkHandling } from './external-links';
import type { KeyInput } from './shortcuts';
import { SURFACES, SURFACE_CONFIG, surfaceForUrl, type Surface } from '../renderer/lib/surfaces';
import { accountKey, type AccountRef } from './account-ref';

export type { Surface };

export interface Profile {
  // Self-describing account identity: an authuser slot or a delegated mailbox.
  // Replaces the bare integer index that used to be threaded everywhere.
  ref: AccountRef;
  kind: AccountRef['kind'];
  email: string;
  name: string;
  avatarUrl: string;
  color: string;
  order?: number;
  label?: string;
}

const SESSION_PARTITION = 'persist:google';
// View-map key: "<accountKey>:<surface>". accountKey may itself contain ':'
// (delegated keys are "d:<email>"), so split on the LAST ':' to recover it.
const viewKey = (acctKey: string, surface: Surface) => `${acctKey}:${surface}`;
const acctKeyOfViewKey = (vk: string) => vk.slice(0, vk.lastIndexOf(':'));

export class ProfileViewManager {
  private views = new Map<string, WebContentsView>();
  private activeViewKey: string | null = null;
  // Views whose notification click the app just handled itself: Gmail's own
  // click handler fires window.open with the same thread shortly after, which
  // must be suppressed (it would open a duplicate window / force a reload).
  private notifClickUntil = new Map<string, number>();
  // Views for which the app is actively triggering Gmail's pop-out button, so
  // the resulting pop-out window.open should be allowed through (vs Gmail's own
  // auto pop-out on a notification click, which is suppressed).
  private popoutExpectUntil = new Map<string, number>();

  constructor(
    private readonly win: BrowserWindow,
    private readonly preloadPath: string,
    private readonly onUnread: (accountKey: string, count: number) => void,
    private readonly onActivate: (accountKey: string, surface: Surface, threadId?: string) => void,
    private readonly onIdentity: (
      accountKey: string,
      identity: { email: string; name: string; avatarUrl: string },
    ) => void,
    private readonly onInput: (accountKey: string, input: KeyInput) => void,
    private readonly getZoom: (accountKey: string) => number,
    private readonly getOpenMode: () => 'app' | 'window',
    // Zoom factor of the sidebar renderer (2 in Rene mode) — the content view
    // must sit past the visually wider sidebar.
    private readonly getUiScale: () => number = () => 1,
  ) {
    this.win.on('resize', () => this.relayout());
  }

  ensureView(ref: AccountRef, surface: Surface, visible: boolean, urlOverride?: string): void {
    if (this.win.isDestroyed()) return;
    const acctKey = accountKey(ref);
    const k = viewKey(acctKey, surface);
    if (this.views.has(k)) {
      if (visible) this.show(ref, surface);
      return;
    }
    const view = new WebContentsView({
      webPreferences: {
        preload: this.preloadPath,
        partition: SESSION_PARTITION,
        contextIsolation: false,
        backgroundThrottling: SURFACE_CONFIG[surface].backgroundThrottling,
      },
    });
    attachExternalLinkHandling(view.webContents, {
      getOpenMode: this.getOpenMode,
      openInApp: (url) => this.openInOwningSurface(ref, surface, url),
      isNotificationClickInFlight: () => Date.now() < (this.notifClickUntil.get(k) ?? 0),
      isPopoutExpected: () => Date.now() < (this.popoutExpectUntil.get(k) ?? 0),
    });
    view.webContents.on('ipc-message', (_e, channel, ...args) => {
      if (surface === 'mail') {
        if (channel === IPC.UNREAD_UPDATE) this.onUnread(acctKey, Number(args[0]) || 0);
        else if (channel === IPC.ACCOUNT_IDENTITY) this.onIdentity(acctKey, args[0]);
      }
      if (channel === IPC.NOTIFICATION_ACTIVATE) {
        this.onActivate(acctKey, surface, typeof args[0] === 'string' ? args[0] : undefined);
      }
    });
    void view.webContents.loadURL(urlOverride ?? SURFACE_CONFIG[surface].url(ref));
    view.webContents.on('before-input-event', (_e, input) => this.onInput(acctKey, input as unknown as KeyInput));
    view.webContents.on('did-finish-load', () => {
      view.webContents.setZoomLevel(this.getZoom(acctKey));
    });
    // A Google page can close itself (e.g. Gmail's full-page compose calls
    // window.close() after sending). Drop the dead view from the map so timers
    // like refreshNotifyAllowed don't crash on a destroyed webContents.
    view.webContents.once('destroyed', () => {
      if (this.views.get(k) !== view) return;
      this.views.delete(k);
      if (this.activeViewKey === k) this.activeViewKey = null;
      // On app quit the window is torn down before its views; touching
      // contentView then throws "Object has been destroyed".
      if (this.win.isDestroyed()) return;
      try {
        this.win.contentView.removeChildView(view);
      } catch {
        // View/window already gone during teardown — nothing to detach.
      }
    });
    this.win.contentView.addChildView(view);
    view.setVisible(false);
    this.views.set(k, view);
    if (visible) this.show(ref, surface);
  }

  show(ref: AccountRef, surface: Surface): void {
    if (this.win.isDestroyed()) return;
    this.ensureView(ref, surface, false);
    const k = viewKey(accountKey(ref), surface);
    const view = this.views.get(k);
    if (!view) return;
    for (const [vk, v] of this.views) v.setVisible(vk === k);
    this.activeViewKey = k;
    this.applyBounds(view);
  }

  activeKey(): string | null {
    return this.activeViewKey ? acctKeyOfViewKey(this.activeViewKey) : null;
  }

  isShowing(accountKey: string, surface: Surface): boolean {
    return this.activeViewKey === viewKey(accountKey, surface);
  }

  discardView(accountKey: string, surface: Surface): void {
    const k = viewKey(accountKey, surface);
    const view = this.views.get(k);
    if (!view) return;
    this.win.contentView.removeChildView(view);
    view.webContents.close();
    this.views.delete(k);
    if (this.activeViewKey === k) this.activeViewKey = null;
  }

  hideAll(): void {
    for (const v of this.views.values()) v.setVisible(false);
  }

  showActive(): void {
    if (this.activeViewKey) {
      const view = this.views.get(this.activeViewKey);
      if (view) {
        view.setVisible(true);
        this.applyBounds(view);
      }
    }
  }

  relayout(): void {
    if (this.activeViewKey) {
      const view = this.views.get(this.activeViewKey);
      if (view) this.applyBounds(view);
    }
  }

  private applyBounds(view: WebContentsView): void {
    // The window can be torn down while a hidden view is still around; touching
    // its contentView/getContentSize then throws "Object has been destroyed".
    if (this.win.isDestroyed()) return;
    const [width, height] = this.win.getContentSize();
    view.setBounds(contentBounds({ width, height }, this.getUiScale()));
  }

  // An in-app popup opens in the view of the surface that owns its URL (a Docs
  // link in an email must not replace the mail view with the document); URLs no
  // surface owns (e.g. an accounts.google.com popup) load in the view that
  // opened them, as before.
  private openInOwningSurface(ref: AccountRef, from: Surface, url: string): void {
    const target = surfaceForUrl(url) ?? from;
    this.ensureView(ref, target, false);
    const wc = this.views.get(viewKey(accountKey(ref), target))?.webContents;
    if (!wc || wc.isDestroyed()) return;
    void wc.loadURL(url);
    this.onActivate(accountKey(ref), target); // brings the window forward and shows the surface
  }

  setZoomForKey(accountKey: string, level: number): void {
    for (const surface of SURFACES) {
      const v = this.views.get(viewKey(accountKey, surface));
      if (v) v.webContents.setZoomLevel(level);
    }
  }
  getActiveZoomLevel(): number {
    if (!this.activeViewKey) return 0;
    return this.views.get(this.activeViewKey)?.webContents.getZoomLevel() ?? 0;
  }

  markNotificationClickHandled(accountKey: string, surface: Surface, windowMs = 2500): void {
    this.notifClickUntil.set(viewKey(accountKey, surface), Date.now() + windowMs);
  }

  // Opens a specific Gmail thread in the account's mail view via a hash-only
  // navigation (instant SPA route, no reload).
  openMailThread(accountKey: string, threadId: string): void {
    const wc = this.views.get(viewKey(accountKey, 'mail'))?.webContents;
    if (!wc || wc.isDestroyed()) return;
    void wc.executeJavaScript(`location.hash = ${JSON.stringify(`#inbox/${threadId}`)}`);
  }

  // Triggers Gmail's own "open in a new window" (pop-out) button in the mail
  // view. Only Gmail itself can open a working pop-out — the page needs the
  // opener that set up its content feed — so we click the real button and let
  // the resulting window.open through (a pop-out URL is always allowed). The
  // caller must have opened the thread first so the button exists. Matched by
  // Gmail's stable jslog action id, then a localized aria-label as a fallback.
  // Resolves true once clicked, false if the button never appears (~3s).
  async popOutThread(accountKey: string): Promise<boolean> {
    const k = viewKey(accountKey, 'mail');
    const wc = this.views.get(k)?.webContents;
    if (!wc || wc.isDestroyed()) return false;
    // Allow the pop-out window.open that our button click is about to produce.
    this.popoutExpectUntil.set(k, Date.now() + 6000);
    const clickScript = `(() => {
      const byLog = Array.from(document.querySelectorAll('button[jslog],[role="button"][jslog]'))
        .find((b) => /(?:^|[;\\s])170693(?:[;\\s]|$)/.test(b.getAttribute('jslog') || ''));
      const byLabel = () => Array.from(document.querySelectorAll('[aria-label]'))
        .find((b) => /nieuw venster|new window|nouvelle fen|neues fenster|nueva ventana|ventana nueva/i
          .test(b.getAttribute('aria-label') || ''));
      const btn = byLog || byLabel();
      if (btn) { btn.click(); return true; }
      return false;
    })()`;
    for (let i = 0; i < 12; i++) {
      const clicked = await wc.executeJavaScript(clickScript).catch(() => false);
      if (clicked) return true;
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
  }

  pushNotifyAllowed(accountKey: string, surface: Surface, allowed: boolean): void {
    const wc = this.views.get(viewKey(accountKey, surface))?.webContents;
    if (!wc || wc.isDestroyed()) return;
    wc.send(IPC.NOTIFY_ALLOWED, allowed);
  }
}
