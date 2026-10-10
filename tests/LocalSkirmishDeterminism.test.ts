import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createSinglePlayerSession,
  LOCAL_SKIRMISH_CLIENT_ID,
  LOCAL_SKIRMISH_GAME_ID,
} from "../src/client/SinglePlayerSession";
import {
  Difficulty,
  Game,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  Player,
} from "../src/core/game/Game";
import { TileRef } from "../src/core/game/GameMap";
import { GameUpdateType, HashUpdate } from "../src/core/game/GameUpdates";
import { GameConfig, GameStartInfo, StampedIntent } from "../src/core/Schemas";
import { NodeGameMapLoader } from "./perf/fullgame/NodeGameMapLoader";

const MAPS_DIR = path.resolve(process.cwd(), "resources/maps");
const SPAWN_X = 256;
const SPAWN_Y = 256;
const CHECKPOINT_TURNS = [50, 130] as const;
const FINAL_TURN = CHECKPOINT_TURNS[CHECKPOINT_TURNS.length - 1];

interface EconomyCheckpoint {
  tick: number;
  ownedTiles: number;
  troops: number;
  maxTroops: number;
  troopsPerSecond: number;
  gold: number;
  wildernessAttackTroops: number | null;
  tilesGainedLastTenTicks: number;
  ownershipHash: string;
  territoryIsContiguous: boolean;
}

interface FixtureResult {
  gameID: string;
  clientID: string;
  map: GameMapType;
  bots: number;
  mapDimensions: [number, number];
  orderedInputs: Array<{ turnNumber: number; intent: StampedIntent }>;
  adjacentWildernessAtAttack: TileRef;
  tilesAfterSpawn: number;
  finalOwnedTiles: number;
  ownershipHash: string;
  stateHash: HashUpdate;
  territoryIsContiguous: boolean;
  checkpoints: EconomyCheckpoint[];
}

function localGameConfig(): GameConfig {
  return {
    gameMap: GameMapType.TheBox,
    gameMapSize: GameMapSize.Normal,
    gameType: GameType.Singleplayer,
    gameMode: GameMode.FFA,
    playerTeams: 2,
    difficulty: Difficulty.Easy,
    bots: 1,
    nations: "disabled",
    donateGold: false,
    donateTroops: false,
    infiniteGold: false,
    infiniteTroops: false,
    instantBuild: false,
    randomSpawn: false,
    disabledUnits: [],
  };
}

function findAdjacentWilderness(game: Game, player: Player): TileRef | null {
  const map = game.map();
  const neighbors: TileRef[] = [0, 0, 0, 0];
  for (const border of player.borderTiles()) {
    const count = map.neighbors4(border, neighbors);
    for (let i = 0; i < count; i++) {
      const tile = neighbors[i];
      if (map.isLand(tile) && !map.isImpassable(tile) && !map.hasOwner(tile)) {
        return tile;
      }
    }
  }
  return null;
}

function ownedTileHash(player: Player): string {
  const tiles = Array.from(player.tiles()).sort((a, b) => a - b);
  let hash = 0x811c9dc5;
  for (const tile of tiles) {
    hash = Math.imul(hash ^ tile, 0x01000193) >>> 0;
  }
  return `${tiles.length}:${hash.toString(16).padStart(8, "0")}`;
}

function isTerritoryContiguous(game: Game, player: Player): boolean {
  const owned = player.tiles();
  const first = owned.values().next().value as TileRef | undefined;
  if (first === undefined) return false;

  const visited = new Set<TileRef>([first]);
  const queue: TileRef[] = [first];
  const neighbors: TileRef[] = [0, 0, 0, 0];
  for (let index = 0; index < queue.length; index++) {
    const count = game.map().neighbors4(queue[index], neighbors);
    for (let i = 0; i < count; i++) {
      const tile = neighbors[i];
      if (owned.has(tile) && !visited.has(tile)) {
        visited.add(tile);
        queue.push(tile);
      }
    }
  }
  return visited.size === player.numTilesOwned();
}

