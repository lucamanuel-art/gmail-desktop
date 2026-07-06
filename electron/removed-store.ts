import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// Persists the set of account emails the user explicitly removed. Accounts are
// auto-detected from the shared Google session, so without this a removed
// account would immediately reappear on the next detection. Detection skips
// any email listed here; signing in again via the "+" flow clears it.
export class RemovedStore {
  constructor(private readonly filePath: string) {}

  private read(): string[] {
    if (!existsSync(this.filePath)) return [];
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8'));
      return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }

  private write(list: string[]): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(list, null, 2), 'utf8');
  }

  list(): string[] {
    return this.read();
  }

  has(email: string): boolean {
    return this.read().includes(email);
  }

  add(email: string): void {
    const list = this.read();
    if (!list.includes(email)) {
      list.push(email);
      this.write(list);
    }
  }

  remove(email: string): void {
    this.write(this.read().filter((e) => e !== email));
  }
}
