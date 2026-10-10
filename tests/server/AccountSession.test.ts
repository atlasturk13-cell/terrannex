// @vitest-environment node
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { describe, expect, it } from "vitest";
import { GoogleIdentityVerifier } from "../../src/server/accounts/GoogleIdentity";
import {
  SESSION_TTL_SECONDS,
  SessionSigner,
} from "../../src/server/accounts/Session";

const SECRET = "a-test-secret-that-is-long-enough-for-sessions";

describe("account sessions", () => {
  it("round-trips claims and rejects tampering, other secrets and expiry", async () => {
    const signer = new SessionSigner(SECRET);
    const now = 1_700_000_000_000;
    const token = await signer.sign(
      { accountId: "acc-1", displayName: "Ada" },
      now,
    );
    expect(await signer.verify(token, now + 1000)).toEqual({
      accountId: "acc-1",
      displayName: "Ada",
    });
    expect(await signer.verify(token + "x", now)).toBeNull();
    expect(
      await new SessionSigner(SECRET + "-other").verify(token, now),
    ).toBeNull();
    expect(
      await signer.verify(token, now + (SESSION_TTL_SECONDS + 60) * 1000),
    ).toBeNull();
    expect(await signer.verify("not-a-jwt", now)).toBeNull();
    expect(() => new SessionSigner("short")).toThrow(/32 characters/);
  });
});

describe("Google identity", () => {
  async function googleLike(payload: Record<string, unknown>, aud: string) {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const jwk: JWK = await exportJWK(publicKey);
    const token = await new SignJWT(payload)
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer("https://accounts.google.com")
      .setAudience(aud)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);
    const keys = async () =>
      await import("jose").then((j) => j.importJWK(jwk, "RS256"));
    return { token, keys };
  }

  it("accepts a token for our client and reads the verified profile", async () => {
    const { token, keys } = await googleLike(
      {
        sub: "google-sub-42",
        email: "ada@example.com",
        email_verified: true,
        name: "Ada Lovelace",
      },
      "our-client-id",
    );
    const verifier = new GoogleIdentityVerifier("our-client-id", keys);
    expect(await verifier.verify(token)).toEqual({
      subject: "google-sub-42",
      email: "ada@example.com",
      displayName: "Ada Lovelace",
    });
  });

  it("drops unverified emails and rejects other audiences", async () => {
    const unverified = await googleLike(
      {
        sub: "s",
        email: "x@example.com",
        email_verified: false,
        given_name: "X",
      },
      "our-client-id",
    );
    expect(
      await new GoogleIdentityVerifier("our-client-id", unverified.keys).verify(
        unverified.token,
      ),
    ).toEqual({ subject: "s", email: null, displayName: "X" });

    const other = await googleLike({ sub: "s" }, "someone-elses-client");
    expect(
      await new GoogleIdentityVerifier("our-client-id", other.keys).verify(
        other.token,
      ),
    ).toBeNull();
  });
});
