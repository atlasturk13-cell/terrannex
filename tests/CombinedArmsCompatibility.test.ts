import { FighterJetExecution } from "../src/core/execution/FighterJetExecution";
import {
  AirMissionType,
  GameMapType,
  GameType,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { simpleHash } from "../src/core/Util";
import { setup } from "./util/Setup";

const attackerInfo = new PlayerInfo(
  "legacy attacker",
  PlayerType.Human,
  "legacy-client",
  "legacy-attacker-id",
);

describe("combined arms config compatibility", () => {
  it("enables air superiority only for an explicit admitted local V1/V2 profile", async () => {
    const admitted = await setup(
      "big_plains",
      {
        airSuperiorityV1: true,
        combinedArmsV1: true,
        combinedArmsV2: true,
        gameMap: GameMapType.NaturalEarthWorld,
        gameType: GameType.Singleplayer,
      },
      [attackerInfo],
    );
    expect(admitted.config().airSuperiorityV1Enabled()).toBe(true);

    for (const overrides of [
      { airSuperiorityV1: false },
      { airSuperiorityV1: true },
      { airSuperiorityV1: true, combinedArmsV1: true },
      {
        airSuperiorityV1: true,
        combinedArmsV1: true,
        combinedArmsV2: true,
      },
      {
        airSuperiorityV1: true,
        combinedArmsV1: true,
        combinedArmsV2: true,
        gameMap: GameMapType.NaturalEarthWorld,
        gameType: GameType.Private,
      },
    ] as const) {
      const game = await setup("big_plains", overrides, [attackerInfo]);
      expect(game.config().airSuperiorityV1Enabled()).toBe(false);
    }
  });

  it("keeps FighterJet disabled when the version flag is absent or false", async () => {
    for (const combinedArmsV1 of [undefined, false] as const) {
      const game = await setup(
        "big_plains",
        {
          ...(combinedArmsV1 === undefined ? {} : { combinedArmsV1 }),
          instantBuild: true,
        },
        [attackerInfo],
      );
      expect(game.config().combinedArmsV1Enabled()).toBe(false);
      expect(game.config().isUnitDisabled(UnitType.FighterJet)).toBe(true);
    }
  });

  it("admits FighterJet only for an explicit v1 config that does not disable it", async () => {
    const enabled = await setup(
      "big_plains",
      { combinedArmsV1: true, disabledUnits: [], instantBuild: true },
      [attackerInfo],
    );
    const explicitlyDisabled = await setup(
      "big_plains",
      {
        combinedArmsV1: true,
        disabledUnits: [UnitType.FighterJet],
        instantBuild: true,
      },
      [attackerInfo],
    );

    expect(enabled.config().combinedArmsV1Enabled()).toBe(true);
    expect(enabled.config().isUnitDisabled(UnitType.FighterJet)).toBe(false);
    expect(
      explicitlyDisabled.config().isUnitDisabled(UnitType.FighterJet),
    ).toBe(true);
  });

  it("requires V1 and V2 together and preserves every V1 fighter constant", async () => {
    const v2WithoutV1 = await setup(
      "big_plains",
      { combinedArmsV2: true, instantBuild: true },
      [attackerInfo],
    );
    expect(v2WithoutV1.config().combinedArmsV1Enabled()).toBe(false);
    expect(v2WithoutV1.config().combinedArmsV2Enabled()).toBe(false);
    expect(v2WithoutV1.config().isUnitDisabled(UnitType.FighterJet)).toBe(true);

    const v1 = await setup(
      "big_plains",
      { combinedArmsV1: true, instantBuild: true },
      [attackerInfo],
    );
    expect(v1.config().combinedArmsV2Enabled()).toBe(false);
    expect({
      range: v1.config().fighterRange(),
      speed: v1.config().fighterSpeed(),
      cap: v1.config().fighterMaxActive(),
      duration: v1.config().fighterMissionDuration(),
      engagement: v1.config().fighterEngagementRange(),
      patrol: v1.config().fighterPatrolRadius(),
      cooldown: v1.config().fighterAttackCooldown(),
      ammo: v1.config().fighterPatrolAmmo(),
      airDamage: v1.config().fighterAirDamage(),
      navalDamage: v1.config().fighterNavalDamage(),
      precisionDamage: v1.config().fighterPrecisionTroopDamage(),
      precisionPercent: v1.config().fighterPrecisionTroopPercent(),
    }).toEqual({
      range: 240,
      speed: 4,
      cap: 4,
      duration: 300,
      engagement: 14,
      patrol: 42,
      cooldown: 8,
      ammo: 4,
      airDamage: 80,
      navalDamage: 260,
      precisionDamage: 20_000,
      precisionPercent: 5,
    });
  });

  it("rejects a fighter intent without mutating a legacy no-air game", async () => {
    const game = await setup("big_plains", { instantBuild: true }, [
      attackerInfo,
    ]);
    const attacker = game.player(attackerInfo.id);
    const home = game.ref(10, 10);
    attacker.conquer(home);
    attacker.addGold(20_000_000n);
    const factory = attacker.buildUnit(UnitType.Factory, home, {});
    const goldBefore = attacker.gold();

    game.addExecution(
      new FighterJetExecution(attacker, {
        mission: AirMissionType.Intercept,
        targetTile: game.ref(20, 10),
      }),
    );
    game.executeNextTick();

    expect(attacker.units(UnitType.FighterJet)).toHaveLength(0);
    expect(factory.missileTimerQueue()).toHaveLength(0);
    expect(attacker.gold()).toBe(goldBefore);
  });

  it("rejects V2 targeted and quantity commands on a V1-only game", async () => {
    const game = await setup(
      "big_plains",
      { combinedArmsV1: true, instantBuild: true },
      [attackerInfo],
    );
    const attacker = game.player(attackerInfo.id);
    const home = game.ref(10, 10);
    attacker.conquer(home);
    attacker.addGold(20_000_000n);
    const factory = attacker.buildUnit(UnitType.Factory, home, {});
    const hostile = attacker.buildUnit(UnitType.FighterJet, game.ref(20, 10), {
      aircraftState: {
        mission: AirMissionType.Intercept,
        phase: "engaging",
        homeFactoryId: 999,
        missionEndTick: game.ticks() + 100,
        ammo: 4,
        targetedBySam: false,
      },
      targetTile: game.ref(20, 10),
    });
    hostile.delete(false);
    const goldBefore = attacker.gold();

    game.addExecution(
      new FighterJetExecution(
        attacker,
        { mission: AirMissionType.Intercept, targetUnitId: hostile.id() },
        2,
      ),
    );
    game.executeNextTick();

    expect(attacker.units(UnitType.FighterJet)).toHaveLength(0);
    expect(factory.missileTimerQueue()).toHaveLength(0);
    expect(attacker.gold()).toBe(goldBefore);
  });

  it("preserves the exact legacy unit hash when the flag is absent", async () => {
    const game = await setup("big_plains", { instantBuild: true }, [
      attackerInfo,
    ]);
    const attacker = game.player(attackerInfo.id);
    const home = game.ref(10, 10);
    attacker.conquer(home);
    const factory = attacker.buildUnit(UnitType.Factory, home, {});
    const legacyHash = home + simpleHash(UnitType.Factory) * factory.id();

    expect(factory.hash()).toBe(legacyHash);
    factory.launch();
    expect(factory.missileTimerQueue()).toEqual([game.ticks()]);
    expect(factory.hash()).toBe(legacyHash);
  });

  it("hashes Factory cooldown and struck naval health under v1", async () => {
    const game = await setup(
      "big_plains",
      { combinedArmsV1: true, instantBuild: true },
      [attackerInfo],
    );
    const attacker = game.player(attackerInfo.id);
    const home = game.ref(10, 10);
    const shipTile = game.ref(12, 10);
    attacker.conquer(home);
    const factory = attacker.buildUnit(UnitType.Factory, home, {});
    const ship = attacker.buildUnit(UnitType.Warship, shipTile, {
      patrolTile: shipTile,
    });

    const factoryReadyHash = factory.hash();
    factory.launch();
    expect(factory.hash()).not.toBe(factoryReadyHash);

    const healthyShipHash = ship.hash();
    ship.modifyHealth(-1);
    expect(ship.hash()).not.toBe(healthyShipHash);
  });
});
