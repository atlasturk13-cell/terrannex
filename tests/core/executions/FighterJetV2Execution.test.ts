import path from "node:path";
import { Executor } from "../../../src/core/execution/ExecutionManager";
import { FactoryExecution } from "../../../src/core/execution/FactoryExecution";
import { FighterJetExecution } from "../../../src/core/execution/FighterJetExecution";
import { SAMLauncherExecution } from "../../../src/core/execution/SAMLauncherExecution";
import {
  AirMissionType,
  Difficulty,
  Game,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  Player,
  PlayerInfo,
  PlayerType,
  Unit,
  UnitType,
} from "../../../src/core/game/Game";
import { createGame } from "../../../src/core/game/GameImpl";
import { loadTerrainMap } from "../../../src/core/game/TerrainMapLoader";
import { UserSettings } from "../../../src/core/game/UserSettings";
import { StampedIntentSchema } from "../../../src/core/Schemas";
import { NodeGameMapLoader } from "../../perf/fullgame/NodeGameMapLoader";
import { setup } from "../../util/Setup";
import { TestConfig } from "../../util/TestConfig";
import { executeTicks } from "../../util/utils";

const attackerInfo = new PlayerInfo(
  "v2 attacker",
  PlayerType.Human,
  "V2ATK001",
  "v2-attacker-id",
);
const defenderInfo = new PlayerInfo(
  "v2 defender",
  PlayerType.Human,
  "V2DEF001",
  "v2-defender-id",
);

async function createV2Game(): Promise<{
  game: Game;
  attacker: Player;
  defender: Player;
}> {
  const game = await setup(
    "big_plains",
    {
      combinedArmsV1: true,
      combinedArmsV2: true,
      instantBuild: true,
    },
    [attackerInfo, defenderInfo],
  );
  const attacker = game.player(attackerInfo.id);
  const defender = game.player(defenderInfo.id);
  attacker.addGold(50_000_000n);
  defender.addGold(50_000_000n);
  return { game, attacker, defender };
}

function buildFactory(game: Game, owner: Player, x: number, y: number): Unit {
  const tile = game.ref(x, y);
  owner.conquer(tile);
  return owner.buildUnit(UnitType.Factory, tile, {});
}

function buildThreat(
  game: Game,
  owner: Player,
  tile: number,
  targetTile: number,
  missionEndTick = game.ticks() + 200,
): Unit {
  return owner.buildUnit(UnitType.FighterJet, tile, {
    aircraftState: {
      mission: AirMissionType.PrecisionStrike,
      phase: "outbound",
      homeFactoryId: 999,
      missionEndTick,
      ammo: 1,
      targetedBySam: false,
    },
    targetTile,
  });
}

