'use client';

import { useCallback, useEffect, useState } from 'react';
import { SettingsPanel } from './SettingsPanel';
import { Topbar } from './Topbar';
import type {
  MailDropItem,
  MailDropCopyProgress,
  MailDropCopyResult,
  MailDropCopyMode,
  MailDropExisting,
} from './MailDropModal';
import { getStrings } from './strings';
import type { Surface } from '../lib/surfaces';
import { googleAppTarget } from '../lib/google-apps';
import type { NativeMenuItem } from '../lib/native-menu';
import type { ChangelogVersion } from './changelog-types';
import type { ReconnectAccount } from './reconnect-text';
import type { OAuthStatusReport } from '../lib/oauth-status';
import type { ComposeAccountAsk } from '../lib/compose-account';
import type { MailDropFolderStatus } from '../../electron/core/ipc';
import type { ToastAction, ToastState } from '../lib/toast';

// The page that carries the bar and the settings panel: all state and all IPC live
// here, the drawing lives in Topbar and SettingsPanel. The Prefs, UpdateState and
// DownloadRecord shapes are copied from electron/ rather than imported, because an
// `import type` from the main process pulls Electron into this page's bundle.
//
// A provisional tab comes from the remembered bar before detection has recovered its
// address. Main cannot open one, so it is never marked active and a click on it is
// remembered by address. An app opening outside the app must not move the active tab, or
// the bar points at a tab with no view behind it.


//===========================
// Types
//===========================

export interface Profile {
  key: string;
  kind: 'authuser' | 'delegated';
  index: number;
  email: string;
  name: string;
  avatarUrl: string;
  color: string;
  hasCalendar: boolean;
  order?: number;
  label?: string;
  provisional?: boolean;
  hasMail?: boolean;
}
export type { Surface };

export type UpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'dev';

export interface UpdateStatus {
  state: UpdateState;
  currentVersion?: string;
  version?: string;
  percent?: number;
  message?: string;
}

export interface AccountPref {
  order?: number;
  label?: string;
  zoom?: number;
  notify?: boolean;
  calendarNotify?: boolean;
  badgeCount?: boolean;
  notifySound?: boolean;
  notifyPersist?: boolean;
}
export interface Prefs {
  window: { width: number; height: number; x?: number; y?: number; maximized: boolean };
  autoStart: boolean;
  launchMinimized: boolean;
  theme: 'system' | 'light' | 'dark';
  notificationOpen: 'app' | 'window';
  notifications: {
    dnd: boolean;
    dndUntil?: number;
    quietHours: { enabled: boolean; start: string; end: string };
    showSender: boolean;
    showSubject: boolean;
    sound: boolean;
    soundName: string;
    volume: number;
    googleApps: boolean;
  };
  accounts: Record<string, AccountPref>;
  mailDrop: { folder: string };
  appearance: {
    showUnreadBadges: boolean;
    tray: { enabled: boolean; selectUnreadOnClick: boolean; color: 'system' | 'light' | 'dark' };
    restrictMinWindowSize: boolean;
  };
  downloads: {
    folder: string;
    saveAsDialog: boolean;
    openFolderWhenDone: boolean;
    notify: boolean;
    notifyClick: DownloadClickAction;
  };
  phishing: { confirmExternalLinks: boolean; trustedHosts: string[] };
  updates: { autoCheck: boolean; notify: boolean; beta: boolean };
  googleApps: {
    openInApp: boolean;
    alwaysNewWindow: boolean;
    excluded: string[];
    showAccountLabel: boolean;
    showAccountColor: boolean;
    pinned: string[];
  };
  verificationCodes: {
    autoCopy: boolean;
    confidence: 'medium' | 'high';
    markRead: boolean;
    deleteAfter: boolean;
  };
  advanced: { hardwareAcceleration: boolean };
  reneMode: boolean;
  language: 'system' | 'en' | 'nl';
  locale: 'en' | 'nl';
}

export interface DownloadRecord {
  filename: string;
  path: string;
  url: string;
  bytes: number;
  startedAt: number;
  state: 'completed' | 'cancelled' | 'interrupted';
}

