import { randomBytes, createHash } from "node:crypto";
import {
  CMU_OAUTH_AUTHORIZE_URL,
  CMU_OAUTH_TOKEN_URL,
  CMU_OAUTH_BASIC_INFO_URL,
  CMU_OAUTH_SCOPE,
  OAUTH_REDIRECT_URI,
} from "../constants.js";

export interface CmuAuthorization {
  url: string;
  state: string;
}

export interface CmuTokenExchangeSuccess {
  type: "success";
  accessToken: string;
  email?: string;
  firstName?: string;
  lastName?: string;
}

export interface CmuTokenExchangeFailure {
  type: "failed";
  error: string;
}

export type CmuTokenExchangeResult =
  | CmuTokenExchangeSuccess
  | CmuTokenExchangeFailure;

export interface CmuBasicInfo {
  cmuitaccount_name: string;
  cmuitaccount: string;
  student_id?: string;
  prename_TH?: string;
  prename_EN?: string;
  firstname_TH: string;
  firstname_EN: string;
  lastname_TH: string;
  lastname_EN: string;
  organization_code: string;
  organization_name_TH: string;
  organization_name_EN: string;
  itaccounttype_id: string;
  itaccounttype_TH: string;
  itaccounttype_EN: string;
}

/**
 * Build the CMU OAuth authorization URL.
 * Uses the authorization code flow with a state parameter for CSRF protection.
 */
export function authorizeCmu(clientId: string): CmuAuthorization {
  const state = randomBytes(16).toString("hex");

  const url = new URL(CMU_OAUTH_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", OAUTH_REDIRECT_URI);
  url.searchParams.set("scope", CMU_OAUTH_SCOPE);
  url.searchParams.set("state", state);

  return { url: url.toString(), state };
}

/**
 * Exchange the CMU OAuth authorization code for an access token,
 * then fetch user basic info.
 */
export async function exchangeCmu(
  code: string,
  clientId: string,
  clientSecret: string,
): Promise<CmuTokenExchangeResult> {
  try {
    const tokenResponse = await fetch(CMU_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        code,
        redirect_uri: OAUTH_REDIRECT_URI,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      return { type: "failed", error: `Token exchange failed: ${errorText}` };
    }

    const tokenPayload = (await tokenResponse.json()) as {
      access_token: string;
    };

    if (!tokenPayload.access_token) {
      return { type: "failed", error: "No access_token in token response" };
    }

    const userInfo = await fetchCmuBasicInfo(tokenPayload.access_token);

    return {
      type: "success",
      accessToken: tokenPayload.access_token,
      email: userInfo?.cmuitaccount,
      firstName: userInfo?.firstname_EN,
      lastName: userInfo?.lastname_EN,
    };
  } catch (error) {
    return {
      type: "failed",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Fetch user basic info from CMU API using the access token.
 */
async function fetchCmuBasicInfo(
  accessToken: string,
): Promise<CmuBasicInfo | null> {
  try {
    const response = await fetch(CMU_OAUTH_BASIC_INFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) return null;
    return (await response.json()) as CmuBasicInfo;
  } catch {
    return null;
  }
}
