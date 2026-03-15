/**
 * Microsoft Azure AD OAuth configuration for CMU tenant.
 * Matthew uses Microsoft SSO (not CMU OAuth at oauth.cmu.ac.th).
 *
 * Extracted from matthew.cmu.ac.th JS bundle (main.cfe9534d.js):
 *   REACT_APP_OAUTH_PROVIDER_URL, REACT_APP_CLIENT_ID, REACT_APP_SCOPE
 */
export const CMU_TENANT_ID = "cf81f1df-de59-4c29-91da-a2dfd04aa751";

export const MICROSOFT_AUTHORIZE_URL = `https://login.microsoftonline.com/${CMU_TENANT_ID}/oauth2/v2.0/authorize`;
export const MICROSOFT_TOKEN_URL = `https://login.microsoftonline.com/${CMU_TENANT_ID}/oauth2/v2.0/token`;

export const MATTHEW_CLIENT_ID = "5bedd6e5-ae10-4b96-abca-5c887092a70c";
export const MATTHEW_SCOPE = "api://cmu/Mis.Account.Read.Me.Basicinfo";
export const MATTHEW_REDIRECT_URI = "https://matthew.cmu.ac.th";

/**
 * Local OAuth callback server configuration.
 */
export const OAUTH_CALLBACK_PORT = 51122;
export const OAUTH_REDIRECT_URI = `http://localhost:${OAUTH_CALLBACK_PORT}/oauth-callback`;

/**
 * Matthew AI platform endpoints.
 * @see https://matthew.cmu.ac.th
 */
export const MATTHEW_API_BASE = "https://matthew.cmu.ac.th";
export const MATTHEW_OAUTH_CALLBACK = `${MATTHEW_API_BASE}/api/oauth_callback`;
export const MATTHEW_THREAD_MESSAGE = `${MATTHEW_API_BASE}/api/thread_sse_message`;
export const MATTHEW_THREAD_STREAM = `${MATTHEW_API_BASE}/api/thread_sse_response_stream`;

/**
 * Provider ID registered with OpenCode.
 */
export const MATTHEW_PROVIDER_ID = "matthew";