async function runLocalFixture(): Promise<FixtureResult> {
  // Each browser client runs GameRunner in its own worker realm. Resetting the
  // module graph gives each fixture the same isolation, including a fresh
  // TerrainMapLoader cache instead of the first run's mutated GameMap.
  vi.resetModules();
  const { createGameRunner } = await import("../src/core/GameRunner");
  const session = createSinglePlayerSession(localGameConfig(), true);
  const gameStart: GameStartInfo = {
    gameID: session.gameID,
    lobbyCreatedAt: 0,
    config: session.config,
    players: [
      {
        clientID: session.clientID,
        username: "Local Commander",
        clanTag: null,
        cosmetics: {},
      },
    ],
  };

  let lastStateHash: HashUpdate | undefined;
  let runtimeError: string | undefined;
  const runner = await createGameRunner(
    gameStart,
    session.clientID,
    new NodeGameMapLoader(MAPS_DIR),
    (update) => {
      if ("errMsg" in update) {
        runtimeError = `${update.errMsg}\n${update.stack ?? ""}`;
        return;
      }
      const hashes = update.updates[GameUpdateType.Hash] as HashUpdate[];
      if (hashes.length > 0) lastStateHash = hashes[hashes.length - 1];
    },
  );

  let nextTurn = 0;
  const orderedInputs: FixtureResult["orderedInputs"] = [];
  const executeTurn = (intents: StampedIntent[]) => {
    const turnNumber = nextTurn++;
    runner.addTurn({ turnNumber, intents });
    if (!runner.executeNextTick() || runtimeError !== undefined) {
      throw new Error(
        `local fixture failed on turn ${turnNumber}: ${runtimeError ?? "runner rejected the turn"}`,
      );
    }
    for (const intent of intents) orderedInputs.push({ turnNumber, intent });
  };

  const spawnTile = runner.game.ref(SPAWN_X, SPAWN_Y);
  executeTurn([
    {
      type: "spawn",
      tile: spawnTile,
      clientID: session.clientID,
    },
  ]);
  executeTurn([]); // SpawnExecution is initialized, then applied, on two ticks.

  const human = runner.game.playerByClientID(session.clientID);
  if (human === null || !human.hasSpawned()) {
    const occupiedSpawns = runner.game
      .allPlayers()
      .flatMap((player) => {
        const tile = player.spawnTile();
        return tile === undefined
          ? []
          : [`${player.type()}:${runner.game.x(tile)},${runner.game.y(tile)}`];
      })
      .join("; ");
    throw new Error(
      `local human did not spawn at ${SPAWN_X},${SPAWN_Y}; occupied spawns: ${occupiedSpawns}`,
    );
  }
  const tilesAfterSpawn = human.numTilesOwned();
  const adjacentWildernessAtAttack = findAdjacentWilderness(runner.game, human);
  if (adjacentWildernessAtAttack === null) {
    throw new Error("spawned human has no adjacent wilderness to expand into");
  }

  executeTurn([
    {
      type: "attack",
      // A null target is the production command for the adjacent Terra
      // Nullius verified immediately above.
      targetID: null,
      troops: null,
      clientID: session.clientID,
    },
  ]);
  const checkpoints: EconomyCheckpoint[] = [];
  const ownedTilesByTurn = new Map<number, number>();
  while (nextTurn <= FINAL_TURN) {
    const turn = nextTurn;
    executeTurn([]);
    ownedTilesByTurn.set(turn, human.numTilesOwned());
    if (CHECKPOINT_TURNS.includes(turn as 50 | 130)) {
      const wildernessAttack = human
        .outgoingAttacks()
        .find((attack) => !attack.target().isPlayer());
      const ownedTilesTenTicksAgo = ownedTilesByTurn.get(turn - 10);
      if (ownedTilesTenTicksAgo === undefined) {
        throw new Error(`missing owned-tile history for turn ${turn - 10}`);
      }
      checkpoints.push({
        tick: turn,
        ownedTiles: human.numTilesOwned(),
        troops: human.troops(),
        maxTroops: runner.game.config().maxTroops(human),
        troopsPerSecond: runner.game.config().troopIncreaseRate(human) * 10,
        gold: Number(human.gold()),
        wildernessAttackTroops: wildernessAttack?.troops() ?? null,
        tilesGainedLastTenTicks: human.numTilesOwned() - ownedTilesTenTicksAgo,
        ownershipHash: ownedTileHash(human),
        territoryIsContiguous: isTerritoryContiguous(runner.game, human),
      });
    }
  }

  if (lastStateHash === undefined) {
    throw new Error("production runner emitted no state hash");
  }
  return {
    gameID: session.gameID,
    clientID: session.clientID,
    map: session.config.gameMap,
    bots: session.config.bots,
    mapDimensions: [runner.game.width(), runner.game.height()],
    orderedInputs,
    adjacentWildernessAtAttack,
    tilesAfterSpawn,
    finalOwnedTiles: human.numTilesOwned(),
    ownershipHash: ownedTileHash(human),
    stateHash: lastStateHash,
    territoryIsContiguous: isTerritoryContiguous(runner.game, human),
    checkpoints,
  };
}

