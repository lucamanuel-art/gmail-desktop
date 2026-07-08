'use client';

import { useEffect, useState } from 'react';
import { SettingsPanel } from './SettingsPanel';
import { CALENDAR_ICON_DATA_URI } from './calendar-icon-data';
import { getStrings } from './strings';
import type { ChangelogVersion } from './changelog-types';

export interface Profile {
  index: number;
  email: string;
  name: string;
  avatarUrl: string;
  color: string;
  order?: number;
  label?: string;
}
export type Surface = 'mail' | 'calendar';

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
}
export interface Prefs {
  window: { width: number; height: number; x?: number; y?: number; maximized: boolean };
  autoStart: boolean;
  theme: 'system' | 'light' | 'dark';
  notificationOpen: 'app' | 'window';
  notifications: { dnd: boolean; quietHours: { enabled: boolean; start: string; end: string } };
  accounts: Record<string, AccountPref>;
  reneMode: boolean;
}

interface DesktopBridge {
  onProfilesChanged(cb: (profiles: Profile[]) => void): void;
  onUnreadChanged(cb: (counts: Record<number, number>) => void): void;
  switchSurface(index: number, surface: Surface): void;
  redetect(): void;
  addAccount(): void;
  setColor(email: string, color: string): void;
  removeAccount(email: string): void;
  toggleSettings(open: boolean): void;
  onSettingsForceClose(cb: () => void): void;
  onSettingsForceOpen(cb: () => void): void;
  checkForUpdate(): void;
  downloadUpdate(): void;
  installUpdate(): void;
  onUpdateStatus(cb: (status: UpdateStatus) => void): void;
  setAutoStart(v: boolean): void;
  onPrefsChanged(cb: (prefs: Prefs) => void): void;
  setAccountPref(arg: { email: string; label?: string; notify?: boolean; calendarNotify?: boolean }): void;
  setAccountOrder(emails: string[]): void;
  setNotifications(arg: { dnd: boolean; quietHours: { enabled: boolean; start: string; end: string } }): void;
  setTheme(theme: 'system' | 'light' | 'dark'): void;
  setNotificationOpen(v: 'app' | 'window'): void;
  setReneMode(v: boolean): void;
  getChangelog(): Promise<ChangelogVersion[]>;
}

declare global {
  interface Window {
    desktop?: DesktopBridge;
  }
}

function initial(p: Profile): string {
  return (p.name || p.email || '?').trim().charAt(0).toUpperCase() || '?';
}

function displayName(p: Profile): string {
  return (p.label && p.label.trim()) || p.name || p.email;
}

function CalendarIcon({ className = '' }: { className?: string }) {
  return (
    <img
      src={CALENDAR_ICON_DATA_URI}
      alt=""
      draggable={false}
      className={className}
    />
  );
}

function PlusIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function GearIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.09A1.65 1.65 0 0 0 9 4.6V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

