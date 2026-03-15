/**
 * CMU OAuth endpoints and configuration.
 * @see https://oauth.cmu.ac.th
 */
export const CMU_OAUTH_AUTHORIZE_URL = "https://oauth.cmu.ac.th/v1/Authorize.aspx";
export const CMU_OAUTH_TOKEN_URL = "https://oauth.cmu.ac.th/v1/GetToken.aspx";
export const CMU_OAUTH_BASIC_INFO_URL =
  "https://misapi.cmu.ac.th/cmuitaccount/v1/api/cmuitaccount/basicinfo";

export const CMU_OAUTH_SCOPE = "cmuitaccount.basicinfo";

/**
 * Local OAuth callback server configuration.
 * The redirect URI must match what is registered with CMU OAuth.
 */
export const OAUTH_CALLBACK_PORT = 51122;
export const OAUTH_REDIRECT_URI = `http://localhost:${OAUTH_CALLBACK_PORT}/oauth-callback`;

/**
 * Matthew AI platform endpoint.
 * @see https://matthew.cmu.ac.th
 */
export const MATTHEW_API_BASE = "https://matthew.cmu.ac.th";

/**
 * Provider ID registered with OpenCode.
 */
export const MATTHEW_PROVIDER_ID = "matthew";
