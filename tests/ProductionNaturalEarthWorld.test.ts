import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  PlayerType,
  UnitType,
  type Game,
  type Player,
} from "../src/core/game/Game";
import { GameUpdateType, type HashUpdate } from "../src/core/game/GameUpdates";
import {
  GameConfigSchema,
  GameStartInfoSchema,
  StampedIntentSchema,
  TurnSchema,
  type StampedIntent,
} from "../src/core/Schemas";
import { NodeGameMapLoader } from "./perf/fullgame/NodeGameMapLoader";

const MAPS_DIR = path.resolve(process.cwd(), "resources/maps");
const GAME_ID = "LocalNE1";
const CLIENT_ID = "LocalP01";
const NATURAL_EARTH_WIDTH = 2000;
const NATURAL_EARTH_HEIGHT = 1000;

function projectWgs84(game: Game, longitude: number, latitude: number) {
  const scale = NATURAL_EARTH_WIDTH / game.map().width();
  const fullX = Math.round(
    ((longitude + 180) * (NATURAL_EARTH_WIDTH - 1)) / 360,
  );
  const fullY = Math.round(
    ((90 - latitude) * (NATURAL_EARTH_HEIGHT - 1)) / 180,
  );
  return game.ref(Math.floor(fullX / scale), Math.floor(fullY / scale));
}

async function createWaterRouteGame(gameMapSize: GameMapSize) {
  vi.resetModules();
  const [{ createGameRunner }, { PathFinding }] = await Promise.all([
    import("../src/core/GameRunner"),
    import("../src/core/pathfinding/PathFinder"),
  ]);
  const config = GameConfigSchema.parse({
    gameMap: GameMapType.NaturalEarthWorld,
    gameMapSize,
    gameType: GameType.Singleplayer,
    gameMode: GameMode.FFA,
    playerTeams: 2,
    difficulty: Difficulty.Medium,
    bots: 0,
    nations: "disabled",
    donateGold: false,
    donateTroops: false,
    infiniteGold: false,
    infiniteTroops: false,
    instantBuild: true,
    randomSpawn: false,
    disabledUnits: [],
    startingGold: 1_000_000,
  });
  const start = GameStartInfoSchema.parse({
    gameID: gameMapSize === GameMapSize.Normal ? "NEWaterN" : "NEWaterC",
    lobbyCreatedAt: 0,
    config,
    players: [
      {
        clientID: CLIENT_ID,
        username: "Natural Earth Navigator",
        clanTag: null,
        cosmetics: {},
      },
    ],
  });
  const runner = await createGameRunner(
    start,
    CLIENT_ID,
    new NodeGameMapLoader(MAPS_DIR),
    () => {},
  );
  return { game: runner.game, PathFinding };
}

function ownedTileHash(player: Player): string {
  const tiles = Array.from(player.tiles()).sort((a, b) => a - b);
  let hash = 0x811c9dc5;
  for (const tile of tiles) {
    hash = Math.imul(hash ^ tile, 0x01000193) >>> 0;
  }
  return `${tiles.length}:${hash.toString(16).padStart(8, "0")}`;
}

function canonicalState(game: Game) {
  return game
    .allPlayers()
    .map((player) => ({
      type: player.type(),
      name: player.name(),
      clientID: player.clientID(),
      spawned: player.hasSpawned(),
      alive: player.isAlive(),
      ownedTiles: ownedTileHash(player),
      ports: player.units(UnitType.Port).map((port) => ({
        tile: port.tile(),
        active: port.isActive(),
        underConstruction: port.isUnderConstruction(),
      })),
    }))
    .sort((a, b) =>
      `${a.type}:${a.name}:${a.clientID ?? ""}`.localeCompare(
        `${b.type}:${b.name}:${b.clientID ?? ""}`,
      ),
    );
}

