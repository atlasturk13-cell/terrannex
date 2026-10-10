import { AirPatrolCommandExecution } from "../../../src/core/execution/AirPatrolCommandExecution";
import { ConstructionExecution } from "../../../src/core/execution/ConstructionExecution";
import { FighterBombExecution } from "../../../src/core/execution/FighterBombExecution";
import { FighterJetExecution } from "../../../src/core/execution/FighterJetExecution";
import { FighterMissileExecution } from "../../../src/core/execution/FighterMissileExecution";
import { NationFighterBehavior } from "../../../src/core/execution/nation/NationFighterBehavior";
import {
  AIRPORT_FIGHTER_CAPACITY,
  AirMissionType,
  Difficulty,
  Execution,
  Game,
  GameMapType,
  MAX_COMMAND_AMOUNT,
  Player,
  PlayerInfo,
  PlayerType,
  Unit,
  UnitType,
} from "../../../src/core/game/Game";
import { PseudoRandom } from "../../../src/core/PseudoRandom";
import { setup } from "../../util/Setup";

const commanderInfo = new PlayerInfo(
  "airport commander",
  PlayerType.Human,
  "airport-commander-client",
  "airport-commander-id",
);
const hostileInfo = new PlayerInfo(
  "airport hostile",
  PlayerType.Human,
  "airport-hostile-client",
  "airport-hostile-id",
);

