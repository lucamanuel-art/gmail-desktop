// Reads and writes the user preferences JSON, with one setter per settings tab.
//
// Every default in DEFAULT_PREFS makes the app behave as it did before that setting
// existed, and anything malformed falls back to it. Each setter is a patch, so ...prefs
// must come first or a one-field caller wipes what it knows nothing about; appearance.tray
// merges a level deeper for the same reason.
//
// Quiet-hours times are "HH:MM", dndUntil is epoch ms, an empty folder string means the OS
// default, and hardwareAcceleration is read before app "ready" so it needs a restart.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { LanguagePref } from './locale';


//===========================
// Types
//===========================

export interface AccountPref {
  order?: number;
  label?: string;
  zoom?: number;
  notify?: boolean;
  calendarNotify?: boolean;
  badgeCount?: boolean;
  notifySound?: boolean;
  notifyPersist?: boolean;
}
export interface QuietHours {
  enabled: boolean;
  start: string;
  end: string;
}
export interface NotificationPrefs {
  dnd: boolean;
  dndUntil?: number;
  quietHours: QuietHours;
  showSender: boolean;
  showSubject: boolean;
  sound: boolean;
  soundName: string;
  volume: number;
  googleApps: boolean;
}

export type TrayColor = 'system' | 'light' | 'dark';
export interface TrayPrefs {
  enabled: boolean;
  selectUnreadOnClick: boolean;
  color: TrayColor;
}
export interface AppearancePrefs {
  showUnreadBadges: boolean;
  tray: TrayPrefs;
  restrictMinWindowSize: boolean;
}

export type DownloadClickAction = 'show-in-folder' | 'open-file' | 'nothing';
export interface DownloadPrefs {
  folder: string;
  saveAsDialog: boolean;
  openFolderWhenDone: boolean;
  notify: boolean;
  notifyClick: DownloadClickAction;
}

export interface PhishingPrefs {
  confirmExternalLinks: boolean;
  trustedHosts: string[];
}

export interface UpdatePrefs {
  autoCheck: boolean;
  notify: boolean;
  // Opt-in: follow the beta channel, so pre-releases are offered as updates too.
  // Off by default — a stable install must never be moved onto a beta silently.
  beta: boolean;
}

export interface GoogleAppsPrefs {
  openInApp: boolean;
  alwaysNewWindow: boolean;
  excluded: string[];
  showAccountLabel: boolean;
  showAccountColor: boolean;
  pinned: string[];
}

export type CodeConfidence = 'medium' | 'high';
export interface VerificationCodePrefs {
  autoCopy: boolean;
  confidence: CodeConfidence;
  markRead: boolean;
  deleteAfter: boolean;
}

export interface AdvancedPrefs {
  hardwareAcceleration: boolean;
}

export type AppearancePatch = Partial<Omit<AppearancePrefs, 'tray'>> & {
  tray?: Partial<TrayPrefs>;
};

export type NotificationExtrasPatch = Partial<
  Pick<
    NotificationPrefs,
    'showSender' | 'showSubject' | 'sound' | 'soundName' | 'volume' | 'googleApps'
  >
>;
export interface WindowPrefs {
  width: number;
  height: number;
  x?: number;
  y?: number;
  maximized: boolean;
}
export type ThemeChoice = 'system' | 'light' | 'dark';
export type NotificationOpen = 'app' | 'window';

export interface MailDropPrefs {
  folder: string;
}

export interface Prefs {
  window: WindowPrefs;
  autoStart: boolean;
  launchMinimized: boolean;
  theme: ThemeChoice;
  language: LanguagePref;
  notificationOpen: NotificationOpen;
  notifications: NotificationPrefs;
  accounts: Record<string, AccountPref>;
  mailDrop: MailDropPrefs;
  appearance: AppearancePrefs;
  downloads: DownloadPrefs;
  phishing: PhishingPrefs;
  updates: UpdatePrefs;
  googleApps: GoogleAppsPrefs;
  verificationCodes: VerificationCodePrefs;
  advanced: AdvancedPrefs;
  reneMode: boolean;
}


