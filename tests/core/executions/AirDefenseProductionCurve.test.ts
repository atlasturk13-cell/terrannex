import {
  Config,
  SAM_CONSTRUCTION_TICKS,
} from "../../../src/core/configuration/Config";
import { ConstructionExecution } from "../../../src/core/execution/ConstructionExecution";
import { Executor } from "../../../src/core/execution/ExecutionManager";
import {
  AircraftType,
  AirDefenseSystem,
  AirMissionType,
  Game,
  GameMapType,
  Player,
  PlayerInfo,
  PlayerType,
  Unit,
  UnitType,
} from "../../../src/core/game/Game";
import { StampedIntentSchema } from "../../../src/core/Schemas";
import { setup } from "../../util/Setup";
import { TestConfig } from "../../util/TestConfig";
import { executeTicks } from "../../util/utils";

/** The shipped SAM curve (70 at level 1) instead of the flat 20-tile test curve. */
class ProductionRangeConfig extends TestConfig {
  override defaultSamRange(): number {
    return Config.prototype.defaultSamRange.call(this);
  }
  override samRange(level: number): number {
    return Config.prototype.samRange.call(this, level);
  }
}

const defenderInfo = new PlayerInfo(
  "curve defender",
  PlayerType.Human,
  "CURV0001",
  "curve-defender-id",
);
const attackerInfo = new PlayerInfo(
  "curve attacker",
  PlayerType.Human,
  "CURV0002",
  "curve-attacker-id",
);

async function curveGame(instantBuild: boolean): Promise<{
  game: Game;
  defender: Player;
  attacker: Player;
}> {
  const game = await setup(
    "big_plains",
    {
      airportOperationsV1: true,
      airSuperiorityV1: true,
      combinedArmsV1: true,
      combinedArmsV2: true,
      gameMap: GameMapType.NaturalEarthWorld,
      instantBuild,
    },
    [defenderInfo, attackerInfo],
    undefined,
    ProductionRangeConfig,
  );
  const defender = game.player(defenderInfo.id);
  const attacker = game.player(attackerInfo.id);
  for (let y = 40; y <= 60; y++) {
    for (let x = 40; x <= 90; x++) defender.conquer(game.ref(x, y));
  }
  defender.addGold(100_000_000n);
  attacker.addGold(100_000_000n);
  return { game, defender, attacker };
}

