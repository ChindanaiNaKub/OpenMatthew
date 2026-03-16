import { randomBytes, createHash } from "node:crypto";
import {
  MICROSOFT_AUTHORIZE_URL,
  MICROSOFT_TOKEN_URL,
  MATTHEW_CLIENT_ID,
  MATTHEW_SCOPE,
  MATTHEW_OAUTH_CALLBACK,
  OAUTH_REDIRECT_URI,
} from "../constants.js";

export interface MicrosoftAuthorization {
  url: string;
  state: string;
  codeVerifier: string;
}

export interface TokenExchangeSuccess {
  type: "success";
  accessToken: string;
}

export interface TokenExchangeFailure {
  type: "failed";
  error: string;
}

export type TokenExchangeResult =
  | TokenExchangeSuccess
  | TokenExchangeFailure;

/**
 * Build the Microsoft Azure AD authorization URL with PKCE.
 * Redirects to localhost so the plugin's callback server captures the code.
 */
export function authorizeMicrosoftPKCE(
  clientId?: string,
): MicrosoftAuthorization {
  const effectiveClientId = clientId || MATTHEW_CLIENT_ID;
  const state = randomBytes(16).toString("hex");

  const verifier = randomBytes(32)
    .toString("base64url")
    .substring(0, 128);
  const challenge = createHash("sha256")
    .update(verifier)
    .digest("base64url");

  const url = new URL(MICROSOFT_AUTHORIZE_URL);
  url.searchParams.set("client_id", effectiveClientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", OAUTH_REDIRECT_URI);
  url.searchParams.set("scope", MATTHEW_SCOPE);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("response_mode", "query");

  return { url: url.toString(), state, codeVerifier: verifier };
}

/**
 * Exchange code via Matthew's backend.
 * Matthew's /api/oauth_callback takes {code} and returns an access token.
 */
export async function exchangeViaMatthew(
  code: string,
): Promise<TokenExchangeResult> {
  try {
    const response = await fetch(MATTHEW_OAUTH_CALLBACK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });

    if (!response.ok) {
      const text = await response.text();
      return { type: "failed", error: `Matthew callback ${response.status}: ${text}` };
    }

    const data = (await response.json()) as Record<string, unknown>;
    const token = (data.access_token as string) || (data.token as string);

    if (!token) {
      return { type: "failed", error: `No token in response: ${JSON.stringify(Object.keys(data))}` };
    }

    return { type: "success", accessToken: token };
  } catch (error) {
    return {
      type: "failed",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Exchange code directly with Microsoft's token endpoint using PKCE.
 * Fallback when Matthew's backend rejects the code (redirect_uri mismatch).
 */
export async function exchangeWithMicrosoft(
  code: string,
  codeVerifier: string,
  clientId?: string,
): Promise<TokenExchangeResult> {
  const effectiveClientId = clientId || MATTHEW_CLIENT_ID;

  try {
    const response = await fetch(MICROSOFT_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: effectiveClientId,
        grant_type: "authorization_code",
        code,
        redirect_uri: OAUTH_REDIRECT_URI,
        code_verifier: codeVerifier,
        scope: MATTHEW_SCOPE,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return { type: "failed", error: `Microsoft token ${response.status}: ${text}` };
    }

    const data = (await response.json()) as { access_token: string };

    if (!data.access_token) {
      return { type: "failed", error: "No access_token from Microsoft" };
    }

    return { type: "success", accessToken: data.access_token };
  } catch (error) {
    return {
      type: "failed",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
