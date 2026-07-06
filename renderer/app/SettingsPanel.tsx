'use client';

import { useState } from 'react';

interface Profile {
  index: number;
  email: string;
  name: string;
  avatarUrl: string;
  color: string;
}

const SWATCHES = ['#4285F4', '#EA4335', '#34A853', '#FBBC05', '#A142F4', '#00ACC1'];

function initial(p: Profile): string {
  return (p.name || p.email || '?').trim().charAt(0).toUpperCase() || '?';
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
}: {
  profiles: Profile[];
  onClose: () => void;
  onRedetect: () => void;
}) {
  const [brokenAvatars, setBrokenAvatars] = useState<Record<string, boolean>>({});
  const [confirmEmail, setConfirmEmail] = useState<string | null>(null);

  return (
    <div className="flex h-screen flex-1 flex-col overflow-y-auto bg-neutral-950 text-neutral-100">
      <div className="mx-auto w-full max-w-2xl px-8 py-8">
        <div className="mb-8 flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <button
            onClick={onClose}
            className="rounded-lg bg-neutral-800 px-3.5 py-1.5 text-sm font-medium text-neutral-200 transition hover:bg-neutral-700"
          >
            Close
          </button>
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
                className="flex flex-col gap-2 rounded-xl border border-white/5 bg-neutral-900 p-3.5"
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
                  <div className="flex min-w-0 flex-1 flex-col">
                    {p.name && <span className="truncate text-sm font-medium">{p.name}</span>}
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
                            ? 'ring-2 ring-white ring-offset-2 ring-offset-neutral-900'
                            : ''
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
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
                  <div className="flex items-center justify-between gap-3 rounded-lg bg-red-950/40 px-3 py-2">
                    <span className="text-xs text-red-200">
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
                        className="rounded bg-neutral-700 px-2.5 py-1 text-xs text-neutral-100 transition hover:bg-neutral-600"
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
            <p className="rounded-xl border border-white/5 bg-neutral-900 p-4 text-sm text-neutral-400">
              No accounts detected yet.
            </p>
          )}
        </div>

        <button
          onClick={onRedetect}
          className="w-fit rounded-lg bg-neutral-800 px-4 py-2 text-sm font-medium text-neutral-100 transition hover:bg-neutral-700"
        >
          Re-detect accounts
        </button>
        <p className="mt-3 max-w-prose text-xs leading-relaxed text-neutral-500">
          Accounts are detected from the Google accounts you are signed into. Use the{' '}
          <span className="font-medium text-neutral-300">+</span> button in the sidebar to sign in
          to a new account, or add one via Gmail&apos;s own account switcher and then re-detect.
        </p>
      </div>
    </div>
  );
}
