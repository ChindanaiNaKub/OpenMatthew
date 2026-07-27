import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";

export interface AccountMetadata {
  accessToken: string;
  sessionToken: string;
  defaultAssistantId?: string;
  userName?: string;
  userNameTh?: string;
  addedAt: number;
  lastUsed: number;
}

export interface AccountStorage {
  version: 1;
  accounts: AccountMetadata[];
  activeIndex: number;
}

const STORAGE_FILE_NAME = "matthew-accounts.json";

function getStoragePath(configDir: string): string {
  return join(configDir, STORAGE_FILE_NAME);
}

export async function loadAccounts(configDir: string): Promise<AccountStorage | null> {
  try {
    const path = getStoragePath(configDir);
    const content = await fs.readFile(path, "utf-8");
    const data = JSON.parse(content) as AccountStorage;

    if (!Array.isArray(data.accounts)) return null;

    let activeIndex =
      typeof data.activeIndex === "number" ? data.activeIndex : 0;
    if (data.accounts.length > 0) {
      activeIndex = Math.min(activeIndex, data.accounts.length - 1);
      activeIndex = Math.max(activeIndex, 0);
    } else {
      activeIndex = 0;
    }

    return { version: 1, accounts: data.accounts, activeIndex };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    return null;
  }
}

export async function saveAccounts(configDir: string, storage: AccountStorage): Promise<void> {
  const path = getStoragePath(configDir);
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, JSON.stringify(storage, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
}

export async function clearAccounts(configDir: string): Promise<void> {
  try {
    await fs.unlink(getStoragePath(configDir));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}
