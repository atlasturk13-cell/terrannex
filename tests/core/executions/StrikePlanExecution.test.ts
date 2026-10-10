import { AirPatrolCommandExecution } from "../../../src/core/execution/AirPatrolCommandExecution";
import { FighterJetExecution } from "../../../src/core/execution/FighterJetExecution";
import {
  AirMissionType,
  Difficulty,
  Game,
  GameMapType,
  Player,
  PlayerInfo,
  PlayerType,
  STRIKE_TARGET_CLASS_UNITS,
  StrikeTargetClass,
  Structures,
  Unit,
  UnitType,
} from "../../../src/core/game/Game";
import { TileRef } from "../../../src/core/game/GameMap";
import {
  AirStrikeEventUpdate,
  GameUpdateType,
} from "../../../src/core/game/GameUpdates";
import { setup } from "../../util/Setup";

const commanderInfo = new PlayerInfo(
  "plan commander",
  PlayerType.Human,
  "PLAN0001",
  "plan-commander-id",
);
const hostileInfo = new PlayerInfo(
  "plan hostile",
  PlayerType.Human,
  "PLAN0002",
  "plan-hostile-id",
);
const bystanderInfo = new PlayerInfo(
  "plan bystander",
  PlayerType.Human,
  "PLAN0003",
  "plan-bystander-id",
);

async function planGame(airportProfile = true): Promise<{
  game: Game;
  commander: Player;
  hostile: Player;
  bystander: Player;
}> {
  const game = await setup(
    "big_plains",
    {
      ...(airportProfile
        ? {
            airportOperationsV1: true,
            airSuperiorityV1: true,
            difficulty: Difficulty.Impossible,
            gameMap: GameMapType.NaturalEarthWorld,
          }
        : {}),
      combinedArmsV1: true,
      combinedArmsV2: true,
      instantBuild: true,
    },
    [commanderInfo, hostileInfo, bystanderInfo],
  );
  const commander = game.player(commanderInfo.id);
  const hostile = game.player(hostileInfo.id);
  const bystander = game.player(bystanderInfo.id);
  commander.addGold(100_000_000n);
  hostile.addGold(100_000_000n);
  // A commander without land is dead and cannot issue commands.
  commander.conquer(game.ref(5, 5));
  return { game, commander, hostile, bystander };
}

function conquerBlock(
  game: Game,
  owner: Player,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): void {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) owner.conquer(game.ref(x, y));
  }
}

