'use client';

import { useEffect, useState } from 'react';
import { SettingsPanel } from './SettingsPanel';
import { CALENDAR_ICON_DATA_URI } from './calendar-icon-data';
import { getStrings } from './strings';
import { APP_SURFACES, SURFACE_CONFIG, type Surface } from '../lib/surfaces';
import { APP_ICONS, WaffleIcon } from './app-icons';
import type { ChangelogVersion } from './changelog-types';

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
}
export type { Surface };

export interface DelegatedSuggestion {
  email: string;
  mailUrl: string;
}

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
  onUnreadChanged(cb: (counts: Record<string, number>) => void): void;
  switchSurface(key: string, surface: Surface): void;
  redetect(): void;
  addAccount(): void;
  addDelegated(): void;
  addDelegatedSuggestion(arg: { email: string; mailUrl: string }): void;
  onDelegatedSuggestions(cb: (arg: { suggestions: DelegatedSuggestion[] }) => void): void;
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

// A small corner badge marking a profile as a delegated mailbox (someone else's
// inbox you have access to), so it's distinguishable from your own accounts.
function DelegatedBadge({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
    </svg>
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
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [active, setActive] = useState<{ key: string; surface: Surface } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [brokenAvatars, setBrokenAvatars] = useState<Record<string, boolean>>({});
  const [update, setUpdate] = useState<UpdateStatus>({ state: 'idle' });
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [dragEmail, setDragEmail] = useState<string | null>(null);
  const [plusOpen, setPlusOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<DelegatedSuggestion[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanDone, setScanDone] = useState(false);
  const S = getStrings(prefs?.reneMode === true);
  // Account key whose waffle (Google apps) flyout is expanded; one at a time.
  const [appsOpenFor, setAppsOpenFor] = useState<string | null>(null);

  useEffect(() => {
    const bridge = window.desktop;
    if (!bridge) return;
    bridge.onProfilesChanged((list) => {
      setProfiles(list);
      // Keep the active selection valid: re-derive if the active profile vanished.
      setActive((cur) => {
        if (cur && list.some((p) => p.key === cur.key)) return cur;
        return list[0] ? { key: list[0].key, surface: 'mail' } : null;
      });
    });
    bridge.onUnreadChanged(setUnread);
    bridge.onDelegatedSuggestions(({ suggestions: s }) => {
      setSuggestions(s);
      setScanning(false);
      setScanDone(true);
    });
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

  function open(key: string, surface: Surface) {
    if (settingsOpen) setSettingsOpen(false);
    setAppsOpenFor(null);
    setPlusOpen(false);
    setActive({ key, surface });
    window.desktop?.switchSurface(key, surface);
  }
  function toggleApps(key: string) {
    setAppsOpenFor((cur) => (cur === key ? null : key));
  }
  function addAccount() {
    if (settingsOpen) setSettingsOpen(false);
    setPlusOpen(false);
    window.desktop?.addAccount();
  }
  function addDelegated() {
    if (settingsOpen) setSettingsOpen(false);
    setScanning(true);
    setScanDone(false);
    window.desktop?.addDelegated();
  }
  function acceptSuggestion(s: DelegatedSuggestion) {
    setSuggestions((cur) => cur.filter((x) => x.email !== s.email));
    setPlusOpen(false);
    window.desktop?.addDelegatedSuggestion(s);
  }
  function redetect() {
    if (settingsOpen) setSettingsOpen(false);
    window.desktop?.redetect();
  }
  function openSettings() {
    setSettingsOpen(true);
    setAppsOpenFor(null);
    setPlusOpen(false);
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

  // Only suggest delegates we don't already have as a profile.
  const freshSuggestions = suggestions.filter(
    (s) => !profiles.some((p) => p.email.toLowerCase() === s.email.toLowerCase()),
  );

  return (
    <div className="flex h-screen w-full bg-neutral-100 text-neutral-800 dark:bg-neutral-950 dark:text-neutral-200">
      <nav className="flex w-[72px] shrink-0 flex-col items-center gap-2 py-4">
        {/* Scrollable so an expanded waffle never pushes settings off-screen. */}
        <div className="flex w-full flex-col items-center gap-2 overflow-y-auto [scrollbar-width:none]">
        {profiles.map((p) => {
          const mailActive = active?.key === p.key && active.surface === 'mail';
          const calActive = active?.key === p.key && active.surface === 'calendar';
          const appActive =
            active?.key === p.key && active.surface !== 'mail' && active.surface !== 'calendar';
          const appsOpen = appsOpenFor === p.key;
          const showImg = p.avatarUrl && !brokenAvatars[p.avatarUrl];
          const count = unread[p.key] ?? 0;
          const isDelegated = p.kind === 'delegated';
          return (
            <div
              key={p.key}
              draggable
              onDragStart={() => setDragEmail(p.email)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDrop(p.email)}
              onDragEnd={() => setDragEmail(null)}
              className={`flex flex-col items-center gap-1.5 ${dragEmail === p.email ? 'opacity-40' : ''}`}
            >
              <div className="relative">
                <button
                  onClick={() => open(p.key, 'mail')}
                  title={isDelegated ? `${displayName(p)} ${S.delegatedTooltipSuffix}` : displayName(p)}
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
                {isDelegated && (
                  <span
                    className="pointer-events-none absolute -bottom-0.5 -left-0.5 flex h-[16px] w-[16px] items-center justify-center rounded-full bg-neutral-700 text-white ring-2 ring-neutral-100 dark:bg-neutral-300 dark:text-neutral-900 dark:ring-neutral-950"
                    title={S.delegatedTooltipSuffix}
                  >
                    <DelegatedBadge className="h-[10px] w-[10px]" />
                  </span>
                )}
              </div>
              {p.hasCalendar && (
                <button
                  onClick={() => open(p.key, 'calendar')}
                  title={`${displayName(p)}${S.calendarTooltipSuffix}`}
                  className={`flex h-6 w-6 items-center justify-center rounded-md transition ${
                    calActive
                      ? 'bg-black/10 ring-1 ring-black/20 dark:bg-white/15 dark:ring-white/30'
                      : 'opacity-70 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10'
                  }`}
                >
                  <CalendarIcon className="h-5 w-5" />
                </button>
              )}
              {p.kind === 'authuser' && (
                <button
                  onClick={() => toggleApps(p.key)}
                  title={`${displayName(p)} — Google apps`}
                  className={`flex h-6 w-6 items-center justify-center rounded-md transition ${
                    appActive || appsOpen
                      ? 'bg-black/10 text-neutral-900 ring-1 ring-black/20 dark:bg-white/15 dark:text-white dark:ring-white/30'
                      : 'text-neutral-500 opacity-70 hover:bg-black/5 hover:opacity-100 dark:text-neutral-400 dark:hover:bg-white/10'
                  }`}
                >
                  <WaffleIcon className="h-4 w-4" />
                </button>
              )}
              {appsOpen && (
                <div className="grid grid-cols-2 gap-1 rounded-lg bg-black/5 p-1.5 dark:bg-white/5">
                  {APP_SURFACES.map((s) => {
                    const Icon = APP_ICONS[s];
                    const isActive = active?.key === p.key && active.surface === s;
                    return (
                      <button
                        key={s}
                        onClick={() => open(p.key, s)}
                        title={`${displayName(p)} — ${SURFACE_CONFIG[s].label}`}
                        className={`flex h-6 w-6 items-center justify-center rounded-md transition ${
                          isActive
                            ? 'bg-black/10 text-neutral-900 ring-1 ring-black/20 dark:bg-white/15 dark:text-white dark:ring-white/30'
                            : 'text-neutral-500 hover:bg-black/5 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-white/10 dark:hover:text-white'
                        }`}
                      >
                        {Icon && <Icon className="h-4 w-4" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        </div>

        <div className="my-1 h-px w-8 shrink-0 bg-black/10 dark:bg-white/10" />

        <div className="relative">
          <button
            onClick={() => setPlusOpen((v) => !v)}
            title={S.addAccountTooltip}
            className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-dashed border-black/20 text-neutral-500 transition hover:border-black/40 hover:text-neutral-900 dark:border-white/20 dark:text-neutral-400 dark:hover:border-white/40 dark:hover:text-white"
          >
            <PlusIcon className="h-5 w-5" />
          </button>
          {freshSuggestions.length > 0 && !plusOpen && (
            <span className="pointer-events-none absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-blue-500 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-neutral-100 dark:ring-neutral-950">
              {freshSuggestions.length}
            </span>
          )}
          {plusOpen && (
            <>
              {/* click-away backdrop */}
              <div className="fixed inset-0 z-10" onClick={() => setPlusOpen(false)} />
              <div className="absolute bottom-0 left-[60px] z-20 w-60 rounded-lg border border-black/10 bg-white p-1 shadow-xl dark:border-white/10 dark:bg-neutral-800">
                <button
                  onClick={addAccount}
                  className="flex w-full items-center rounded-md px-3 py-2 text-left text-sm text-neutral-800 hover:bg-black/5 dark:text-neutral-100 dark:hover:bg-white/10"
                >
                  {S.addAccountLabel}
                </button>
                <button
                  onClick={addDelegated}
                  className="flex w-full items-center rounded-md px-3 py-2 text-left text-sm text-neutral-800 hover:bg-black/5 dark:text-neutral-100 dark:hover:bg-white/10"
                >
                  {S.addDelegatedLabel}
                </button>
                {scanning && (
                  <div className="px-3 py-2 text-sm text-neutral-400">{S.delegatedScanning}</div>
                )}
                {!scanning && freshSuggestions.length > 0 && (
                  <>
                    <div className="mx-2 my-1 border-t border-black/10 dark:border-white/10" />
                    <div className="px-3 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wide text-neutral-400">
                      {S.delegatedSuggestionsHeading}
                    </div>
                    {freshSuggestions.map((s) => (
                      <button
                        key={s.email}
                        onClick={() => acceptSuggestion(s)}
                        title={S.addDelegatedSuggestionTooltip}
                        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-neutral-800 hover:bg-black/5 dark:text-neutral-100 dark:hover:bg-white/10"
                      >
                        <PlusIcon className="h-3.5 w-3.5 shrink-0 opacity-60" />
                        <span className="truncate">{s.email}</span>
                      </button>
                    ))}
                  </>
                )}
                {!scanning && scanDone && freshSuggestions.length === 0 && (
                  <div className="px-3 py-2 text-sm text-neutral-400">{S.delegatedNoneFound}</div>
                )}
              </div>
            </>
          )}
        </div>

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
