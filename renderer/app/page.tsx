'use client';

import { useEffect, useState } from 'react';

interface Account {
  id: string;
  label: string;
  color: string;
}

// Bridge exposed by the Electron preload for the sidebar (Task 11).
interface DesktopBridge {
  listAccounts(): Promise<Account[]>;
  addAccount(input: { label: string; color: string }): Promise<Account>;
  removeAccount(id: string): Promise<void>;
  switchAccount(id: string): void;
  onAccountsChanged(cb: (accounts: Account[]) => void): void;
  onUnreadChanged(cb: (counts: Record<string, number>) => void): void;
}

declare global {
  interface Window {
    desktop?: DesktopBridge;
  }
}

export default function Sidebar() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const bridge = window.desktop;
    if (!bridge) return;
    bridge.listAccounts().then((list) => {
      setAccounts(list);
      setActive(list[0]?.id ?? null);
    });
    bridge.onAccountsChanged(setAccounts);
    bridge.onUnreadChanged(setUnread);
  }, []);

  function select(id: string) {
    setActive(id);
    window.desktop?.switchAccount(id);
  }

  async function addAccount() {
    const created = await window.desktop?.addAccount({ label: 'Account', color: '#4285F4' });
    if (created) select(created.id);
  }

  return (
    <div className="flex h-screen w-full bg-neutral-900">
      <nav className="flex w-16 shrink-0 flex-col items-center gap-3 bg-neutral-950 py-3">
        {accounts.map((a) => (
          <button
            key={a.id}
            onClick={() => select(a.id)}
            title={a.label}
            className={`relative flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold text-white transition ${
              active === a.id ? 'ring-2 ring-white' : 'opacity-80 hover:opacity-100'
            }`}
            style={{ backgroundColor: a.color }}
          >
            {a.label.charAt(0).toUpperCase()}
            {(unread[a.id] ?? 0) > 0 && (
              <span className="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-red-600 px-1 text-center text-[10px] leading-[18px] text-white">
                {unread[a.id]}
              </span>
            )}
          </button>
        ))}
        <button
          onClick={addAccount}
          title="Add account"
          className="mt-1 flex h-10 w-10 items-center justify-center rounded-full bg-neutral-800 text-xl text-neutral-300 hover:bg-neutral-700"
        >
          +
        </button>
        <div className="mt-auto">
          <button
            title="Settings"
            className="flex h-10 w-10 items-center justify-center rounded-full text-xl text-neutral-400 hover:text-white"
          >
            ⚙
          </button>
        </div>
      </nav>
    </div>
  );
}
