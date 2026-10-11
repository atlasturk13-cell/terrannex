import EventEmitter from "events";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GameMapType,
  GameMode,
  GameType,
  HumansVsNations,
} from "../../src/core/game/Game";
import { LOCAL_PROVENANCE_SAFE_MAPS } from "../../src/core/game/LocalProvenanceSafeMaps";
import { isAdmittedServerMap } from "../../src/server/AdmittedMaps";
import { GameManager } from "../../src/server/GameManager";
import { GameServer } from "../../src/server/GameServer";
import { MapPlaylist, lobbyNationCount } from "../../src/server/MapPlaylist";
import { MasterLobbyService } from "../../src/server/MasterLobbyService";
import { startPolling } from "../../src/server/PollingLoop";
import { ServerEnv } from "../../src/server/ServerEnv";

vi.mock("../../src/server/Logger", () => ({
  logger: {
    child: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
  },
}));

vi.mock("../../src/server/PollingLoop", () => ({
  startPolling: vi.fn(),
}));

const mockLogger: any = {
  child: vi.fn().mockReturnThis(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const admitted = new Set<GameMapType>(LOCAL_PROVENANCE_SAFE_MAPS);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("public lobbies without the closed API", () => {
  it("admits only the provenance-safe maps in the self-contained profile", () => {
    vi.stubEnv("LOCAL_ONLY", "true");
    expect(isAdmittedServerMap(GameMapType.TheBox)).toBe(true);
    expect(isAdmittedServerMap(GameMapType.NaturalEarthWorld)).toBe(true);
    expect(isAdmittedServerMap(GameMapType.World)).toBe(false);
    vi.stubEnv("LOCAL_ONLY", "false");
    expect(isAdmittedServerMap(GameMapType.World)).toBe(true);
  });

  it("rotates every admitted map through the FFA, team and special playlists", async () => {
    vi.stubEnv("LOCAL_ONLY", "true");
    const playlist = new MapPlaylist();
    const seen: Record<string, Set<GameMapType>> = {
      ffa: new Set(),
      team: new Set(),
      special: new Set(),
    };
    for (const type of ["ffa", "team", "special"] as const) {
      for (let i = 0; i < 14; i++) {
        const config = await playlist.gameConfig(type);
        expect(admitted.has(config.gameMap)).toBe(true);
        expect(config.gameType).toBe(GameType.Public);
        expect(config.maxPlayers).toBeGreaterThanOrEqual(2);
        seen[type].add(config.gameMap);
      }
    }
    // Only The Box carries an upstream multiplayer weight; the floor of one
    // ticket per admitted map still rotates the regional maps in.
    expect(seen.ffa.size).toBe(admitted.size);
    expect(seen.team.size).toBe(admitted.size);
    expect(seen.special.size).toBe(admitted.size);
  });

  it("puts AI nations into every public lobby type", async () => {
    vi.stubEnv("LOCAL_ONLY", "true");
    expect(lobbyNationCount(2)).toBe(2);
    expect(lobbyNationCount(25)).toBe(19);
    expect(lobbyNationCount(40)).toBe(30);
    expect(lobbyNationCount(400)).toBe(60);
    const playlist = new MapPlaylist();
    for (let i = 0; i < 12; i++) {
      const team = await playlist.gameConfig("team");
      expect(team.gameMode).toBe(GameMode.Team);
      if (team.playerTeams === HumansVsNations) {
        expect(team.nations).toBe("default");
      } else {
        expect(team.nations).toBe(lobbyNationCount(team.maxPlayers!));
      }
      const ffa = await playlist.gameConfig("ffa");
      // Three quarters of the slots are AI commanders.
      expect(ffa.nations).toBe(lobbyNationCount(ffa.maxPlayers!));
      const special = await playlist.gameConfig("special");
      // Only the 25M-gold preset keeps nations out (no PVP immunity).
      if ((special.startingGold ?? 0) < 25_000_000) {
        expect(special.nations).not.toBe("disabled");
      }
    }
  });

  it("schedules public games only when MULTIPLAYER=true, on admitted maps", async () => {
    vi.stubEnv("LOCAL_ONLY", "true");
    vi.stubEnv("NUM_WORKERS", "1");
    vi.stubEnv("MULTIPLAYER", "");
    vi.stubEnv("PUBLIC_ORIGIN", "");
    const off = new MasterLobbyService(new MapPlaylist(), mockLogger);
    const idleWorker = Object.assign(new EventEmitter(), { send: vi.fn() });
    off.registerWorker(0, idleWorker as any);
    idleWorker.emit("message", { type: "workerReady", workerId: 0 });
    expect(off.isHealthy()).toBe(true);
    expect(startPolling).not.toHaveBeenCalled();

    vi.stubEnv("MULTIPLAYER", "true");
    const on = new MasterLobbyService(new MapPlaylist(), mockLogger);
    const sent: any[] = [];
    const worker = Object.assign(new EventEmitter(), {
      send: vi.fn((msg: unknown, cb?: (e?: Error) => void) => {
        sent.push(msg);
        cb?.();
      }),
    });
    on.registerWorker(0, worker as any);
    worker.emit("message", { type: "workerReady", workerId: 0 });
    expect(startPolling).toHaveBeenCalledTimes(2);

    await (
      on as unknown as { maybeScheduleLobby(): Promise<void> }
    ).maybeScheduleLobby();
    const created = sent.filter((m) => m.type === "createGame");
    expect(created.map((m) => m.publicGameType).sort()).toEqual([
      "ffa",
      "special",
      "team",
    ]);
    for (const message of created) {
      expect(admitted.has(message.gameConfig.gameMap)).toBe(true);
      expect(message.gameConfig.gameType).toBe(GameType.Public);
      expect(message.gameConfig.depthProgression).toBeUndefined();
      expect(message.gameConfig.airportOperationsV1).toBeUndefined();
    }
  });

  it("paces lobbies for the profile and honours the interval override", () => {
    vi.stubEnv("PUBLIC_LOBBY_INTERVAL_SECONDS", "");
    vi.stubEnv("PUBLIC_ORIGIN", "");
    vi.stubEnv("MULTIPLAYER", "true");
    expect(ServerEnv.gameCreationRate()).toBe(30_000);
    vi.stubEnv("PUBLIC_ORIGIN", "https://play.example.com");
    expect(ServerEnv.gameCreationRate()).toBe(30_000);
    vi.stubEnv("PUBLIC_LOBBY_INTERVAL_SECONDS", "45");
    expect(ServerEnv.gameCreationRate()).toBe(45_000);
    vi.stubEnv("PUBLIC_LOBBY_INTERVAL_SECONDS", "5");
    expect(() => ServerEnv.gameCreationRate()).toThrow(/15-3600/);
    vi.stubEnv("PUBLIC_LOBBY_INTERVAL_SECONDS", "soon");
    expect(() => ServerEnv.gameCreationRate()).toThrow(/Invalid/);
  });

  it("refuses unshipped maps for private lobbies and lobby updates", () => {
    vi.stubEnv("LOCAL_ONLY", "true");
    const gm = new GameManager(mockLogger);
    expect(
      gm.createGame("world", {
        gameType: GameType.Private,
        gameMap: GameMapType.World,
      }),
    ).toBeNull();
    const box = gm.createGame("box", {
      gameType: GameType.Private,
      gameMap: GameMapType.TheBox,
    });
    expect(box).not.toBeNull();
    const defaulted = gm.createGame("defaulted", {
      gameType: GameType.Private,
    });
    expect(defaulted?.gameInfo().gameConfig?.gameMap).toBe(
      GameMapType.NaturalEarthWorld,
    );

    const game = new GameServer("upd", mockLogger, Date.now(), {
      gameType: GameType.Private,
      gameMap: GameMapType.TheBox,
    } as any);
    game.updateGameConfig({ gameMap: GameMapType.World });
    expect(game.gameInfo().gameConfig?.gameMap).toBe(GameMapType.TheBox);
    game.updateGameConfig({ gameMap: GameMapType.AsiaPacific });
    expect(game.gameInfo().gameConfig?.gameMap).toBe(GameMapType.AsiaPacific);
  });
});