export type DownloadClickAction = 'show-in-folder' | 'open-file' | 'nothing';

interface DesktopBridge {
  onProfilesChanged(cb: (profiles: Profile[]) => void): void;
  onUnreadChanged(cb: (counts: Record<string, number>) => void): void;
  onActiveChanged(cb: (active: { key: string; surface: Surface } | null) => void): void;
  getActive(): Promise<{ key: string; surface: Surface } | null>;
  switchSurface(key: string, surface: Surface): void;
  redetect(): void;
  addAccount(): void;
  addDelegated(): void;
  setColor(email: string, color: string): void;
  removeAccount(email: string): void;
  toggleSettings(open: boolean): void;
  popupMenu(items: NativeMenuItem[]): Promise<string | null>;
  onSettingsForceClose(cb: () => void): void;
  onSettingsForceOpen(cb: () => void): void;
  checkForUpdate(): void;
  downloadUpdate(): void;
  installUpdate(): void;
  onUpdateStatus(cb: (status: UpdateStatus) => void): void;
  setAutoStart(v: boolean): void;
  setLaunchMinimized(v: boolean): void;
  setAppearance(patch: {
    showUnreadBadges?: boolean;
    tray?: { enabled?: boolean; selectUnreadOnClick?: boolean };
    restrictMinWindowSize?: boolean;
  }): void;
  setDownloadPrefs(patch: {
    folder?: string;
    saveAsDialog?: boolean;
    openFolderWhenDone?: boolean;
    notify?: boolean;
    notifyClick?: DownloadClickAction;
  }): void;
  setPhishing(patch: { confirmExternalLinks?: boolean; trustedHosts?: string[] }): void;
  setUpdatePrefs(patch: { autoCheck?: boolean; notify?: boolean; beta?: boolean }): void;
  setAdvanced(patch: { hardwareAcceleration?: boolean }): void;
  setVerificationCodes(patch: {
    autoCopy?: boolean;
    confidence?: 'medium' | 'high';
    markRead?: boolean;
    deleteAfter?: boolean;
  }): void;
  getDownloadHistory(): Promise<DownloadRecord[]>;
  clearDownloadHistory(): void;
  revealDownload(path: string): void;
  openDownload(path: string): void;
  onDownloadHistoryChanged(cb: () => void): void;
  onPlayNotificationSound(cb: (arg: { name: string; volume: number }) => void): void;
  setGoogleApps(patch: {
    openInApp?: boolean;
    alwaysNewWindow?: boolean;
    excluded?: string[];
    showAccountLabel?: boolean;
    showAccountColor?: boolean;
    pinned?: string[];
  }): void;
  setNotificationExtras(patch: {
    showSender?: boolean;
    showSubject?: boolean;
    sound?: boolean;
    soundName?: string;
    volume?: number;
    googleApps?: boolean;
  }): void;
  testNotification(): void;
  pickDownloadFolder(): Promise<string>;
  onPrefsChanged(cb: (prefs: Prefs) => void): void;
  setAccountPref(arg: { email: string; label?: string; notify?: boolean; calendarNotify?: boolean; badgeCount?: boolean; notifySound?: boolean; notifyPersist?: boolean }): void;
  setAccountOrder(emails: string[]): void;
  setNotifications(arg: { dnd: boolean; quietHours: { enabled: boolean; start: string; end: string } }): void;
  setTheme(theme: 'system' | 'light' | 'dark'): void;
  setLanguage(v: 'system' | 'en' | 'nl'): void;
  setNotificationOpen(v: 'app' | 'window'): void;
  setReneMode(v: boolean): void;
  requestDefaultMail(): void;
  isOverlay: boolean;
  onMailDropPreview(cb: (arg: { items: MailDropItem[] }) => void): void;
  closeMailDropPreview(): void;
  getMailDropPreview(): Promise<{ items: MailDropItem[] }>;
  getLabels(): Promise<{ accounts: { email: string; labels: { id: string; name: string }[]; error?: string }[] }>;
  getMailDropExisting(): Promise<MailDropExisting>;
  onMailDropExisting(cb: (arg: MailDropExisting) => void): void;
  copyMailDrop(
    targets: { email: string; labelIds: string[] }[],
    mode?: MailDropCopyMode,
  ): Promise<MailDropCopyResult>;
  onMailDropCopyProgress(cb: (arg: MailDropCopyProgress) => void): void;
  onReconnectList(cb: (arg: { accounts: ReconnectAccount[] }) => void): void;
  getReconnectList(): Promise<{ accounts: ReconnectAccount[] }>;
  reconnectOAuth(email: string): Promise<{ ok: boolean; error?: string }>;
  getOAuthStatus(): Promise<OAuthStatusReport>;
  onOAuthStatus(cb: (arg: OAuthStatusReport) => void): void;
  importOAuthConfig(): Promise<{ ok: boolean; invalid?: boolean }>;
  getMailDropFolder(): Promise<MailDropFolderStatus>;
  pickMailDropFolder(): Promise<MailDropFolderStatus>;
  openMailDropFolder(): void;
  onDefaultMailStatus(cb: (isDefault: boolean) => void): void;
  getChangelog(): Promise<ChangelogVersion[]>;
  onComposeAccountAsk(cb: (arg: ComposeAccountAsk) => void): void;
  pickComposeAccount(index: number | null): void;
  reportComposeAccountSize(size: { width: number; height: number }): void;
  onToastState(cb: (state: ToastState) => void): void;
  toastReady(): void;
  onToastHoverEnd(cb: () => void): void;
  reportToastSize(size: { width: number; height: number }): void;
  activateToast(id: string): void;
  dismissToast(id: string): void;
  dismissAllToasts(): void;
  runToastAction(arg: { id: string; action: ToastAction }): void;
  setToastHovered(hovered: boolean): void;
}

