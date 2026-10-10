import { FighterJetExecution } from "../../../src/core/execution/FighterJetExecution";
import { FighterMissileExecution } from "../../../src/core/execution/FighterMissileExecution";
import {
  aircraftMissileDamage,
  aircraftProfile,
  isPatrolAircraftType,
} from "../../../src/core/game/AircraftProfiles";
import {
  AircraftType,
  AirMissionType,
  Difficulty,
  Game,
  GameMapType,
  PATROL_AIRCRAFT_TYPES,
  PatrolAircraftType,
  Player,
  PlayerInfo,
  PlayerType,
  Unit,
  UnitType,
} from "../../../src/core/game/Game";
import { setup } from "../../util/Setup";

const commanderInfo = new PlayerInfo(
  "patrol class commander",
  PlayerType.Human,
  "PATCLS01",
  "patrol-class-commander-id",
);
const hostileInfo = new PlayerInfo(
  "patrol class hostile",
  PlayerType.Human,
  "PATCLS02",
  "patrol-class-hostile-id",
);

async function patrolGame(airportProfile = true): Promise<{
  game: Game;
  commander: Player;
  hostile: Player;
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
    [commanderInfo, hostileInfo],
  );
  const commander = game.player(commanderInfo.id);
  const hostile = game.player(hostileInfo.id);
  commander.addGold(100_000_000n);
  hostile.addGold(100_000_000n);
  return { game, commander, hostile };
}

function buildAirport(game: Game, owner: Player, x: number, y: number): Unit {
  const tile = game.ref(x, y);
  owner.conquer(tile);
  return owner.buildUnit(UnitType.Airport, tile, {});
}

function patrolOrder(targetTile: number, aircraftType?: AircraftType) {
  // The wire type only admits patrol airframes; the F-35 case below checks
  // the runtime gate, so the cast is deliberate.
  return {
    mission: AirMissionType.CombatAirPatrol as const,
    targetTile,
    ...(aircraftType === undefined
      ? {}
      : { aircraftType: aircraftType as PatrolAircraftType }),
  };
}

function launchPatrol(
  game: Game,
  owner: Player,
  targetTile: number,
  aircraftType?: AircraftType,
): void {
  game.addExecution(
    new FighterJetExecution(owner, patrolOrder(targetTile, aircraftType), 1),
  );
  game.executeNextTick();
}

function airbornePatrol(
  game: Game,
  owner: Player,
  tile: number,
  aircraftType?: AircraftType,
): Unit {
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
      ...(aircraftType === undefined ? {} : { aircraftType }),
    },
    targetTile: tile,
  });
}

function tickUntil(game: Game, condition: () => boolean, maximum = 200): void {
  for (let i = 0; i < maximum && !condition(); i++) game.executeNextTick();
  expect(condition()).toBe(true);
}

function fighterOfType(owner: Player, aircraftType: AircraftType | undefined) {
  const fighter = owner
    .units(UnitType.FighterJet)
    .find((unit) => unit.aircraftState().aircraftType === aircraftType);
  expect(fighter).toBeDefined();
  return fighter!;
}

