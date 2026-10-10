import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Config } from "../src/core/configuration/Config";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  Player,
  UnitType,
} from "../src/core/game/Game";
import {
  GameUpdateType,
  HashUpdate,
  WinUpdate,
} from "../src/core/game/GameUpdates";
import {
  GameConfigSchema,
  GameStartInfoSchema,
  StampedIntentSchema,
  TurnSchema,
  type StampedIntent,
} from "../src/core/Schemas";
import { NodeGameMapLoader } from "./perf/fullgame/NodeGameMapLoader";

const MAPS_DIR = path.resolve(process.cwd(), "resources/maps");
const WINNER_CLIENT_ID = "TempoWin";
const LOSER_CLIENT_ID = "TempoLos";
const FIFTEEN_MINUTES = 9_000;
const ATTACK_TURN = 18_000;
const EARLIEST_WIN_TURN = 27_000;
const LATEST_WIN_TURN = 36_000;

interface PlayerSnapshot {
  alive: boolean;
  tiles: number;
  troops: number;
  maxTroops: number;
}

function snapshot(player: Player, config: Config): PlayerSnapshot {
  return {
    alive: player.isAlive(),
    tiles: player.numTilesOwned(),
    troops: player.troops(),
    maxTroops: Math.round(config.maxTroops(player)),
  };
}

