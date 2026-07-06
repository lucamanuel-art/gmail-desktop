import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface Settings {
  outlookShortcuts: boolean;
}

const DEFAULTS: Settings = { outlookShortcuts: true };

export class SettingsStore {
  constructor(private readonly filePath: string) {}

  get(): Settings {
    if (!existsSync(this.filePath)) return { ...DEFAULTS };
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8'));
      return { ...DEFAULTS, ...(parsed as Partial<Settings>) };
    } catch {
      return { ...DEFAULTS };
    }
  }

  set(patch: Partial<Settings>): Settings {
    const next = { ...this.get(), ...patch };
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(next, null, 2), 'utf8');
    return next;
  }
}