describe("Patrol aircraft classes", () => {
  it("admits every airframe as a patrol airframe, cheapest first", () => {
    expect(PATROL_AIRCRAFT_TYPES).toEqual([
      AircraftType.F16,
      AircraftType.Typhoon,
      AircraftType.F35,
      AircraftType.A10,
      AircraftType.KAAN,
      AircraftType.F22,
      AircraftType.B52,
      AircraftType.B2,
    ]);
    expect(isPatrolAircraftType(undefined)).toBe(true);
    for (const type of Object.values(AircraftType)) {
      expect(isPatrolAircraftType(type)).toBe(true);
    }

    expect(aircraftMissileDamage(300, undefined)).toBe(300);
    expect(aircraftMissileDamage(300, AircraftType.F16)).toBe(300);
    expect(aircraftMissileDamage(300, AircraftType.F35)).toBe(375);
    expect(aircraftMissileDamage(300, AircraftType.B2)).toBe(600);
    expect(aircraftMissileDamage(600, AircraftType.B2)).toBe(1200);
  });

  it("launches a B-2 patrol with its own hull, price and airframe on the unit", async () => {
    const { game, commander } = await patrolGame();
    const airport = buildAirport(game, commander, 10, 10);
    const anchor = game.ref(10, 10);

    let goldBefore = commander.gold();
    launchPatrol(game, commander, anchor, AircraftType.B2);
    const b2 = fighterOfType(commander, AircraftType.B2);
    expect(b2.aircraftState().mission).toBe(AirMissionType.CombatAirPatrol);
    expect(b2.aircraftState().homeFactoryId).toBe(airport.id());
    expect(b2.maxHealth()).toBe(1500);
    expect(b2.health()).toBe(aircraftProfile(AircraftType.B2).health);
    expect(goldBefore - commander.gold()).toBe(3_750_000n);

    goldBefore = commander.gold();
    launchPatrol(game, commander, anchor, AircraftType.F16);
    const f16 = fighterOfType(commander, AircraftType.F16);
    expect(f16.maxHealth()).toBe(300);
    expect(f16.health()).toBe(300);
    expect(goldBefore - commander.gold()).toBe(750_000n);

    goldBefore = commander.gold();
    launchPatrol(game, commander, anchor);
    const untyped = fighterOfType(commander, undefined);
    expect(untyped.health()).toBe(300);
    expect(goldBefore - commander.gold()).toBe(750_000n);
    expect(commander.units(UnitType.FighterJet)).toHaveLength(3);

    // Airframe and hull are part of the deterministic unit identity.
    expect(b2.hash()).not.toBe(f16.hash());
  });

  it("flies a B-2 patrol faster than an F-16 on the same route", async () => {
    const { game, commander } = await patrolGame();
    buildAirport(game, commander, 10, 10);
    const anchor = game.ref(90, 10);
    commander.conquer(anchor);

    game.addExecution(
      new FighterJetExecution(commander, patrolOrder(anchor, AircraftType.F16)),
      new FighterJetExecution(commander, patrolOrder(anchor, AircraftType.B2)),
    );
    game.executeNextTick();
    game.executeNextTick();

    const origin = game.ref(10, 10);
    const f16Distance = game.manhattanDist(
      origin,
      fighterOfType(commander, AircraftType.F16).tile(),
    );
    const b2Distance = game.manhattanDist(
      origin,
      fighterOfType(commander, AircraftType.B2).tile(),
    );
    expect(f16Distance).toBeGreaterThan(0);
    expect(b2Distance).toBeGreaterThan(f16Distance);
    // Both jets took the same number of route steps along a straight path.
    expect(b2Distance * aircraftProfile(AircraftType.F16).speed).toBe(
      f16Distance * aircraftProfile(AircraftType.B2).speed,
    );
  });

  it("hits harder with a B-2 missile and takes more hits to bring down", async () => {
    const { game, commander, hostile } = await patrolGame();
    const target = airbornePatrol(
      game,
      hostile,
      game.ref(34, 10),
      AircraftType.B2,
    );
    const f16 = airbornePatrol(
      game,
      commander,
      game.ref(10, 10),
      AircraftType.F16,
    );
    const lightShot = new FighterMissileExecution(commander, f16, target);
    game.addExecution(lightShot);
    tickUntil(game, () => !lightShot.isActive());
    expect(lightShot.missileUnitForTesting()?.reachedTarget()).toBe(true);
    expect(target.isActive()).toBe(true);
    // An F-16 missile (300) scratches a 1,500-point B-2 hull.
    expect(target.health()).toBe(1200);

    const b2 = airbornePatrol(
      game,
      commander,
      game.ref(10, 12),
      AircraftType.B2,
    );
    const heavyShot = new FighterMissileExecution(commander, b2, target);
    game.addExecution(heavyShot);
    tickUntil(game, () => !heavyShot.isActive());
    expect(heavyShot.missileUnitForTesting()?.reachedTarget()).toBe(true);
    expect(target.isActive()).toBe(true);
    // A B-2 missile (600) hits twice as hard as an F-16's.
    expect(target.health()).toBe(600);

    // An untyped legacy hull still dies to one baseline missile.
    const legacy = airbornePatrol(game, hostile, game.ref(34, 14));
    const finishingShot = new FighterMissileExecution(commander, f16, legacy);
    game.addExecution(finishingShot);
    tickUntil(game, () => !finishingShot.isActive());
    expect(legacy.isActive()).toBe(false);
  });

  it("launches a stealth F-35 patrol with its own hull and price", async () => {
    const { game, commander } = await patrolGame();
    const airport = buildAirport(game, commander, 10, 10);
    const goldBefore = commander.gold();

    launchPatrol(game, commander, game.ref(10, 10), AircraftType.F35);

    const f35 = fighterOfType(commander, AircraftType.F35);
    expect(f35.aircraftState().mission).toBe(AirMissionType.CombatAirPatrol);
    expect(f35.aircraftState().homeFactoryId).toBe(airport.id());
    expect(f35.maxHealth()).toBe(500);
    expect(f35.health()).toBe(aircraftProfile(AircraftType.F35).health);
    expect(airport.missileTimerQueue()).toHaveLength(1);
    expect(goldBefore - commander.gold()).toBe(1_500_000n);
  });

  it("keeps a legacy V2 Factory patrol on the generic hull without the airframe field", async () => {
    const { game, commander } = await patrolGame(false);
    const tile = game.ref(10, 10);
    commander.conquer(tile);
    commander.buildUnit(UnitType.Factory, tile, {});

    launchPatrol(game, commander, tile, AircraftType.B2);

    const fighter = commander.units(UnitType.FighterJet)[0];
    expect(fighter).toBeDefined();
    expect(fighter.aircraftState().aircraftType).toBeUndefined();
    expect(fighter.health()).toBe(300);
    expect(fighter.maxHealth()).toBe(300);
  });
});
