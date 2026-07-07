'use client';

import { useState } from 'react';
import type { Prefs } from './page';

interface Profile {
  index: number;
  email: string;
  name: string;
  avatarUrl: string;
  color: string;
  label?: string;
}

const SWATCHES = ['#4285F4', '#EA4335', '#34A853', '#FBBC05', '#A142F4', '#00ACC1'];

interface UpdateStatus {
  state:
    | 'idle'
    | 'checking'
    | 'available'
    | 'not-available'
    | 'downloading'
    | 'downloaded'
    | 'error'
    | 'dev';
  currentVersion?: string;
  version?: string;
  percent?: number;
  message?: string;
}

function initial(p: Profile): string {
  return (p.name || p.email || '?').trim().charAt(0).toUpperCase() || '?';
}

function updateStatusText(u: UpdateStatus): string {
  switch (u.state) {
    case 'checking':
      return 'Checking for updates…';
    case 'available':
      return `Update available: v${u.version}`;
    case 'not-available':
      return "You're on the latest version.";
    case 'downloading':
      return `Downloading update… ${u.percent ?? 0}%`;
    case 'downloaded':
      return 'Update downloaded — restarting to install…';
    case 'error':
      return `Couldn't check for updates: ${u.message ?? 'unknown error'}`;
    case 'dev':
      return 'Updates are only available in the installed app.';
    default:
      return '';
  }
}

function TrashIcon({ className = '' }: { className?: string }) {
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
      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6M10 11v6M14 11v6" />
    </svg>
  );
}

