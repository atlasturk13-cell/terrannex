import { describe, expect, test } from "vitest";
import { isAllowedWebSocketOrigin } from "../../src/server/WebSocketOrigin";

describe("websocket origin allowlist", () => {
  test("allows everything while no allowlist is configured", () => {
    expect(isAllowedWebSocketOrigin(undefined, "localhost:3001", null)).toBe(
      true,
    );
    expect(
      isAllowedWebSocketOrigin("http://evil.example", "localhost:3001", null),
    ).toBe(true);
  });

  test("same-origin accepts only an Origin whose host matches the request Host", () => {
    const allow = ["same-origin"];
    expect(
      isAllowedWebSocketOrigin(
        "https://play.example.com",
        "play.example.com",
        allow,
      ),
    ).toBe(true);
    expect(
      isAllowedWebSocketOrigin(
        "https://Play.Example.com",
        "play.example.com ",
        allow,
      ),
    ).toBe(true);
    expect(
      isAllowedWebSocketOrigin(
        "https://evil.example",
        "play.example.com",
        allow,
      ),
    ).toBe(false);
    expect(isAllowedWebSocketOrigin(undefined, "play.example.com", allow)).toBe(
      false,
    );
    expect(
      isAllowedWebSocketOrigin("not a url", "play.example.com", allow),
    ).toBe(false);
  });

  test("explicit origins compare scheme, host and port exactly", () => {
    const allow = ["https://play.example.com", "http://localhost:9000"];
    expect(
      isAllowedWebSocketOrigin("https://play.example.com", "x", allow),
    ).toBe(true);
    expect(isAllowedWebSocketOrigin("http://localhost:9000", "x", allow)).toBe(
      true,
    );
    expect(
      isAllowedWebSocketOrigin("http://play.example.com", "x", allow),
    ).toBe(false);
    expect(
      isAllowedWebSocketOrigin("https://play.example.com:8443", "x", allow),
    ).toBe(false);
  });

  test("a malformed allowlist entry never grants access", () => {
    expect(
      isAllowedWebSocketOrigin("https://play.example.com", "x", ["nonsense"]),
    ).toBe(false);
  });
});
