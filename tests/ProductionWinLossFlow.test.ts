import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  RankedType,
  type Player,
} from "../src/core/game/Game";
import {
  GameUpdateType,
  type ConquestUpdate,
  type GameUpdateViewData,
  type HashUpdate,
  type PlayerUpdate,
  type WinUpdate,
} from "../src/core/game/GameUpdates";
import {
  AllPlayersStatsSchema,
  GameConfigSchema,
  GameStartInfoSchema,
  StampedIntentSchema,
  TurnSchema,
  type StampedIntent,
  type Turn,
} from "../src/core/Schemas";
import { NodeGameMapLoader } from "./perf/fullgame/NodeGameMapLoader";

const MAPS_DIR = path.resolve(process.cwd(), "resources/maps");
const GAME_ID = "WinLoss3";
const WINNER_CLIENT_ID = "Winner01";
const LOSER_CLIENT_ID = "Loser001";
const ATTACK_TURN = 351;
const FINAL_TURN = 360;

type DeterministicEmission = Omit<GameUpdateViewData, "tickExecutionDuration">;

interface PlayerSnapshot {
  alive: boolean;
  tiles: number;
  troops: number;
}

interface SimulationSnapshot {
  config: ReturnType<typeof GameConfigSchema.parse>;
  turns: Turn[];
  emissions: DeterministicEmission[];
  playerIDs: { winner: string; loser: string };
  preAttack: {
    tick: number;
    winner: PlayerSnapshot;
    loser: PlayerSnapshot;
    sharesBorder: boolean;
    canAttack: boolean;
    loserImmune: boolean;
  };
  conquest: {
    tick: number;
    updates: ConquestUpdate[];
    loser: PlayerSnapshot;
    loserStats: ReturnType<typeof AllPlayersStatsSchema.parse>[string];
    loserUpdates: PlayerUpdate[];
  };
  wins: Array<{ tick: number; update: WinUpdate }>;
  final: {
    tick: number;
    winner: PlayerSnapshot;
    loser: PlayerSnapshot;
    hash: HashUpdate;
    stats: ReturnType<typeof AllPlayersStatsSchema.parse>;
  };
}

function productionRankedConfig() {
  return GameConfigSchema.parse({
    gameMap: GameMapType.TheBox,
    gameMapSize: GameMapSize.Normal,
    gameType: GameType.Public,
    gameMode: GameMode.FFA,
    rankedType: RankedType.OneVOne,
    maxPlayers: 2,
    difficulty: Difficulty.Medium,
    bots: 0,
    nations: "disabled",
    donateGold: false,
    donateTroops: false,
    infiniteGold: false,
    infiniteTroops: false,
    instantBuild: false,
    randomSpawn: false,
    disabledUnits: [],
  });
}

function playerSnapshot(player: Player): PlayerSnapshot {
  return {
    alive: player.isAlive(),
    tiles: player.numTilesOwned(),
    troops: player.troops(),
  };
}

