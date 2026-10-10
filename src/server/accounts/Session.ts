/**
 * Account sessions: a compact HS256 JWT the client keeps in local storage
 * and presents when it joins a match or asks for its profile. Signed with
 * SESSION_SECRET; without that secret accounts are switched off and every
 * player is a guest, exactly as before.
 */
import { createHash } from "crypto";
import { jwtVerify, SignJWT } from "jose";

export const SESSION_ISSUER = "front-wars-accounts";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

export interface SessionClaims {
  /** Account id. */
  accountId: string;
  displayName: string;
}

export class SessionSigner {
  private readonly key: Uint8Array;

  constructor(secret: string) {
    if (secret.length < 32) {
      throw new Error("SESSION_SECRET must be at least 32 characters");
    }
    // Hash to a fixed 256-bit key so secrets of any length work with HS256.
    this.key = new Uint8Array(createHash("sha256").update(secret).digest());
  }

  async sign(claims: SessionClaims, now = Date.now()): Promise<string> {
    const issuedAt = Math.floor(now / 1000);
    return new SignJWT({ name: claims.displayName })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer(SESSION_ISSUER)
      .setSubject(claims.accountId)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + SESSION_TTL_SECONDS)
      .sign(this.key);
  }

  /** The claims of a valid, unexpired session; null for anything else. */
  async verify(token: string, now = Date.now()): Promise<SessionClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: SESSION_ISSUER,
        algorithms: ["HS256"],
        currentDate: new Date(now),
      });
      if (typeof payload.sub !== "string" || typeof payload.name !== "string") {
        return null;
      }
      return { accountId: payload.sub, displayName: payload.name };
    } catch {
      return null;
    }
  }
}