export default function Sidebar() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [unread, setUnread] = useState<Record<number, number>>({});
  const [active, setActive] = useState<{ index: number; surface: Surface } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [brokenAvatars, setBrokenAvatars] = useState<Record<string, boolean>>({});
  const [update, setUpdate] = useState<UpdateStatus>({ state: 'idle' });
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [dragEmail, setDragEmail] = useState<string | null>(null);
  const S = getStrings(prefs?.reneMode === true);

  useEffect(() => {
    const bridge = window.desktop;
    if (!bridge) return;
    bridge.onProfilesChanged((list) => {
      setProfiles(list);
      // Keep the active selection valid: re-derive if the active profile vanished.
      setActive((cur) => {
        if (cur && list.some((p) => p.index === cur.index)) return cur;
        return list[0] ? { index: list[0].index, surface: 'mail' } : null;
      });
    });
    bridge.onUnreadChanged(setUnread);
    bridge.onSettingsForceClose(() => setSettingsOpen(false));
    bridge.onSettingsForceOpen(() => setSettingsOpen(true));
    bridge.onUpdateStatus(setUpdate);
    bridge.onPrefsChanged((p) => setPrefs(p as Prefs));
  }, []);

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

  function open(index: number, surface: Surface) {
    if (settingsOpen) setSettingsOpen(false);
    setActive({ index, surface });
    window.desktop?.switchSurface(index, surface);
  }
  function addAccount() {
    if (settingsOpen) setSettingsOpen(false);
    window.desktop?.addAccount();
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
  function onDrop(targetEmail: string) {
    if (!dragEmail || dragEmail === targetEmail) return;
    const emails = profiles.map((p) => p.email);
    const from = emails.indexOf(dragEmail);
    const to = emails.indexOf(targetEmail);
    if (from < 0 || to < 0) return;
    emails.splice(to, 0, emails.splice(from, 1)[0]);
    window.desktop?.setAccountOrder(emails);
    setDragEmail(null);
  }

  return (
    <div className="flex h-screen w-full bg-neutral-100 text-neutral-800 dark:bg-neutral-950 dark:text-neutral-200">
      <nav className="flex w-[72px] shrink-0 flex-col items-center gap-2 py-4">
        {profiles.map((p) => {
          const mailActive = active?.index === p.index && active.surface === 'mail';
          const calActive = active?.index === p.index && active.surface === 'calendar';
          const showImg = p.avatarUrl && !brokenAvatars[p.avatarUrl];
          const count = unread[p.index] ?? 0;
          return (
            <div
              key={p.index}
              draggable
              onDragStart={() => setDragEmail(p.email)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDrop(p.email)}
              onDragEnd={() => setDragEmail(null)}
              className={`flex flex-col items-center gap-1.5 ${dragEmail === p.email ? 'opacity-40' : ''}`}
            >
              <div className="relative">
                <button
                  onClick={() => open(p.index, 'mail')}
                  title={displayName(p)}
                  className={`flex h-11 w-11 items-center justify-center overflow-hidden rounded-full text-sm font-semibold text-white transition-all duration-150 ${
                    mailActive
                      ? 'ring-2 ring-white ring-offset-2 ring-offset-neutral-100 dark:ring-offset-neutral-950'
                      : 'opacity-85 hover:opacity-100 hover:ring-2 hover:ring-white/40'
                  }`}
                  style={{ backgroundColor: p.color }}
                >
                  {showImg ? (
                    <img
                      src={p.avatarUrl}
                      alt=""
                      referrerPolicy="no-referrer"
                      onError={() =>
                        setBrokenAvatars((b) => ({ ...b, [p.avatarUrl]: true }))
                      }
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    initial(p)
                  )}
                </button>
                {count > 0 && (
                  <span className="pointer-events-none absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-neutral-100 dark:ring-neutral-950">
                    {count > 99 ? '99+' : count}
                  </span>
                )}
              </div>
              <button
                onClick={() => open(p.index, 'calendar')}
                title={`${displayName(p)}${S.calendarTooltipSuffix}`}
                className={`flex h-6 w-6 items-center justify-center rounded-md transition ${
                  calActive
                    ? 'bg-black/10 ring-1 ring-black/20 dark:bg-white/15 dark:ring-white/30'
                    : 'opacity-70 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10'
                }`}
              >
                <CalendarIcon className="h-5 w-5" />
              </button>
            </div>
          );
        })}

        <div className="my-1 h-px w-8 shrink-0 bg-black/10 dark:bg-white/10" />

        <button
          onClick={addAccount}
          title={S.addAccountTooltip}
          className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-dashed border-black/20 text-neutral-500 transition hover:border-black/40 hover:text-neutral-900 dark:border-white/20 dark:text-neutral-400 dark:hover:border-white/40 dark:hover:text-white"
        >
          <PlusIcon className="h-5 w-5" />
        </button>

        <div className="mt-auto">
          <button
            onClick={openSettings}
            title={S.settingsTooltip}
            className={`flex h-10 w-10 items-center justify-center rounded-full transition ${
              settingsOpen
                ? 'bg-black/10 text-neutral-900 dark:bg-white/15 dark:text-white'
                : 'text-neutral-500 hover:bg-black/5 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-white/10 dark:hover:text-white'
            }`}
          >
            <GearIcon className="h-5 w-5" />
          </button>
        </div>
      </nav>

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
          onSetNotifications={(a) => window.desktop?.setNotifications(a)}
        />
      )}
    </div>
  );
}
