import { AirPatrolCommandExecution } from "../../../src/core/execution/AirPatrolCommandExecution";
import { FighterJetExecution } from "../../../src/core/execution/FighterJetExecution";
import { FighterMissileExecution } from "../../../src/core/execution/FighterMissileExecution";
import {
  AirMissionType,
  Game,
  GameMapType,
  Player,
  PlayerInfo,
  PlayerType,
  Unit,
  UnitType,
} from "../../../src/core/game/Game";
import type { UnitUpdate } from "../../../src/core/game/GameUpdates";
import { setup } from "../../util/Setup";

const commanderInfo = new PlayerInfo(
  "air-superiority commander",
  PlayerType.Human,
  "air-superiority-owner",
  "air-superiority-owner-id",
);
const hostileInfo = new PlayerInfo(
  "air-superiority hostile",
  PlayerType.Human,
  "air-superiority-hostile",
  "air-superiority-hostile-id",
);

async function airGame(enabled = true): Promise<{
  game: Game;
  commander: Player;
  hostile: Player;
}> {
  const game = await setup(
    "big_plains",
    {
      airSuperiorityV1: enabled,
      combinedArmsV1: true,
      combinedArmsV2: true,
      gameMap: GameMapType.NaturalEarthWorld,
      instantBuild: true,
    },
    [commanderInfo, hostileInfo],
  );
  const commander = game.player(commanderInfo.id);
  const hostile = game.player(hostileInfo.id);
  commander.addGold(50_000_000n);
  hostile.addGold(50_000_000n);
  return { game, commander, hostile };
}

function buildFactory(game: Game, owner: Player): Unit {
  const tile = game.ref(10, 10);
  owner.conquer(tile);
  return owner.buildUnit(UnitType.Factory, tile, {});
}

function tickUntil(
  game: Game,
  condition: () => boolean,
  maximumTicks = 400,
): void {
  for (let i = 0; i < maximumTicks && !condition(); i++) {
    game.executeNextTick();
  }
  expect(condition()).toBe(true);
}

function launchPatrol(game: Game, owner: Player): Unit {
  game.addExecution(
    new FighterJetExecution(owner, {
      mission: AirMissionType.CombatAirPatrol,
      targetTile: game.ref(150, 150),
    }),
  );
  game.executeNextTick();
  const fighter = owner.units(UnitType.FighterJet)[0];
  expect(fighter).toBeDefined();
  tickUntil(game, () => fighter.aircraftState().phase === "patrolling", 100);
  return fighter;
}

