import http from "http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { GameMapType, GameType } from "../../src/core/game/Game";
import { Client } from "../../src/server/Client";
import { GameManager } from "../../src/server/GameManager";

vi.mock("../../src/server/Logger", () => ({
  logger: {
    child: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
  },
}));

const mockLogger: any = {
  child: vi.fn().mockReturnThis(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const HOST = "11111111-1111-4111-8111-111111111111";
const GUEST = "22222222-2222-4222-8222-222222222222";

type Received = { type: string; [key: string]: unknown };

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function until(
  condition: () => boolean,
  label: string,
  timeoutMs = 8000,
) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `timed out waiting for ${label}; errors=${JSON.stringify(
          mockLogger.error.mock.calls,
        )} warnings=${JSON.stringify(mockLogger.warn.mock.calls.slice(0, 6))}`,
      );
    }
    await wait(25);
  }
}

describe("two independent socket clients", () => {
  const cleanups: Array<() => Promise<void> | void> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    cleanups.length = 0;
    vi.unstubAllEnvs();
  });

  it("receive the same ordered turns, including each other's intents", async () => {
    vi.stubEnv("LOCAL_ONLY", "true");
    vi.stubEnv("GAME_ENV", "dev");
    const gm = new GameManager(mockLogger);
    const game = gm.createGame(
      "RELAYPR1",
      {
        gameType: GameType.Private,
        gameMap: GameMapType.TheBox,
        maxPlayers: 4,
      },
      HOST,
    );
    expect(game).not.toBeNull();
    cleanups.push(() => game!.end());

    // A worker-shaped socket server: the first message is the join, after
    // which the game itself owns the socket (intents, pings, hashes).
    const server = http.createServer();
    const wss = new WebSocketServer({ server });
    let nextClient = 1;
    const clientIds = ["CLIENT01", "CLIENT02"];
    wss.on("connection", (ws) => {
      ws.once("message", (raw) => {
        const join = JSON.parse(raw.toString()) as {
          type: string;
          token: string;
          username: string;
          gameID: string;
        };
        expect(join.type).toBe("join");
        expect(join.gameID).toBe("RELAYPR1");
        const client = new Client(
          clientIds[nextClient++ - 1],
          join.token,
          null,
          null,
          undefined,
          "127.0.0.1",
          join.username,
          null,
          ws,
          undefined,
          undefined,
          [],
        );
        expect(gm.joinClient(client, join.gameID)).toBe("joined");
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    const port =
      typeof address === "object" && address !== null ? address.port : 0;
    cleanups.push(
      () =>
        new Promise<void>((resolve) => {
          wss.close(() => server.close(() => resolve()));
        }),
    );

    function connect(token: string, username: string) {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/w0`);
      const received: Received[] = [];
      ws.on("message", (raw) => received.push(JSON.parse(raw.toString())));
      const open = new Promise<void>((resolve) => ws.once("open", resolve));
      cleanups.push(() => ws.close());
      return {
        ws,
        received,
        join: async () => {
          await open;
          ws.send(
            JSON.stringify({
              type: "join",
              token,
              gameID: "RELAYPR1",
              username,
              clanTag: null,
              turnstileToken: null,
            }),
          );
        },
      };
    }

    const host = connect(HOST, "Host");
    const guest = connect(GUEST, "Guest");
    await host.join();
    await guest.join();
    await until(() => game!.numClients() === 2, "both clients joined");

    game!.prestart();
    game!.start();
    await until(
      () =>
        host.received.some((m) => m.type === "start") &&
        guest.received.some((m) => m.type === "start"),
      `start messages (host saw ${JSON.stringify(host.received.map((m) => m.type))})`,
    );
    const hostStart = host.received.find(
      (m) => m.type === "start",
    ) as unknown as {
      gameStartInfo: { players: Array<{ clientID: string; username: string }> };
    };
    expect(
      hostStart.gameStartInfo.players.map((p) => p.username).sort(),
    ).toEqual(["Guest", "Host"]);

    // The host spawns; the guest must see that intent in the same turn.
    host.ws.send(
      JSON.stringify({
        type: "intent",
        intent: { type: "spawn", clientID: "CLIENT01", tile: 1000 },
      }),
    );
    const turns = (received: Received[]) =>
      received.filter((m) => m.type === "turn") as unknown as Array<{
        turn: {
          turnNumber: number;
          intents: Array<{ type: string; clientID?: string }>;
        };
      }>;
    await until(
      () =>
        turns(host.received).length >= 6 && turns(guest.received).length >= 6,
      "six turns on both clients",
    );

    const hostTurns = turns(host.received).slice(0, 6);
    const guestTurns = turns(guest.received).slice(0, 6);
    expect(hostTurns.map((t) => t.turn.turnNumber)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(JSON.stringify(guestTurns)).toBe(JSON.stringify(hostTurns));
    const spawnTurn = hostTurns.find((t) =>
      t.turn.intents.some((intent) => intent.type === "spawn"),
    );
    expect(spawnTurn).toBeDefined();
    expect(
      spawnTurn!.turn.intents.find((intent) => intent.type === "spawn")
        ?.clientID,
    ).toBe("CLIENT01");
  }, 20_000);
});
