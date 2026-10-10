import { FighterJetExecution } from "../../../src/core/execution/FighterJetExecution";
import { SAMLauncherExecution } from "../../../src/core/execution/SAMLauncherExecution";
import {
  aircraftProfile,
  effectiveAircraftType,
} from "../../../src/core/game/AircraftProfiles";
import {
  AircraftType,
  AirMissionType,
  Difficulty,
  Game,
  GameMapType,
  MessageType,
  Player,
  PlayerInfo,
  PlayerType,
  Unit,
  UnitType,
} from "../../../src/core/game/Game";
import { GameUpdateType } from "../../../src/core/game/GameUpdates";
import { setup } from "../../util/Setup";

const commanderInfo = new PlayerInfo(
  "aircraft commander",
  PlayerType.Human,
  "AIRTYPE1",
  "aircraft-commander-id",
);
const hostileInfo = new PlayerInfo(
  "aircraft hostile",
  PlayerType.Human,
  "AIRTYPE2",
  "aircraft-hostile-id",
);

async function aircraftGame(): Promise<{
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

function buildAirport(game: Game, owner: Player, x = 10, y = 10): Unit {
  const tile = game.ref(x, y);
  owner.conquer(tile);
  return owner.buildUnit(UnitType.Airport, tile, {});
}

function buildAircraft(
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

function launchStrike(
  game: Game,
  owner: Player,
  targetTile: number,
  aircraftType: AircraftType | undefined,
  amount = 1,
): void {
  game.addExecution(
    new FighterJetExecution(
      owner,
      {
        mission: AirMissionType.PrecisionStrike,
        targetTile,
        ...(aircraftType === undefined ? {} : { aircraftType }),
      },
      amount,
    ),
  );
  game.executeNextTick();
}

function tickUntil(
  game: Game,
  condition: () => boolean,
  maximum = 500,
): number {
  let elapsed = 0;
  while (elapsed < maximum && !condition()) {
    game.executeNextTick();
    elapsed++;
  }
  expect(condition()).toBe(true);
  return elapsed;
}

describe("Airport aircraft profiles", () => {
  it("keeps the original three profiles unchanged among the eight airframes", () => {
    expect(Object.values(AircraftType)).toEqual([
      "f16",
      "f35",
      "b2",
      "f22",
      "kaan",
      "typhoon",
      "a10",
      "b52",
    ]);
    expect(effectiveAircraftType(undefined)).toBe(AircraftType.F16);

    const f16 = aircraftProfile(AircraftType.F16);
    const f35 = aircraftProfile(AircraftType.F35);
    const b2 = aircraftProfile(AircraftType.B2);
    // The B-2 is the fast, tough heavy airframe that outguns everything; the
    // F-35 is the stealthy middle rung; the F-16 is the baseline whose hull
    // equals the generic fighter.
    expect(b2.speed).toBeGreaterThan(f16.speed);
    expect(f35.speed).toBe(f16.speed);
    expect(f16.health).toBe(300);
    expect(f35.health).toBe(500);
    expect(b2.health).toBe(1500);
    expect(f35.missileDamagePercent).toBeGreaterThan(f16.missileDamagePercent);
    expect(b2.missileDamagePercent).toBeGreaterThan(f35.missileDamagePercent);
    expect(f35.costMultiplier).toBeGreaterThan(f16.costMultiplier);
    expect(b2.costMultiplier).toBeGreaterThan(f35.costMultiplier);
    // Every model lands with a visible, bounded conventional effect; heavier
    // ordnance reaches further and destroys more.
    expect(f16.areaRadius).toBeGreaterThan(0);
    expect(f16.areaRadius).toBeLessThan(f35.areaRadius);
    expect(f35.areaRadius).toBeLessThan(b2.areaRadius);
    expect(f16.structureRadius).toBe(0);
    expect(f16.maxStructures).toBe(1);
    expect(f35.maxStructures).toBeLessThan(b2.maxStructures);
    expect(f35.bypassesSAM).toBe(true);
    expect(b2.areaRadius).toBeGreaterThan(0);
    expect(b2.areaUnitDamage).toBeGreaterThan(0);
    expect(b2.maxAreaTargets).toBeGreaterThan(0);
  });

  it.each([
    [AircraftType.F16, 750_000n, 900_000],
    [AircraftType.F35, 1_500_000n, 850_000],
    [AircraftType.B2, 3_750_000n, 750_000],
  ] as const)(
    "launches a direct %s strike with delayed model-balanced impact",
    async (aircraftType, expectedCost, expectedTroops) => {
      const { game, commander, hostile } = await aircraftGame();
      buildAirport(game, commander);
      const targetTile = game.ref(120, 10);
      hostile.conquer(targetTile);
      hostile.setTroops(1_000_000);
      const goldBefore = commander.gold();

      launchStrike(game, commander, targetTile, aircraftType);

      const fighter = commander.units(UnitType.FighterJet)[0];
      expect(fighter).toBeDefined();
      expect(fighter.aircraftState().aircraftType).toBe(aircraftType);
      expect(goldBefore - commander.gold()).toBe(expectedCost);
      expect(hostile.troops()).toBe(1_000_000);

      tickUntil(game, () => commander.units(UnitType.FighterBomb).length === 1);
      const bomb = commander.units(UnitType.FighterBomb)[0];
      // Overfly release: the bomb is dropped on the target tile itself.
      expect(bomb.tile()).toBe(targetTile);
      expect(fighter.tile()).toBe(targetTile);
      expect(hostile.troops()).toBe(1_000_000);
      tickUntil(game, () => !bomb.isActive());

      expect(bomb.reachedTarget()).toBe(true);
      expect(hostile.troops()).toBe(expectedTroops);
    },
  );

  it("treats an omitted type as F16 without materializing a legacy state field", async () => {
    const { game, commander, hostile } = await aircraftGame();
    buildAirport(game, commander);
    const targetTile = game.ref(80, 10);
    hostile.conquer(targetTile);
    hostile.setTroops(10);
    const goldBefore = commander.gold();

    launchStrike(game, commander, targetTile, undefined);
    const fighter = commander.units(UnitType.FighterJet)[0];
    expect(fighter.aircraftState().aircraftType).toBeUndefined();
    const legacyShapeHash = fighter.hash();
    fighter.updateAircraftState({ aircraftType: undefined });
    expect(fighter.hash()).toBe(legacyShapeHash);
    expect(goldBefore - commander.gold()).toBe(750_000n);

    tickUntil(game, () => commander.units(UnitType.FighterBomb).length === 1);
    const bomb = commander.units(UnitType.FighterBomb)[0];
    tickUntil(game, () => !bomb.isActive());
    expect(hostile.troops()).toBe(9);
  });

  it("rejects an unaffordable model before charging or reserving an Airport", async () => {
    const { game, commander, hostile } = await aircraftGame();
    const airport = buildAirport(game, commander);
    const targetTile = game.ref(80, 10);
    hostile.conquer(targetTile);
    commander.removeGold(commander.gold());
    commander.addGold(2_000_000n);
    const goldBefore = commander.gold();

    launchStrike(game, commander, targetTile, AircraftType.B2);

    expect(commander.units(UnitType.FighterJet)).toHaveLength(0);
    expect(airport.missileTimerQueue()).toEqual([]);
    expect(commander.gold()).toBe(goldBefore);
  });

  it("applies every accepted bomb once, including a low-troop target", async () => {
    const { game, commander, hostile } = await aircraftGame();
    buildAirport(game, commander);
    const targetTile = game.ref(100, 10);
    hostile.conquer(targetTile);
    // Land outside the F-16 raze radius keeps the victim alive after the
    // first bomb turns the strike point into a crater.
    hostile.conquer(game.ref(104, 10));
    hostile.setTroops(11);

    launchStrike(game, commander, targetTile, AircraftType.F16, 2);
    tickUntil(game, () => commander.units(UnitType.FighterBomb).length === 2);
    const bombs = [...commander.units(UnitType.FighterBomb)];
    tickUntil(game, () => bombs.every((bomb) => !bomb.isActive()));

    expect(bombs.every((bomb) => bomb.reachedTarget())).toBe(true);
    expect(hostile.troops()).toBe(9);
    const afterImpact = hostile.troops();
    for (let i = 0; i < 20; i++) game.executeNextTick();
    expect(hostile.troops()).toBe(afterImpact);

    const lowTroopGame = await aircraftGame();
    buildAirport(lowTroopGame.game, lowTroopGame.commander);
    const lowTarget = lowTroopGame.game.ref(100, 10);
    lowTroopGame.hostile.conquer(lowTarget);
    lowTroopGame.hostile.setTroops(1);
    launchStrike(
      lowTroopGame.game,
      lowTroopGame.commander,
      lowTarget,
      AircraftType.F16,
    );
    tickUntil(
      lowTroopGame.game,
      () => lowTroopGame.commander.units(UnitType.FighterBomb).length === 1,
    );
    const lowBomb = lowTroopGame.commander.units(UnitType.FighterBomb)[0];
    tickUntil(lowTroopGame.game, () => !lowBomb.isActive());
    expect(lowTroopGame.hostile.troops()).toBe(0);
  });

  it("makes an Airport-profile F35 invisible to SAM acquisition", async () => {
    const { game, commander, hostile } = await aircraftGame();
    const stealth = buildAircraft(
      game,
      commander,
      game.ref(20, 20),
      AircraftType.F35,
    );
    const sam = hostile.buildUnit(UnitType.SAMLauncher, game.ref(21, 20), {});
    game.addExecution(new SAMLauncherExecution(hostile, null, sam));

    for (let i = 0; i < 3; i++) game.executeNextTick();
    expect(stealth.targetedBySAM()).toBe(false);
    expect(hostile.units(UnitType.SAMMissile)).toHaveLength(0);

    const visible = buildAircraft(
      game,
      commander,
      game.ref(22, 20),
      AircraftType.F16,
    );
    game.executeNextTick();
    expect(visible.health()).toBeLessThan(300);
    expect(stealth.health()).toBe(500);
  });

  it("applies B2 area damage only to bounded nearby hostile units", async () => {
    const { game, commander, hostile } = await aircraftGame();
    buildAirport(game, commander);
    const targetTile = game.ref(100, 100);
    hostile.conquer(targetTile);
    hostile.setTroops(1_000_000);
    const directHostile = buildAircraft(game, hostile, targetTile);
    const nearbyHostile = buildAircraft(game, hostile, game.ref(105, 100));
    const farHostile = buildAircraft(game, hostile, game.ref(109, 100));
    const nearbyFriendly = buildAircraft(game, commander, game.ref(104, 100));

    launchStrike(game, commander, targetTile, AircraftType.B2);
    tickUntil(game, () => commander.units(UnitType.FighterBomb).length === 1);
    const bomb = commander.units(UnitType.FighterBomb)[0];
    tickUntil(game, () => !bomb.isActive());

    expect(directHostile.isActive()).toBe(false);
    expect(nearbyHostile.isActive()).toBe(false);
    expect(farHostile.health()).toBe(300);
    expect(nearbyFriendly.health()).toBe(300);
  });

  it("replays a multi-B2 strike deterministically", async () => {
    const run = async () => {
      const { game, commander, hostile } = await aircraftGame();
      buildAirport(game, commander);
      const targetTile = game.ref(100, 100);
      hostile.conquer(targetTile);
      hostile.setTroops(1_000_000);
      buildAircraft(game, hostile, targetTile);
      launchStrike(game, commander, targetTile, AircraftType.B2, 2);

      const timeline: unknown[] = [];
      for (let i = 0; i < 80; i++) {
        game.executeNextTick();
        timeline.push(
          game
            .units([UnitType.FighterJet, UnitType.FighterBomb])
            .sort((a, b) => a.id() - b.id())
            .map((unit) => ({
              hash: unit.hash(),
              id: unit.id(),
              state:
                unit.type() === UnitType.FighterJet
                  ? { ...unit.aircraftState() }
                  : undefined,
              tile: unit.tile(),
              type: unit.type(),
            })),
        );
      }
      return { timeline, troops: hostile.troops() };
    };

    expect(await run()).toEqual(await run());
  });
});

describe("Air strike results", () => {
  it("destroys the hostile structures on razed ground and publishes one AirStrikeEvent", async () => {
    const { game, commander, hostile } = await aircraftGame();
    buildAirport(game, commander);
    const targetTile = game.ref(120, 10);
    hostile.conquer(targetTile);
    hostile.conquer(game.ref(121, 10));
    hostile.conquer(game.ref(123, 10));
    hostile.setTroops(1_000_000);
    const city = hostile.buildUnit(UnitType.City, targetTile, {});
    const neighbour = hostile.buildUnit(UnitType.City, game.ref(121, 10), {});
    const distant = hostile.buildUnit(UnitType.City, game.ref(123, 10), {});
    const strikes: Array<{
      troops: number;
      structures: number;
      tilesRazed: number;
    }> = [];
    const addUpdate = game.addUpdate.bind(game);
    vi.spyOn(game, "addUpdate").mockImplementation((update) => {
      if (update.type === GameUpdateType.AirStrikeEvent) {
        strikes.push({
          troops: update.troops,
          structures: update.structures,
          tilesRazed: update.tilesRazed,
        });
        expect(update.tile).toBe(targetTile);
        expect(update.attacker).toBe(commander.id());
        expect(update.target).toBe(hostile.id());
        expect(update.aircraftType).toBe(AircraftType.F16);
      }
      addUpdate(update);
    });
    const incoming = vi.spyOn(game, "displayIncomingUnit");

    launchStrike(game, commander, targetTile, AircraftType.F16);
    tickUntil(game, () => commander.units(UnitType.FighterBomb).length === 1);
    expect(incoming).toHaveBeenCalledWith(
      expect.any(Number),
      expect.stringContaining("AIR STRIKE INBOUND"),
      MessageType.AIR_STRIKE_INBOUND,
      hostile.id(),
    );
    const bomb = commander.units(UnitType.FighterBomb)[0];
    tickUntil(game, () => !bomb.isActive());

    expect(bomb.reachedTarget()).toBe(true);
    // F-16: the impact tile and the neighbour one tile away sit on razed
    // ground (radius 2) and die; the City three tiles away survives.
    expect(city.isActive()).toBe(false);
    expect(neighbour.isActive()).toBe(false);
    expect(distant.isActive()).toBe(true);
    expect(hostile.troops()).toBe(900_000);
    // Only the three owned tiles inside the disc are razed on this map: the
    // rest of the disc is unowned land that merely becomes fallout.
    expect(strikes).toEqual([
      { troops: 100_000, structures: 2, tilesRazed: 13 },
    ]);
    // Nothing is captured: razed ground is unowned fallout.
    expect(game.hasOwner(targetTile)).toBe(false);
    expect(game.hasFallout(targetTile)).toBe(true);
    expect(game.owner(game.ref(123, 10))).toBe(hostile);
    expect(commander.numTilesOwned()).toBe(1);
  });

  it("lets heavier ordnance destroy several nearby structures, nearest first", async () => {
    const { game, commander, hostile } = await aircraftGame();
    buildAirport(game, commander);
    const targetTile = game.ref(120, 40);
    const tiles = [
      targetTile,
      game.ref(122, 40),
      game.ref(120, 43),
      game.ref(124, 40),
      game.ref(120, 46),
    ];
    for (const tile of tiles) hostile.conquer(tile);
    hostile.setTroops(1_000_000);
    const units = tiles.map((tile) =>
      hostile.buildUnit(UnitType.City, tile, {}),
    );

    launchStrike(game, commander, targetTile, AircraftType.B2);
    tickUntil(game, () => commander.units(UnitType.FighterBomb).length === 1);
    const bomb = commander.units(UnitType.FighterBomb)[0];
    tickUntil(game, () => !bomb.isActive());

    // B-2: structure radius 3 (at most 4) plus a raze radius of 5. (124,40)
    // is 4 tiles away and stands on razed ground, so it dies too; (120,46) is
    // 6 tiles away and survives.
    expect(units.map((unit) => unit.isActive())).toEqual([
      false,
      false,
      false,
      false,
      true,
    ]);
    expect(game.owner(game.ref(120, 46))).toBe(hostile);
    expect(game.hasOwner(game.ref(124, 40))).toBe(false);
  });
});
