import { FighterJetExecution } from "../../../src/core/execution/FighterJetExecution";
import { FighterMissileExecution } from "../../../src/core/execution/FighterMissileExecution";
import {
  AircraftType,
  AirMissionType,
  Difficulty,
  Game,
  GameMapType,
  Player,
  PlayerInfo,
  PlayerType,
  Unit,
  UnitType,
} from "../../../src/core/game/Game";
import { setup } from "../../util/Setup";

const commanderInfo = new PlayerInfo(
  "contact commander",
  PlayerType.Human,
  "CNTK0001",
  "contact-commander-id",
);
const hostileInfo = new PlayerInfo(
  "contact hostile",
  PlayerType.Human,
  "CNTK0002",
  "contact-hostile-id",
);

async function contactGame(profile: "airport" | "legacy" = "airport"): Promise<{
  game: Game;
  commander: Player;
  hostile: Player;
}> {
  const game = await setup(
    "big_plains",
    {
      ...(profile === "airport"
        ? { airportOperationsV1: true, difficulty: Difficulty.Impossible }
        : {}),
      airSuperiorityV1: true,
      combinedArmsV1: true,
      combinedArmsV2: true,
      gameMap: GameMapType.NaturalEarthWorld,
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

function warshipAt(game: Game, owner: Player, x: number, y: number): Unit {
  const tile = game.ref(x, y);
  return owner.buildUnit(UnitType.Warship, tile, { patrolTile: tile });
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

function tickUntil(game: Game, condition: () => boolean, maximum = 200): void {
  for (let i = 0; i < maximum && !condition(); i++) game.executeNextTick();
  expect(condition()).toBe(true);
}

describe("Anti-ship contact kill", () => {
  it("sinks a Warship that keeps sailing with the one missile that reaches it, on the contact tick", async () => {
    const { game, commander, hostile } = await contactGame();
    const f16 = airbornePatrol(
      game,
      commander,
      game.ref(10, 10),
      AircraftType.F16,
    );
    const ship = warshipAt(game, hostile, 60, 10);
    const shot = new FighterMissileExecution(commander, f16, ship);
    game.addExecution(shot);
    const reach = game.config().fighterMissileSpeed();

    let shipX = 60;
    let contactTick: number | null = null;
    let sunkTick: number | null = null;
    for (let tick = 1; tick <= 20 && sunkTick === null; tick++) {
      const missile = shot.missileUnitForTesting();
      if (
        contactTick === null &&
        missile !== null &&
        game.manhattanDist(missile.tile(), ship.tile()) <= reach
      ) {
        contactTick = tick;
      }
      game.executeNextTick();
      if (ship.isActive()) {
        shipX += 1;
        ship.move(game.ref(shipX, 10));
      } else {
        sunkTick = tick;
      }
    }

    // Tick 1 only spawns the missile; from tick 2 it closes 11 tiles per
    // tick on the sailing ship, is in reach before tick 6 and sinks the ship
    // on tick 6 — the first missile, exactly where the ship was.
    expect(contactTick).toBe(6);
    expect(sunkTick).toBe(6);
    expect(ship.isActive()).toBe(false);
    expect(ship.wasDestroyedByEnemy()).toBe(true);
    expect(ship.destroyer()).toBe(commander);
    const missile = shot.missileUnitForTesting();
    expect(missile?.reachedTarget()).toBe(true);
    expect(missile?.tile()).toBe(game.ref(65, 10));
    expect(shot.isActive()).toBe(false);
    expect(commander.units(UnitType.FighterMissile)).toHaveLength(0);
  });

  it("kills a full-hull and a veteran Warship in one F-16 hit", async () => {
    const { game, commander, hostile } = await contactGame();
    const f16 = airbornePatrol(
      game,
      commander,
      game.ref(10, 10),
      AircraftType.F16,
    );
    const ship = warshipAt(game, hostile, 30, 10);
    expect(ship.health()).toBe(1000);
    const shot = new FighterMissileExecution(commander, f16, ship);
    game.addExecution(shot);
    tickUntil(game, () => !shot.isActive(), 10);
    expect(ship.isActive()).toBe(false);
    expect(shot.missileUnitForTesting()?.reachedTarget()).toBe(true);

    const veteran = warshipAt(game, hostile, 30, 14);
    for (let i = 0; i < 3; i++) veteran.recordKill(UnitType.Warship);
    veteran.modifyHealth(600);
    expect(veteran.maxHealth()).toBe(1600);
    expect(veteran.health()).toBe(1600);
    const second = new FighterMissileExecution(commander, f16, veteran);
    game.addExecution(second);
    tickUntil(game, () => !second.isActive(), 10);
    expect(veteran.isActive()).toBe(false);
    expect(veteran.destroyer()).toBe(commander);
  });

  it("hits a jet that keeps flying away on the contact tick with the airframe-scaled hit", async () => {
    const { game, commander, hostile } = await contactGame();
    const f16 = airbornePatrol(
      game,
      commander,
      game.ref(10, 10),
      AircraftType.F16,
    );
    const b2 = airbornePatrol(game, hostile, game.ref(30, 10), AircraftType.B2);
    const shot = new FighterMissileExecution(commander, f16, b2);
    game.addExecution(shot);

    let targetX = 30;
    for (let tick = 1; tick <= 6; tick++) {
      expect(shot.isActive()).toBe(true);
      game.executeNextTick();
      targetX += 8;
      b2.move(game.ref(targetX, 10));
    }
    // Spawned on tick 1, 20 tiles behind a jet fleeing 8 per tick, the
    // 12-tile missile closes 4 per tick and is in reach on tick 6, where it
    // strikes the jet on the jet's own tile instead of pausing behind it.
    expect(shot.isActive()).toBe(false);
    expect(shot.missileUnitForTesting()?.reachedTarget()).toBe(true);
    expect(shot.missileUnitForTesting()?.tile()).toBe(game.ref(70, 10));
    expect(b2.isActive()).toBe(true);
    expect(b2.health()).toBe(1200);
  });

  it("keeps the legacy naval hit and the one-tick pause outside the Airport profile", async () => {
    const { game, commander, hostile } = await contactGame("legacy");
    const f16 = airbornePatrol(game, commander, game.ref(10, 10));
    const ship = warshipAt(game, hostile, 30, 10);
    const shot = new FighterMissileExecution(commander, f16, ship);
    game.addExecution(shot);
    // Tick 1 spawns the missile, ticks 2–3 fly the legacy 9 per tick, tick 4
    // reaches the ship's tile and pauses there, tick 5 impacts for the base
    // 600.
    expect(game.config().fighterMissileSpeed()).toBe(9);
    for (let i = 0; i < 4; i++) game.executeNextTick();
    expect(shot.missileUnitForTesting()?.tile()).toBe(ship.tile());
    expect(ship.health()).toBe(1000);
    expect(shot.isActive()).toBe(true);
    game.executeNextTick();
    expect(shot.isActive()).toBe(false);
    expect(ship.isActive()).toBe(true);
    expect(ship.health()).toBe(400);
  });

  it("lets a B-2 patrol down an F-16 patrol with one missile and survive the return fire", async () => {
    const { game, commander, hostile } = await contactGame();
    conquerBlock(game, commander, 0, 0, 20, 20);
    commander.buildUnit(UnitType.Airport, game.ref(10, 10), {});
    conquerBlock(game, hostile, 30, 0, 50, 20);
    hostile.buildUnit(UnitType.Airport, game.ref(40, 10), {});

    game.addExecution(
      new FighterJetExecution(
        commander,
        {
          mission: AirMissionType.CombatAirPatrol,
          targetTile: game.ref(20, 10),
          aircraftType: AircraftType.B2,
        },
        1,
      ),
      new FighterJetExecution(
        hostile,
        {
          mission: AirMissionType.CombatAirPatrol,
          targetTile: game.ref(30, 10),
          aircraftType: AircraftType.F16,
        },
        1,
      ),
    );
    tickUntil(
      game,
      () =>
        commander.units(UnitType.FighterJet).length === 1 &&
        hostile.units(UnitType.FighterJet).length === 1,
      10,
    );
    const b2 = commander.units(UnitType.FighterJet)[0];
    const f16 = hostile.units(UnitType.FighterJet)[0];
    expect(b2.aircraftState().aircraftType).toBe(AircraftType.B2);
    expect(f16.aircraftState().aircraftType).toBe(AircraftType.F16);

    const f16Hulls = new Set<number>();
    for (let i = 0; i < 150 && f16.isActive(); i++) {
      f16Hulls.add(f16.health());
      game.executeNextTick();
    }
    // The F-16 went from full hull straight to destroyed: one B-2 missile.
    expect(f16.isActive()).toBe(false);
    expect([...f16Hulls]).toEqual([300]);
    expect(f16.wasDestroyedByEnemy()).toBe(true);
    expect(b2.isActive()).toBe(true);
    // At most two F-16 missiles (300 each) landed before the F-16 died.
    expect(b2.health()).toBeGreaterThanOrEqual(900);
  });
});
