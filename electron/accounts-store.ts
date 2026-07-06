import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface Account {
  id: string;
  label: string;
  color: string;
}

export class AccountsStore {
  constructor(private readonly filePath: string) {}

  list(): Account[] {
    if (!existsSync(this.filePath)) return [];
    try {
      const raw = readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as Account[]) : [];
    } catch {
      return [];
    }
  }

  add(input: { label: string; color: string }): Account {
    const account: Account = { id: randomUUID(), label: input.label, color: input.color };
    const next = [...this.list(), account];
    this.persist(next);
    return account;
  }

  remove(id: string): void {
    this.persist(this.list().filter((a) => a.id !== id));
  }

  private persist(accounts: Account[]): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(accounts, null, 2), 'utf8');
  }
}
