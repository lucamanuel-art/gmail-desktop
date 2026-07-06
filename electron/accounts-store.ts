import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface Account {
  id: string;
  label: string;
  color: string;
  email?: string;
  name?: string;
  avatarUrl?: string;
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

  update(
    id: string,
    patch: Partial<Pick<Account, 'label' | 'color' | 'email' | 'name' | 'avatarUrl'>>,
  ): Account | null {
    const accounts = this.list();
    const idx = accounts.findIndex((a) => a.id === id);
    if (idx === -1) return null;
    const updated = { ...accounts[idx], ...patch };
    accounts[idx] = updated;
    this.persist(accounts);
    return updated;
  }

  private persist(accounts: Account[]): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(accounts, null, 2), 'utf8');
  }
}