function buildCap(game: Game, owner: Player, tile: TileRef): Unit {
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

function command(
  game: Game,
  player: Player,
  targetTile: TileRef,
  targetClass: StrikeTargetClass | undefined,
  amount: number,
): void {
  game.addExecution(
    new AirPatrolCommandExecution(
      player,
      {
        mission: AirMissionType.PrecisionStrike,
        targetTile,
        ...(targetClass === undefined ? {} : { targetClass }),
      },
      amount,
    ),
  );
  game.executeNextTick();
}

function recordStrikes(game: Game): AirStrikeEventUpdate[] {
  const strikes: AirStrikeEventUpdate[] = [];
  const addUpdate = game.addUpdate.bind(game);
  vi.spyOn(game, "addUpdate").mockImplementation((update) => {
    if (update.type === GameUpdateType.AirStrikeEvent) strikes.push(update);
    addUpdate(update);
  });
  return strikes;
}

function tickUntil(game: Game, condition: () => boolean, maximum = 300): void {
  for (let i = 0; i < maximum && !condition(); i++) game.executeNextTick();
  expect(condition()).toBe(true);
}

describe("Strike plans", () => {
  afterEach(() => vi.restoreAllMocks());

  it("maps every plan to its structure class and the tile plan to nothing", () => {
    expect(Object.values(StrikeTargetClass)).toEqual([
      "tile",
      "factories",
      "air_defense",
      "defense_posts",
      "missile_silos",
      "cities",
      "ports",
      "airports",
      "barracks",
      "all_structures",
    ]);
    expect(STRIKE_TARGET_CLASS_UNITS[StrikeTargetClass.Tile]).toEqual([]);
    expect(STRIKE_TARGET_CLASS_UNITS[StrikeTargetClass.Factories]).toEqual([
      UnitType.Factory,
    ]);
    expect(STRIKE_TARGET_CLASS_UNITS[StrikeTargetClass.AirDefense]).toEqual([
      UnitType.SAMLauncher,
    ]);
    expect(STRIKE_TARGET_CLASS_UNITS[StrikeTargetClass.AllStructures]).toEqual(
      Structures.types,
    );
    for (const targetClass of Object.values(StrikeTargetClass)) {
      for (const type of STRIKE_TARGET_CLASS_UNITS[targetClass]) {
        expect(Structures.has(type)).toBe(true);
      }
    }
  });

  it("deals the jets over the victim's factories nearest to the click first", async () => {
    const { game, commander, hostile, bystander } = await planGame();
    conquerBlock(game, hostile, 80, 10, 120, 40);
    const click = game.ref(100, 20);
    const nearest = hostile.buildUnit(UnitType.Factory, game.ref(102, 20), {});
    const middle = hostile.buildUnit(UnitType.Factory, game.ref(100, 28), {});
    const farthest = hostile.buildUnit(UnitType.Factory, game.ref(110, 20), {});
    hostile.buildUnit(UnitType.SAMLauncher, game.ref(101, 20), {});
    hostile.buildUnit(UnitType.City, game.ref(99, 20), {});
    // A different player's Factory right at the click is never a target.
    bystander.conquer(game.ref(100, 21));
    bystander.buildUnit(UnitType.Factory, game.ref(100, 21), {});
    // A dead Factory of the victim is skipped.
    const wreck = hostile.buildUnit(UnitType.Factory, game.ref(100, 19), {});
    wreck.delete(false);

    const jets = [
      buildCap(game, commander, game.ref(100, 20)),
      buildCap(game, commander, game.ref(105, 20)),
      buildCap(game, commander, game.ref(100, 26)),
      buildCap(game, commander, game.ref(90, 20)),
    ];
    command(game, commander, click, StrikeTargetClass.Factories, 4);

    expect(jets.map((jet) => jet.targetTile())).toEqual([
      nearest.tile(),
      middle.tile(),
      farthest.tile(),
      nearest.tile(),
    ]);
    expect(jets.map((jet) => jet.aircraftState().commandRevision)).toEqual([
      1, 1, 1, 1,
    ]);
    expect(jets.map((jet) => jet.aircraftState().phase)).toEqual([
      "outbound",
      "outbound",
      "outbound",
      "outbound",
    ]);
  });

  it("targets only the chosen class and rejects an empty class with no mutation", async () => {
    const { game, commander, hostile } = await planGame();
    conquerBlock(game, hostile, 80, 60, 120, 80);
    const click = game.ref(100, 70);
    const samNear = hostile.buildUnit(
      UnitType.SAMLauncher,
      game.ref(104, 70),
      {},
    );
    const samFar = hostile.buildUnit(
      UnitType.SAMLauncher,
      game.ref(100, 76),
      {},
    );
    hostile.buildUnit(UnitType.Factory, game.ref(101, 70), {});
    const cityNear = hostile.buildUnit(UnitType.City, game.ref(100, 71), {});
    const jets = [
      buildCap(game, commander, game.ref(100, 70)),
      buildCap(game, commander, game.ref(100, 72)),
      buildCap(game, commander, game.ref(100, 74)),
    ];

    command(game, commander, click, StrikeTargetClass.Ports, 3);
    expect(jets.map((jet) => jet.targetTile())).toEqual(
      jets.map((jet) => jet.tile()),
    );
    expect(jets.map((jet) => jet.aircraftState().commandRevision)).toEqual([
      0, 0, 0,
    ]);
    expect(jets.map((jet) => jet.aircraftState().phase)).toEqual([
      "patrolling",
      "patrolling",
      "patrolling",
    ]);

    command(game, commander, click, StrikeTargetClass.AirDefense, 3);
    expect(jets.map((jet) => jet.targetTile())).toEqual([
      samNear.tile(),
      samFar.tile(),
      samNear.tile(),
    ]);

    // Fewer jets than structures: only the nearest structure is hit, by the
    // nearest jet, which is simply retasked again.
    hostile.buildUnit(UnitType.City, game.ref(90, 70), {});
    command(game, commander, click, StrikeTargetClass.Cities, 1);
    expect(jets[0].targetTile()).toBe(cityNear.tile());
    expect(jets[0].aircraftState().commandRevision).toBe(2);
    expect(jets[1].targetTile()).toBe(samFar.tile());
    expect(jets[1].aircraftState().commandRevision).toBe(1);
  });

  it("covers every structure class for the all-structures plan and keeps the tile plan as before", async () => {
    const { game, commander, hostile } = await planGame();
    conquerBlock(game, hostile, 80, 90, 120, 110);
    const click = game.ref(100, 100);
    const built = [
      hostile.buildUnit(UnitType.City, game.ref(101, 100), {}),
      hostile.buildUnit(UnitType.DefensePost, game.ref(100, 102), {}),
      hostile.buildUnit(UnitType.MissileSilo, game.ref(103, 100), {}),
      hostile.buildUnit(UnitType.Factory, game.ref(100, 104), {}),
      hostile.buildUnit(UnitType.SAMLauncher, game.ref(105, 100), {}),
    ];
    const jets = [0, 1, 2, 3, 4, 5].map(() =>
      buildCap(game, commander, game.ref(100, 100)),
    );

    command(game, commander, click, StrikeTargetClass.AllStructures, 6);
    expect(jets.map((jet) => jet.targetTile())).toEqual([
      ...built.map((unit) => unit.tile()),
      built[0].tile(),
    ]);

    const plain = buildCap(game, commander, game.ref(100, 100));
    command(game, commander, click, StrikeTargetClass.Tile, 1);
    expect(plain.targetTile()).toBe(click);
    const legacyShape = buildCap(game, commander, game.ref(100, 100));
    command(game, commander, click, undefined, 1);
    expect(legacyShape.targetTile()).toBe(click);
  });

  it("refuses a plan outside the Airport profile without mutation", async () => {
    const { game, commander, hostile } = await planGame(false);
    conquerBlock(game, hostile, 80, 10, 120, 30);
    const click = game.ref(100, 20);
    hostile.buildUnit(UnitType.Factory, game.ref(102, 20), {});
    const jet = buildCap(game, commander, game.ref(100, 20));

    command(game, commander, click, StrikeTargetClass.Factories, 1);
    expect(jet.targetTile()).toBe(jet.tile());
    expect(jet.aircraftState().commandRevision).toBe(0);

    command(game, commander, click, undefined, 1);
    expect(jet.targetTile()).toBe(click);
    expect(jet.aircraftState().commandRevision).toBe(1);
  });

  it("bombs and razes two factories with three patrol jets end to end", async () => {
    const { game, commander, hostile } = await planGame();
    const airportTile = game.ref(10, 10);
    commander.conquer(airportTile);
    commander.buildUnit(UnitType.Airport, airportTile, {});
    conquerBlock(game, hostile, 80, 50, 130, 80);
    hostile.setTroops(1_000_000);
    const click = game.ref(100, 60);
    const near = hostile.buildUnit(UnitType.Factory, game.ref(102, 60), {});
    const far = hostile.buildUnit(UnitType.Factory, game.ref(112, 60), {});
    const spared = hostile.buildUnit(UnitType.City, game.ref(100, 70), {});

    game.addExecution(
      new FighterJetExecution(
        commander,
        { mission: AirMissionType.CombatAirPatrol, targetTile: airportTile },
        3,
      ),
    );
    game.executeNextTick();
    tickUntil(game, () => commander.units(UnitType.FighterJet).length === 3);
    const jets = commander.units(UnitType.FighterJet);
    expect(jets).toHaveLength(3);
    tickUntil(
      game,
      () => jets.every((jet) => jet.aircraftState().phase === "patrolling"),
      100,
    );
    for (const jet of jets) jet.move(click);
    const strikes = recordStrikes(game);

    command(game, commander, click, StrikeTargetClass.Factories, 3);
    expect(jets.map((jet) => jet.targetTile()).sort()).toEqual(
      [near.tile(), near.tile(), far.tile()].sort(),
    );

    tickUntil(game, () => strikes.length === 3, 100);
    expect(strikes.map((strike) => strike.tile).sort()).toEqual(
      [near.tile(), near.tile(), far.tile()].sort(),
    );
    expect(near.isActive()).toBe(false);
    expect(far.isActive()).toBe(false);
    expect(spared.isActive()).toBe(true);
    expect(game.hasFallout(near.tile())).toBe(true);
    expect(game.hasFallout(far.tile())).toBe(true);
    expect(game.owner(spared.tile())).toBe(hostile);
    expect(hostile.troops()).toBe(729_000);
    tickUntil(
      game,
      () => jets.every((jet) => jet.aircraftState().phase === "patrolling"),
      100,
    );
    expect(jets.every((jet) => jet.isActive())).toBe(true);
  });
});
