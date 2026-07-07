'use client';

import { useEffect, useState } from 'react';
import { SettingsPanel } from './SettingsPanel';
import { CALENDAR_ICON_DATA_URI } from './calendar-icon-data';

export interface Profile {
  index: number;
  email: string;
  name: string;
  avatarUrl: string;
  color: string;
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
  checkForUpdate(): void;
  downloadUpdate(): void;
  installUpdate(): void;
  onUpdateStatus(cb: (status: UpdateStatus) => void): void;
}

declare global {
  interface Window {
    desktop?: DesktopBridge;
  }
}

function initial(p: Profile): string {
  return (p.name || p.email || '?').trim().charAt(0).toUpperCase() || '?';
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
    bridge.onUpdateStatus(setUpdate);
  }, []);

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

  return (
    <div className="flex h-screen w-full bg-neutral-950 text-neutral-200">
      <nav className="flex w-[72px] shrink-0 flex-col items-center gap-2 py-4">
        {profiles.map((p) => {
          const mailActive = active?.index === p.index && active.surface === 'mail';
          const calActive = active?.index === p.index && active.surface === 'calendar';
          const showImg = p.avatarUrl && !brokenAvatars[p.avatarUrl];
          const count = unread[p.index] ?? 0;
          return (
            <div key={p.index} className="flex flex-col items-center gap-1.5">
              <div className="relative">
                <button
                  onClick={() => open(p.index, 'mail')}
                  title={p.email || p.name}
                  className={`flex h-11 w-11 items-center justify-center overflow-hidden rounded-full text-sm font-semibold text-white transition-all duration-150 ${
                    mailActive
                      ? 'ring-2 ring-white ring-offset-2 ring-offset-neutral-950'
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
                  <span className="pointer-events-none absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-neutral-950">
                    {count > 99 ? '99+' : count}
                  </span>
                )}
              </div>
              <button
                onClick={() => open(p.index, 'calendar')}
                title={`${p.email || p.name} — Calendar`}
                className={`flex h-6 w-6 items-center justify-center rounded-md transition ${
                  calActive
                    ? 'bg-white/15 ring-1 ring-white/30'
                    : 'opacity-70 hover:bg-white/10 hover:opacity-100'
                }`}
              >
                <CalendarIcon className="h-5 w-5" />
              </button>
            </div>
          );
        })}

        <div className="my-1 h-px w-8 shrink-0 bg-white/10" />

        <button
          onClick={addAccount}
          title="Add account"
          className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-dashed border-white/20 text-neutral-400 transition hover:border-white/40 hover:text-white"
        >
          <PlusIcon className="h-5 w-5" />
        </button>

        <div className="mt-auto">
          <button
            onClick={openSettings}
            title="Settings"
            className={`flex h-10 w-10 items-center justify-center rounded-full transition ${
              settingsOpen
                ? 'bg-white/15 text-white'
                : 'text-neutral-500 hover:bg-white/10 hover:text-white'
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
        />
      )}
    </div>
  );
}
