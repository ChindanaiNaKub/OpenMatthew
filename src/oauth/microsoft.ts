import { randomBytes, createHash } from "node:crypto";
import {
  MICROSOFT_AUTHORIZE_URL,
  MATTHEW_CLIENT_ID,
  MATTHEW_SCOPE,
  MATTHEW_REDIRECT_URI,
  MATTHEW_OAUTH_CALLBACK,
  OAUTH_REDIRECT_URI,
} from "../constants.js";

export interface MicrosoftAuthorization {
  url: string;
  state: string;
}

export interface TokenExchangeSuccess {
  type: "success";
  accessToken: string;
  userInfo?: Record<string, unknown>;
}

export interface TokenExchangeFailure {
  type: "failed";
  error: string;
}

export type TokenExchangeResult =
  | TokenExchangeSuccess
  | TokenExchangeFailure;

/**
 * Build the Microsoft Azure AD authorization URL.
 * Uses the same parameters as Matthew's frontend.
 * Redirects to matthew.cmu.ac.th so the code can be exchanged via
 * Matthew's /api/oauth_callback backend.
 */
export function authorizeMicrosoft(
  clientId?: string,
): MicrosoftAuthorization {
  const effectiveClientId = clientId || MATTHEW_CLIENT_ID;
  const state = randomBytes(16).toString("hex");

  const url = new URL(MICROSOFT_AUTHORIZE_URL);
  url.searchParams.set("client_id", effectiveClientId);
  url.searchParams.set("redirect_uri", MATTHEW_REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", MATTHEW_SCOPE);

  return { url: url.toString(), state };
}

/**
 * Exchange an authorization code via Matthew's backend.
 * Matthew's /api/oauth_callback handles the Microsoft token exchange
 * internally and returns a Matthew access token.
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
      const errorBody = await response.text();
      return {
        type: "failed",
        error: `Matthew OAuth callback failed (${response.status}): ${errorBody}`,
      };
    }

    const data = (await response.json()) as Record<string, unknown>;

    const accessToken =
      (data.access_token as string) || (data.token as string);

    if (!accessToken) {
      return {
        type: "failed",
        error: `No access_token in Matthew response: ${JSON.stringify(Object.keys(data))}`,
      };
    }

    return {
      type: "success",
      accessToken,
      userInfo: data,
    };
  } catch (error) {
    return {
      type: "failed",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
