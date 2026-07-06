'use client';

interface Profile {
  index: number;
  email: string;
  name: string;
  avatarUrl: string;
  color: string;
}

const SWATCHES = ['#4285F4', '#EA4335', '#34A853', '#FBBC05', '#A142F4', '#00ACC1'];

export function SettingsPanel({
  profiles,
  onClose,
  onRedetect,
}: {
  profiles: Profile[];
  onClose: () => void;
  onRedetect: () => void;
}) {
  return (
    <div className="flex h-screen flex-1 flex-col overflow-y-auto bg-neutral-900 p-8 text-neutral-100">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Settings</h1>
        <button onClick={onClose} className="rounded bg-neutral-800 px-3 py-1 text-sm hover:bg-neutral-700">
          Close
        </button>
      </div>

      <h2 className="mb-2 text-sm uppercase tracking-wide text-neutral-400">Accounts</h2>
      <div className="mb-6 flex flex-col gap-3">
        {profiles.map((p) => (
          <div key={p.index} className="flex items-center gap-3 rounded bg-neutral-800 p-3">
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-semibold text-white"
              style={{ backgroundColor: p.color }}
            >
              {p.avatarUrl ? (
                <img src={p.avatarUrl} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
              ) : (
                (p.name || p.email || 'A').charAt(0).toUpperCase()
              )}
            </span>
            <span className="flex-1 truncate text-sm">{p.email}</span>
            <div className="flex gap-1">
              {SWATCHES.map((c) => (
                <button
                  key={c}
                  onClick={() => window.desktop?.setColor(p.email, c)}
                  aria-label={`color ${c}`}
                  className="h-5 w-5 rounded-full ring-white hover:ring-2"
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
        ))}
        {profiles.length === 0 && <p className="text-sm text-neutral-400">No accounts detected yet.</p>}
      </div>

      <button
        onClick={onRedetect}
        className="w-fit rounded bg-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-600"
      >
        Re-detect accounts
      </button>
      <p className="mt-3 max-w-prose text-xs text-neutral-400">
        Accounts are detected from the Google accounts you are signed into. Add another via Gmail&apos;s own
        account switcher, then re-detect.
      </p>
    </div>
  );
}