function jet(
  game: Game,
  owner: Player,
  x: number,
  y: number,
  aircraftType?: AircraftType,
): Unit {
  const tile = game.ref(x, y);
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

function warhead(
  game: Game,
  owner: Player,
  type: UnitType.AtomBomb | UnitType.MIRVWarhead,
  x: number,
  y: number,
): Unit {
  const trajectory = [0, 1, 2].map((step) => ({
    tile: game.ref(x + step, y),
    targetable: true,
  }));
  return owner.buildUnit(type, game.ref(x, y), {
    targetTile: game.ref(x + 2, y),
    trajectory,
  });
}

function construct(
  game: Game,
  player: Player,
  x: number,
  y: number,
  system?: AirDefenseSystem,
): ConstructionExecution {
  const execution = new ConstructionExecution(
    player,
    UnitType.SAMLauncher,
    game.ref(x, y),
    undefined,
    undefined,
    undefined,
    system,
  );
  game.addExecution(execution);
  return execution;
}

describe("Air defense on the shipped range curve", () => {
  it("uses the shipped 70-tile baseline and the systems' own level-1 radii", async () => {
    const { game } = await curveGame(true);
    const config = game.config();
    expect(config.samRange(1)).toBe(70);
    expect(config.airDefenseRadius(undefined, 1)).toBe(70);
    expect(config.airDefenseRadius(AirDefenseSystem.IronDome, 1)).toBe(40);
    expect(config.airDefenseRadius(AirDefenseSystem.Patriot, 1)).toBe(80);
    expect(config.airDefenseRadius(AirDefenseSystem.S500, 1)).toBe(130);
    expect(config.airDefenseRadius(AirDefenseSystem.S500, 3)).toBeCloseTo(
      130 + (config.samRange(3) - 70),
      10,
    );
  });

  it("builds a Patriot through the real construction path with construction time, then it intercepts a warhead and downs a jet", async () => {
    const { game, defender, attacker } = await curveGame(false);
    const execution = construct(
      game,
      defender,
      50,
      50,
      AirDefenseSystem.Patriot,
    );
    executeTicks(game, 2);
    expect(execution.placementOutcome()).toBe("accepted");
    const sam = defender.units(UnitType.SAMLauncher)[0];
    expect(sam).toBeDefined();
    expect(sam.airDefenseSystem()).toBe(AirDefenseSystem.Patriot);
    expect(sam.isUnderConstruction()).toBe(true);
    const duration = game.config().tempoDurationTicks(SAM_CONSTRUCTION_TICKS);
    expect(duration).toBe(300);

    // While building it ignores everything.
    const early = jet(game, attacker, 50, 60, AircraftType.F16);
    executeTicks(game, 5);
    expect(early.health()).toBe(300);
    early.delete(false);

    executeTicks(game, duration);
    expect(sam.isUnderConstruction()).toBe(false);

    const bomb = warhead(game, attacker, UnitType.AtomBomb, 51, 50);
    executeTicks(game, 4);
    expect(bomb.isActive()).toBe(false);

    // The slot reloads in the Patriot's 90 ticks, then a jet 70 tiles out
    // (inside the 80-tile radius, outside the old 70) is downed by the
    // 300-point hit.
    executeTicks(
      game,
      game.config().airDefenseCooldown(AirDefenseSystem.Patriot),
    );
    const target = jet(game, attacker, 50, 120, AircraftType.F16);
    expect(game.manhattanDist(sam.tile(), target.tile())).toBe(70);
    executeTicks(game, 12);
    expect(target.isActive()).toBe(false);
  });

  it.each([
    [AirDefenseSystem.IronDome, 30, 150, 60],
    [AirDefenseSystem.S500, 120, 0, 140],
    [undefined, 65, 125, 75],
  ] as const)(
    "%s engages a jet at %i tiles and ignores one beyond its radius",
    async (system, near, hullAfter, far) => {
      const { game, defender, attacker } = await curveGame(true);
      construct(game, defender, 50, 50, system);
      executeTicks(game, 2);
      const sam = defender.units(UnitType.SAMLauncher)[0];
      expect(sam.airDefenseSystem()).toBe(system);
      expect(sam.isUnderConstruction()).toBe(false);
      const outside = jet(game, attacker, 50, 50 + far, AircraftType.F16);
      executeTicks(game, 12);
      expect(outside.health()).toBe(300);
      expect(outside.targetedBySAM()).toBe(false);
      outside.delete(false);
      const inside = jet(game, attacker, 50, 50 + near, AircraftType.F16);
      executeTicks(game, 14);
      if (hullAfter === 0) {
        expect(inside.isActive()).toBe(false);
      } else {
        expect(inside.health()).toBe(hullAfter);
      }
    },
  );

  it("keeps the baseline launcher on the curve for MIRV warheads and builds from a recorded local intent", async () => {
    const { game, defender, attacker } = await curveGame(true);
    const intent = {
      type: "build_unit",
      unit: UnitType.SAMLauncher,
      tile: game.ref(50, 50),
      airDefenseSystem: AirDefenseSystem.DavidsSling,
      clientID: defenderInfo.clientID!,
    } as const;
    expect(StampedIntentSchema.safeParse(intent).success).toBe(true);
    const executor = new Executor(game, "CURVGAME", defenderInfo.clientID!);
    game.addExecution(executor.createExec(intent));
    executeTicks(game, 2);
    const sling = defender.units(UnitType.SAMLauncher)[0];
    expect(sling?.airDefenseSystem()).toBe(AirDefenseSystem.DavidsSling);

    // David's Sling never engages a MIRV warhead; a baseline launcher does.
    const mirv = warhead(game, attacker, UnitType.MIRVWarhead, 51, 50);
    executeTicks(game, 4);
    expect(mirv.isActive()).toBe(true);
    expect(sling.missileTimerQueue()).toHaveLength(0);
    mirv.delete(false);

    // A baseline launcher 35 tiles east (outside the 15-tile structure
    // spacing, inside the same territory) takes the next warhead.
    construct(game, defender, 85, 50);
    executeTicks(game, 2);
    const baseline = defender
      .units(UnitType.SAMLauncher)
      .find((unit) => unit.airDefenseSystem() === undefined);
    expect(baseline).toBeDefined();
    const second = warhead(game, attacker, UnitType.MIRVWarhead, 86, 50);
    executeTicks(game, 4);
    expect(second.isActive()).toBe(false);
    expect(baseline!.missileTimerQueue()).toHaveLength(1);
    expect(sling.missileTimerQueue()).toHaveLength(0);
  });
});
