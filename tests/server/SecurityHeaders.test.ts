import { describe, expect, test, vi } from "vitest";
import { setSecurityHeaders } from "../../src/server/SecurityHeaders";

describe("setSecurityHeaders", () => {
  test("applies the browser security baseline", () => {
    const headers = new Map<string, string>();
    setSecurityHeaders({
      setHeader: vi.fn(
        (name: string, value: string | number | readonly string[]) => {
          headers.set(name, String(value));
          return undefined as never;
        },
      ),
    });

    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("Referrer-Policy")).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(headers.get("Permissions-Policy")).toContain("camera=()");
    expect(headers.get("Content-Security-Policy")).toContain(
      "frame-ancestors 'none'",
    );
    expect(headers.get("Content-Security-Policy")).toContain(
      "object-src 'none'",
    );
    expect(headers.get("Content-Security-Policy")).toContain(
      "connect-src 'self'",
    );
    expect(headers.get("Content-Security-Policy")).not.toContain(" wss:");
    expect(headers.has("Strict-Transport-Security")).toBe(false);
  });

  test("adds HSTS only when the operator opts in behind TLS", () => {
    const headers = new Map<string, string>();
    setSecurityHeaders(
      {
        setHeader: vi.fn(
          (name: string, value: string | number | readonly string[]) => {
            headers.set(name, String(value));
            return undefined as never;
          },
        ),
      },
      { hsts: true },
    );
    expect(headers.get("Strict-Transport-Security")).toBe(
      "max-age=31536000; includeSubDomains",
    );
  });
});