async function airportGame(): Promise<{
  game: Game;
  commander: Player;
  hostile: Player;
}> {
  const game = await setup(
    "big_plains",
    {
      airportOperationsV1: true,
      airSuperiorityV1: true,
      combinedArmsV1: true,
      combinedArmsV2: true,
      difficulty: Difficulty.Impossible,
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

function buildAirport(game: Game, owner: Player, x: number, y: number): Unit {
  const tile = game.ref(x, y);
  owner.conquer(tile);
  return owner.buildUnit(UnitType.Airport, tile, {});
}

function attributedFighter(
  game: Game,
  owner: Player,
  airportID: number,
  x: number,
  y: number,
): Unit {
  const tile = game.ref(x, y);
  return owner.buildUnit(UnitType.FighterJet, tile, {
    aircraftState: {
      mission: AirMissionType.CombatAirPatrol,
      phase: "patrolling",
      homeFactoryId: airportID,
      missionEndTick: Number.MAX_SAFE_INTEGER,
      ammo: 2,
      targetedBySam: false,
      patrolAnchorTile: tile,
      commandRevision: 0,
    },
    targetTile: tile,
  });
}

function launchPatrol(
  game: Game,
  owner: Player,
  targetTile: number,
  amount = 1,
): void {
  const before = owner.units(UnitType.FighterJet).length;
  game.addExecution(
    new FighterJetExecution(
      owner,
      { mission: AirMissionType.CombatAirPatrol, targetTile },
      amount,
    ),
  );
  game.executeNextTick();
  // An accepted order launches its first jet at once and the rest one at a
  // time; a rejected order launches nothing and needs no waiting.
  if (owner.units(UnitType.FighterJet).length === before) return;
  for (
    let i = 0;
    i < amount * 4 && owner.units(UnitType.FighterJet).length < before + amount;
    i++
  ) {
    game.executeNextTick();
  }
}

function tickUntil(game: Game, condition: () => boolean, maximum = 500): void {
  for (let i = 0; i < maximum && !condition(); i++) game.executeNextTick();
  expect(condition()).toBe(true);
}

function scheduleThen(
  game: Game,
  scheduled: Execution,
  afterSchedule: () => void,
): void {
  let active = true;
  game.addExecution({
    init: () => {},
    tick: () => {
      game.addExecution(scheduled);
      afterSchedule();
      active = false;
    },
    isActive: () => active,
    activeDuringSpawnPhase: () => false,
  });
}

describe("Airport operations V1", () => {
  it("is admitted only with the complete local profile and preserves legacy constants", async () => {
    const admitted = await airportGame();
    expect(admitted.game.config().airportOperationsV1Enabled()).toBe(true);
    expect(admitted.game.config().fighterAttackCooldown()).toBe(3);
    expect(admitted.game.config().fighterMissileSpeed()).toBe(12);
    expect(admitted.game.config().fighterBombSpeed()).toBe(8);

    for (const overrides of [
      { airportOperationsV1: true },
      {
        airportOperationsV1: true,
        airSuperiorityV1: true,
        combinedArmsV1: true,
        combinedArmsV2: true,
        gameMap: GameMapType.World,
      },
      {
        airSuperiorityV1: true,
        combinedArmsV1: true,
        combinedArmsV2: true,
        gameMap: GameMapType.NaturalEarthWorld,
      },
    ] as const) {
      const game = await setup("big_plains", overrides, [commanderInfo]);
      expect(game.config().airportOperationsV1Enabled()).toBe(false);
      expect(game.config().fighterAttackCooldown()).toBe(
        overrides.combinedArmsV2 === true ? 6 : 8,
      );
      expect(game.config().fighterMissileSpeed()).toBe(9);
      expect(game.config().isUnitDisabled(UnitType.Airport)).toBe(true);
    }
  });

  it("rejects a Factory-only launch without charging or cooldown mutation", async () => {
    const { game, commander } = await airportGame();
    const tile = game.ref(10, 10);
    commander.conquer(tile);
    const factory = commander.buildUnit(UnitType.Factory, tile, {});
    const goldBefore = commander.gold();

    launchPatrol(game, commander, game.ref(150, 150));

    expect(commander.units(UnitType.FighterJet)).toHaveLength(0);
    expect(factory.missileTimerQueue()).toEqual([]);
    expect(commander.gold()).toBe(goldBefore);
  });

  it("requires exact placement for an Airport instead of silently relocating it", async () => {
    const { game, commander } = await airportGame();
    game.config().structureMinDist = () => 5;
    for (let x = 10; x <= 15; x++) commander.conquer(game.ref(x, 10));
    const clicked = game.ref(10, 10);
    buildAirport(game, commander, 10, 10);
    expect(commander.canBuild(UnitType.Airport, clicked)).not.toBe(false);
    expect(commander.canBuildExact(UnitType.Airport, clicked)).toBe(false);
    const goldBefore = commander.gold();

    game.addExecution(
      new ConstructionExecution(commander, UnitType.Airport, clicked),
    );
    game.executeNextTick();

    expect(commander.units(UnitType.Airport)).toHaveLength(1);
    expect(commander.gold()).toBe(goldBefore);
  });

  it("allocates an order to the nearest Airport first, by distance then ID", async () => {
    const { game, commander } = await airportGame();
    const first = buildAirport(game, commander, 10, 10);
    const second = buildAirport(game, commander, 40, 10);
    const target = game.ref(12, 12);

    launchPatrol(game, commander, target, 4);

    const homes = commander
      .units(UnitType.FighterJet)
      .map((fighter) => fighter.aircraftState().homeFactoryId);
    expect(homes.filter((id) => id === first.id())).toHaveLength(4);
    expect(homes.filter((id) => id === second.id())).toHaveLength(0);
    expect(first.missileTimerQueue()).toHaveLength(4);
    expect(second.missileTimerQueue()).toHaveLength(0);
  });

  it("spills over to the next Airport only once physical capacity is exhausted", async () => {
    const { game, commander } = await airportGame();
    commander.addGold(1_000_000_000n);
    const first = buildAirport(game, commander, 10, 10);
    const second = buildAirport(game, commander, 40, 10);
    for (let i = 0; i < AIRPORT_FIGHTER_CAPACITY - 1; i++) {
      attributedFighter(game, commander, first.id(), 10, 12);
    }

    launchPatrol(game, commander, game.ref(12, 12), 3);

    const homes = commander
      .units(UnitType.FighterJet)
      .map((fighter) => fighter.aircraftState().homeFactoryId);
    expect(homes.filter((id) => id === first.id())).toHaveLength(
      AIRPORT_FIGHTER_CAPACITY,
    );
    expect(homes.filter((id) => id === second.id())).toHaveLength(2);
    expect(first.missileTimerQueue()).toHaveLength(1);
    expect(second.missileTimerQueue()).toHaveLength(2);
  });

  it("rejects an oversized physical-capacity order with no partial mutation", async () => {
    const { game, commander } = await airportGame();
    commander.addGold(1_000_000_000n);
    const first = buildAirport(game, commander, 10, 10);
    const second = buildAirport(game, commander, 40, 10);
    for (let i = 0; i < AIRPORT_FIGHTER_CAPACITY; i++) {
      attributedFighter(game, commander, first.id(), 10, 12);
    }
    for (let i = 0; i < AIRPORT_FIGHTER_CAPACITY - 2; i++) {
      attributedFighter(game, commander, second.id(), 40, 12);
    }
    const goldBefore = commander.gold();
    const jetsBefore = commander.units(UnitType.FighterJet).length;

    launchPatrol(game, commander, game.ref(150, 150), 3);

    expect(commander.units(UnitType.FighterJet)).toHaveLength(jetsBefore);
    expect(first.missileTimerQueue()).toEqual([]);
    expect(second.missileTimerQueue()).toEqual([]);
    expect(commander.gold()).toBe(goldBefore);
  });

  it("rejects an amount above the universal command ceiling atomically", async () => {
    const { game, commander } = await airportGame();
    const airport = buildAirport(game, commander, 10, 10);
    const goldBefore = commander.gold();

    launchPatrol(game, commander, game.ref(150, 150), MAX_COMMAND_AMOUNT + 1);

    expect(commander.units(UnitType.FighterJet)).toHaveLength(0);
    expect(airport.missileTimerQueue()).toEqual([]);
    expect(commander.gold()).toBe(goldBefore);
  });

  it("frees deleted-jet capacity but preserves that launch slot's cooldown", async () => {
    const { game, commander } = await airportGame();
    commander.addGold(1_000_000_000n);
    const airport = buildAirport(game, commander, 10, 10);
    const prebuilt = new Set<number>();
    for (let i = 0; i < AIRPORT_FIGHTER_CAPACITY - 1; i++) {
      prebuilt.add(
        attributedFighter(game, commander, airport.id(), 10, 12).id(),
      );
    }
    launchPatrol(game, commander, game.ref(150, 150));
    expect(commander.units(UnitType.FighterJet)).toHaveLength(
      AIRPORT_FIGHTER_CAPACITY,
    );
    const goldWhenFull = commander.gold();

    // Physically full: another order is rejected without mutation.
    launchPatrol(game, commander, game.ref(150, 150));
    expect(commander.units(UnitType.FighterJet)).toHaveLength(
      AIRPORT_FIGHTER_CAPACITY,
    );
    expect(commander.gold()).toBe(goldWhenFull);
    expect(airport.missileTimerQueue()).toHaveLength(1);

    const deleted = commander
      .units(UnitType.FighterJet)
      .find((fighter) => !prebuilt.has(fighter.id()))!;
    deleted.delete(false);
    launchPatrol(game, commander, game.ref(150, 150));
    expect(commander.units(UnitType.FighterJet)).toHaveLength(
      AIRPORT_FIGHTER_CAPACITY,
    );
    // The deleted jet's launch slot keeps its cooldown entry.
    expect(airport.missileTimerQueue()).toHaveLength(2);
  });

  it("keeps physical Airport capacity across capture and frees only a deleted jet slot", async () => {
    const { game, commander, hostile } = await airportGame();
    commander.addGold(1_000_000_000n);
    const airport = buildAirport(game, commander, 10, 10);
    let last: Unit | undefined;
    for (let i = 0; i < AIRPORT_FIGHTER_CAPACITY; i++) {
      last = attributedFighter(game, commander, airport.id(), 20, 10);
    }
    airport.setOwner(hostile);
    hostile.conquer(game.ref(30, 10));
    const hostileGold = hostile.gold();

    launchPatrol(game, hostile, game.ref(150, 150));
    expect(hostile.units(UnitType.FighterJet)).toHaveLength(0);
    expect(hostile.gold()).toBe(hostileGold);

    last!.delete(false);
    launchPatrol(game, hostile, game.ref(150, 150));
    const replacement = hostile.units(UnitType.FighterJet)[0];
    expect(replacement).toBeDefined();
    expect(replacement.aircraftState().homeFactoryId).toBe(airport.id());
  });

  it("keeps the physical Airport rearm queue across capture", async () => {
    const { game, commander, hostile } = await airportGame();
    const airport = buildAirport(game, commander, 10, 10);
    launchPatrol(game, commander, game.ref(150, 150));
    const launched = commander.units(UnitType.FighterJet)[0];
    launched.delete(false);
    // Every other launch slot is still rearming when the Airport changes hands.
    for (let i = 0; i < AIRPORT_FIGHTER_CAPACITY - 2; i++) airport.launch();
    airport.setOwner(hostile);
    hostile.conquer(game.ref(30, 10));
    const goldBefore = hostile.gold();

    launchPatrol(game, hostile, game.ref(150, 150), 3);
    expect(hostile.units(UnitType.FighterJet)).toHaveLength(0);
    expect(hostile.gold()).toBe(goldBefore);
    expect(airport.missileTimerQueue()).toHaveLength(
      AIRPORT_FIGHTER_CAPACITY - 1,
    );

    for (let i = 0; i < game.config().fighterLaunchCooldown(); i++) {
      game.executeNextTick();
    }
    launchPatrol(game, hostile, game.ref(150, 150), 3);
    expect(hostile.units(UnitType.FighterJet)).toHaveLength(3);
    expect(
      hostile
        .units(UnitType.FighterJet)
        .every(
          (fighter) => fighter.aircraftState().homeFactoryId === airport.id(),
        ),
    ).toBe(true);
  });

  it("downs an airborne patrol when its Airport is lost and refuses a replacement", async () => {
    const { game, commander } = await airportGame();
    const airport = buildAirport(game, commander, 10, 10);
    launchPatrol(game, commander, game.ref(150, 150));
    const fighter = commander.units(UnitType.FighterJet)[0];
    airport.delete(false);
    game.executeNextTick();
    // A base that is gone takes its aircraft with it.
    expect(fighter.isActive()).toBe(false);
    expect(commander.units(UnitType.FighterJet)).toHaveLength(0);

    const goldBefore = commander.gold();
    launchPatrol(game, commander, game.ref(150, 150));
    expect(commander.units(UnitType.FighterJet)).toHaveLength(0);
    expect(commander.gold()).toBe(goldBefore);
  });

  it("publishes symmetric faster missiles and allows mutual destruction", async () => {
    const { game, commander, hostile } = await airportGame();
    const commanderAirport = buildAirport(game, commander, 5, 5);
    const hostileAirport = buildAirport(game, hostile, 60, 5);
    const left = attributedFighter(
      game,
      commander,
      commanderAirport.id(),
      10,
      10,
    );
    const right = attributedFighter(game, hostile, hostileAirport.id(), 34, 10);
    const leftShot = new FighterMissileExecution(commander, left, right);
    const rightShot = new FighterMissileExecution(hostile, right, left);
    game.addExecution(leftShot, rightShot);

    game.executeNextTick();
    expect(left.health()).toBe(300);
    expect(right.health()).toBe(300);
    expect(commander.units(UnitType.FighterMissile)).toHaveLength(1);
    expect(hostile.units(UnitType.FighterMissile)).toHaveLength(1);

    const positions = [leftShot.missileUnitForTesting()!.tile()];
    let elapsed = 0;
    while (leftShot.isActive() || rightShot.isActive()) {
      game.executeNextTick();
      elapsed++;
      const missile = leftShot.missileUnitForTesting();
      if (missile !== null) positions.push(missile.tile());
      // One full flight tick at 300 hull; the missiles detonate on contact
      // the tick the jets come inside their 12-tile reach (24 tiles apart:
      // flight, then contact) instead of pausing a tick on the reached tile.
      if (elapsed <= 1) {
        expect(left.health()).toBe(300);
        expect(right.health()).toBe(300);
      }
    }

    expect(elapsed * game.config().msPerTick()).toBeGreaterThanOrEqual(200);
    expect(new Set(positions).size).toBeGreaterThanOrEqual(3);
    expect(left.isActive()).toBe(false);
    expect(right.isActive()).toBe(false);
    expect(leftShot.missileUnitForTesting()?.reachedTarget()).toBe(true);
    expect(rightShot.missileUnitForTesting()?.reachedTarget()).toBe(true);
  });

  it("lets an already-launched profile missile impact after its source is destroyed", async () => {
    const { game, commander, hostile } = await airportGame();
    const commanderAirport = buildAirport(game, commander, 5, 5);
    const hostileAirport = buildAirport(game, hostile, 60, 5);
    const source = attributedFighter(
      game,
      commander,
      commanderAirport.id(),
      10,
      10,
    );
    const target = attributedFighter(
      game,
      hostile,
      hostileAirport.id(),
      34,
      10,
    );
    const shot = new FighterMissileExecution(commander, source, target);
    scheduleThen(game, shot, () => source.delete(false));
    game.executeNextTick();
    game.executeNextTick();
    const missile = shot.missileUnitForTesting()!;
    expect(missile.isActive()).toBe(true);
    tickUntil(game, () => !shot.isActive(), 20);

    expect(target.isActive()).toBe(false);
    expect(missile.reachedTarget()).toBe(true);
  });

  it("drops the bomb over the strike point on arrival and resumes the same patrol", async () => {
    const { game, commander, hostile } = await airportGame();
    buildAirport(game, commander, 10, 10);
    const strikeTile = game.ref(120, 10);
    hostile.conquer(strikeTile);
    hostile.addTroops(1_000_000);
    launchPatrol(game, commander, game.ref(10, 10));
    const fighter = commander.units(UnitType.FighterJet)[0];
    tickUntil(game, () => fighter.aircraftState().phase === "patrolling", 100);
    const fighterID = fighter.id();
    fighter.move(game.ref(90, 10));
    const troopsBefore = hostile.troops();

    game.addExecution(
      new AirPatrolCommandExecution(
        commander,
        { mission: AirMissionType.PrecisionStrike, targetTile: strikeTile },
        1,
      ),
    );
    const commandTick = game.ticks();
    tickUntil(
      game,
      () => commander.units(UnitType.FighterBomb).length === 1,
      100,
    );
    const bomb = commander.units(UnitType.FighterBomb)[0];
    // The jet flew the 30 tiles at its own speed (three moves) and released
    // over the target itself: no stand-off, no bomb cruise, no cadence wait.
    expect(game.ticks() - commandTick).toBeLessThanOrEqual(5);
    expect(fighter.tile()).toBe(strikeTile);
    expect(bomb.tile()).toBe(strikeTile);
    expect(hostile.troops()).toBe(troopsBefore);

    let elapsed = 0;
    while (bomb.isActive() && elapsed < 20) {
      game.executeNextTick();
      elapsed++;
    }
    expect(elapsed).toBeLessThanOrEqual(2);
    expect(bomb.reachedTarget()).toBe(true);
    // The impact razes the strike point: unowned fallout, never captured.
    expect(game.hasOwner(strikeTile)).toBe(false);
    expect(game.hasFallout(strikeTile)).toBe(true);
    expect(commander.numTilesOwned()).toBe(1);
    expect(hostile.troops()).toBeLessThan(troopsBefore);
    const troopsAfterImpact = hostile.troops();
    for (let i = 0; i < 10; i++) game.executeNextTick();
    expect(hostile.troops()).toBe(troopsAfterImpact);

    tickUntil(game, () => fighter.aircraftState().phase === "patrolling", 100);
    expect(commander.units(UnitType.FighterJet)[0].id()).toBe(fighterID);
  });

  it("sends every selected patrol jet and bomb to one chosen strike point", async () => {
    const { game, commander, hostile } = await airportGame();
    buildAirport(game, commander, 10, 10);
    const strikeTile = game.ref(120, 10);
    hostile.conquer(strikeTile);
    // Land outside the raze radius keeps the victim alive for the second,
    // later-departing jet.
    hostile.conquer(game.ref(130, 10));
    hostile.addTroops(1_000_000);
    launchPatrol(game, commander, game.ref(10, 10), 2);
    const fighters = commander.units(UnitType.FighterJet);
    tickUntil(
      game,
      () =>
        fighters.every(
          (fighter) => fighter.aircraftState().phase === "patrolling",
        ),
      100,
    );
    for (const fighter of fighters) fighter.move(strikeTile);

    game.addExecution(
      new AirPatrolCommandExecution(
        commander,
        { mission: AirMissionType.PrecisionStrike, targetTile: strikeTile },
        2,
      ),
    );
    game.executeNextTick();

    expect(fighters.map((fighter) => fighter.targetTile())).toEqual([
      strikeTile,
      strikeTile,
    ]);
    // The jets leave one after another, so their bombs are never live at
    // the same time; collect every bomb as it appears.
    const bombTargets = new Map<number, number | undefined>();
    tickUntil(
      game,
      () => {
        for (const bomb of commander.units(UnitType.FighterBomb)) {
          bombTargets.set(bomb.id(), bomb.targetTile());
        }
        return bombTargets.size === 2;
      },
      100,
    );
    expect([...bombTargets.values()]).toEqual([strikeTile, strikeTile]);
  });

  it("keeps an accepted bomb after same-tick source destruction", async () => {
    const { game, commander, hostile } = await airportGame();
    const airport = buildAirport(game, commander, 5, 5);
    const source = attributedFighter(game, commander, airport.id(), 10, 10);
    const target = game.ref(34, 10);
    hostile.conquer(target);
    hostile.addTroops(1_000_000);
    const troopsBefore = hostile.troops();
    const strike = new FighterBombExecution(commander, source, target);

    scheduleThen(game, strike, () => source.delete(false));
    game.executeNextTick();
    game.executeNextTick();
    const bomb = strike.bombUnitForTesting()!;
    expect(bomb.isActive()).toBe(true);
    tickUntil(game, () => !strike.isActive(), 20);

    expect(bomb.reachedTarget()).toBe(true);
    expect(hostile.troops()).toBeLessThan(troopsBefore);
  });

  it("aborts a released bomb if diplomacy changes and rejects forged non-land retasks", async () => {
    const { game, commander, hostile } = await airportGame();
    const sourceAirport = buildAirport(game, commander, 10, 10);
    const fighter = attributedFighter(
      game,
      commander,
      sourceAirport.id(),
      10,
      10,
    );
    const target = game.ref(34, 10);
    hostile.conquer(target);
    hostile.addTroops(1_000_000);
    const bombExec = new FighterBombExecution(commander, fighter, target);
    game.addExecution(bombExec);
    game.executeNextTick();
    const bomb = bombExec.bombUnitForTesting()!;
    const troopsBefore = hostile.troops();
    const request = commander.createAllianceRequest(hostile);
    expect(request).not.toBeNull();
    request!.accept();
    tickUntil(game, () => !bombExec.isActive(), 20);
    expect(hostile.troops()).toBe(troopsBefore);
    expect(bomb.reachedTarget()).toBe(false);

    const revision = fighter.aircraftState().commandRevision;
    game.addExecution(
      new AirPatrolCommandExecution(
        commander,
        { mission: AirMissionType.Intercept, targetUnitId: fighter.id() },
        1,
      ),
    );
    game.executeNextTick();
    expect(fighter.aircraftState().commandRevision).toBe(revision);
  });

  it("makes Nation AI require and use an Airport in the new profile", async () => {
    const nationInfo = new PlayerInfo(
      "airport nation",
      PlayerType.Nation,
      null,
      "airport-nation-id",
    );
    const enemyInfo = new PlayerInfo(
      "airport nation enemy",
      PlayerType.Human,
      null,
      "airport-nation-enemy-id",
    );
    const game = await setup(
      "big_plains",
      {
        airportOperationsV1: true,
        airSuperiorityV1: true,
        combinedArmsV1: true,
        combinedArmsV2: true,
        difficulty: Difficulty.Impossible,
        gameMap: GameMapType.NaturalEarthWorld,
        instantBuild: true,
      },
      [nationInfo, enemyInfo],
    );
    const nation = game.player(nationInfo.id);
    const tile = game.ref(10, 10);
    nation.conquer(tile);
    nation.addGold(20_000_000n);
    nation.buildUnit(UnitType.Factory, tile, {});
    const behavior = new NationFighterBehavior(
      new PseudoRandom(1234),
      game,
      nation,
    );
    expect(behavior.maybeLaunchFighter()).toBe(false);

    buildAirport(game, nation, 12, 10);
    expect(behavior.maybeLaunchFighter()).toBe(true);
    game.executeNextTick();
    const fighter = nation.units(UnitType.FighterJet)[0];
    expect(fighter.aircraftState().homeFactoryId).toBe(
      nation.units(UnitType.Airport)[0].id(),
    );
  });
});
