import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export interface AccountMetadata {
  email?: string;
  firstName?: string;
  lastName?: string;
  accessToken: string;
  addedAt: number;
  lastUsed: number;
}

export interface AccountStorage {
  version: 1;
  accounts: AccountMetadata[];
  activeIndex: number;
}

function getConfigDir(): string {
  if (process.env.OPENCODE_CONFIG_DIR) {
    return process.env.OPENCODE_CONFIG_DIR;
  }
  const xdgConfig =
    process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(xdgConfig, "opencode");
}

function getStoragePath(): string {
  return join(getConfigDir(), "matthew-accounts.json");
}

export async function loadAccounts(): Promise<AccountStorage | null> {
  try {
    const path = getStoragePath();
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

export async function saveAccounts(storage: AccountStorage): Promise<void> {
  const path = getStoragePath();
  const configDir = dirname(path);
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(path, JSON.stringify(storage, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
}

export async function clearAccounts(): Promise<void> {
  try {
    const path = getStoragePath();
    await fs.unlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}