describe("FighterJetExecution combined-arms V2", () => {
  it("launches to the opposite corner of the production Natural Earth map", async () => {
    const mapData = await loadTerrainMap(
      GameMapType.NaturalEarthWorld,
      GameMapSize.Normal,
      new NodeGameMapLoader(path.resolve(process.cwd(), "resources/maps")),
      false,
    );
    const config = new TestConfig(
      {
        gameMap: GameMapType.NaturalEarthWorld,
        gameMapSize: GameMapSize.Normal,
        gameMode: GameMode.FFA,
        gameType: GameType.Singleplayer,
        difficulty: Difficulty.Medium,
        nations: "disabled",
        donateGold: false,
        donateTroops: false,
        bots: 0,
        infiniteGold: false,
        infiniteTroops: false,
        instantBuild: true,
        randomSpawn: false,
        combinedArmsV1: true,
        combinedArmsV2: true,
      },
      new UserSettings(),
      false,
    );
    const game = createGame(
      [attackerInfo],
      [],
      mapData.gameMap,
      mapData.miniGameMap,
      config,
    );
    game.endSpawnPhase();
    const attacker = game.player(attackerInfo.id);
    attacker.addGold(20_000_000n);
    const factoryTile = game.ref(592, 260);
    expect(game.isLand(factoryTile)).toBe(true);
    attacker.conquer(factoryTile);
    const factory = attacker.buildUnit(UnitType.Factory, factoryTile, {});
    const oppositeCorner = game.ref(game.width() - 1, game.height() - 1);
    expect(attacker.canBuild(UnitType.FighterJet, oppositeCorner)).toBe(
      factory.tile(),
    );

    game.addExecution(
      new FighterJetExecution(attacker, {
        mission: AirMissionType.Intercept,
        targetTile: oppositeCorner,
      }),
    );
    game.executeNextTick();

    expect(attacker.units(UnitType.FighterJet)).toHaveLength(1);
    expect(attacker.canBuild(UnitType.FighterJet, oppositeCorner)).toBe(false);
    expect(factory.missileTimerQueue()).toHaveLength(1);
  });

  it("launches from one map corner to the opposite corner with global range", async () => {
    const { game, attacker } = await createV2Game();
    const factory = buildFactory(game, attacker, 1, 1);
    const target = game.ref(game.width() - 2, game.height() - 2);

    expect(game.config().fighterRange()).toBe(Number.MAX_SAFE_INTEGER);
    expect(game.config().fighterRange()).toBeGreaterThan(
      Math.hypot(2_000, 1_000),
    );
    expect(attacker.canBuild(UnitType.FighterJet, target)).toBe(factory.tile());

    game.addExecution(
      new FighterJetExecution(attacker, {
        mission: AirMissionType.Intercept,
        targetTile: target,
      }),
    );
    game.executeNextTick();

    expect(attacker.units(UnitType.FighterJet)).toHaveLength(1);
    expect(factory.missileTimerQueue()).toHaveLength(1);
  });

  it("preflights a two-sortie batch atomically across two ready Factories", async () => {
    const { game, attacker } = await createV2Game();
    const factories = [
      buildFactory(game, attacker, 10, 10),
      buildFactory(game, attacker, 12, 10),
    ];
    const target = game.ref(180, 180);
    const goldBefore = attacker.gold();

    game.addExecution(
      new FighterJetExecution(
        attacker,
        { mission: AirMissionType.Intercept, targetTile: target },
        2,
      ),
    );
    game.executeNextTick();

    expect(attacker.units(UnitType.FighterJet)).toHaveLength(2);
    expect(
      attacker
        .units(UnitType.FighterJet)
        .map((fighter) => fighter.targetTile()),
    ).toEqual([target, target]);
    expect(
      factories.map((factory) => factory.missileTimerQueue().length),
    ).toEqual([1, 1]);
    expect(goldBefore - attacker.gold()).toBe(1_500_000n);
  });

  it("carries a schema-valid amount through the authoritative Executor", async () => {
    const { game, attacker } = await createV2Game();
    buildFactory(game, attacker, 10, 10);
    buildFactory(game, attacker, 12, 10);
    const intent = StampedIntentSchema.parse({
      type: "launch_air_mission",
      clientID: attacker.clientID(),
      order: {
        mission: AirMissionType.Intercept,
        targetTile: game.ref(180, 180),
      },
      amount: 2,
    });

    game.addExecution(
      new Executor(game, "fighter-v2-batch", attacker.clientID()!).createExec(
        intent,
      ),
    );
    game.executeNextTick();

    expect(attacker.units(UnitType.FighterJet)).toHaveLength(2);
  });

  it("leaves no free partial batch when a Factory slot or gold is missing", async () => {
    const { game, attacker } = await createV2Game();
    const factory = buildFactory(game, attacker, 10, 10);
    const target = game.ref(180, 180);
    const goldBefore = attacker.gold();

    game.addExecution(
      new FighterJetExecution(
        attacker,
        { mission: AirMissionType.Intercept, targetTile: target },
        2,
      ),
    );
    game.executeNextTick();

    expect(attacker.units(UnitType.FighterJet)).toHaveLength(0);
    expect(factory.missileTimerQueue()).toHaveLength(0);
    expect(attacker.gold()).toBe(goldBefore);

    buildFactory(game, attacker, 12, 10);
    attacker.removeGold(attacker.gold() - 1_499_999n);
    const insufficientGold = attacker.gold();
    game.addExecution(
      new FighterJetExecution(
        attacker,
        { mission: AirMissionType.Intercept, targetTile: target },
        2,
      ),
    );
    game.executeNextTick();

    expect(attacker.units(UnitType.FighterJet)).toHaveLength(0);
    expect(factory.missileTimerQueue()).toHaveLength(0);
    expect(attacker.gold()).toBe(insufficientGold);
  });

  it("rejects an over-cap launch without charging or locking its Factory", async () => {
    const { game, attacker, defender } = await createV2Game();
    const factory = buildFactory(game, attacker, 10, 10);
    const target = game.ref(100, 100);
    defender.conquer(target);
    buildThreat(game, attacker, game.ref(20, 10), target);
    buildThreat(game, attacker, game.ref(22, 10), target);
    const goldBefore = attacker.gold();

    game.addExecution(
      new FighterJetExecution(attacker, {
        mission: AirMissionType.Intercept,
        targetTile: target,
      }),
    );
    game.executeNextTick();

    expect(attacker.units(UnitType.FighterJet)).toHaveLength(2);
    expect(factory.missileTimerQueue()).toHaveLength(0);
    expect(attacker.gold()).toBe(goldBefore);
  });

  it("does not let global reach bypass spawn immunity", async () => {
    const { game, attacker } = await createV2Game();
    const factory = buildFactory(game, attacker, 10, 10);
    const goldBefore = attacker.gold();
    vi.spyOn(game, "isSpawnImmunityActive").mockReturnValue(true);

    game.addExecution(
      new FighterJetExecution(attacker, {
        mission: AirMissionType.Intercept,
        targetTile: game.ref(180, 180),
      }),
    );
    game.executeNextTick();

    expect(attacker.units(UnitType.FighterJet)).toHaveLength(0);
    expect(factory.missileTimerQueue()).toHaveLength(0);
    expect(attacker.gold()).toBe(goldBefore);
  });

  it("globally intercepts an inbound precision attacker before impact", async () => {
    const { game, attacker, defender } = await createV2Game();
    buildFactory(game, attacker, 40, 100);
    const defendedFactory = buildFactory(game, defender, 100, 100);
    defender.setTroops(1_000_000);

    game.addExecution(
      new FighterJetExecution(attacker, {
        mission: AirMissionType.PrecisionStrike,
        targetTile: defendedFactory.tile(),
      }),
    );
    game.addExecution(
      new FighterJetExecution(defender, {
        mission: AirMissionType.Intercept,
        targetTile: defendedFactory.tile(),
      }),
    );
    game.executeNextTick();
    executeTicks(game, 12);

    expect(attacker.units(UnitType.FighterJet)).toHaveLength(0);
    expect(defender.troops()).toBe(1_000_000);
    const interceptor = defender.units(UnitType.FighterJet)[0];
    expect(interceptor).toBeDefined();
    expect(interceptor.aircraftState().ammo).toBe(1);
  });

  it("reprioritizes a global patrol when a direct inbound threat appears", async () => {
    const { game, attacker, defender } = await createV2Game();
    const defendedFactory = buildFactory(game, defender, 10, 10);
    const unrelatedTarget = game.ref(190, 190);
    attacker.conquer(unrelatedTarget);
    const unrelated = buildThreat(
      game,
      attacker,
      game.ref(180, 180),
      unrelatedTarget,
      game.ticks() + 100,
    );

    game.addExecution(
      new FighterJetExecution(defender, {
        mission: AirMissionType.Intercept,
        targetTile: defendedFactory.tile(),
      }),
    );
    game.executeNextTick();

    const interceptor = defender.units(UnitType.FighterJet)[0];
    expect(interceptor.targetUnit()?.id()).toBe(unrelated.id());

    const directThreat = buildThreat(
      game,
      attacker,
      game.ref(180, 178),
      defendedFactory.tile(),
      game.ticks() + 200,
    );
    executeTicks(game, 10);

    expect(unrelated.isActive()).toBe(true);
    expect(interceptor.targetUnit()?.id()).toBe(directThreat.id());
  });

  it("preserves an explicit intercept target when a higher-priority threat appears", async () => {
    const { game, attacker, defender } = await createV2Game();
    const defendedFactory = buildFactory(game, defender, 10, 10);
    const explicitTargetTile = game.ref(190, 190);
    attacker.conquer(explicitTargetTile);
    const explicitTarget = buildThreat(
      game,
      attacker,
      game.ref(180, 180),
      explicitTargetTile,
      game.ticks() + 100,
    );

    game.addExecution(
      new FighterJetExecution(defender, {
        mission: AirMissionType.Intercept,
        targetUnitId: explicitTarget.id(),
      }),
    );
    game.executeNextTick();

    const interceptor = defender.units(UnitType.FighterJet)[0];
    const directThreat = buildThreat(
      game,
      attacker,
      game.ref(180, 178),
      defendedFactory.tile(),
      game.ticks() + 50,
    );
    executeTicks(game, 10);

    expect(directThreat.isActive()).toBe(true);
    expect(interceptor.targetUnit()?.id()).toBe(explicitTarget.id());
  });

  it("returns immediately after spending its second and final air-to-air round", async () => {
    const { game, attacker, defender } = await createV2Game();
    const defendedFactory = buildFactory(game, defender, 100, 100);
    const threatTile = game.ref(105, 100);
    buildThreat(game, attacker, threatTile, defendedFactory.tile(), 100);
    buildThreat(game, attacker, threatTile, defendedFactory.tile(), 101);

    game.addExecution(
      new FighterJetExecution(defender, {
        mission: AirMissionType.Intercept,
        targetTile: defendedFactory.tile(),
      }),
    );
    game.executeNextTick();
    executeTicks(game, 12);

    expect(attacker.units(UnitType.FighterJet)).toHaveLength(0);
    expect(defender.units(UnitType.FighterJet)).toHaveLength(0);
    expect(defendedFactory.missileTimerQueue()).toHaveLength(1);
  });

  it("applies material but bounded tactical strike damage without capture", async () => {
    const { game, attacker, defender } = await createV2Game();
    buildFactory(game, attacker, 10, 10);
    const shipTile = game.ref(30, 10);
    const ship = defender.buildUnit(UnitType.Warship, shipTile, {
      patrolTile: shipTile,
    });
    const originalOwner = game.owner(shipTile);

    game.addExecution(
      new FighterJetExecution(attacker, {
        mission: AirMissionType.NavalStrike,
        targetUnitId: ship.id(),
      }),
    );
    executeTicks(game, 10);

    expect(ship.health()).toBe(400);
    expect(game.owner(shipTile)).toBe(originalOwner);
  });

  it("bounds a V2 precision strike to ten percent and never captures land", async () => {
    const { game, attacker, defender } = await createV2Game();
    buildFactory(game, attacker, 10, 10);
    const targetTile = game.ref(30, 10);
    defender.conquer(targetTile);
    defender.setTroops(2_000_000);

    game.addExecution(
      new FighterJetExecution(attacker, {
        mission: AirMissionType.PrecisionStrike,
        targetTile,
      }),
    );
    executeTicks(game, 10);

    expect(defender.troops()).toBe(1_900_000);
    expect(game.owner(targetTile)).toBe(defender);
  });

  it("keeps local SAM counterplay decisive against a stronger V2 fighter", async () => {
    const { game, attacker, defender } = await createV2Game();
    const targetTile = game.ref(105, 100);
    const fighter = buildThreat(game, attacker, targetTile, game.ref(110, 100));
    for (const x of [100, 101]) {
      const samTile = game.ref(x, 100);
      defender.conquer(samTile);
      const sam = defender.buildUnit(UnitType.SAMLauncher, samTile, {});
      game.addExecution(new SAMLauncherExecution(defender, null, sam));
    }

    executeTicks(game, 5);

    expect(fighter.isActive()).toBe(false);
    expect(defender.units(UnitType.SAMMissile)).toHaveLength(0);
  });

  it("repeats a V2 defense batch deterministically and cleans every sortie lock", async () => {
    const run = async () => {
      const { game, attacker, defender } = await createV2Game();
      const factories = [
        buildFactory(game, defender, 100, 100),
        buildFactory(game, defender, 102, 100),
      ];
      for (const factory of factories) {
        game.addExecution(new FactoryExecution(factory));
      }
      const defendedTile = factories[0].tile();
      buildThreat(game, attacker, game.ref(80, 100), defendedTile, 300);
      buildThreat(game, attacker, game.ref(82, 100), defendedTile, 301);
      game.addExecution(
        new FighterJetExecution(
          defender,
          { mission: AirMissionType.Intercept, targetTile: defendedTile },
          2,
        ),
      );

      const timeline: unknown[] = [];
      for (let i = 0; i < 520; i++) {
        game.executeNextTick();
        timeline.push(
          game
            .units(UnitType.FighterJet)
            .sort((a, b) => a.id() - b.id())
            .map((fighter) => ({
              id: fighter.id(),
              hash: fighter.hash(),
              tile: fighter.tile(),
              target: fighter.targetUnit()?.id() ?? null,
              state: { ...fighter.aircraftState() },
            })),
        );
      }
      return {
        timeline,
        fighters: game.units(UnitType.FighterJet).length,
        samMissiles: game.units(UnitType.SAMMissile).length,
        queues: factories.map((factory) => [
          factory.id(),
          ...factory.missileTimerQueue(),
        ]),
      };
    };

    const first = await run();
    const second = await run();
    expect(second).toEqual(first);
    expect(first.fighters).toBe(0);
    expect(first.samMissiles).toBe(0);
    expect(first.queues.every((queue) => queue.length === 1)).toBe(true);
  });
});