describe("local The Box deterministic runtime fixture", () => {
  it("replays spawn and adjacent-wilderness expansion identically with contiguous ownership", async () => {
    const first = await runLocalFixture();
    const second = await runLocalFixture();

    expect(first.gameID).toBe(LOCAL_SKIRMISH_GAME_ID);
    expect(second.gameID).toBe(first.gameID);
    expect(first.clientID).toBe(LOCAL_SKIRMISH_CLIENT_ID);
    expect(second.clientID).toBe(first.clientID);
    expect(first.map).toBe(GameMapType.TheBox);
    expect(first.bots).toBe(1);
    expect(first.mapDimensions).toEqual([2048, 2048]);
    expect(second.mapDimensions).toEqual(first.mapDimensions);
    expect(second.orderedInputs).toEqual(first.orderedInputs);
    expect(
      first.orderedInputs.map(({ turnNumber, intent }) => [
        turnNumber,
        intent.type,
      ]),
    ).toEqual([
      [0, "spawn"],
      [2, "attack"],
    ]);
    expect(second.adjacentWildernessAtAttack).toBe(
      first.adjacentWildernessAtAttack,
    );

    expect(first.finalOwnedTiles).toBeGreaterThan(first.tilesAfterSpawn);
    expect(second.finalOwnedTiles).toBeGreaterThan(second.tilesAfterSpawn);
    expect(second.ownershipHash).toBe(first.ownershipHash);
    expect(second.stateHash).toEqual(first.stateHash);
    expect(second.checkpoints).toEqual(first.checkpoints);
    expect(
      first.checkpoints.map(({ tick, ownedTiles, gold, ownershipHash }) => ({
        tick,
        ownedTiles,
        gold,
        ownershipHash,
      })),
    ).toEqual([
      {
        tick: 50,
        ownedTiles: 289,
        gold: 4_900,
        ownershipHash: "289:6a49f48a",
      },
      {
        tick: 130,
        ownedTiles: 479,
        gold: 12_900,
        ownershipHash: "479:3211a1a9",
      },
    ]);
    const [atFiveSeconds, atThirteenSeconds] = first.checkpoints;
    // Population economy: expanding into wilderness adds no people; the
    // capital's 150k is the cap until a City or Barracks is built.
    expect(atFiveSeconds.maxTroops).toBe(150_000);
    expect(atThirteenSeconds.maxTroops).toBe(150_000);
    expect(atThirteenSeconds.ownedTiles).toBeGreaterThan(
      atFiveSeconds.ownedTiles,
    );
    for (const checkpoint of first.checkpoints) {
      expect(checkpoint.wildernessAttackTroops).not.toBeNull();
      expect(checkpoint.wildernessAttackTroops).toBeGreaterThan(0);
      expect(checkpoint.tilesGainedLastTenTicks).toBeGreaterThan(0);
      expect(checkpoint.territoryIsContiguous).toBe(true);
    }
    expect(first.stateHash.tick).toBe(FINAL_TURN);
    expect(first.territoryIsContiguous).toBe(true);
    expect(second.territoryIsContiguous).toBe(true);
  }, 30_000);
});
