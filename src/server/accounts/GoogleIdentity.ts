/**
 * "Sign in with Google": the browser obtains an ID token from Google
 * Identity Services and posts it here; the server verifies the signature
 * against Google's published keys and the audience against our OAuth client
 * id, then trusts the `sub` as the stable identity.
 */
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

export const GOOGLE_ISSUERS = [
  "https://accounts.google.com",
  "accounts.google.com",
];
export const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";

export interface GoogleProfile {
  subject: string;
  email: string | null;
  displayName: string;
}

export class GoogleIdentityVerifier {
  private readonly keys: JWTVerifyGetKey;

  constructor(
    private readonly clientId: string,
    keys: JWTVerifyGetKey = createRemoteJWKSet(new URL(GOOGLE_JWKS_URL)),
  ) {
    this.keys = keys;
  }

  /** The Google profile of a valid ID token for our client, else null. */
  async verify(
    idToken: string,
    now = Date.now(),
  ): Promise<GoogleProfile | null> {
    try {
      const { payload } = await jwtVerify(idToken, this.keys, {
        issuer: GOOGLE_ISSUERS,
        audience: this.clientId,
        currentDate: new Date(now),
      });
      if (typeof payload.sub !== "string") return null;
      const verifiedEmail =
        payload.email_verified === true && typeof payload.email === "string"
          ? payload.email
          : null;
      const name =
        typeof payload.name === "string" && payload.name.trim() !== ""
          ? payload.name.trim()
          : typeof payload.given_name === "string"
            ? payload.given_name
            : "Player";
      return { subject: payload.sub, email: verifiedEmail, displayName: name };
    } catch {
      return null;
    }
  }
}
