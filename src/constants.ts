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