async function runProductionFixture(
  viewerClientID: typeof WINNER_CLIENT_ID | typeof LOSER_CLIENT_ID,
): Promise<SimulationSnapshot> {
  // A production client runs this code in an isolated worker. Resetting the
  // module graph also gives the second run a fresh terrain-map cache.
  vi.resetModules();
  const { createGameRunner } = await import("../src/core/GameRunner");
  const config = productionRankedConfig();
  const start = GameStartInfoSchema.parse({
    gameID: GAME_ID,
    lobbyCreatedAt: 0,
    config,
    players: [
      {
        clientID: WINNER_CLIENT_ID,
        username: WINNER_CLIENT_ID,
        clanTag: null,
        cosmetics: {},
      },
      {
        clientID: LOSER_CLIENT_ID,
        username: LOSER_CLIENT_ID,
        clanTag: null,
        cosmetics: {},
      },
    ],
  });

  let runtimeError: string | undefined;
  let lastEmission: DeterministicEmission | undefined;
  const emissions: DeterministicEmission[] = [];
  const runner = await createGameRunner(
    start,
    viewerClientID,
    new NodeGameMapLoader(MAPS_DIR),
    (update) => {
      if ("errMsg" in update) {
        runtimeError = `${update.errMsg}\n${update.stack ?? ""}`;
        return;
      }
      const simulationUpdate = structuredClone(update);
      delete simulationUpdate.tickExecutionDuration;
      lastEmission = simulationUpdate;
      emissions.push(lastEmission);
    },
  );

  const turns: Turn[] = [];
  let nextTurn = 0;
  const executeTurn = (intents: StampedIntent[] = []) => {
    const turn = TurnSchema.parse({ turnNumber: nextTurn++, intents });
    if (intents.length > 0) {
      for (const intent of intents) StampedIntentSchema.parse(intent);
    }
    turns.push(turn);
    runner.addTurn(turn);
    if (!runner.executeNextTick() || runtimeError !== undefined) {
      throw new Error(
        `production fixture failed on turn ${turn.turnNumber}: ${runtimeError ?? "runner rejected turn"}`,
      );
    }
    if (lastEmission === undefined) {
      throw new Error(
        `production fixture emitted nothing on turn ${turn.turnNumber}`,
      );
    }
    return lastEmission;
  };

  executeTurn([
    {
      type: "spawn",
      tile: runner.game.ref(256, 256),
      clientID: WINNER_CLIENT_ID,
    },
    {
      type: "spawn",
      tile: runner.game.ref(264, 256),
      clientID: LOSER_CLIENT_ID,
    },
  ]);
  while (nextTurn <= 350) executeTurn();

  const winner = runner.game.playerByClientID(WINNER_CLIENT_ID);
  const loser = runner.game.playerByClientID(LOSER_CLIENT_ID);
  if (winner === null || loser === null) {
    throw new Error("production fixture did not resolve both human players");
  }
  if (!winner.hasSpawned() || !loser.hasSpawned()) {
    throw new Error("production fixture did not apply both spawn intents");
  }

  const preAttack: SimulationSnapshot["preAttack"] = {
    tick: runner.game.ticks(),
    winner: playerSnapshot(winner),
    loser: playerSnapshot(loser),
    sharesBorder: winner.sharesBorderWith(loser),
    canAttack: winner.canAttack(loser.spawnTile()!),
    loserImmune: loser.isImmune(),
  };

  const attackEmission = executeTurn([
    {
      type: "attack",
      targetID: loser.id(),
      troops: null,
      clientID: WINNER_CLIENT_ID,
    },
  ]);

  let conquest: SimulationSnapshot["conquest"] | undefined;
  const wins: SimulationSnapshot["wins"] = [];
  const inspectTerminalEmission = (emission: DeterministicEmission) => {
    const conquestUpdates = emission.updates[
      GameUpdateType.ConquestEvent
    ] as ConquestUpdate[];
    if (conquestUpdates.length > 0) {
      const allStats = AllPlayersStatsSchema.parse(runner.game.stats().stats());
      conquest = {
        tick: emission.tick,
        updates: structuredClone(conquestUpdates),
        loser: playerSnapshot(loser),
        loserStats: structuredClone(allStats[LOSER_CLIENT_ID]),
        loserUpdates: structuredClone(
          (emission.updates[GameUpdateType.Player] as PlayerUpdate[]).filter(
            (update) => update.id === loser.id(),
          ),
        ),
      };
    }
    for (const update of emission.updates[GameUpdateType.Win] as WinUpdate[]) {
      wins.push({ tick: emission.tick, update: structuredClone(update) });
    }
  };

  inspectTerminalEmission(attackEmission);
  while (nextTurn <= FINAL_TURN) {
    inspectTerminalEmission(executeTurn());
  }

  if (conquest === undefined) throw new Error("no production conquest emitted");
  const hashes = emissions.flatMap(
    (emission) => emission.updates[GameUpdateType.Hash] as HashUpdate[],
  );
  const hash = hashes[hashes.length - 1];
  if (hash === undefined) throw new Error("no production state hash emitted");
  const stats = AllPlayersStatsSchema.parse(runner.game.stats().stats());

  return {
    config,
    turns,
    emissions,
    playerIDs: { winner: winner.id(), loser: loser.id() },
    preAttack,
    conquest,
    wins,
    final: {
      tick: runner.game.ticks(),
      winner: playerSnapshot(winner),
      loser: playerSnapshot(loser),
      hash,
      stats,
    },
  };
}

