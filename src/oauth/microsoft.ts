import { randomBytes } from "node:crypto";
import {
  MICROSOFT_AUTHORIZE_URL,
  MATTHEW_CLIENT_ID,
  MATTHEW_SCOPE,
  MATTHEW_REDIRECT_URI,
  MATTHEW_OAUTH_CALLBACK,
} from "../constants.js";

export interface MicrosoftAuthorization {
  url: string;
  state: string;
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
 * Build the Microsoft Azure AD authorization URL.
 * Redirects to matthew.cmu.ac.th (the only allowed redirect URI).
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
 * Exchange code via Matthew's backend.
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
      return { type: "failed", error: `${response.status}: ${text}` };
    }

    const data = (await response.json()) as Record<string, unknown>;
    const token = (data.access_token as string) || (data.token as string);

    if (!token) {
      return { type: "failed", error: "No token in response" };
    }

    return { type: "success", accessToken: token };
  } catch (error) {
    return {
      type: "failed",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