//===========================
// Defaults
//===========================

export const DEFAULT_PREFS: Prefs = {
  window: { width: 1200, height: 820, maximized: false },
  autoStart: false,
  launchMinimized: false,
  theme: 'system',
  language: 'system',
  notificationOpen: 'app',
  notifications: {
    dnd: false,
    quietHours: { enabled: false, start: '18:00', end: '08:00' },
    showSender: true,
    showSubject: true,
    sound: true,
    soundName: '',
    volume: 1,
    googleApps: true,
  },
  accounts: {},
  mailDrop: { folder: '' },
  appearance: {
    showUnreadBadges: true,
    tray: { enabled: true, selectUnreadOnClick: false, color: 'system' },
    restrictMinWindowSize: true,
  },
  downloads: {
    folder: '',
    saveAsDialog: false,
    openFolderWhenDone: false,
    notify: true,
    notifyClick: 'show-in-folder',
  },
  phishing: { confirmExternalLinks: false, trustedHosts: [] },
  updates: { autoCheck: true, notify: true, beta: false },
  googleApps: {
    openInApp: true,
    alwaysNewWindow: false,
    excluded: [],
    showAccountLabel: true,
    showAccountColor: true,
    pinned: [],
  },
  verificationCodes: { autoCopy: false, confidence: 'high', markRead: false, deleteAfter: false },
  advanced: { hardwareAcceleration: true },
  reneMode: false,
};


//===========================
// Helper functions
//===========================

/**
 * Reads a boolean, falling back on anything else
 *
 * @param v
 * @param fallback
 * @returns the value or the fallback
 * @private
 */
function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}
/**
 * Reads a value that must be one of a fixed set
 *
 * @param v
 * @param allowed
 * @param fallback
 * @returns the value when it is in the set, the fallback otherwise
 * @private
 */
function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

/**
 * Reads a number and clamps it to 0..1
 *
 * @param v
 * @param fallback
 * @returns the clamped value, or the fallback when v is not finite
 * @private
 */
function unitRange(v: unknown, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(1, Math.max(0, v));
}

/**
 * Reads a list of non-empty strings, trimmed and deduplicated
 *
 * @param v
 * @returns the usable entries, in first-seen order
 * @private
 */
function stringList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== 'string') continue;
    const s = item.trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}


//===========================
// Store
//===========================

export class PrefsStore {
  constructor(private readonly filePath: string) {}

