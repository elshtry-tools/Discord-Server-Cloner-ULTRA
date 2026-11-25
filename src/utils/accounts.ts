import { existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";

const ACCOUNTS_PATH = path.resolve(process.cwd(), "accounts.json");

export interface SavedAccount {
  userId: string;
  username: string;
  token: string;
  lastUsedAt: number;
}

interface AccountsStore {
  lastActiveUserId?: string;
  accounts: SavedAccount[];
}

function readStore(): AccountsStore {
  if (!existsSync(ACCOUNTS_PATH)) {
    return { accounts: [] };
  }
  try {
    const raw = readFileSync(ACCOUNTS_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Partial<AccountsStore>;
    return {
      lastActiveUserId: parsed.lastActiveUserId,
      accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
    };
  } catch {
    return { accounts: [] };
  }
}

function writeStore(store: AccountsStore): void {
  try {
    writeFileSync(ACCOUNTS_PATH, JSON.stringify(store, null, 2), "utf-8");
  } catch {
    // Non-fatal if read-only
  }
}

export function listSavedAccounts(): SavedAccount[] {
  const store = readStore();
  return [...store.accounts].sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0));
}

export function getLastActiveAccount(): SavedAccount | null {
  const store = readStore();
  if (store.accounts.length === 0) return null;
  if (store.lastActiveUserId) {
    const found = store.accounts.find((a) => a.userId === store.lastActiveUserId);
    if (found) return found;
  }
  return listSavedAccounts()[0] ?? null;
}

export function isAccountSaved(userId: string): boolean {
  return readStore().accounts.some((a) => a.userId === userId);
}

export function saveOrUpdateAccount(account: Omit<SavedAccount, "lastUsedAt">): void {
  const store = readStore();
  const idx = store.accounts.findIndex(
    (a) => a.userId === account.userId || a.token === account.token
  );
  const entry: SavedAccount = {
    ...account,
    lastUsedAt: Date.now(),
  };
  if (idx >= 0) {
    store.accounts[idx] = entry;
  } else {
    store.accounts.push(entry);
  }
  store.lastActiveUserId = account.userId;
  writeStore(store);
}

export function markAccountUsed(userId: string): void {
  const store = readStore();
  const found = store.accounts.find((a) => a.userId === userId);
  if (found) {
    found.lastUsedAt = Date.now();
    store.lastActiveUserId = userId;
    writeStore(store);
  }
}

export function removeSavedAccount(userId: string): void {
  const store = readStore();
  store.accounts = store.accounts.filter((a) => a.userId !== userId);
  if (store.lastActiveUserId === userId) {
    store.lastActiveUserId = store.accounts[0]?.userId;
  }
  writeStore(store);
}
