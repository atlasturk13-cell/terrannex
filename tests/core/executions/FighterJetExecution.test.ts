import { FactoryExecution } from "../../../src/core/execution/FactoryExecution";
import { FighterJetExecution } from "../../../src/core/execution/FighterJetExecution";
import { SAMLauncherExecution } from "../../../src/core/execution/SAMLauncherExecution";
import {
  AirMissionType,
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  Unit,
  UnitType,
} from "../../../src/core/game/Game";
import { GameUpdateType } from "../../../src/core/game/GameUpdates";
import { setup } from "../../util/Setup";
import { TestConfig } from "../../util/TestConfig";
import { executeTicks } from "../../util/utils";

let game: Game;
let attacker: Player;
let defender: Player;
let factory: Unit;

const attackerInfo = new PlayerInfo(
  "attacker",
  PlayerType.Human,
  "attacker-client",
  "attacker-id",
);
const defenderInfo = new PlayerInfo(
  "defender",
  PlayerType.Human,
  "defender-client",
  "defender-id",
);

describe("FighterJetExecution", () => {
  beforeEach(async () => {
    game = await setup(
      "big_plains",
      { combinedArmsV1: true, instantBuild: true },
      [attackerInfo, defenderInfo],
    );
    attacker = game.player(attackerInfo.id);
    defender = game.player(defenderInfo.id);
    attacker.conquer(game.ref(10, 10));
    defender.conquer(game.ref(30, 10));
    attacker.addGold(20_000_000n);
    defender.addGold(20_000_000n);
    factory = attacker.buildUnit(UnitType.Factory, game.ref(10, 10), {});
  });

  afterEach(() => vi.restoreAllMocks());

  it("charges once, serializes sortie state, enforces Factory cooldown and returns", () => {
    const config = game.config() as TestConfig;
    vi.spyOn(config, "fighterMissionDuration").mockReturnValue(6);
    vi.spyOn(config, "fighterLaunchCooldown").mockReturnValue(40);
    const target = game.ref(22, 10);
    const cost = config.unitInfo(UnitType.FighterJet).cost(game, attacker);
    const goldBefore = attacker.gold();

    game.addExecution(
      new FighterJetExecution(attacker, {
        mission: AirMissionType.Intercept,
        targetTile: target,
      }),
    );
    game.executeNextTick();

    const fighter = attacker.units(UnitType.FighterJet)[0];
    expect(fighter).toBeDefined();
    expect(goldBefore - attacker.gold()).toBe(cost);
    expect(factory.missileTimerQueue()).toHaveLength(1);
    expect(fighter.toUpdate().aircraftState).toMatchObject({
      mission: AirMissionType.Intercept,
      phase: "outbound",
      homeFactoryId: factory.id(),
      ammo: 4,
      targetedBySam: false,
    });

    const originalHash = fighter.hash();
    fighter.updateAircraftState({ phase: "engaging" });
    expect(fighter.hash()).not.toBe(originalHash);
    fighter.updateAircraftState({ phase: "outbound" });

    game.addExecution(
      new FighterJetExecution(attacker, {
        mission: AirMissionType.Intercept,
        targetTile: target,
      }),
    );
    game.executeNextTick();
    expect(attacker.units(UnitType.FighterJet)).toHaveLength(1);

    executeTicks(game, 30);
    expect(attacker.units(UnitType.FighterJet)).toHaveLength(0);
  });

  it("applies one bounded naval strike, then returns without capturing", () => {
    const targetTile = game.ref(18, 10);
    const target = defender.buildUnit(UnitType.Warship, targetTile, {
      patrolTile: targetTile,
    });
    const initialHealth = target.health();
    const initialOwner = game.owner(targetTile);

    game.addExecution(
      new FighterJetExecution(attacker, {
        mission: AirMissionType.NavalStrike,
        targetUnitId: target.id(),
      }),
    );
    executeTicks(game, 20);

    expect(target.health()).toBe(
      initialHealth - game.config().fighterNavalDamage(),
    );
    expect(game.owner(targetTile)).toBe(initialOwner);
    expect(attacker.units(UnitType.FighterJet)).toHaveLength(0);
  });

  it("caps precision damage at five percent of the target's troops", () => {
    const targetTile = game.ref(18, 10);
    defender.conquer(targetTile);
    defender.setTroops(100_000);

    game.addExecution(
      new FighterJetExecution(attacker, {
        mission: AirMissionType.PrecisionStrike,
        targetTile,
      }),
    );
    executeTicks(game, 20);

    expect(defender.troops()).toBe(95_000);
    expect(game.owner(targetTile)).toBe(defender);
  });

  it("intercepts hostile aircraft with bounded ammunition", () => {
    const targetTile = game.ref(18, 10);
    const hostile = defender.buildUnit(UnitType.FighterJet, targetTile, {
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
    game.addExecution(
      new FighterJetExecution(attacker, {
        mission: AirMissionType.Intercept,
        targetTile,
      }),
    );

    executeTicks(game, 40);

    expect(hostile.isActive()).toBe(false);
    expect(attacker.units(UnitType.FighterJet)).toHaveLength(0);
  });

  it("escorts a friendly ship and engages aircraft around that ship", () => {
    const shipTile = game.ref(18, 10);
    const escorted = attacker.buildUnit(UnitType.Warship, shipTile, {
      patrolTile: shipTile,
    });
    const hostile = defender.buildUnit(UnitType.FighterJet, game.ref(19, 10), {
      aircraftState: {
        mission: AirMissionType.Intercept,
        phase: "engaging",
        homeFactoryId: 999,
        missionEndTick: game.ticks() + 100,
        ammo: 4,
        targetedBySam: false,
      },
      targetTile: shipTile,
    });
    game.addExecution(
      new FighterJetExecution(attacker, {
        mission: AirMissionType.Escort,
        targetUnitId: escorted.id(),
      }),
    );

    executeTicks(game, 40);

    expect(hostile.isActive()).toBe(false);
    expect(escorted.isActive()).toBe(true);
  });

  it("lets a SAM damage a hostile fighter without using nuke trajectory state", () => {
    const samTile = game.ref(16, 10);
    const fighterTile = game.ref(18, 10);
    const sam = defender.buildUnit(UnitType.SAMLauncher, samTile, {});
    const fighter = attacker.buildUnit(UnitType.FighterJet, fighterTile, {
      aircraftState: {
        mission: AirMissionType.Intercept,
        phase: "engaging",
        homeFactoryId: factory.id(),
        missionEndTick: game.ticks() + 100,
        ammo: 4,
        targetedBySam: false,
      },
      targetTile: fighterTile,
    });
    const initialHealth = fighter.health();
    game.addExecution(new SAMLauncherExecution(defender, null, sam));

    executeTicks(game, 5);

    expect(fighter.health()).toBe(
      initialHealth - game.config().fighterSamDamage(),
    );
    expect(fighter.targetedBySAM()).toBe(false);
    expect(defender.units(UnitType.SAMMissile)).toHaveLength(0);
  });

  it("rejects an out-of-range authoritative launch", () => {
    vi.spyOn(game.config() as TestConfig, "fighterRange").mockReturnValue(5);
    game.addExecution(
      new FighterJetExecution(attacker, {
        mission: AirMissionType.Intercept,
        targetTile: game.ref(30, 30),
      }),
    );
    game.executeNextTick();

    expect(attacker.units(UnitType.FighterJet)).toHaveLength(0);
    expect(factory.missileTimerQueue()).toHaveLength(0);
  });

  it("rejects mission-specific invalid relations and unit types without charging", () => {
    const ownShipTile = game.ref(14, 10);
    const hostileShipTile = game.ref(18, 10);
    const hostileFactoryTile = game.ref(20, 10);
    const ownShip = attacker.buildUnit(UnitType.Warship, ownShipTile, {
      patrolTile: ownShipTile,
    });
    const hostileShip = defender.buildUnit(UnitType.Warship, hostileShipTile, {
      patrolTile: hostileShipTile,
    });
    const hostileFactory = defender.buildUnit(
      UnitType.Factory,
      hostileFactoryTile,
      {},
    );
    const goldBefore = attacker.gold();
    const invalidOrders = [
      {
        mission: AirMissionType.PrecisionStrike,
        targetTile: factory.tile(),
      },
      {
        mission: AirMissionType.NavalStrike,
        targetUnitId: ownShip.id(),
      },
      {
        mission: AirMissionType.Escort,
        targetUnitId: hostileShip.id(),
      },
      {
        mission: AirMissionType.NavalStrike,
        targetUnitId: hostileFactory.id(),
      },
    ] as const;

    for (const order of invalidOrders) {
      game.addExecution(new FighterJetExecution(attacker, order));
      game.executeNextTick();
    }

    expect(attacker.units(UnitType.FighterJet)).toHaveLength(0);
    expect(factory.missileTimerQueue()).toHaveLength(0);
    expect(attacker.gold()).toBe(goldBefore);
  });

  it("keeps a multi-aircraft SAM soak deterministic and releases every sortie lock", async () => {
    const runSoak = async () => {
      const soakGame = await setup(
        "big_plains",
        { combinedArmsV1: true, instantBuild: true },
        [attackerInfo, defenderInfo],
      );
      const red = soakGame.player(attackerInfo.id);
      const blue = soakGame.player(defenderInfo.id);
      red.addGold(100_000_000n);
      blue.addGold(100_000_000n);

      const soakConfig = soakGame.config() as TestConfig;
      vi.spyOn(soakConfig, "fighterLaunchCooldown").mockReturnValue(12);
      vi.spyOn(soakConfig, "fighterMissionDuration").mockReturnValue(18);
      vi.spyOn(soakConfig, "fighterAttackCooldown").mockReturnValue(2);
      vi.spyOn(soakConfig, "SAMCooldown").mockReturnValue(6);

      const factories: Unit[] = [];
      const buildFactories = (
        owner: Player,
        coordinates: readonly (readonly [number, number])[],
      ) => {
        for (const [x, y] of coordinates) {
          const tile = soakGame.ref(x, y);
          owner.conquer(tile);
          const built = owner.buildUnit(UnitType.Factory, tile, {});
          factories.push(built);
          soakGame.addExecution(new FactoryExecution(built));
        }
      };
      buildFactories(red, [
        [8, 8],
        [8, 12],
        [11, 8],
        [11, 12],
      ]);
      buildFactories(blue, [
        [29, 8],
        [29, 12],
        [32, 8],
        [32, 12],
      ]);

      const buildSam = (owner: Player, x: number, y: number) => {
        const tile = soakGame.ref(x, y);
        owner.conquer(tile);
        const sam = owner.buildUnit(UnitType.SAMLauncher, tile, {});
        soakGame.addExecution(new SAMLauncherExecution(owner, null, sam));
      };
      buildSam(red, 15, 10);
      buildSam(blue, 25, 10);

      const patrol = soakGame.ref(20, 10);
      for (let i = 0; i < 4; i++) {
        soakGame.addExecution(
          new FighterJetExecution(red, {
            mission: AirMissionType.Intercept,
            targetTile: patrol,
          }),
        );
        soakGame.addExecution(
          new FighterJetExecution(blue, {
            mission: AirMissionType.Intercept,
            targetTile: patrol,
          }),
        );
      }

      const timeline: unknown[] = [];
      let maxActiveFighters = 0;
      let maxFactoryQueueDepth = 0;
      for (let i = 0; i < 80; i++) {
        const updates = soakGame.executeNextTick();
        const fighters = [
          ...red.units(UnitType.FighterJet),
          ...blue.units(UnitType.FighterJet),
        ]
          .filter((unit) => unit.isActive())
          .sort((a, b) => a.id() - b.id())
          .map((unit) => {
            const update = unit.toUpdate();
            return {
              id: unit.id(),
              hash: unit.hash(),
              ownerID: update.ownerID,
              pos: update.pos,
              lastPos: update.lastPos,
              health: update.health,
              targetTile: update.targetTile,
              targetUnitId: update.targetUnitId,
              aircraftState:
                update.aircraftState === undefined
                  ? undefined
                  : { ...update.aircraftState },
            };
          });
        const missiles = [
          ...red.units(UnitType.SAMMissile),
          ...blue.units(UnitType.SAMMissile),
        ]
          .filter((unit) => unit.isActive())
          .sort((a, b) => a.id() - b.id())
          .map((unit) => ({
            id: unit.id(),
            hash: unit.hash(),
            ownerID: unit.owner().smallID(),
            pos: unit.tile(),
            targetUnitId: unit.targetUnit()?.id(),
          }));
        const factoryQueues = factories
          .sort((a, b) => a.id() - b.id())
          .map((unit) => ({
            id: unit.id(),
            queue: [...unit.missileTimerQueue()],
          }));
        const emittedUnits = updates[GameUpdateType.Unit]
          .filter((update) =>
            [
              UnitType.FighterJet,
              UnitType.SAMMissile,
              UnitType.Factory,
            ].includes(update.unitType),
          )
          .map((update) => ({
            id: update.id,
            unitType: update.unitType,
            pos: update.pos,
            lastPos: update.lastPos,
            isActive: update.isActive,
            health: update.health,
            missileTimerQueue: [...update.missileTimerQueue],
            aircraftState:
              update.aircraftState === undefined
                ? undefined
                : { ...update.aircraftState },
          }));
        const emittedHashes = updates[GameUpdateType.Hash].map((update) => ({
          tick: update.tick,
          hash: update.hash,
        }));

        maxActiveFighters = Math.max(maxActiveFighters, fighters.length);
        maxFactoryQueueDepth = Math.max(
          maxFactoryQueueDepth,
          ...factoryQueues.map(({ queue }) => queue.length),
        );
        timeline.push({
          tick: soakGame.ticks(),
          fighters,
          missiles,
          factoryQueues,
          emittedUnits,
          emittedHashes,
        });
      }

      return {
        timeline,
        maxActiveFighters,
        maxFactoryQueueDepth,
        activeFighters: [
          ...red.units(UnitType.FighterJet),
          ...blue.units(UnitType.FighterJet),
        ].filter((unit) => unit.isActive()).length,
        activeSamMissiles: [
          ...red.units(UnitType.SAMMissile),
          ...blue.units(UnitType.SAMMissile),
        ].filter((unit) => unit.isActive()).length,
        finalFactoryQueues: factories.map((unit) => [
          unit.id(),
          ...unit.missileTimerQueue(),
        ]),
      };
    };

    const first = await runSoak();
    const second = await runSoak();

    expect(first.timeline).toEqual(second.timeline);
    expect(first.maxActiveFighters).toBe(8);
    expect(first.maxFactoryQueueDepth).toBeLessThanOrEqual(1);
    expect(first.activeFighters).toBe(0);
    expect(first.activeSamMissiles).toBe(0);
    expect(first.finalFactoryQueues).toEqual(second.finalFactoryQueues);
    expect(first.finalFactoryQueues.every((queue) => queue.length === 1)).toBe(
      true,
    );
  });
});
