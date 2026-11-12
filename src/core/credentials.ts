/**
 * The Matthew login a client sends as its bearer token. The bearer value is
 * this blob, base64-encoded, so one string carries all three fields.
 */

export interface MatthewCredentials {
  accessToken: string;
  sessionToken: string;
  assistantId?: string;
}

/** The fields of Matthew's `localStorage.user` blob that we use. */
export interface MatthewUserBlob {
  access_token?: string;
  token?: string;
  defaultAssistant?: { daid?: string };
}

export function fromUserBlob(user: MatthewUserBlob): MatthewCredentials {
  return {
    accessToken: user.access_token ?? "",
    sessionToken: user.token ?? "",
    assistantId: user.defaultAssistant?.daid,
  };
}

export function encodeCredentials(credentials: MatthewCredentials): string {
  return Buffer.from(JSON.stringify(credentials), "utf-8").toString("base64");
}

const FALLBACK_LIFETIME_MS = 3600 * 1000;

/**
 * When the access token itself expires, in epoch milliseconds.
 *
 * Matthew has no refresh endpoint, so this only tells the host when to ask
 * for a fresh login. The token is a JWT in practice; reading its `exp` claim
 * beats inventing a lifetime. Opaque tokens keep the one-hour fallback.
 */
export function credentialExpiry(accessToken: string): number {
  const payload = accessToken.split(".")[1];
  if (payload) {
    try {
      const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8")) as {
        exp?: unknown;
      };
      if (typeof claims.exp === "number" && Number.isFinite(claims.exp)) {
        return claims.exp * 1000;
      }
    } catch {
      // Not a JWT; use the fallback.
    }
  }
  return Date.now() + FALLBACK_LIFETIME_MS;
}

/** Returns null when the value is not a credentials blob. */
export function decodeCredentials(token: string): MatthewCredentials | null {
  try {
    const parsed = JSON.parse(Buffer.from(token, "base64").toString("utf-8")) as Partial<MatthewCredentials>;
    if (parsed.accessToken && parsed.sessionToken) {
      return {
        accessToken: parsed.accessToken,
        sessionToken: parsed.sessionToken,
        assistantId: parsed.assistantId,
      };
    }
  } catch {
    // not a base64-encoded credentials blob
  }
  return null;
}