export function SettingsPanel({
  profiles,
  onClose,
  onRedetect,
  update,
  onCheckUpdate,
  onDownloadUpdate,
  onInstallUpdate,
  prefs,
  onSetAutoStart,
  onSetNotifications,
}: {
  profiles: Profile[];
  onClose: () => void;
  onRedetect: () => void;
  update: UpdateStatus;
  onCheckUpdate: () => void;
  onDownloadUpdate: () => void;
  onInstallUpdate: () => void;
  prefs: Prefs | null;
  onSetAutoStart: (v: boolean) => void;
  onSetNotifications: (arg: {
    dnd: boolean;
    quietHours: { enabled: boolean; start: string; end: string };
  }) => void;
}) {
  const [brokenAvatars, setBrokenAvatars] = useState<Record<string, boolean>>({});
  const [confirmEmail, setConfirmEmail] = useState<string | null>(null);

  const busy = update.state === 'checking' || update.state === 'downloading';
  const statusText = updateStatusText(update);

  return (
    <div className="flex h-screen flex-1 flex-col overflow-y-auto bg-neutral-100 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <div className="mx-auto w-full max-w-2xl px-8 py-8">
        <div className="mb-8 flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <button
            onClick={onClose}
            className="rounded-lg bg-neutral-200 px-3.5 py-1.5 text-sm font-medium text-neutral-900 transition hover:bg-neutral-300 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
          >
            Close
          </button>
        </div>

        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">
          General
        </h2>
        <div className="mb-6 rounded-xl border border-black/5 bg-white dark:border-white/5 dark:bg-neutral-900 p-4">
          <label className="flex items-center justify-between gap-3">
            <span className="text-sm">Start Gmail Desktop when I sign in</span>
            <input
              type="checkbox"
              checked={!!prefs?.autoStart}
              onChange={(e) => onSetAutoStart(e.target.checked)}
              className="h-4 w-4 accent-blue-600"
            />
          </label>
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-sm">Theme</span>
            <select
              value={prefs?.theme ?? 'system'}
              onChange={(e) => window.desktop?.setTheme(e.target.value as 'system' | 'light' | 'dark')}
              className="rounded bg-neutral-200 px-2 py-1 text-sm text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-sm">When you click a notification</span>
            <select
              value={prefs?.notificationOpen ?? 'app'}
              onChange={(e) => window.desktop?.setNotificationOpen(e.target.value as 'app' | 'window')}
              className="rounded bg-neutral-200 px-2 py-1 text-sm text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
            >
              <option value="app">Open in the app</option>
              <option value="window">Open in a new window</option>
            </select>
          </div>
        </div>

        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">
          Notifications
        </h2>
        <div className="mb-6 flex flex-col gap-3 rounded-xl border border-black/5 bg-white dark:border-white/5 dark:bg-neutral-900 p-4">
          <label className="flex items-center justify-between gap-3">
            <span className="text-sm">Do not disturb (mute all)</span>
            <input
              type="checkbox"
              checked={!!prefs?.notifications.dnd}
              onChange={(e) => {
                if (!prefs) return;
                onSetNotifications({ dnd: e.target.checked, quietHours: prefs!.notifications.quietHours });
              }}
              className="h-4 w-4 accent-blue-600"
            />
          </label>
          <label className="flex items-center justify-between gap-3">
            <span className="text-sm">Quiet hours</span>
            <input
              type="checkbox"
              checked={!!prefs?.notifications.quietHours.enabled}
              onChange={(e) => {
                if (!prefs) return;
                onSetNotifications({
                  dnd: prefs!.notifications.dnd,
                  quietHours: { ...prefs!.notifications.quietHours, enabled: e.target.checked },
                });
              }}
              className="h-4 w-4 accent-blue-600"
            />
          </label>
          {prefs?.notifications.quietHours.enabled && (
            <div className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
              <span>From</span>
              <input
                type="time"
                value={prefs.notifications.quietHours.start}
                onChange={(e) => {
                  if (!prefs) return;
                  onSetNotifications({ dnd: prefs!.notifications.dnd, quietHours: { ...prefs!.notifications.quietHours, start: e.target.value } });
                }}
                className="rounded bg-neutral-200 px-2 py-1 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
              />
              <span>to</span>
              <input
                type="time"
                value={prefs.notifications.quietHours.end}
                onChange={(e) => {
                  if (!prefs) return;
                  onSetNotifications({ dnd: prefs!.notifications.dnd, quietHours: { ...prefs!.notifications.quietHours, end: e.target.value } });
                }}
                className="rounded bg-neutral-200 px-2 py-1 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
              />
            </div>
          )}
        </div>

        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">
          About &amp; updates
        </h2>
        <div className="mb-6 rounded-xl border border-black/5 bg-white dark:border-white/5 dark:bg-neutral-900 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">Gmail Desktop</div>
              <div className="text-xs text-neutral-400">Version {update.currentVersion ?? '—'}</div>
            </div>
            <div className="flex shrink-0 gap-2">
              {update.state === 'available' && (
                <button
                  onClick={onDownloadUpdate}
                  className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-sm font-medium text-white transition hover:bg-blue-500"
                >
                  Update now
                </button>
              )}
              {update.state === 'downloaded' && (
                <button
                  onClick={onInstallUpdate}
                  className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-sm font-medium text-white transition hover:bg-blue-500"
                >
                  Restart &amp; install
                </button>
              )}
              <button
                onClick={onCheckUpdate}
                disabled={busy}
                className="rounded-lg bg-neutral-200 px-3.5 py-1.5 text-sm font-medium text-neutral-900 transition hover:bg-neutral-300 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700"
              >
                {update.state === 'checking' ? 'Checking…' : 'Check for updates'}
              </button>
            </div>
          </div>
          {statusText && (
            <p
              className={`mt-3 text-xs ${
                update.state === 'error' ? 'text-red-400' : 'text-neutral-400'
              }`}
            >
              {statusText}
            </p>
          )}
        </div>

        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">
          Accounts
        </h2>
        <div className="mb-6 flex flex-col gap-2.5">
          {profiles.map((p) => {
            const showImg = p.avatarUrl && !brokenAvatars[p.avatarUrl];
            return (
              <div
                key={p.index}
                className="flex flex-col gap-2 rounded-xl border border-black/5 bg-white dark:border-white/5 dark:bg-neutral-900 p-3.5"
              >
                <div className="flex items-center gap-3">
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-semibold text-white"
                    style={{ backgroundColor: p.color }}
                  >
                    {showImg ? (
                      <img
                        src={p.avatarUrl}
                        alt=""
                        referrerPolicy="no-referrer"
                        onError={() => setBrokenAvatars((b) => ({ ...b, [p.avatarUrl]: true }))}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      initial(p)
                    )}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <input
                      defaultValue={p.label ?? p.name ?? ''}
                      placeholder={p.name || p.email}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v !== (p.label ?? p.name ?? '')) window.desktop?.setAccountPref({ email: p.email, label: v });
                      }}
                      className="w-full truncate rounded bg-transparent text-sm font-medium outline-none focus:bg-neutral-200 focus:px-2 focus:py-1 dark:focus:bg-neutral-800"
                    />
                    <span className="truncate text-xs text-neutral-400">{p.email}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {SWATCHES.map((c) => (
                      <button
                        key={c}
                        onClick={() => window.desktop?.setColor(p.email, c)}
                        aria-label={`color ${c}`}
                        className={`h-5 w-5 rounded-full transition hover:scale-110 ${
                          p.color.toLowerCase() === c.toLowerCase()
                            ? 'ring-2 ring-white ring-offset-2 ring-offset-white dark:ring-offset-neutral-900'
                            : ''
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-1 text-xs text-neutral-500 dark:text-neutral-400" title="Mail notifications for this account">
                        <input
                          type="checkbox"
                          checked={prefs?.accounts?.[p.email]?.notify !== false}
                          onChange={(e) => window.desktop?.setAccountPref({ email: p.email, notify: e.target.checked })}
                          className="h-3.5 w-3.5 accent-blue-600"
                        />
                        Mail
                      </label>
                      <label className="flex items-center gap-1 text-xs text-neutral-500 dark:text-neutral-400" title="Calendar reminders for this account">
                        <input
                          type="checkbox"
                          checked={prefs?.accounts?.[p.email]?.calendarNotify === true}
                          onChange={(e) => window.desktop?.setAccountPref({ email: p.email, calendarNotify: e.target.checked })}
                          className="h-3.5 w-3.5 accent-blue-600"
                        />
                        Calendar
                      </label>
                    </div>
                    <button
                      onClick={() => setConfirmEmail(p.email)}
                      aria-label="Remove account"
                      title="Remove account"
                      className="ml-1 flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 transition hover:bg-red-600/20 hover:text-red-400"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {confirmEmail === p.email && (
                  <div className="flex items-center justify-between gap-3 rounded-lg bg-red-100 px-3 py-2 dark:bg-red-950/40">
                    <span className="text-xs text-red-700 dark:text-red-200">
                      Remove this account from the app? It stays signed in with Google — re-add it
                      later with the <span className="font-semibold">+</span> button.
                    </span>
                    <div className="flex shrink-0 gap-2">
                      <button
                        onClick={() => {
                          window.desktop?.removeAccount(p.email);
                          setConfirmEmail(null);
                        }}
                        className="rounded bg-red-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-red-500"
                      >
                        Remove
                      </button>
                      <button
                        onClick={() => setConfirmEmail(null)}
                        className="rounded bg-neutral-300 px-2.5 py-1 text-xs text-neutral-900 transition hover:bg-neutral-400 dark:bg-neutral-700 dark:text-neutral-100 dark:hover:bg-neutral-600"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {profiles.length === 0 && (
            <p className="rounded-xl border border-black/5 bg-white dark:border-white/5 dark:bg-neutral-900 p-4 text-sm text-neutral-400">
              No accounts detected yet.
            </p>
          )}
        </div>

        <button
          onClick={onRedetect}
          className="w-fit rounded-lg bg-neutral-200 px-4 py-2 text-sm font-medium text-neutral-900 transition hover:bg-neutral-300 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700"
        >
          Re-detect accounts
        </button>
        <p className="mt-3 max-w-prose text-xs leading-relaxed text-neutral-500">
          Accounts are detected from the Google accounts you are signed into. Use the{' '}
          <span className="font-medium text-neutral-700 dark:text-neutral-300">+</span> button in the sidebar to sign in
          to a new account, or add one via Gmail&apos;s own account switcher and then re-detect.
        </p>
      </div>
    </div>
  );
}