  /**
   * Reads every preference, filling in a default for anything unusable
   *
   * @returns a complete Prefs, never a partial one
   */
  getAll(): Prefs {
    if (!existsSync(this.filePath)) return structuredClone(DEFAULT_PREFS);
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8'));
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return structuredClone(DEFAULT_PREFS);
      return {
        window: { ...DEFAULT_PREFS.window, ...(raw.window ?? {}) },
        autoStart: typeof raw.autoStart === 'boolean' ? raw.autoStart : DEFAULT_PREFS.autoStart,
        launchMinimized:
          typeof raw.launchMinimized === 'boolean'
            ? raw.launchMinimized
            : DEFAULT_PREFS.launchMinimized,
        theme: ['system', 'light', 'dark'].includes(raw.theme) ? raw.theme : DEFAULT_PREFS.theme,
        language: ['system', 'en', 'nl'].includes(raw.language)
          ? raw.language
          : DEFAULT_PREFS.language,
        notificationOpen: raw.notificationOpen === 'window' ? 'window' : 'app',
        notifications: {
          dnd: typeof raw.notifications?.dnd === 'boolean' ? raw.notifications.dnd : false,
          dndUntil: typeof raw.notifications?.dndUntil === 'number' ? raw.notifications.dndUntil : undefined,
          quietHours: { ...DEFAULT_PREFS.notifications.quietHours, ...(raw.notifications?.quietHours ?? {}) },
          showSender: bool(raw.notifications?.showSender, true),
          showSubject: bool(raw.notifications?.showSubject, true),
          sound: bool(raw.notifications?.sound, true),
          soundName: typeof raw.notifications?.soundName === 'string' ? raw.notifications.soundName : '',
          volume: unitRange(raw.notifications?.volume, 1),
          googleApps: bool(raw.notifications?.googleApps, true),
        },
        accounts: raw.accounts && typeof raw.accounts === 'object' && !Array.isArray(raw.accounts)
          ? raw.accounts
          : {},
        mailDrop: {
          folder: typeof raw.mailDrop?.folder === 'string' ? raw.mailDrop.folder : '',
        },
        appearance: {
          showUnreadBadges: bool(raw.appearance?.showUnreadBadges, true),
          tray: {
            enabled: bool(raw.appearance?.tray?.enabled, true),
            selectUnreadOnClick: bool(raw.appearance?.tray?.selectUnreadOnClick, false),
            color: oneOf(raw.appearance?.tray?.color, ['system', 'light', 'dark'] as const, 'system'),
          },
          restrictMinWindowSize: bool(raw.appearance?.restrictMinWindowSize, true),
        },
        downloads: {
          folder: typeof raw.downloads?.folder === 'string' ? raw.downloads.folder : '',
          saveAsDialog: bool(raw.downloads?.saveAsDialog, false),
          openFolderWhenDone: bool(raw.downloads?.openFolderWhenDone, false),
          notify: bool(raw.downloads?.notify, true),
          notifyClick: oneOf(
            raw.downloads?.notifyClick,
            ['show-in-folder', 'open-file', 'nothing'] as const,
            'show-in-folder',
          ),
        },
        phishing: {
          confirmExternalLinks: bool(raw.phishing?.confirmExternalLinks, false),
          trustedHosts: stringList(raw.phishing?.trustedHosts),
        },
        updates: {
          autoCheck: bool(raw.updates?.autoCheck, true),
          notify: bool(raw.updates?.notify, true),
          beta: bool(raw.updates?.beta, false),
        },
        googleApps: {
          openInApp: bool(raw.googleApps?.openInApp, true),
          alwaysNewWindow: bool(raw.googleApps?.alwaysNewWindow, false),
          excluded: stringList(raw.googleApps?.excluded),
          showAccountLabel: bool(raw.googleApps?.showAccountLabel, true),
          showAccountColor: bool(raw.googleApps?.showAccountColor, true),
          pinned: stringList(raw.googleApps?.pinned),
        },
        verificationCodes: {
          autoCopy: bool(raw.verificationCodes?.autoCopy, false),
          confidence: oneOf(raw.verificationCodes?.confidence, ['medium', 'high'] as const, 'high'),
          markRead: bool(raw.verificationCodes?.markRead, false),
          deleteAfter: bool(raw.verificationCodes?.deleteAfter, false),
        },
        advanced: { hardwareAcceleration: bool(raw.advanced?.hardwareAcceleration, true) },
        reneMode: typeof raw.reneMode === 'boolean' ? raw.reneMode : false,
      };
    } catch {
      return structuredClone(DEFAULT_PREFS);
    }
  }

  /**
   * Writes the whole preferences file
   *
   * @param prefs
   * @private
   */
  private write(prefs: Prefs): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(prefs, null, 2), 'utf8');
  }

  setWindow(w: WindowPrefs): void {
    this.write({ ...this.getAll(), window: w });
  }
  setAutoStart(v: boolean): void {
    this.write({ ...this.getAll(), autoStart: v });
  }

  /**
   * Patches the appearance tab, merging tray a level deeper
   *
   * @param patch
   */
  setAppearance(patch: AppearancePatch): void {
    const prefs = this.getAll();
    this.write({
      ...prefs,
      appearance: {
        ...prefs.appearance,
        ...patch,
        tray: { ...prefs.appearance.tray, ...(patch.tray ?? {}) },
      },
    });
  }
  setDownloads(patch: Partial<DownloadPrefs>): void {
    const prefs = this.getAll();
    this.write({ ...prefs, downloads: { ...prefs.downloads, ...patch } });
  }
  /**
   * Patches the phishing tab, lowercasing the trusted hosts
   *
   * @param patch
   */
  setPhishing(patch: Partial<PhishingPrefs>): void {
    const prefs = this.getAll();
    const trustedHosts =
      patch.trustedHosts === undefined
        ? prefs.phishing.trustedHosts
        : stringList(patch.trustedHosts.map((h) => h.toLowerCase()));
    this.write({ ...prefs, phishing: { ...prefs.phishing, ...patch, trustedHosts } });
  }
  setUpdates(patch: Partial<UpdatePrefs>): void {
    const prefs = this.getAll();
    this.write({ ...prefs, updates: { ...prefs.updates, ...patch } });
  }
  setAdvanced(patch: Partial<AdvancedPrefs>): void {
    const prefs = this.getAll();
    this.write({ ...prefs, advanced: { ...prefs.advanced, ...patch } });
  }
  setVerificationCodes(patch: Partial<VerificationCodePrefs>): void {
    const prefs = this.getAll();
    this.write({ ...prefs, verificationCodes: { ...prefs.verificationCodes, ...patch } });
  }
  /**
   * Patches the Google apps tab, normalising the excluded and pinned lists
   *
   * @param patch
   */
  setGoogleApps(patch: Partial<GoogleAppsPrefs>): void {
    const prefs = this.getAll();
    const excluded = patch.excluded === undefined ? prefs.googleApps.excluded : stringList(patch.excluded);
    const pinned = patch.pinned === undefined ? prefs.googleApps.pinned : stringList(patch.pinned);
    this.write({ ...prefs, googleApps: { ...prefs.googleApps, ...patch, excluded, pinned } });
  }
  setNotificationExtras(patch: NotificationExtrasPatch): void {
    const prefs = this.getAll();
    this.write({ ...prefs, notifications: { ...prefs.notifications, ...patch } });
  }
  setLaunchMinimized(v: boolean): void {
    this.write({ ...this.getAll(), launchMinimized: v });
  }
  setTheme(t: ThemeChoice): void {
    this.write({ ...this.getAll(), theme: t });
  }
  setLanguage(v: LanguagePref): void {
    this.write({ ...this.getAll(), language: v });
  }
  setNotificationOpen(v: NotificationOpen): void {
    this.write({ ...this.getAll(), notificationOpen: v });
  }
  setNotifications(patch: Partial<NotificationPrefs>): void {
    const prefs = this.getAll();
    this.write({ ...prefs, notifications: { ...prefs.notifications, ...patch } });
  }
  setReneMode(v: boolean): void {
    this.write({ ...this.getAll(), reneMode: v });
  }
  setMailDropFolder(folder: string): void {
    this.write({ ...this.getAll(), mailDrop: { folder } });
  }
  getAccount(email: string): AccountPref {
    return this.getAll().accounts[email] ?? {};
  }
  /**
   * Patches one account's preferences
   *
   * @param email
   * @param partial an empty label removes the key, so the address shows again
   */
  setAccount(email: string, partial: Partial<AccountPref>): void {
    const prefs = this.getAll();
    const next = { ...(prefs.accounts[email] ?? {}), ...partial };
    if (partial.label === '' || partial.label === undefined && 'label' in partial) delete next.label;
    prefs.accounts = { ...prefs.accounts, [email]: next };
    this.write(prefs);
  }
  /**
   * Stores the tab order as one order number per account
   *
   * @param emailsInOrder
   */
  setOrder(emailsInOrder: string[]): void {
    const prefs = this.getAll();
    emailsInOrder.forEach((email, i) => {
      prefs.accounts = { ...prefs.accounts, [email]: { ...(prefs.accounts[email] ?? {}), order: i } };
    });
    this.write(prefs);
  }
}
