import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Matthew AI platform endpoints.
 * @see https://matthew.cmu.ac.th
 */
export const MATTHEW_API_BASE = "https://matthew.cmu.ac.th";

/**
 * Where users log in. Azure AD only accepts this as a redirect URI —
 * it rejects localhost, which is why login is a copy-paste of the
 * browser's session rather than a callback to a local server.
 */
export const MATTHEW_LOGIN_URL = MATTHEW_API_BASE;

/** Provider ID registered with OpenCode. */
export const MATTHEW_PROVIDER_ID = "matthew";

/** Name sent to Matthew as the uploader of each thread. */
export const CLIENT_NAME = "OpenMatthew";

export function getApiBase(): string {
  return process.env.MATTHEW_API_BASE || MATTHEW_API_BASE;
}

export function getConfigDir(): string {
  if (process.env.OPENCODE_CONFIG_DIR) {
    return process.env.OPENCODE_CONFIG_DIR;
  }
  const xdgConfig = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(xdgConfig, "opencode");
}
