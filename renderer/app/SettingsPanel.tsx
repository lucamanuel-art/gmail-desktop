'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Prefs } from './page';
import type { ChangelogEntry, ChangelogVersion } from './changelog-types';
import { advanceReneSequence, isCompleteTime, RENE_SEQUENCE } from './settings-utils';
import { getStrings, type UiStrings } from './strings';

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

function updateStatusText(u: UpdateStatus, S: UiStrings): string {
  switch (u.state) {
    case 'checking':
      return S.updChecking;
    case 'available':
      return S.updAvailable(u.version ?? '');
    case 'not-available':
      return S.updLatest;
    case 'downloading':
      return S.updDownloading(u.percent ?? 0);
    case 'downloaded':
      return S.updDownloaded;
    case 'error':
      return S.updError(u.message ?? 'unknown error');
    case 'dev':
      return S.updDev;
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

// Show the changelog entries for the current UI language. The file mixes
// English (### Fixed) and Dutch (### Opgelost) within a version; prefer the
// entries matching the UI, and fall back to the other language when a version
// has none. Prose-only versions (no ### headings) are shown as-is.
function entriesForLang(v: ChangelogVersion, uiLang: 'en' | 'nl'): ChangelogEntry[] {
  const hasLangTagged = v.entries.some((e) => e.lang !== 'unknown');
  if (!hasLangTagged) return v.entries;
  const matching = v.entries.filter((e) => e.lang === uiLang);
  if (matching.length) return matching;
  return v.entries.filter((e) => e.lang !== 'unknown');
}

// Minimal inline markdown: render **bold** spans, leave the rest as text.
function renderInline(text: string): ReactNode {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : (
      part
    ),
  );
}

function ChangelogVersionBlock({
  version,
  uiLang,
  S,
}: {
  version: ChangelogVersion;
  uiLang: 'en' | 'nl';
  S: UiStrings;
}) {
  const entries = entriesForLang(version, uiLang);
  return (
    <div>
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-sm font-semibold">
          {S.changelogVersionPrefix} {version.version}
        </span>
        {version.date && <span className="text-xs text-neutral-400">{version.date}</span>}
      </div>
      {entries.map((entry, ei) => {
        const label = S.changelogCategory(entry.heading);
        return (
          <div key={ei} className="mb-2 last:mb-0">
            {label && (
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">
                {label}
              </div>
            )}
            <ul className="list-disc space-y-1 pl-5 text-sm text-neutral-700 dark:text-neutral-300">
              {entry.items.map((item, ii) => (
                <li key={ii}>{renderInline(item)}</li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
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

  const rene = prefs?.reneMode === true;
  const S = getStrings(rene);
  const uiLang: 'en' | 'nl' = rene ? 'nl' : 'en';

  // Changelog is fetched once from the main process (which reads CHANGELOG.md).
  const [changelog, setChangelog] = useState<ChangelogVersion[]>([]);
  const [showOlder, setShowOlder] = useState(false);
  useEffect(() => {
    let alive = true;
    window.desktop
      ?.getChangelog()
      .then((v) => {
        if (alive) setChangelog(Array.isArray(v) ? v : []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Rene mode's secret handshake (↑ ↓ ← → a b) only works here: this listener
  // exists only while the settings page is mounted. Keystrokes inside inputs
  // don't count — arrows/letters there are just editing.
  const seqProgress = useRef(0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const next = advanceReneSequence(seqProgress.current, e.key);
      if (next === RENE_SEQUENCE.length) {
        seqProgress.current = 0;
        window.desktop?.setReneMode(!rene);
      } else {
        seqProgress.current = next;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rene]);

  // "Saved ✓" feedback: flash whenever the main process echoes updated prefs
  // (the write already happened by then), and when Save is pressed.
  const [savedFlash, setSavedFlash] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstPrefs = useRef(true);
  const flashSaved = () => {
    setSavedFlash(true);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setSavedFlash(false), 2000);
  };
  useEffect(() => {
    if (!prefs) return;
    if (firstPrefs.current) {
      firstPrefs.current = false;
      return;
    }
    flashSaved();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs]);
  useEffect(() => () => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
  }, []);

  // Every control applies immediately; Save additionally commits an in-progress
  // label edit (which normally commits on blur/Enter) and confirms visually.
  const saveNow = () => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    flashSaved();
  };

  const busy = update.state === 'checking' || update.state === 'downloading';
  const statusText = updateStatusText(update, S);

  return (
    <div className="flex h-screen flex-1 flex-col overflow-y-auto bg-neutral-100 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <div className="mx-auto w-full max-w-2xl px-8 py-8">
        <div className="mb-8 flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">{S.settingsTitle}</h1>
          <div className="flex items-center gap-2">
            <span
              aria-live="polite"
              className={`text-xs font-medium text-green-600 transition-opacity duration-300 dark:text-green-400 ${
                savedFlash ? 'opacity-100' : 'opacity-0'
              }`}
            >
              {S.saved}
            </span>
            <button
              onClick={saveNow}
              className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-sm font-medium text-white transition hover:bg-blue-500"
            >
              {S.save}
            </button>
            <button
              onClick={onClose}
              className="rounded-lg bg-neutral-200 px-3.5 py-1.5 text-sm font-medium text-neutral-900 transition hover:bg-neutral-300 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
            >
              {S.close}
            </button>
          </div>
        </div>

        {rene && (
          <div className="mb-6 rounded-xl border border-yellow-300 bg-yellow-100 p-4 text-sm font-medium text-yellow-900 dark:border-yellow-700 dark:bg-yellow-950/50 dark:text-yellow-200">
            {S.reneBanner}
          </div>
        )}

        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">
          {S.sectionGeneral}
        </h2>
        <div className="mb-6 rounded-xl border border-black/5 bg-white dark:border-white/5 dark:bg-neutral-900 p-4">
          <label className="flex items-center justify-between gap-3">
            <span className="text-sm">{S.autoStart}</span>
            <input
              type="checkbox"
              checked={!!prefs?.autoStart}
              onChange={(e) => onSetAutoStart(e.target.checked)}
              className="h-4 w-4 accent-blue-600"
            />
          </label>
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-sm">{S.theme}</span>
            <select
              value={prefs?.theme ?? 'system'}
              onChange={(e) => window.desktop?.setTheme(e.target.value as 'system' | 'light' | 'dark')}
              className="rounded bg-neutral-200 px-2 py-1 text-sm text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
            >
              <option value="system">{S.themeSystem}</option>
              <option value="light">{S.themeLight}</option>
              <option value="dark">{S.themeDark}</option>
            </select>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-sm">{S.notificationOpenLabel}</span>
            <select
              value={prefs?.notificationOpen ?? 'app'}
              onChange={(e) => window.desktop?.setNotificationOpen(e.target.value as 'app' | 'window')}
              className="rounded bg-neutral-200 px-2 py-1 text-sm text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
            >
              <option value="app">{S.openInApp}</option>
              <option value="window">{S.openInWindow}</option>
            </select>
          </div>
        </div>

        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">
          {S.sectionNotifications}
        </h2>
        <div className="mb-6 flex flex-col gap-3 rounded-xl border border-black/5 bg-white dark:border-white/5 dark:bg-neutral-900 p-4">
          <label className="flex items-center justify-between gap-3">
            <span className="text-sm">{S.dnd}</span>
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
            <span className="text-sm">{S.quietHours}</span>
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
              <span>{S.from}</span>
              <input
                type="time"
                defaultValue={prefs.notifications.quietHours.start}
                onChange={(e) => {
                  // '' fires while a segment is half-typed; only save complete times.
                  if (!prefs || !isCompleteTime(e.target.value)) return;
                  onSetNotifications({ dnd: prefs!.notifications.dnd, quietHours: { ...prefs!.notifications.quietHours, start: e.target.value } });
                }}
                className="rounded bg-neutral-200 px-2 py-1 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
              />
              <span>{S.to}</span>
              <input
                type="time"
                defaultValue={prefs.notifications.quietHours.end}
                onChange={(e) => {
                  if (!prefs || !isCompleteTime(e.target.value)) return;
                  onSetNotifications({ dnd: prefs!.notifications.dnd, quietHours: { ...prefs!.notifications.quietHours, end: e.target.value } });
                }}
                className="rounded bg-neutral-200 px-2 py-1 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
              />
            </div>
          )}
        </div>

        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">
          {S.sectionAbout}
        </h2>
        <div className="mb-6 rounded-xl border border-black/5 bg-white dark:border-white/5 dark:bg-neutral-900 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">Gmail Desktop</div>
              <div className="text-xs text-neutral-400">{S.versionPrefix} {update.currentVersion ?? '—'}</div>
            </div>
            <div className="flex shrink-0 gap-2">
              {update.state === 'available' && (
                <button
                  onClick={onDownloadUpdate}
                  className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-sm font-medium text-white transition hover:bg-blue-500"
                >
                  {S.updateNow}
                </button>
              )}
              {update.state === 'downloaded' && (
                <button
                  onClick={onInstallUpdate}
                  className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-sm font-medium text-white transition hover:bg-blue-500"
                >
                  {S.restartInstall}
                </button>
              )}
              <button
                onClick={onCheckUpdate}
                disabled={busy}
                className="rounded-lg bg-neutral-200 px-3.5 py-1.5 text-sm font-medium text-neutral-900 transition hover:bg-neutral-300 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700"
              >
                {update.state === 'checking' ? S.checking : S.checkForUpdates}
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
          {S.sectionWhatsNew}
        </h2>
        <div className="mb-6 rounded-xl border border-black/5 bg-white dark:border-white/5 dark:bg-neutral-900 p-4">
          {changelog.length === 0 ? (
            <p className="text-sm text-neutral-400">{S.changelogEmpty}</p>
          ) : (
            <>
              <ChangelogVersionBlock version={changelog[0]} uiLang={uiLang} S={S} />
              {changelog.length > 1 && (
                <>
                  {showOlder && (
                    <div className="mt-4 flex flex-col gap-4 border-t border-black/5 pt-4 dark:border-white/5">
                      {changelog.slice(1).map((v) => (
                        <ChangelogVersionBlock key={v.version} version={v} uiLang={uiLang} S={S} />
                      ))}
                    </div>
                  )}
                  <button
                    onClick={() => setShowOlder((s) => !s)}
                    className="mt-3 text-xs font-medium text-blue-600 transition hover:text-blue-500 dark:text-blue-400"
                  >
                    {showOlder ? S.hideOlder : S.showOlder}
                  </button>
                </>
              )}
            </>
          )}
        </div>

        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">
          {S.sectionAccounts}
        </h2>
        <div className="mb-6 flex flex-col gap-2.5">
          {profiles.map((p) => {
            const showImg = p.avatarUrl && !brokenAvatars[p.avatarUrl];
            return (
              <div
                key={p.email}
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
                      onKeyDown={(e) => {
                        // Commit on Enter — blur triggers the save below.
                        if (e.key === 'Enter') e.currentTarget.blur();
                      }}
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
                      <label className="flex items-center gap-1 text-xs text-neutral-500 dark:text-neutral-400" title={S.mailToggleTitle}>
                        <input
                          type="checkbox"
                          checked={prefs?.accounts?.[p.email]?.notify !== false}
                          onChange={(e) => window.desktop?.setAccountPref({ email: p.email, notify: e.target.checked })}
                          className="h-3.5 w-3.5 accent-blue-600"
                        />
                        {S.mailToggle}
                      </label>
                      <label className="flex items-center gap-1 text-xs text-neutral-500 dark:text-neutral-400" title={S.calendarToggleTitle}>
                        <input
                          type="checkbox"
                          checked={prefs?.accounts?.[p.email]?.calendarNotify === true}
                          onChange={(e) => window.desktop?.setAccountPref({ email: p.email, calendarNotify: e.target.checked })}
                          className="h-3.5 w-3.5 accent-blue-600"
                        />
                        {S.calendarToggle}
                      </label>
                    </div>
                    <button
                      onClick={() => setConfirmEmail(p.email)}
                      aria-label={S.removeAccount}
                      title={S.removeAccount}
                      className="ml-1 flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 transition hover:bg-red-600/20 hover:text-red-400"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {confirmEmail === p.email && (
                  <div className="flex items-center justify-between gap-3 rounded-lg bg-red-100 px-3 py-2 dark:bg-red-950/40">
                    <span className="text-xs text-red-700 dark:text-red-200">
                      {S.removeConfirmBefore}
                      <span className="font-semibold">+</span>
                      {S.removeConfirmAfter}
                    </span>
                    <div className="flex shrink-0 gap-2">
                      <button
                        onClick={() => {
                          window.desktop?.removeAccount(p.email);
                          setConfirmEmail(null);
                        }}
                        className="rounded bg-red-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-red-500"
                      >
                        {S.remove}
                      </button>
                      <button
                        onClick={() => setConfirmEmail(null)}
                        className="rounded bg-neutral-300 px-2.5 py-1 text-xs text-neutral-900 transition hover:bg-neutral-400 dark:bg-neutral-700 dark:text-neutral-100 dark:hover:bg-neutral-600"
                      >
                        {S.cancel}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {profiles.length === 0 && (
            <p className="rounded-xl border border-black/5 bg-white dark:border-white/5 dark:bg-neutral-900 p-4 text-sm text-neutral-400">
              {S.noAccounts}
            </p>
          )}
        </div>

        <button
          onClick={onRedetect}
          className="w-fit rounded-lg bg-neutral-200 px-4 py-2 text-sm font-medium text-neutral-900 transition hover:bg-neutral-300 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700"
        >
          {S.redetect}
        </button>
        <p className="mt-3 max-w-prose text-xs leading-relaxed text-neutral-500">
          {S.accountsFootnoteBefore}
          <span className="font-medium text-neutral-700 dark:text-neutral-300">+</span>
          {S.accountsFootnoteAfter}
        </p>
      </div>
    </div>
  );
}
