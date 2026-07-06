'use client';

import { useEffect, useState } from 'react';

interface Account {
  id: string;
  label: string;
  color: string;
  email?: string;
  name?: string;
  avatarUrl?: string;
}

const SWATCHES = ['#4285F4', '#EA4335', '#34A853', '#FBBC05', '#A142F4', '#00ACC1'];

export function SettingsPanel({
  accounts,
  onClose,
  onChanged,
}: {
  accounts: Account[];
  onClose: () => void;
  onChanged: (list: Account[]) => void;
}) {
  const [shortcuts, setShortcuts] = useState(true);

  useEffect(() => {
    window.desktop?.getSettings().then((s) => setShortcuts(s.outlookShortcuts));
  }, []);

  async function rename(id: string, label: string) {
    await window.desktop?.updateAccount(id, { label });
    onChanged(accounts.map((a) => (a.id === id ? { ...a, label } : a)));
  }
  async function recolor(id: string, color: string) {
    await window.desktop?.updateAccount(id, { color });
    onChanged(accounts.map((a) => (a.id === id ? { ...a, color } : a)));
  }
  async function remove(id: string) {
    await window.desktop?.removeAccount(id);
    onChanged(accounts.filter((a) => a.id !== id));
  }
  async function toggleShortcuts(next: boolean) {
    setShortcuts(next);
    await window.desktop?.setSettings({ outlookShortcuts: next });
  }

  return (
    <div className="flex h-screen flex-1 flex-col overflow-y-auto bg-neutral-900 p-8 text-neutral-100">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Settings</h1>
        <button onClick={onClose} className="rounded bg-neutral-800 px-3 py-1 text-sm hover:bg-neutral-700">
          Close
        </button>
      </div>

      <h2 className="mb-2 text-sm uppercase tracking-wide text-neutral-400">Accounts</h2>
      <div className="mb-8 flex flex-col gap-3">
        {accounts.map((a) => (
          <div key={a.id} className="flex items-center gap-3 rounded bg-neutral-800 p-3">
            <span className="h-8 w-8 shrink-0 overflow-hidden rounded-full" style={{ backgroundColor: a.color }}>
              {a.avatarUrl && (
                <img src={a.avatarUrl} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
              )}
            </span>
            <input
              defaultValue={a.label}
              onBlur={(e) => rename(a.id, e.target.value)}
              className="flex-1 rounded bg-neutral-700 px-2 py-1 text-sm"
            />
            <div className="flex gap-1">
              {SWATCHES.map((c) => (
                <button
                  key={c}
                  onClick={() => recolor(a.id, c)}
                  aria-label={`color ${c}`}
                  className="h-5 w-5 rounded-full ring-white hover:ring-2"
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <button
              onClick={() => remove(a.id)}
              className="rounded bg-red-700 px-2 py-1 text-xs hover:bg-red-600"
            >
              Remove
            </button>
          </div>
        ))}
        {accounts.length === 0 && <p className="text-sm text-neutral-400">No accounts yet.</p>}
      </div>

      <h2 className="mb-2 text-sm uppercase tracking-wide text-neutral-400">Shortcuts</h2>
      <label className="flex items-center gap-3 text-sm">
        <input type="checkbox" checked={shortcuts} onChange={(e) => toggleShortcuts(e.target.checked)} />
        Enable Outlook keyboard shortcuts
      </label>
      <p className="mt-2 max-w-prose text-xs text-neutral-400">
        For these to work, turn on Gmail keyboard shortcuts in Gmail: Settings → See all settings →
        General → Keyboard shortcuts on.
      </p>
    </div>
  );
}