describe("production ranked win/loss flow", () => {
  it("reaches one authentic conquest and one deterministic win for both viewers", async () => {
    const winnerView = await runProductionFixture(WINNER_CLIENT_ID);
    const loserView = await runProductionFixture(LOSER_CLIENT_ID);

    expect(loserView).toEqual(winnerView);
    expect(winnerView.config).toEqual({
      gameMap: GameMapType.TheBox,
      gameMapSize: GameMapSize.Normal,
      gameType: GameType.Public,
      gameMode: GameMode.FFA,
      rankedType: RankedType.OneVOne,
      maxPlayers: 2,
      difficulty: Difficulty.Medium,
      bots: 0,
      nations: "disabled",
      donateGold: false,
      donateTroops: false,
      infiniteGold: false,
      infiniteTroops: false,
      instantBuild: false,
      randomSpawn: false,
      disabledUnits: [],
    });
    expect(winnerView.turns.filter((turn) => turn.intents.length > 0)).toEqual([
      {
        turnNumber: 0,
        intents: [
          {
            type: "spawn",
            tile: 524544,
            clientID: WINNER_CLIENT_ID,
          },
          {
            type: "spawn",
            tile: 524552,
            clientID: LOSER_CLIENT_ID,
          },
        ],
      },
      {
        turnNumber: ATTACK_TURN,
        intents: [
          {
            type: "attack",
            targetID: winnerView.playerIDs.loser,
            troops: null,
            clientID: WINNER_CLIENT_ID,
          },
        ],
      },
    ]);
    expect(winnerView.turns).toHaveLength(FINAL_TURN + 1);
    expect(winnerView.preAttack).toEqual({
      tick: 351,
      winner: { alive: true, tiles: 52, troops: 52_542 },
      loser: { alive: true, tiles: 52, troops: 52_542 },
      sharesBorder: true,
      canAttack: true,
      loserImmune: false,
    });
    expect(winnerView.conquest).toMatchObject({
      tick: 353,
      loser: { alive: false, tiles: 0 },
      loserStats: {
        killedBy: WINNER_CLIENT_ID,
        deathPosition: 2,
      },
    });
    expect(winnerView.conquest.updates).toEqual([
      {
        type: GameUpdateType.ConquestEvent,
        conquerorId: winnerView.playerIDs.winner,
        conqueredId: winnerView.playerIDs.loser,
        gold: 0n,
      },
    ]);
    expect(
      winnerView.emissions
        .filter(
          (emission) =>
            emission.updates[GameUpdateType.ConquestEvent].length > 0,
        )
        .map((emission) => emission.tick),
    ).toEqual([353]);
    expect(winnerView.conquest.loserUpdates).toEqual([
      expect.objectContaining({
        type: GameUpdateType.Player,
        id: winnerView.playerIDs.loser,
        isAlive: false,
        killedBy: WINNER_CLIENT_ID,
        deathPosition: 2,
      }),
    ]);
    expect(winnerView.wins).toHaveLength(1);
    expect(winnerView.wins[0].tick).toBe(361);
    expect(winnerView.wins[0].update.type).toBe(GameUpdateType.Win);
    expect(winnerView.wins[0].update.winner).toEqual([
      "player",
      WINNER_CLIENT_ID,
    ]);
    expect(
      winnerView.emissions.flatMap(
        (emission) => emission.updates[GameUpdateType.Win],
      ),
    ).toHaveLength(1);
    expect(winnerView.final).toMatchObject({
      tick: 361,
      winner: { alive: true, tiles: 104 },
      loser: { alive: false, tiles: 0 },
      hash: {
        type: GameUpdateType.Hash,
        tick: 360,
        hash: 168_784_428_292_465,
      },
    });
    expect(winnerView.wins[0].update.allPlayersStats).toEqual(
      winnerView.final.stats,
    );
    expect(winnerView.final.stats).toEqual({
      [WINNER_CLIENT_ID]: {
        attacks: [10_607n],
        finalTiles: 104n,
        kills: [{ victim: LOSER_CLIENT_ID, tick: 352n }],
        gold: [5_900n],
      },
      [LOSER_CLIENT_ID]: {
        attacks: [0n, 10_607n],
        killedAt: 353n,
        killedBy: WINNER_CLIENT_ID,
        deathPosition: 2,
        gold: [5_100n],
      },
    });

    const source = readFileSync(fileURLToPath(import.meta.url), "utf8");
    const forbiddenMethodCalls = [
      ["set", "Winner"],
      ["con", "quer"],
      ["add", "Troops"],
      ["add", "Gold"],
      ["mark", "Disconnected"],
      ["add", "Update"],
    ].map((parts) => `.${parts.join("")}(`);
    for (const call of forbiddenMethodCalls) expect(source).not.toContain(call);
    const forbiddenIntentType = ["mark", "disconnected"].join("_");
    expect(source).not.toContain(`type: "${forbiddenIntentType}"`);
    expect(
      winnerView.turns.flatMap((turn) =>
        turn.intents.map((intent) => intent.type),
      ),
    ).toEqual(["spawn", "spawn", "attack"]);
  }, 120_000);
});
