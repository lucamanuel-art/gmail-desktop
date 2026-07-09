import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// The durability layer: delegated mailboxes persist with Google's real URLs, so
// a persisted entry keeps working regardless of switcher-DOM changes. Detection
// only ever *adds* to this store; only explicit user removal deletes an entry.
export interface StoredDelegate {
  email: string;
  mailUrl: string;
  calendarUrl: string | null;
}

/**
 * Merge a fresh scan into the existing store. Pure, with the HEALTH CHECK: it
 * never removes an existing entry the scan happened to miss, and reports
 * `healthOk === false` when the scan returned fewer entries than we already
 * hold (probable scrape breakage) — the caller then keeps the store intact and
 * surfaces a non-fatal hint instead of pruning. Fields from a fresh scan
 * (e.g. a newly-resolved calendarUrl) overwrite the stored ones for that email.
 */
export function mergeScan(
  existing: StoredDelegate[],
  scanned: StoredDelegate[],
): { next: StoredDelegate[]; healthOk: boolean } {
  const byEmail = new Map(existing.map((d) => [d.email.toLowerCase(), d]));
  for (const s of scanned) {
    const key = s.email.toLowerCase();
    byEmail.set(key, { ...byEmail.get(key), ...s });
  }
  return { next: [...byEmail.values()], healthOk: scanned.length >= existing.length };
}

export class DelegatedStore {
  constructor(private readonly filePath: string) {}

  list(): StoredDelegate[] {
    if (!existsSync(this.filePath)) return [];
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8'));
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }

  private write(items: StoredDelegate[]): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(items, null, 2), 'utf8');
  }

  upsert(d: StoredDelegate): void {
    const items = this.list().filter((x) => x.email.toLowerCase() !== d.email.toLowerCase());
    items.push(d);
    this.write(items);
  }

  remove(email: string): void {
    this.write(this.list().filter((x) => x.email.toLowerCase() !== email.toLowerCase()));
  }
}