async function runLongTempoFixture() {
  vi.resetModules();
  const { createGameRunner } = await import("../src/core/GameRunner");
  const config = GameConfigSchema.parse({
    gameMap: GameMapType.TheBox,
    gameMapSize: GameMapSize.Normal,
    gameType: GameType.Singleplayer,
    gameMode: GameMode.FFA,
    playerTeams: 2,
    difficulty: Difficulty.Hard,
    bots: 0,
    nations: "disabled",
    donateGold: false,
    donateTroops: false,
    infiniteGold: false,
    infiniteTroops: false,
    instantBuild: false,
    randomSpawn: false,
    disabledUnits: [],
    depthProgression: true,
  });
  const start = GameStartInfoSchema.parse({
    gameID: "LongGame",
    lobbyCreatedAt: 0,
    config,
    players: [
      {
        clientID: WINNER_CLIENT_ID,
        username: "Tempo winner",
        clanTag: null,
        cosmetics: {},
      },
      {
        clientID: LOSER_CLIENT_ID,
        username: "Tempo holdout",
        clanTag: null,
        cosmetics: {},
      },
    ],
  });

  const hashes = new Map<number, HashUpdate>();
  const wins: Array<{ tick: number; update: WinUpdate }> = [];
  const runtimeErrors: string[] = [];
  const runner = await createGameRunner(
    start,
    WINNER_CLIENT_ID,
    new NodeGameMapLoader(MAPS_DIR),
    (update) => {
      if ("errMsg" in update) {
        runtimeErrors.push(`${update.errMsg}\n${update.stack ?? ""}`);
        return;
      }
      for (const hash of update.updates[GameUpdateType.Hash] as HashUpdate[]) {
        hashes.set(hash.tick, structuredClone(hash));
      }
      for (const win of update.updates[GameUpdateType.Win] as WinUpdate[]) {
        wins.push({ tick: update.tick, update: structuredClone(win) });
      }
    },
  );

  let nextTurn = 0;
  const nonEmptyTurns: Array<{
    turnNumber: number;
    intents: StampedIntent[];
  }> = [];
  const executeTurn = (intents: StampedIntent[] = []) => {
    for (const intent of intents) StampedIntentSchema.parse(intent);
    const turn = TurnSchema.parse({ turnNumber: nextTurn++, intents });
    if (intents.length > 0) {
      nonEmptyTurns.push(structuredClone(turn));
    }
    runner.addTurn(turn);
    if (!runner.executeNextTick() || runtimeErrors.length > 0) {
      throw new Error(
        `long-tempo fixture failed on turn ${turn.turnNumber}: ${runtimeErrors[runtimeErrors.length - 1] ?? "runner rejected turn"}`,
      );
    }
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
  executeTurn();

  const winner = runner.game.playerByClientID(WINNER_CLIENT_ID);
  const loser = runner.game.playerByClientID(LOSER_CLIENT_ID);
  if (winner === null || loser === null) {
    throw new Error("long-tempo players were not created");
  }

  let atFifteen: { winner: PlayerSnapshot; loser: PlayerSnapshot } | undefined;
  let preAttack:
    | {
        tick: number;
        winner: PlayerSnapshot;
        loser: PlayerSnapshot;
        sharesBorder: boolean;
        canAttack: boolean;
      }
    | undefined;

  while (nextTurn <= LATEST_WIN_TURN && runner.game.getWinner() === null) {
    const turnNumber = nextTurn;
    const intents: StampedIntent[] = [];
    const activeWilderness = winner
      .outgoingAttacks()
      .some((attack) => attack.isActive() && !attack.target().isPlayer());

    if (turnNumber >= 2 && (turnNumber - 2) % 100 === 0 && !activeWilderness) {
      intents.push({
        type: "attack",
        targetID: null,
        troops: null,
        clientID: WINNER_CLIENT_ID,
      });
    }

    // Population economy: land adds no people, so the winner grows by
    // building a City whenever it can afford one, and a Barracks for each.
    if (turnNumber % 50 === 7) {
      const buildType =
        winner.unitsOwned(UnitType.Barracks) < winner.unitsOwned(UnitType.City)
          ? UnitType.Barracks
          : UnitType.City;
      if (
        winner.gold() >=
        runner.game.unitInfo(buildType).cost(runner.game, winner)
      ) {
        let index = 0;
        for (const tile of winner.tiles()) {
          if (index++ % 97 !== 0) continue;
          if (winner.canBuild(buildType, tile) !== false) {
            intents.push({
              type: "build_unit",
              unit: buildType,
              tile,
              clientID: WINNER_CLIENT_ID,
            });
            break;
          }
        }
      }
    }

    if (turnNumber === ATTACK_TURN) {
      preAttack = {
        tick: runner.game.ticks(),
        winner: snapshot(winner, runner.game.config()),
        loser: snapshot(loser, runner.game.config()),
        sharesBorder: winner.sharesBorderWith(loser),
        canAttack: winner.canAttack(loser.spawnTile()!),
      };
    }

    const activePlayerAttack = winner
      .outgoingAttacks()
      .some(
        (attack) =>
          attack.isActive() &&
          attack.target().isPlayer() &&
          attack.target() === loser,
      );
    if (
      turnNumber >= ATTACK_TURN &&
      (turnNumber - ATTACK_TURN) % 300 === 0 &&
      loser.isAlive() &&
      !activePlayerAttack
    ) {
      intents.push({
        type: "attack",
        targetID: loser.id(),
        troops: Math.floor(winner.troops() * 0.8),
        clientID: WINNER_CLIENT_ID,
      });
    }

    executeTurn(intents);
    if (turnNumber === FIFTEEN_MINUTES) {
      atFifteen = {
        winner: snapshot(winner, runner.game.config()),
        loser: snapshot(loser, runner.game.config()),
      };
    }
  }

  if (atFifteen === undefined || preAttack === undefined) {
    throw new Error("long-tempo checkpoints were not reached");
  }
  const hashValues = [...hashes.values()];
  const lastHash = hashValues[hashValues.length - 1];
  if (lastHash === undefined) throw new Error("long-tempo hash missing");
  const gameWinner = runner.game.getWinner();

  return {
    config,
    atFifteen,
    preAttack,
    winTick: wins[0]?.tick ?? null,
    wins,
    final: {
      tick: runner.game.ticks(),
      winner: snapshot(winner, runner.game.config()),
      loser: snapshot(loser, runner.game.config()),
      gameWinnerID:
        typeof gameWinner === "string"
          ? gameWinner
          : (gameWinner?.id() ?? null),
      hash: lastHash,
    },
    nonEmptyTurns,
    runtimeErrors,
  };
}

describe("depth progression long match tempo", () => {
  it("a building player conquers The Box deterministically in the 45–60 minute window", async () => {
    const first = await runLongTempoFixture();
    const second = await runLongTempoFixture();

    expect(second).toEqual(first);
    expect(first.config.depthProgression).toBe(true);
    expect(first.runtimeErrors).toEqual([]);
    expect(first.atFifteen).toEqual({
      winner: {
        alive: true,
        tiles: 440_461,
        troops: 567_681,
        maxTroops: 750_000,
      },
      loser: {
        alive: true,
        tiles: 52,
        troops: 149_803,
        maxTroops: 150_000,
      },
    });
    expect(first.wins).toHaveLength(1);
    expect(first.winTick).toBe(35_611);
    expect(first.winTick).toBeGreaterThanOrEqual(EARLIEST_WIN_TURN);
    expect(first.winTick).toBeLessThanOrEqual(LATEST_WIN_TURN);
    expect(first.preAttack).toEqual({
      tick: ATTACK_TURN,
      winner: {
        alive: true,
        tiles: 1_258_911,
        troops: 808_502,
        maxTroops: 1_050_000,
      },
      loser: {
        alive: true,
        tiles: 52,
        troops: 149_803,
        maxTroops: 150_000,
      },
      sharesBorder: true,
      canAttack: true,
    });
    expect(first.wins[0]).toMatchObject({
      tick: 35_611,
      update: {
        type: GameUpdateType.Win,
        winner: ["player", WINNER_CLIENT_ID],
      },
    });
    expect(first.final).toEqual({
      tick: 35_611,
      winner: {
        alive: true,
        tiles: 3_357_776,
        troops: 872_780,
        maxTroops: 1_350_000,
      },
      loser: {
        alive: false,
        tiles: 0,
        troops: 146_923,
        maxTroops: 150_000,
      },
      gameWinnerID: "f3yax6se",
      hash: {
        type: GameUpdateType.Hash,
        tick: 35_610,
        hash: 4_588_923_660_611_498,
      },
    });
    // Population economy: the land adds nobody; the winner's population is
    // its capital plus the Cities and Barracks it built.
    expect(first.final.winner.maxTroops).toBe(
      150_000 + 4 * 250_000 + 4 * 50_000,
    );
    expect(first.atFifteen.loser.maxTroops).toBe(150_000);

    const wildernessTurns = first.nonEmptyTurns.filter(
      (turn) =>
        turn.intents[0]?.type === "attack" && turn.intents[0].targetID === null,
    );
    const playerAttackTurns = first.nonEmptyTurns.filter(
      (turn) =>
        turn.intents[0]?.type === "attack" && turn.intents[0].targetID !== null,
    );
    const buildTurns = first.nonEmptyTurns
      .filter((turn) => turn.intents[0]?.type === "build_unit")
      .map((turn) => {
        const intent = turn.intents[0];
        return [
          turn.turnNumber,
          intent.type === "build_unit" ? intent.unit : "",
        ];
      });
    expect(buildTurns).toEqual([
      [1257, UnitType.City],
      [2007, UnitType.Barracks],
      [4507, UnitType.City],
      [6007, UnitType.Barracks],
      [11007, UnitType.City],
      [14007, UnitType.Barracks],
      [24007, UnitType.City],
      [30007, UnitType.Barracks],
    ]);
    expect(wildernessTurns).toHaveLength(357);
    expect(
      wildernessTurns.every(({ turnNumber }) => (turnNumber - 2) % 100 === 0),
    ).toBe(true);
    expect(playerAttackTurns).toEqual([
      {
        turnNumber: ATTACK_TURN,
        intents: [
          {
            type: "attack",
            targetID: expect.any(String),
            troops: 646_801,
            clientID: WINNER_CLIENT_ID,
          },
        ],
      },
    ]);
  }, 300_000);
});
