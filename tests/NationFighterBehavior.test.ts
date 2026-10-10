import { NationFighterBehavior } from "../src/core/execution/nation/NationFighterBehavior";
import {
  AirMissionType,
  Difficulty,
  Game,
  GameMapType,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { PseudoRandom } from "../src/core/PseudoRandom";
import { setup } from "./util/Setup";

type MissionFixture = {
  name: string;
  mission: AirMissionType;
  arrange: (game: Game, nation: Player, enemy: Player) => void;
};

const missionFixtures: MissionFixture[] = [
  {
    name: "intercept",
    mission: AirMissionType.Intercept,
    arrange: (game, _nation, enemy) => {
      const targetTile = game.ref(20, 10);
      enemy.buildUnit(UnitType.FighterJet, targetTile, {
        aircraftState: {
          mission: AirMissionType.Intercept,
          phase: "engaging",
          homeFactoryId: 999,
          missionEndTick: game.ticks() + 100,
          ammo: 4,
          targetedBySam: false,
        },
        targetTile,
      });
    },
  },
  {
    name: "escort",
    mission: AirMissionType.Escort,
    arrange: (game, nation, enemy) => {
      const escortTile = game.ref(18, 10);
      nation.buildUnit(UnitType.Warship, escortTile, {
        patrolTile: escortTile,
      });
      const fighterTile = game.ref(20, 10);
      enemy.buildUnit(UnitType.FighterJet, fighterTile, {
        aircraftState: {
          mission: AirMissionType.Intercept,
          phase: "engaging",
          homeFactoryId: 999,
          missionEndTick: game.ticks() + 100,
          ammo: 4,
          targetedBySam: false,
        },
        targetTile: fighterTile,
      });
    },
  },
  {
    name: "naval strike",
    mission: AirMissionType.NavalStrike,
    arrange: (game, _nation, enemy) => {
      const targetTile = game.ref(20, 10);
      enemy.buildUnit(UnitType.Warship, targetTile, {
        patrolTile: targetTile,
      });
    },
  },
  {
    name: "precision strike",
    mission: AirMissionType.PrecisionStrike,
    arrange: (game, _nation, enemy) => {
      enemy.buildUnit(UnitType.MissileSilo, game.ref(20, 10), {});
    },
  },
];

describe("NationFighterBehavior", () => {
  it("uses the same persistent Air Superiority Patrol command as humans", async () => {
    const nationInfo = new PlayerInfo(
      "air superiority nation",
      PlayerType.Nation,
      null,
      "air-superiority-nation-id",
    );
    const enemyInfo = new PlayerInfo(
      "air superiority enemy",
      PlayerType.Human,
      null,
      "air-superiority-enemy-id",
    );
    const game = await setup(
      "big_plains",
      {
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
    expect(behavior.maybeLaunchFighter()).toBe(true);
    game.executeNextTick();

    expect(nation.units(UnitType.FighterJet)).toHaveLength(1);
    expect(nation.units(UnitType.FighterJet)[0].aircraftState().mission).toBe(
      AirMissionType.CombatAirPatrol,
    );
  });

  it.each(missionFixtures)(
    "uses the authoritative sortie execution for $name",
    async ({ mission, arrange }) => {
      const nationInfo = new PlayerInfo(
        "air nation",
        PlayerType.Nation,
        null,
        "air-nation-id",
      );
      const enemyInfo = new PlayerInfo(
        "enemy",
        PlayerType.Human,
        null,
        "air-enemy-id",
      );
      const game = await setup(
        "big_plains",
        {
          combinedArmsV1: true,
          difficulty: Difficulty.Impossible,
          instantBuild: true,
        },
        [nationInfo, enemyInfo],
      );
      const nation = game.player(nationInfo.id);
      const enemy = game.player(enemyInfo.id);
      nation.conquer(game.ref(10, 10));
      enemy.conquer(game.ref(20, 10));
      nation.addGold(20_000_000n);
      nation.buildUnit(UnitType.Factory, game.ref(10, 10), {});
      arrange(game, nation, enemy);

      const behavior = new NationFighterBehavior(
        new PseudoRandom(1234),
        game,
        nation,
      );
      expect(behavior.maybeLaunchFighter()).toBe(true);
      game.executeNextTick();

      const fighter = nation.units(UnitType.FighterJet)[0];
      expect(fighter).toBeDefined();
      expect(fighter.aircraftState().mission).toBe(mission);
    },
  );

  it("falls back to intercept when a nearby escort ship is outside Factory range", async () => {
    const nationInfo = new PlayerInfo(
      "air nation",
      PlayerType.Nation,
      null,
      "range-nation-id",
    );
    const enemyInfo = new PlayerInfo(
      "enemy",
      PlayerType.Human,
      null,
      "range-enemy-id",
    );
    const game = await setup(
      "big_plains",
      {
        combinedArmsV1: true,
        difficulty: Difficulty.Impossible,
        instantBuild: true,
      },
      [nationInfo, enemyInfo],
    );
    const nation = game.player(nationInfo.id);
    const enemy = game.player(enemyInfo.id);
    const factoryTile = game.ref(10, 10);
    const escortTile = game.ref(18, 10);
    const fighterTile = game.ref(20, 10);
    nation.conquer(factoryTile);
    enemy.conquer(fighterTile);
    nation.addGold(20_000_000n);
    nation.buildUnit(UnitType.Factory, factoryTile, {});
    const escort = nation.buildUnit(UnitType.Warship, escortTile, {
      patrolTile: escortTile,
    });
    enemy.buildUnit(UnitType.FighterJet, fighterTile, {
      aircraftState: {
        mission: AirMissionType.Intercept,
        phase: "engaging",
        homeFactoryId: 999,
        missionEndTick: game.ticks() + 100,
        ammo: 4,
        targetedBySam: false,
      },
      targetTile: fighterTile,
    });
    const realCanBuild = nation.canBuild.bind(nation);
    vi.spyOn(nation, "canBuild").mockImplementation((type, tile) =>
      tile === escort.tile() ? false : realCanBuild(type, tile),
    );

    const behavior = new NationFighterBehavior(
      new PseudoRandom(1234),
      game,
      nation,
    );
    expect(behavior.maybeLaunchFighter()).toBe(true);
    game.executeNextTick();

    expect(nation.units(UnitType.FighterJet)[0].aircraftState().mission).toBe(
      AirMissionType.Intercept,
    );
  });

  it("never launches in a legacy config without the combined-arms flag", async () => {
    const nationInfo = new PlayerInfo(
      "legacy nation",
      PlayerType.Nation,
      null,
      "legacy-nation-id",
    );
    const enemyInfo = new PlayerInfo(
      "legacy enemy",
      PlayerType.Human,
      null,
      "legacy-enemy-id",
    );
    const game = await setup(
      "big_plains",
      { difficulty: Difficulty.Impossible, instantBuild: true },
      [nationInfo, enemyInfo],
    );
    const nation = game.player(nationInfo.id);
    const enemy = game.player(enemyInfo.id);
    const factoryTile = game.ref(10, 10);
    const targetTile = game.ref(20, 10);
    nation.conquer(factoryTile);
    enemy.conquer(targetTile);
    nation.addGold(20_000_000n);
    nation.buildUnit(UnitType.Factory, factoryTile, {});
    enemy.buildUnit(UnitType.Warship, targetTile, {
      patrolTile: targetTile,
    });

    const behavior = new NationFighterBehavior(
      new PseudoRandom(1234),
      game,
      nation,
    );
    expect(behavior.maybeLaunchFighter()).toBe(false);
    game.executeNextTick();
    expect(nation.units(UnitType.FighterJet)).toHaveLength(0);
  });

  it("prioritizes a V2 inbound strike over a lower-ID unrelated fighter", async () => {
    const nationInfo = new PlayerInfo(
      "v2 air nation",
      PlayerType.Nation,
      null,
      "v2-air-nation-id",
    );
    const enemyInfo = new PlayerInfo(
      "v2 air enemy",
      PlayerType.Human,
      null,
      "v2-air-enemy-id",
    );
    const game = await setup(
      "big_plains",
      {
        combinedArmsV1: true,
        combinedArmsV2: true,
        difficulty: Difficulty.Impossible,
        instantBuild: true,
      },
      [nationInfo, enemyInfo],
    );
    const nation = game.player(nationInfo.id);
    const enemy = game.player(enemyInfo.id);
    const nationTile = game.ref(10, 10);
    const enemyTile = game.ref(100, 100);
    nation.conquer(nationTile);
    enemy.conquer(enemyTile);
    nation.addGold(20_000_000n);
    enemy.addGold(20_000_000n);
    nation.buildUnit(UnitType.Factory, nationTile, {});

    const unrelated = enemy.buildUnit(UnitType.FighterJet, game.ref(80, 80), {
      aircraftState: {
        mission: AirMissionType.Intercept,
        phase: "engaging",
        homeFactoryId: 998,
        missionEndTick: game.ticks() + 50,
        ammo: 2,
        targetedBySam: false,
      },
      targetTile: enemyTile,
    });
    const inbound = enemy.buildUnit(UnitType.FighterJet, game.ref(90, 90), {
      aircraftState: {
        mission: AirMissionType.PrecisionStrike,
        phase: "outbound",
        homeFactoryId: 999,
        missionEndTick: game.ticks() + 100,
        ammo: 1,
        targetedBySam: false,
      },
      targetTile: nationTile,
    });
    expect(unrelated.id()).toBeLessThan(inbound.id());

    const behavior = new NationFighterBehavior(
      new PseudoRandom(1234),
      game,
      nation,
    );
    expect(behavior.maybeLaunchFighter()).toBe(true);
    game.executeNextTick();

    const interceptor = nation.units(UnitType.FighterJet)[0];
    expect(interceptor.aircraftState().mission).toBe(AirMissionType.Intercept);
    expect(interceptor.targetUnit()?.id()).toBe(inbound.id());
  });
});
