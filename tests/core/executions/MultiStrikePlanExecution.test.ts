import { AirPatrolCommandExecution } from "../../../src/core/execution/AirPatrolCommandExecution";
import {
  AirMissionType,
  Difficulty,
  Game,
  GameMapType,
  Player,
  PlayerInfo,
  PlayerType,
  StrikeTargetClass,
  Unit,
  UnitType,
} from "../../../src/core/game/Game";
import { TileRef } from "../../../src/core/game/GameMap";
import {
  dealStrikeTargets,
  evenStrikeShares,
  normalizeStrikeClasses,
} from "../../../src/core/game/StrikePlan";
import {
  AirportAirPatrolCommandOrderSchema,
  StampedIntentSchema,
} from "../../../src/core/Schemas";
import { setup } from "../../util/Setup";

const commanderInfo = new PlayerInfo(
  "multi commander",
  PlayerType.Human,
  "MULT0001",
  "multi-commander-id",
);
const hostileInfo = new PlayerInfo(
  "multi hostile",
  PlayerType.Human,
  "MULT0002",
  "multi-hostile-id",
);

async function planGame(): Promise<{
  game: Game;
  commander: Player;
  hostile: Player;
}> {
  const game = await setup(
    "big_plains",
    {
      airportOperationsV1: true,
      airSuperiorityV1: true,
      difficulty: Difficulty.Impossible,
      gameMap: GameMapType.NaturalEarthWorld,
      combinedArmsV1: true,
      combinedArmsV2: true,
      instantBuild: true,
    },
    [commanderInfo, hostileInfo],
  );
  const commander = game.player(commanderInfo.id);
  const hostile = game.player(hostileInfo.id);
  commander.conquer(game.ref(5, 5));
  for (let y = 60; y <= 90; y++) {
    for (let x = 80; x <= 130; x++) hostile.conquer(game.ref(x, y));
  }
  return { game, commander, hostile };
}

function buildCap(owner: Player, tile: TileRef): Unit {
  return owner.buildUnit(UnitType.FighterJet, tile, {
    aircraftState: {
      mission: AirMissionType.CombatAirPatrol,
      phase: "patrolling",
      homeFactoryId: 999,
      missionEndTick: Number.MAX_SAFE_INTEGER,
      ammo: 2,
      targetedBySam: false,
      patrolAnchorTile: tile,
      commandRevision: 0,
    },
    targetTile: tile,
  });
}

/** `count` structures of `type` on a row, 3 tiles apart, nearest first. */
function row(
  game: Game,
  hostile: Player,
  type: UnitType,
  y: number,
  count: number,
): Unit[] {
  return Array.from({ length: count }, (_, i) =>
    hostile.buildUnit(type, game.ref(102 + i * 3, y), {}),
  );
}

function command(
  game: Game,
  commander: Player,
  click: TileRef,
  targetClasses: StrikeTargetClass[],
  amount: number,
): void {
  game.addExecution(
    new AirPatrolCommandExecution(
      commander,
      {
        mission: AirMissionType.PrecisionStrike,
        targetTile: click,
        targetClasses,
      },
      amount,
    ),
  );
  game.executeNextTick();
}

function hitsPerTile(jets: Unit[]): Map<TileRef, number> {
  const hits = new Map<TileRef, number>();
  for (const jet of jets) {
    const tile = jet.targetTile()!;
    hits.set(tile, (hits.get(tile) ?? 0) + 1);
  }
  return hits;
}

describe("Strike plan helpers", () => {
  it("normalizes the chosen plans into the canonical groups", () => {
    expect(normalizeStrikeClasses(undefined)).toEqual([StrikeTargetClass.Tile]);
    expect(normalizeStrikeClasses([])).toEqual([StrikeTargetClass.Tile]);
    expect(
      normalizeStrikeClasses([
        StrikeTargetClass.MissileSilos,
        StrikeTargetClass.AirDefense,
        StrikeTargetClass.MissileSilos,
      ]),
    ).toEqual([StrikeTargetClass.AirDefense, StrikeTargetClass.MissileSilos]);
    expect(
      normalizeStrikeClasses([
        StrikeTargetClass.Tile,
        StrikeTargetClass.Cities,
      ]),
    ).toEqual([StrikeTargetClass.Cities]);
    expect(
      normalizeStrikeClasses([
        StrikeTargetClass.Cities,
        StrikeTargetClass.AllStructures,
      ]),
    ).toEqual([StrikeTargetClass.AllStructures]);
  });

  it("shares jets equally with the remainder to the first groups", () => {
    expect(evenStrikeShares(46, 2)).toEqual([23, 23]);
    expect(evenStrikeShares(5, 3)).toEqual([2, 2, 1]);
    expect(evenStrikeShares(1, 3)).toEqual([1, 0, 0]);
    expect(evenStrikeShares(4, 0)).toEqual([]);
    expect(dealStrikeTargets(5, [["a1", "a2"], [], ["b1"]])).toEqual([
      "a1",
      "b1",
      "a2",
      "b1",
      "a1",
    ]);
    expect(dealStrikeTargets(3, [[], []])).toEqual([]);
  });
});

