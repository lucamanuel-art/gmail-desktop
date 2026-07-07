import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface AccountPref {
  order?: number;
  label?: string;
  zoom?: number;
  notify?: boolean;
}
export interface QuietHours {
  enabled: boolean;
  start: string; // "HH:MM"
  end: string; // "HH:MM"
}
export interface NotificationPrefs {
  dnd: boolean;
  quietHours: QuietHours;
}
export interface WindowPrefs {
  width: number;
  height: number;
  x?: number;
  y?: number;
  maximized: boolean;
}
export type ThemeChoice = 'system' | 'light' | 'dark';

export interface Prefs {
  window: WindowPrefs;
  autoStart: boolean;
  theme: ThemeChoice;
  notifications: NotificationPrefs;
  accounts: Record<string, AccountPref>;
}

export const DEFAULT_PREFS: Prefs = {
  window: { width: 1200, height: 820, maximized: false },
  autoStart: false,
  theme: 'system',
  notifications: { dnd: false, quietHours: { enabled: false, start: '18:00', end: '08:00' } },
  accounts: {},
};

export class PrefsStore {
  constructor(private readonly filePath: string) {}

  getAll(): Prefs {
    if (!existsSync(this.filePath)) return structuredClone(DEFAULT_PREFS);
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8'));
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return structuredClone(DEFAULT_PREFS);
      return {
        window: { ...DEFAULT_PREFS.window, ...(raw.window ?? {}) },
        autoStart: typeof raw.autoStart === 'boolean' ? raw.autoStart : DEFAULT_PREFS.autoStart,
        theme: ['system', 'light', 'dark'].includes(raw.theme) ? raw.theme : DEFAULT_PREFS.theme,
        notifications: {
          dnd: typeof raw.notifications?.dnd === 'boolean' ? raw.notifications.dnd : false,
          quietHours: { ...DEFAULT_PREFS.notifications.quietHours, ...(raw.notifications?.quietHours ?? {}) },
        },
        accounts: raw.accounts && typeof raw.accounts === 'object' && !Array.isArray(raw.accounts)
          ? raw.accounts
          : {},
      };
    } catch {
      return structuredClone(DEFAULT_PREFS);
    }
  }

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
  setTheme(t: ThemeChoice): void {
    this.write({ ...this.getAll(), theme: t });
  }
  setNotifications(n: NotificationPrefs): void {
    this.write({ ...this.getAll(), notifications: n });
  }
  getAccount(email: string): AccountPref {
    return this.getAll().accounts[email] ?? {};
  }
  setAccount(email: string, partial: Partial<AccountPref>): void {
    const prefs = this.getAll();
    const next = { ...(prefs.accounts[email] ?? {}), ...partial };
    // Drop keys explicitly cleared with undefined/'' so labels can be removed.
    if (partial.label === '' || partial.label === undefined && 'label' in partial) delete next.label;
    prefs.accounts = { ...prefs.accounts, [email]: next };
    this.write(prefs);
  }
  setOrder(emailsInOrder: string[]): void {
    const prefs = this.getAll();
    emailsInOrder.forEach((email, i) => {
      prefs.accounts = { ...prefs.accounts, [email]: { ...(prefs.accounts[email] ?? {}), order: i } };
    });
    this.write(prefs);
  }
}
