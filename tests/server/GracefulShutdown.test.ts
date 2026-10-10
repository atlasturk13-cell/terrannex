import { describe, expect, test, vi } from "vitest";
import { installGracefulShutdown } from "../../src/server/GracefulShutdown";

function fakeServer(closeDelayMs = 0) {
  const closeIdleConnections = vi.fn();
  const closeAllConnections = vi.fn();
  const server = {
    close: vi.fn((callback: () => void) => {
      setTimeout(callback, closeDelayMs);
    }),
    closeIdleConnections,
    closeAllConnections,
  };
  return server;
}

const quietLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe("graceful shutdown", () => {
  test("closes websocket clients, the listener, drains, then exits 0", async () => {
    const server = fakeServer();
    const client = { close: vi.fn() };
    const drain = vi.fn(async () => {});
    const exit = vi.fn();
    const order: string[] = [];
    client.close.mockImplementation(() => order.push("ws"));
    server.close.mockImplementation((callback: () => void) => {
      order.push("listener");
      callback();
    });
    drain.mockImplementation(async () => {
      order.push("drain");
    });
    exit.mockImplementation((code: number) => order.push(`exit:${code}`));

    const trigger = installGracefulShutdown(quietLog, {
      server: server as never,
      webSocketServers: [{ clients: new Set([client]) } as never],
      drain,
      exit,
      signals: [],
    });
    await trigger("test");

    expect(order).toEqual(["ws", "listener", "drain", "exit:0"]);
    expect(client.close).toHaveBeenCalledWith(1001, "Server shutting down");
    expect(server.closeIdleConnections).toHaveBeenCalledOnce();
    expect(server.closeAllConnections).toHaveBeenCalledOnce();
  });

  test("runs the sequence only once even when triggered repeatedly", async () => {
    const server = fakeServer();
    const exit = vi.fn();
    const trigger = installGracefulShutdown(quietLog, {
      server: server as never,
      exit,
      signals: [],
    });
    await Promise.all([trigger("a"), trigger("b"), trigger("c")]);
    expect(server.close).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  test("forces exit 1 when the drain never finishes", async () => {
    vi.useFakeTimers();
    try {
      const server = fakeServer();
      const exit = vi.fn();
      const trigger = installGracefulShutdown(quietLog, {
        server: server as never,
        drain: () => new Promise<void>(() => {}),
        timeoutMs: 50,
        exit,
        signals: [],
      });
      const pending = trigger("hang");
      await vi.advanceTimersByTimeAsync(60);
      expect(exit).toHaveBeenCalledWith(1);
      void pending;
    } finally {
      vi.useRealTimers();
    }
  });

  test("exits 1 when the drain throws", async () => {
    const server = fakeServer();
    const exit = vi.fn();
    const trigger = installGracefulShutdown(quietLog, {
      server: server as never,
      drain: () => {
        throw new Error("boom");
      },
      exit,
      signals: [],
    });
    await trigger("boom");
    expect(exit).toHaveBeenCalledWith(1);
  });
});