declare global {
  interface Window {
    desktop?: DesktopBridge;
  }
}


//===========================
// Page
//===========================

export default function AppShell() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [active, setActive] = useState<{ key: string; surface: Surface } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [update, setUpdate] = useState<UpdateStatus>({ state: 'idle' });
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const S = getStrings(prefs?.locale ?? 'en', prefs?.reneMode === true);
  const [isDefaultMail, setIsDefaultMail] = useState(false);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);

  useEffect(() => {
    const bridge = window.desktop;
    if (!bridge) return;
    bridge.onProfilesChanged((list) => {
      setProfiles(list);
      // only until main has spoken: the first non-provisional tab is a different question,
      // and at startup a ready delegated mailbox would win over authuser 0's mail
      setActive((cur) => {
        if (cur) return cur;
        const first = list.find((p) => !p.provisional);
        return first ? { key: first.key, surface: 'mail' } : null;
      });
    });
    bridge.onActiveChanged((a) => setActive(a));
    void bridge.getActive().then((a) => {
      if (a) setActive(a);
    });
    bridge.onUnreadChanged(setUnread);
    bridge.onSettingsForceClose(() => setSettingsOpen(false));
    bridge.onSettingsForceOpen(() => setSettingsOpen(true));
    bridge.onUpdateStatus(setUpdate);
    bridge.onPrefsChanged((p) => setPrefs(p as Prefs));
    bridge.onDefaultMailStatus(setIsDefaultMail);
  }, []);

  const popupMenu = useCallback(
    async (items: NativeMenuItem[]) => (await window.desktop?.popupMenu(items)) ?? null,
    [],
  );

  useEffect(() => {
    if (!pendingEmail) return;
    const row = profiles.find((p) => p.email.toLowerCase() === pendingEmail);
    if (!row) {
      setPendingEmail(null);
      return;
    }
    if (row.provisional) return;
    setPendingEmail(null);
    // Same guard as `open()` below: a row that settled into a URL-less delegated mailbox
    // has nothing for ensureView to load. Without this the tab would highlight as active
    // while its view never opens.
    if (row.kind === 'delegated' && row.hasMail === false) return;
    setActive({ key: row.key, surface: 'mail' });
    window.desktop?.switchSurface(row.key, 'mail');
  }, [profiles, pendingEmail]);

  useEffect(() => {
    const choice = prefs?.theme ?? 'system';
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = choice === 'dark' || (choice === 'system' && mq.matches);
      document.documentElement.classList.toggle('dark', dark);
      document.documentElement.classList.toggle('light', !dark);
    };
    apply();
    if (choice === 'system') {
      mq.addEventListener('change', apply);
      return () => mq.removeEventListener('change', apply);
    }
  }, [prefs?.theme]);

  function open(key: string, surface: Surface) {
    if (settingsOpen) setSettingsOpen(false);
    const row = profiles.find((p) => p.key === key);
    if (row?.provisional) {
      setPendingEmail(row.email.toLowerCase());
      return;
    }
    // Known by address, with no URL to load. Opening it would reach
    // SURFACE_CONFIG.mail.url and throw; the tooltip is what tells the user why.
    if (row && row.kind === 'delegated' && row.hasMail === false) return;
    setPendingEmail(null);
    const target =
      surface === 'mail' || !prefs
        ? 'in-app'
        : googleAppTarget(surface, prefs.googleApps);
    if (target !== 'external') setActive({ key, surface });
    window.desktop?.switchSurface(key, surface);
  }
  function addAccount() {
    if (settingsOpen) setSettingsOpen(false);
    window.desktop?.addAccount();
  }
  function addDelegated() {
    if (settingsOpen) setSettingsOpen(false);
    // Nothing to track here any more. This used to raise a "looking…" state that a
    // suggestion message cleared; discovery now asks the relay and whatever it finds arrives
    // through onProfilesChanged like any other account, so the tab appearing in the bar is
    // the feedback.
    window.desktop?.addDelegated();
  }
  function redetect() {
    if (settingsOpen) setSettingsOpen(false);
    window.desktop?.redetect();
  }
  function openSettings() {
    setSettingsOpen(true);
    window.desktop?.toggleSettings(true);
  }
  function closeSettings() {
    setSettingsOpen(false);
    window.desktop?.toggleSettings(false);
  }
  function reorder(fromEmail: string, toEmail: string) {
    if (fromEmail === toEmail) return;
    const emails = profiles.map((p) => p.email);
    const from = emails.indexOf(fromEmail);
    const to = emails.indexOf(toEmail);
    if (from < 0 || to < 0) return;
    emails.splice(to, 0, emails.splice(from, 1)[0]);
    window.desktop?.setAccountOrder(emails);
  }

  return (
    <div className="flex h-screen w-full flex-col bg-neutral-100 text-neutral-800 dark:bg-neutral-950 dark:text-neutral-200">
      <Topbar
        profiles={profiles}
        unread={unread}
        prefs={prefs}
        active={active}
        labelFor={displayName}
        settingsOpen={settingsOpen}
        update={update}
        strings={S}
        onOpen={open}
        onPopupMenu={popupMenu}
        onAddAccount={addAccount}
        onAddDelegated={addDelegated}
        onOpenSettings={openSettings}
        onInstallUpdate={() => window.desktop?.installUpdate()}
        onReorder={reorder}
      />

      {settingsOpen && (
        <SettingsPanel
          profiles={profiles}
          onClose={closeSettings}
          onRedetect={redetect}
          update={update}
          onCheckUpdate={() => window.desktop?.checkForUpdate()}
          onDownloadUpdate={() => window.desktop?.downloadUpdate()}
          onInstallUpdate={() => window.desktop?.installUpdate()}
          prefs={prefs}
          onSetAutoStart={(v) => window.desktop?.setAutoStart(v)}
          onSetLaunchMinimized={(v) => window.desktop?.setLaunchMinimized(v)}
          onSetNotifications={(a) => window.desktop?.setNotifications(a)}
          isDefaultMail={isDefaultMail}
          onRequestDefaultMail={() => window.desktop?.requestDefaultMail()}
        />
      )}
    </div>
  );
}


//===========================
// Helper functions
//===========================

function displayName(p: Profile): string {
  return (p.label && p.label.trim()) || p.name || p.email;
}