describe("Multi-class strike plans", () => {
  it("46 jets over six air defenses and six missile silos: 23 + 23, every target hit", async () => {
    const { game, commander, hostile } = await planGame();
    const click = game.ref(100, 70);
    const sams = row(game, hostile, UnitType.SAMLauncher, 70, 6);
    const silos = row(game, hostile, UnitType.MissileSilo, 80, 6);
    row(game, hostile, UnitType.City, 88, 2);
    const jets = Array.from({ length: 46 }, (_, i) =>
      buildCap(commander, game.ref(20 + (i % 10), 20 + Math.floor(i / 10))),
    );

    command(
      game,
      commander,
      click,
      [StrikeTargetClass.MissileSilos, StrikeTargetClass.AirDefense],
      46,
    );

    const hits = hitsPerTile(jets);
    const samHits = sams.map((sam) => hits.get(sam.tile()) ?? 0);
    const siloHits = silos.map((silo) => hits.get(silo.tile()) ?? 0);
    expect(samHits.reduce((a, b) => a + b, 0)).toBe(23);
    expect(siloHits.reduce((a, b) => a + b, 0)).toBe(23);
    // 23 over six: every target hit, nearest ones once more.
    expect(samHits).toEqual([4, 4, 4, 4, 4, 3]);
    expect(siloHits).toEqual([4, 4, 4, 4, 4, 3]);
    expect(jets.every((jet) => jet.aircraftState().phase === "outbound")).toBe(
      true,
    );
    expect(jets.every((jet) => jet.aircraftState().commandRevision === 1)).toBe(
      true,
    );
  });

  it("with fewer jets than targets, each class gets its share of the nearest ones", async () => {
    const { game, commander, hostile } = await planGame();
    const click = game.ref(100, 70);
    const sams = row(game, hostile, UnitType.SAMLauncher, 70, 6);
    const silos = row(game, hostile, UnitType.MissileSilo, 80, 6);
    const jets = Array.from({ length: 4 }, (_, i) =>
      buildCap(commander, game.ref(20 + i, 20)),
    );

    command(
      game,
      commander,
      click,
      [StrikeTargetClass.AirDefense, StrikeTargetClass.MissileSilos],
      4,
    );

    expect(new Set(jets.map((jet) => jet.targetTile()))).toEqual(
      new Set([
        sams[0].tile(),
        sams[1].tile(),
        silos[0].tile(),
        silos[1].tile(),
      ]),
    );
  });

  it("skips a chosen class that has nothing and rejects when none has anything", async () => {
    const { game, commander, hostile } = await planGame();
    const click = game.ref(100, 70);
    const factories = row(game, hostile, UnitType.Factory, 70, 2);
    const jets = Array.from({ length: 3 }, (_, i) =>
      buildCap(commander, game.ref(20 + i, 20)),
    );

    command(
      game,
      commander,
      click,
      [StrikeTargetClass.Ports, StrikeTargetClass.Airports],
      3,
    );
    expect(jets.map((jet) => jet.aircraftState().commandRevision)).toEqual([
      0, 0, 0,
    ]);

    command(
      game,
      commander,
      click,
      [StrikeTargetClass.Ports, StrikeTargetClass.Factories],
      3,
    );
    expect(jets.map((jet) => jet.targetTile())).toEqual([
      factories[0].tile(),
      factories[1].tile(),
      factories[0].tile(),
    ]);
  });

  it("the wire admits several distinct plans, but not together with targetClass", () => {
    const strike = {
      mission: AirMissionType.PrecisionStrike,
      targetTile: 84,
    } as const;
    const ok = {
      ...strike,
      targetClasses: [StrikeTargetClass.AirDefense, StrikeTargetClass.Cities],
    };
    expect(AirportAirPatrolCommandOrderSchema.safeParse(ok).success).toBe(true);
    expect(
      StampedIntentSchema.safeParse({
        clientID: "MULT0001",
        type: "command_air_patrol",
        order: ok,
        amount: 2,
      }).success,
    ).toBe(true);
    for (const bad of [
      { ...strike, targetClasses: [] },
      {
        ...strike,
        targetClasses: [StrikeTargetClass.Cities, StrikeTargetClass.Cities],
      },
      { ...strike, targetClasses: ["bases"] },
      {
        ...strike,
        targetClass: StrikeTargetClass.Ports,
        targetClasses: [StrikeTargetClass.Cities],
      },
    ]) {
      expect(AirportAirPatrolCommandOrderSchema.safeParse(bad).success).toBe(
        false,
      );
    }
  });
});
