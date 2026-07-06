'use client';

import { useEffect, useState } from 'react';
import { SettingsPanel } from './SettingsPanel';

export interface Profile {
  index: number;
  email: string;
  name: string;
  avatarUrl: string;
  color: string;
}
export type Surface = 'mail' | 'calendar';

interface DesktopBridge {
  onProfilesChanged(cb: (profiles: Profile[]) => void): void;
  onUnreadChanged(cb: (counts: Record<number, number>) => void): void;
  switchSurface(index: number, surface: Surface): void;
  redetect(): void;
  setColor(email: string, color: string): void;
  toggleSettings(open: boolean): void;
  onSettingsForceClose(cb: () => void): void;
}

declare global {
  interface Window {
    desktop?: DesktopBridge;
  }
}

export default function Sidebar() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [unread, setUnread] = useState<Record<number, number>>({});
  const [active, setActive] = useState<{ index: number; surface: Surface } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    const bridge = window.desktop;
    if (!bridge) return;
    bridge.onProfilesChanged((list) => {
      setProfiles(list);
      setActive((cur) => cur ?? (list[0] ? { index: list[0].index, surface: 'mail' } : null));
    });
    bridge.onUnreadChanged(setUnread);
    bridge.onSettingsForceClose(() => setSettingsOpen(false));
  }, []);

  function open(index: number, surface: Surface) {
    if (settingsOpen) setSettingsOpen(false);
    setActive({ index, surface });
    window.desktop?.switchSurface(index, surface);
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
    <div className="flex h-screen w-full bg-neutral-900">
      <nav className="flex w-16 shrink-0 flex-col items-center gap-2 bg-neutral-950 py-3">
        {profiles.map((p) => {
          const mailActive = active?.index === p.index && active.surface === 'mail';
          const calActive = active?.index === p.index && active.surface === 'calendar';
          return (
            <div key={p.index} className="flex flex-col items-center gap-1">
              <button
                onClick={() => open(p.index, 'mail')}
                title={p.email}
                className={`relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-full text-sm font-semibold text-white transition ${
                  mailActive ? 'ring-2 ring-white' : 'opacity-80 hover:opacity-100'
                }`}
                style={{ backgroundColor: p.color }}
              >
                {p.avatarUrl ? (
                  <img
                    src={p.avatarUrl}
                    alt={p.email}
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  (p.name || p.email || 'A').charAt(0).toUpperCase()
                )}
                {unread[p.index] > 0 && (
                  <span className="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-red-600 px-1 text-center text-[10px] leading-[18px] text-white">
                    {unread[p.index]}
                  </span>
                )}
              </button>
              <button
                onClick={() => open(p.index, 'calendar')}
                title={`${p.email} — Calendar`}
                className={`flex h-5 w-10 items-center justify-center rounded text-[13px] leading-none transition ${
                  calActive ? 'text-white' : 'text-neutral-500 hover:text-neutral-200'
                }`}
              >
                📅
              </button>
            </div>
          );
        })}
        <button
          onClick={redetect}
          title="Detect accounts"
          className="mt-1 flex h-10 w-10 items-center justify-center rounded-full bg-neutral-800 text-xl text-neutral-300 hover:bg-neutral-700"
        >
          +
        </button>
        <div className="mt-auto">
          <button
            onClick={openSettings}
            title="Settings"
            className="flex h-10 w-10 items-center justify-center rounded-full text-xl text-neutral-400 hover:text-white"
          >
            ⚙
          </button>
        </div>
      </nav>
      {settingsOpen && (
        <SettingsPanel profiles={profiles} onClose={closeSettings} onRedetect={redetect} />
      )}
    </div>
  );
}