function airborneFighter(game: Game, owner: Player, tile: number): Unit {
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

describe("local Air Superiority Patrol", () => {
  it("marks only profile combat kills for fighter explosion rendering", async () => {
    const enabled = await airGame();
    const combatVictim = airborneFighter(
      enabled.game,
      enabled.hostile,
      enabled.game.ref(20, 10),
    );
    combatVictim.modifyHealth(-300, enabled.commander);
    expect(
      (combatVictim as unknown as { toUpdate(): UnitUpdate }).toUpdate()
        .combatDestroyed,
    ).toBe(true);

    const routineReturn = airborneFighter(
      enabled.game,
      enabled.commander,
      enabled.game.ref(10, 10),
    );
    routineReturn.delete(false);
    const routineUpdate = (
      routineReturn as unknown as { toUpdate(): UnitUpdate }
    ).toUpdate();
    expect(routineUpdate).not.toHaveProperty("combatDestroyed");

    const legacy = await airGame(false);
    const legacyVictim = airborneFighter(
      legacy.game,
      legacy.hostile,
      legacy.game.ref(20, 10),
    );
    legacyVictim.modifyHealth(-300, legacy.commander);
    const legacyUpdate = (
      legacyVictim as unknown as { toUpdate(): UnitUpdate }
    ).toUpdate();
    expect(legacyUpdate).not.toHaveProperty("combatDestroyed");
  });

  it.each([10, 24])(
    "keeps a %i-tile missile visible across authoritative flight frames",
    async (distance) => {
      const { game, commander, hostile } = await airGame();
      const sourceTile = game.ref(10, 10);
      const targetTile = game.ref(10 + distance, 10);
      const source = airborneFighter(game, commander, sourceTile);
      const target = airborneFighter(game, hostile, targetTile);
      const execution = new FighterMissileExecution(commander, source, target);
      game.addExecution(execution);
      game.executeNextTick();
      const missile = execution.missileUnitForTesting()!;
      const flightFrames: Array<{ last: number; pos: number }> = [];

      while (execution.isActive() && flightFrames.length < 20) {
        game.executeNextTick();
        if (missile.isActive() && missile.lastTile() !== missile.tile()) {
          flightFrames.push({ last: missile.lastTile(), pos: missile.tile() });
        }
      }

      expect(flightFrames.length).toBeGreaterThanOrEqual(2);
      expect(flightFrames[0].last).toBe(sourceTile);
      expect(flightFrames[0].pos).not.toBe(sourceTile);
      expect(flightFrames[0].pos).not.toBe(targetTile);
      expect(
        game.manhattanDist(flightFrames[0].last, flightFrames[0].pos),
      ).toBe(game.config().fighterMissileSpeed());
      expect(missile.reachedTarget()).toBe(true);
      expect(target.isActive()).toBe(false);
    },
  );

  it("creates a visible missile before damage, pursues the live target, and impacts exactly once", async () => {
    const { game, commander, hostile } = await airGame();
    const source = airborneFighter(game, commander, game.ref(10, 10));
    const target = airborneFighter(game, hostile, game.ref(30, 10));
    const execution = new FighterMissileExecution(commander, source, target);

    game.addExecution(execution);
    game.executeNextTick();
    const missile = execution.missileUnitForTesting();
    expect(missile?.isActive()).toBe(true);
    expect(target.health()).toBe(300);

    target.move(game.ref(50, 10));
    tickUntil(game, () => !execution.isActive(), 20);

    expect(target.isActive()).toBe(false);
    expect(missile?.isActive()).toBe(false);
    expect(missile?.reachedTarget()).toBe(true);
    const healthAfterImpact = target.health();
    for (let i = 0; i < 10; i++) game.executeNextTick();
    expect(target.health()).toBe(healthAfterImpact);
  });

  it("revalidates diplomacy and source life, aborting without damage or impact FX", async () => {
    const allied = await airGame();
    const alliedSource = airborneFighter(
      allied.game,
      allied.commander,
      allied.game.ref(10, 10),
    );
    const alliedTarget = airborneFighter(
      allied.game,
      allied.hostile,
      allied.game.ref(45, 10),
    );
    const alliedMissile = new FighterMissileExecution(
      allied.commander,
      alliedSource,
      alliedTarget,
    );
    allied.game.addExecution(alliedMissile);
    allied.game.executeNextTick();
    const alliance = allied.commander.createAllianceRequest(allied.hostile);
    expect(alliance).not.toBeNull();
    alliance!.accept();
    tickUntil(allied.game, () => !alliedMissile.isActive(), 10);
    expect(alliedTarget.health()).toBe(300);
    expect(alliedMissile.missileUnitForTesting()?.reachedTarget()).toBe(false);

    const sourceLost = await airGame();
    const doomedSource = airborneFighter(
      sourceLost.game,
      sourceLost.commander,
      sourceLost.game.ref(10, 10),
    );
    const untouchedTarget = airborneFighter(
      sourceLost.game,
      sourceLost.hostile,
      sourceLost.game.ref(45, 10),
    );
    const orphan = new FighterMissileExecution(
      sourceLost.commander,
      doomedSource,
      untouchedTarget,
    );
    sourceLost.game.addExecution(orphan);
    sourceLost.game.executeNextTick();
    doomedSource.delete(false);
    tickUntil(sourceLost.game, () => !orphan.isActive(), 10);
    expect(untouchedTarget.health()).toBe(300);
    expect(orphan.missileUnitForTesting()?.reachedTarget()).toBe(false);

    const stale = await airGame();
    const staleSource = airborneFighter(
      stale.game,
      stale.commander,
      stale.game.ref(10, 10),
    );
    const staleTarget = airborneFighter(
      stale.game,
      stale.hostile,
      stale.game.ref(45, 10),
    );
    const staleMissile = new FighterMissileExecution(
      stale.commander,
      staleSource,
      staleTarget,
    );
    stale.game.addExecution(staleMissile);
    stale.game.executeNextTick();
    staleTarget.delete(false);
    tickUntil(stale.game, () => !staleMissile.isActive(), 10);
    expect(staleMissile.missileUnitForTesting()?.reachedTarget()).toBe(false);
  });

  it("automatically destroys global hostile jets and repeats missiles until a near Warship sinks", async () => {
    const { game, commander, hostile } = await airGame();
    buildFactory(game, commander);
    const patrol = launchPatrol(game, commander);
    const hostileJet = airborneFighter(game, hostile, game.ref(80, 80));

    tickUntil(
      game,
      () => commander.units(UnitType.FighterMissile).length === 1,
      100,
    );
    const jetMissile = commander.units(UnitType.FighterMissile)[0];
    expect(hostileJet.health()).toBe(300);
    tickUntil(game, () => !hostileJet.isActive(), 100);
    expect(jetMissile.reachedTarget()).toBe(true);

    const shipTile = game.ref(45, 10);
    const warship = hostile.buildUnit(UnitType.Warship, shipTile, {
      patrolTile: shipTile,
    });
    const missileIds = new Set<number>();
    for (let i = 0; i < 250 && warship.isActive(); i++) {
      game.executeNextTick();
      for (const missile of commander.units(UnitType.FighterMissile)) {
        missileIds.add(missile.id());
      }
    }

    expect(warship.isActive()).toBe(false);
    expect(missileIds.size).toBe(2);
    expect(patrol.isActive()).toBe(true);
  });

  it("targets empty transports in the 64-tile envelope, but ignores Trade Ships and far ships", async () => {
    const { game, commander, hostile } = await airGame();
    buildFactory(game, commander);
    launchPatrol(game, commander);
    const emptyTransport = hostile.buildUnit(
      UnitType.TransportShip,
      game.ref(45, 12),
      { troops: 0, targetTile: game.ref(10, 10) },
    );
    const farTile = game.ref(170, 170);
    const farWarship = hostile.buildUnit(UnitType.Warship, farTile, {
      patrolTile: farTile,
    });
    hostile.conquer(game.ref(165, 165));
    const port = hostile.buildUnit(UnitType.Port, game.ref(165, 165), {});
    const trade = hostile.buildUnit(UnitType.TradeShip, game.ref(160, 160), {
      targetUnit: port,
    });

    tickUntil(game, () => !emptyTransport.isActive(), 150);
    for (let i = 0; i < 150; i++) game.executeNextTick();

    expect(farWarship.health()).toBe(1_000);
    expect(trade.isActive()).toBe(true);
  });

  it("rejects every legacy launch and manual retask while the one-purpose profile is active", async () => {
    const { game, commander, hostile } = await airGame();
    const factory = buildFactory(game, commander);
    const goldBefore = commander.gold();
    const targetTile = game.ref(20, 10);
    hostile.conquer(targetTile);

    game.addExecution(
      new FighterJetExecution(commander, {
        mission: AirMissionType.PrecisionStrike,
        targetTile,
      }),
    );
    game.executeNextTick();

    expect(commander.units(UnitType.FighterJet)).toHaveLength(0);
    expect(factory.missileTimerQueue()).toHaveLength(0);
    expect(commander.gold()).toBe(goldBefore);

    const patrol = launchPatrol(game, commander);
    const farTile = game.ref(170, 170);
    const farShip = hostile.buildUnit(UnitType.Warship, farTile, {
      patrolTile: farTile,
    });
    game.addExecution(
      new AirPatrolCommandExecution(
        commander,
        { mission: AirMissionType.NavalStrike, targetUnitId: farShip.id() },
        1,
      ),
    );
    game.executeNextTick();
    expect(patrol.aircraftState().commandRevision).toBe(0);
    expect(patrol.targetUnit()).toBeUndefined();
  });

  it("keeps the V2 direct-damage patrol path unchanged when the flag is absent", async () => {
    const { game, commander, hostile } = await airGame(false);
    buildFactory(game, commander);
    launchPatrol(game, commander);
    const target = airborneFighter(game, hostile, game.ref(20, 10));

    tickUntil(game, () => !target.isActive(), 100);

    expect(commander.units(UnitType.FighterMissile)).toHaveLength(0);
  });

  it("replays a moving missile and repeated naval impacts deterministically", async () => {
    const run = async () => {
      const { game, commander, hostile } = await airGame();
      buildFactory(game, commander);
      launchPatrol(game, commander);
      const shipTile = game.ref(45, 10);
      const warship = hostile.buildUnit(UnitType.Warship, shipTile, {
        patrolTile: shipTile,
      });
      const timeline: unknown[] = [];
      for (let i = 0; i < 180; i++) {
        game.executeNextTick();
        timeline.push(
          commander
            .units([UnitType.FighterJet, UnitType.FighterMissile])
            .sort((a, b) => a.id() - b.id())
            .map((unit) => ({
              hash: unit.hash(),
              id: unit.id(),
              reachedTarget: unit.reachedTarget(),
              target: unit.targetUnit()?.id() ?? null,
              tile: unit.tile(),
              type: unit.type(),
            })),
        );
      }
      return {
        timeline,
        warshipActive: warship.isActive(),
        warshipHealth: warship.health(),
      };
    };

    expect(await run()).toEqual(await run());
  });
});
