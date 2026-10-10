import { describe, expect, test } from "vitest";
import { assertLocalRuntimeBoundary } from "../../src/server/LocalRuntimeBoundary";

const validLocalEnv = {
  LOCAL_ONLY: "true",
  DOMAIN: "localhost",
  GAME_ENV: "dev",
  TRUST_PROXY_HOPS: "1",
  TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
};

describe("local runtime boundary", () => {
  test("accepts the exact self-contained profile", () => {
    expect(() => assertLocalRuntimeBoundary(validLocalEnv)).not.toThrow();
  });

  test.each([
    [{ ...validLocalEnv, DOMAIN: "attacker.example" }, /DOMAIN=localhost/],
    [{ ...validLocalEnv, GAME_ENV: "prod" }, /GAME_ENV=dev/],
    [{ ...validLocalEnv, TRUST_PROXY_HOPS: "7" }, /TRUST_PROXY_HOPS=1/],
    [{ ...validLocalEnv, TRUST_PROXY_HOPS: "0" }, /TRUST_PROXY_HOPS=1/],
    [
      { ...validLocalEnv, TURNSTILE_SITE_KEY: "real-secret" },
      /public Turnstile test key/,
    ],
    [{ ...validLocalEnv, API_KEY: "sentinel" }, /API_KEY/],
    [{ ...validLocalEnv, OTEL_AUTH_HEADER: "sentinel" }, /OTEL_AUTH_HEADER/],
    [{ ...validLocalEnv, TELEMETRY_ENABLED: "true" }, /TELEMETRY_ENABLED/],
  ] as const)("rejects dirty integration environment %#", (env, error) => {
    expect(() => assertLocalRuntimeBoundary(env)).toThrow(error);
  });

  test.each(["1", "2", "3", "4"])(
    "accepts %s trusted reverse-proxy hops",
    (hops) => {
      expect(() =>
        assertLocalRuntimeBoundary({
          ...validLocalEnv,
          TRUST_PROXY_HOPS: hops,
        }),
      ).not.toThrow();
    },
  );

  test("leaves an explicitly hosted profile to the upstream validator", () => {
    expect(() =>
      assertLocalRuntimeBoundary({ LOCAL_ONLY: "false" }),
    ).not.toThrow();
  });
});