async function runCoastalWorld() {
  vi.resetModules();
  const { createGameRunner } = await import("../src/core/GameRunner");
  const config = GameConfigSchema.parse({
    gameMap: GameMapType.NaturalEarthWorld,
    gameMapSize: GameMapSize.Normal,
    gameType: GameType.Singleplayer,
    gameMode: GameMode.FFA,
    playerTeams: 2,
    difficulty: Difficulty.Medium,
    bots: 4,
    nations: 8,
    donateGold: false,
    donateTroops: false,
    infiniteGold: false,
    infiniteTroops: false,
    instantBuild: true,
    randomSpawn: false,
    disabledUnits: [],
    startingGold: 1_000_000,
  });
  const start = GameStartInfoSchema.parse({
    gameID: GAME_ID,
    lobbyCreatedAt: 0,
    config,
    players: [
      {
        clientID: CLIENT_ID,
        username: "Natural Earth Commander",
        clanTag: null,
        cosmetics: {},
      },
    ],
  });

  const runtimeErrors: string[] = [];
  const hashes = new Map<number, HashUpdate>();
  const runner = await createGameRunner(
    start,
    CLIENT_ID,
    new NodeGameMapLoader(MAPS_DIR),
    (update) => {
      if ("errMsg" in update) {
        runtimeErrors.push(`${update.errMsg}\n${update.stack ?? ""}`);
        return;
      }
      for (const hash of update.updates[GameUpdateType.Hash] as HashUpdate[]) {
        hashes.set(hash.tick, structuredClone(hash));
      }
    },
  );

  let nextTurn = 0;
  const executeTurn = (intents: StampedIntent[] = []) => {
    for (const intent of intents) StampedIntentSchema.parse(intent);
    const turn = TurnSchema.parse({ turnNumber: nextTurn++, intents });
    runner.addTurn(turn);
    if (!runner.executeNextTick() || runtimeErrors.length > 0) {
      throw new Error(
        `Natural Earth production turn ${turn.turnNumber} failed: ${runtimeErrors[runtimeErrors.length - 1] ?? "runner rejected turn"}`,
      );
    }
  };

  executeTurn();
  executeTurn();
  executeTurn();

  const human = runner.game.playerByClientID(CLIENT_ID);
  if (human === null) throw new Error("local human missing");
  const nations = runner.game
    .allPlayers()
    .filter((player) => player.type() === PlayerType.Nation);
  const bots = runner.game
    .allPlayers()
    .filter((player) => player.type() === PlayerType.Bot);
  expect(nations).toHaveLength(8);
  expect(bots).toHaveLength(4);
  expect([...nations, ...bots].every((player) => player.hasSpawned())).toBe(
    true,
  );

  let landTiles = 0;
  let oceanTiles = 0;
  let shoreTiles = 0;
  let coast: number | undefined;
  runner.game.forEachTile((tile) => {
    if (runner.game.isLand(tile)) landTiles++;
    if (runner.game.isOcean(tile)) oceanTiles++;
    if (runner.game.isShore(tile)) shoreTiles++;
    if (
      coast === undefined &&
      runner.game.isShore(tile) &&
      runner.game.isOceanShore(tile) &&
      !runner.game.isImpassable(tile) &&
      !runner.game.isOnEdgeOfMap(tile) &&
      !runner.game.hasOwner(tile)
    ) {
      coast = tile;
    }
  });
  expect(landTiles).toBe(679332);
  expect(oceanTiles).toBeGreaterThan(1_000_000);
  expect(shoreTiles).toBeGreaterThan(10_000);
  if (coast === undefined)
    throw new Error("unowned Natural Earth coast missing");

  executeTurn([{ type: "spawn", tile: coast, clientID: CLIENT_ID }]);
  executeTurn();
  expect(human.hasSpawned()).toBe(true);
  expect(runner.game.owner(coast)).toBe(human);

  const portTile = human.canBuild(UnitType.Port, coast);
  if (portTile === false)
    throw new Error("coastal Port placement was rejected");
  executeTurn([
    {
      type: "build_unit",
      unit: UnitType.Port,
      tile: coast,
      clientID: CLIENT_ID,
    },
  ]);
  expect(human.units(UnitType.Port)).toHaveLength(0);
  executeTurn();

  const port = human.units(UnitType.Port)[0];
  expect(port).toBeDefined();
  expect(port.tile()).toBe(portTile);
  expect(port.owner()).toBe(human);
  expect(port.isActive()).toBe(true);
  expect(port.isUnderConstruction()).toBe(false);
  expect(runner.game.config().isUnitDisabled(UnitType.Port)).toBe(false);
  expect(runner.game.config().isUnitDisabled(UnitType.TransportShip)).toBe(
    false,
  );
  expect(runner.game.config().isUnitDisabled(UnitType.Warship)).toBe(false);

  while (nextTurn <= 100) executeTurn();
  expect(runtimeErrors).toEqual([]);
  const hash = hashes.get(100);
  if (hash === undefined) {
    throw new Error(`tick 100 hash missing: ${[...hashes.keys()].join(",")}`);
  }

  return {
    config,
    counts: {
      humans: runner.game
        .allPlayers()
        .filter((player) => player.type() === PlayerType.Human).length,
      nations: nations.length,
      bots: bots.length,
    },
    coast,
    portTile,
    tick: runner.game.ticks(),
    hash,
    state: canonicalState(runner.game),
    runtimeErrors,
  };
}

describe("production Natural Earth local world", () => {
  it.each([GameMapSize.Normal, GameMapSize.Compact])(
    "returns an all-water Black Sea to Aegean route on the production %s map",
    async (gameMapSize) => {
      const { game, PathFinding } = await createWaterRouteGame(gameMapSize);
      const blackSea = projectWgs84(game, 34, 43);
      const marmara = projectWgs84(game, 28.5, 40.65);
      // A point in open Aegean water, rather than the Gallipoli shoreline.
      const aegean = projectWgs84(game, 25, 39.5);
      expect(game.isWater(blackSea)).toBe(true);
      expect(game.isWater(marmara)).toBe(true);
      expect(game.isWater(aegean)).toBe(true);

      const path = PathFinding.Water(game).findPath(blackSea, aegean);
      expect(path).not.toBeNull();
      expect(path).not.toHaveLength(0);
      const landTiles = path
        ?.filter((tile) => !game.isWater(tile))
        .map((tile) => [game.x(tile), game.y(tile)]);
      expect(landTiles).toEqual([]);
    },
  );

  it("authoritatively rejects a land capture on the carved Istanbul water tile", async () => {
    const { game } = await createWaterRouteGame(GameMapSize.Normal);
    const player = game.playerByClientID(CLIENT_ID);
    if (player === null) throw new Error("local human missing");
    const istanbulStrait = projectWgs84(game, 28.5, 41);

    expect(game.isWater(istanbulStrait)).toBe(true);
    expect(game.hasOwner(istanbulStrait)).toBe(false);
    expect(player.canAttack(istanbulStrait)).toBe(false);
    expect(() => player.conquer(istanbulStrait)).toThrow(
      /cannot conquer water/,
    );
    expect(game.hasOwner(istanbulStrait)).toBe(false);
  });

  it("spawns exactly 1 human + 8 Nations + 4 Tribes and activates a legal Port deterministically", async () => {
    const first = await runCoastalWorld();
    const second = await runCoastalWorld();

    expect(second).toEqual(first);
    expect(first.counts).toEqual({ humans: 1, nations: 8, bots: 4 });
    expect(first.tick).toBe(101);
    expect(first.runtimeErrors).toEqual([]);
    expect(first.hash).toEqual({
      type: GameUpdateType.Hash,
      tick: 100,
      hash: 1381526395671630,
    });
  });
});
