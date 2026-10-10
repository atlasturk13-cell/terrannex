import type http from "http";
import type { WebSocketServer } from "ws";

type ShutdownLogger = {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string, error?: unknown) => void;
};

export interface GracefulShutdownOptions {
  server: http.Server;
  /** WebSocket servers whose clients receive a 1001 close before exit. */
  webSocketServers?: readonly WebSocketServer[];
  /** Extra async work after the listener is closed (stop workers, flush). */
  drain?: () => Promise<void> | void;
  /** Hard deadline before the process exits with code 1. */
  timeoutMs?: number;
  /** Injectable for tests; defaults to process.exit. */
  exit?: (code: number) => void;
  /** Signals to listen for; pass [] to drive shutdown manually. */
  signals?: readonly NodeJS.Signals[];
}

/**
 * Stop accepting connections, tell live WebSocket clients the server is going
 * away, run the optional drain step, then exit. A container stop (SIGTERM) or
 * Ctrl-C (SIGINT) therefore ends cleanly instead of hard-killing live games;
 * a stuck drain is still bounded by `timeoutMs`. Returns a manual trigger so
 * callers and tests can start the same sequence without a signal.
 */
export function installGracefulShutdown(
  log: ShutdownLogger,
  options: GracefulShutdownOptions,
): (reason?: string) => Promise<void> {
  const {
    server,
    webSocketServers = [],
    drain,
    timeoutMs = 10_000,
    exit = (code: number) => process.exit(code),
    signals = ["SIGTERM", "SIGINT"],
  } = options;
  let started = false;

  const shutdown = async (reason = "manual"): Promise<void> => {
    if (started) return;
    started = true;
    log.info(`Shutting down (${reason})`);
    const deadline = setTimeout(() => {
      log.warn(`Shutdown exceeded ${timeoutMs} ms; forcing exit`);
      exit(1);
    }, timeoutMs);
    deadline.unref?.();

    try {
      for (const wss of webSocketServers) {
        for (const client of wss.clients) {
          try {
            client.close(1001, "Server shutting down");
          } catch {
            // A client that already errored has nothing left to close.
          }
        }
      }
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        // Keep-alive sockets would otherwise hold close() open until they idle.
        server.closeIdleConnections?.();
        server.closeAllConnections?.();
      });
      await drain?.();
      clearTimeout(deadline);
      log.info("Shutdown complete");
      exit(0);
    } catch (error) {
      clearTimeout(deadline);
      log.error("Shutdown failed:", error);
      exit(1);
    }
  };

  for (const signal of signals) {
    process.once(signal, () => {
      void shutdown(signal);
    });
  }
  return shutdown;
}
