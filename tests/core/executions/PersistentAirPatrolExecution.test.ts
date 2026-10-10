import { AirPatrolCommandExecution } from "../../../src/core/execution/AirPatrolCommandExecution";
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
import { setup } from "../../util/Setup";

const commanderInfo = new PlayerInfo(
  "CAP commander",
  PlayerType.Human,
  "CAPOWNER",
  "cap-owner-id",
);
const hostileInfo = new PlayerInfo(
  "CAP hostile",
  PlayerType.Human,
  "CAPENEMY",
  "cap-hostile-id",
);

async function createPatrolGame(v2 = true): Promise<{
  game: Game;
  commander: Player;
  hostile: Player;
}> {
  const game = await setup(
    "big_plains",
    {
      combinedArmsV1: true,
      combinedArmsV2: v2,
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

function buildFactory(game: Game, owner: Player, x = 10, y = 10): Unit {
  const tile = game.ref(x, y);
  owner.conquer(tile);
  return owner.buildUnit(UnitType.Factory, tile, {});
}

function tickUntil(
  game: Game,
  condition: () => boolean,
  maximumTicks = 300,
): void {
  for (let i = 0; i < maximumTicks && !condition(); i++) {
    game.executeNextTick();
  }
  expect(condition()).toBe(true);
}

function launchPatrol(game: Game, owner: Player, clickedTile: number): Unit {
  game.addExecution(
    new FighterJetExecution(owner, {
      mission: AirMissionType.CombatAirPatrol,
      targetTile: clickedTile,
    }),
  );
  game.executeNextTick();
  const fighter = owner.units(UnitType.FighterJet)[0];
  expect(fighter).toBeDefined();
  tickUntil(game, () => fighter.aircraftState().phase === "patrolling", 100);
  return fighter;
}

function hostileFighter(
  game: Game,
  owner: Player,
  tile: number,
  targetTile: number,
): Unit {
  return owner.buildUnit(UnitType.FighterJet, tile, {
    aircraftState: {
      mission: AirMissionType.PrecisionStrike,
      phase: "outbound",
      homeFactoryId: 999,
      missionEndTick: game.ticks() + 1_000,
      ammo: 1,
      targetedBySam: false,
    },
    targetTile,
  });
}

describe("persistent Combat Air Patrol", () => {
  it("deploys to the nearest deterministic border anchor and survives expiry or Factory loss", async () => {
    const { game, commander } = await createPatrolGame();
    const firstFactory = buildFactory(game, commander, 10, 12);
    const secondFactory = buildFactory(game, commander, 12, 10);
    const expectedAnchor = Math.min(firstFactory.tile(), secondFactory.tile());
    const clickedTile = game.ref(180, 180);
    const fighter = launchPatrol(game, commander, clickedTile);
    const fighterId = fighter.id();

    expect(fighter.aircraftState()).toMatchObject({
      mission: AirMissionType.CombatAirPatrol,
      phase: "patrolling",
      patrolAnchorTile: expectedAnchor,
      commandRevision: 0,
    });
    expect(fighter.aircraftState().missionEndTick).toBe(
      Number.MAX_SAFE_INTEGER,
    );

    for (const factory of commander.units(UnitType.Factory)) {
      factory.delete(false);
    }
    for (let i = 0; i < game.config().fighterMissionDuration() + 50; i++) {
      game.executeNextTick();
    }

    expect(fighter.isActive()).toBe(true);
    expect(fighter.id()).toBe(fighterId);
    expect(fighter.aircraftState().phase).toBe("patrolling");
  });

  it("rejects the persistent role outside combined-arms V2 without mutation", async () => {
    const { game, commander } = await createPatrolGame(false);
    const factory = buildFactory(game, commander);
    const goldBefore = commander.gold();

    game.addExecution(
      new FighterJetExecution(commander, {
        mission: AirMissionType.CombatAirPatrol,
        targetTile: game.ref(100, 100),
      }),
    );
    game.executeNextTick();

    expect(commander.units(UnitType.FighterJet)).toHaveLength(0);
    expect(commander.gold()).toBe(goldBefore);
    expect(factory.missileTimerQueue()).toHaveLength(0);
  });

  it("strikes a manually selected military ship, egresses, and remains the same airborne unit", async () => {
    const { game, commander, hostile } = await createPatrolGame();
    const factory = buildFactory(game, commander);
    const fighter = launchPatrol(game, commander, game.ref(150, 150));
    const fighterId = fighter.id();
    factory.delete(false);
    const shipTile = game.ref(35, 10);
    const ship = hostile.buildUnit(UnitType.Warship, shipTile, {
      patrolTile: shipTile,
    });

    game.addExecution(
      new AirPatrolCommandExecution(
        commander,
        { mission: AirMissionType.NavalStrike, targetUnitId: ship.id() },
        1,
      ),
    );
    game.executeNextTick();
    expect(fighter.aircraftState().commandRevision).toBe(1);

    tickUntil(game, () => ship.health() === 400, 100);
    tickUntil(game, () => fighter.aircraftState().phase === "patrolling", 100);

    expect(fighter.isActive()).toBe(true);
    expect(fighter.id()).toBe(fighterId);
    expect(fighter.targetUnit()).toBeUndefined();
  });

  it("strikes hostile land on command without capturing it, then resumes patrol", async () => {
    const { game, commander, hostile } = await createPatrolGame();
    buildFactory(game, commander);
    const fighter = launchPatrol(game, commander, game.ref(150, 150));
    const targetTile = game.ref(40, 10);
    hostile.conquer(targetTile);
    hostile.setTroops(1_000_000);

    game.addExecution(
      new AirPatrolCommandExecution(
        commander,
        { mission: AirMissionType.PrecisionStrike, targetTile },
        1,
      ),
    );
    game.executeNextTick();
    tickUntil(game, () => hostile.troops() === 900_000, 100);
    tickUntil(game, () => fighter.aircraftState().phase === "patrolling", 100);

    expect(game.owner(targetTile)).toBe(hostile);
    expect(fighter.isActive()).toBe(true);
  });

  it("automatically hits near and approaching military ships but ignores far and civilian ships", async () => {
    const near = await createPatrolGame();
    buildFactory(near.game, near.commander);
    const nearCap = launchPatrol(
      near.game,
      near.commander,
      near.game.ref(150, 150),
    );
    const nearShipTile = near.game.ref(45, 10);
    const nearShip = near.hostile.buildUnit(UnitType.Warship, nearShipTile, {
      patrolTile: nearShipTile,
    });
    tickUntil(near.game, () => nearShip.health() === 400, 150);
    expect(nearCap.isActive()).toBe(true);

    const approaching = await createPatrolGame();
    const approachFactory = buildFactory(
      approaching.game,
      approaching.commander,
    );
    launchPatrol(
      approaching.game,
      approaching.commander,
      approaching.game.ref(150, 150),
    );
    const farTile = approaching.game.ref(170, 170);
    const approachingShip = approaching.hostile.buildUnit(
      UnitType.Warship,
      farTile,
      { patrolTile: approachFactory.tile() },
    );
    tickUntil(approaching.game, () => approachingShip.health() === 400, 250);

    const ignored = await createPatrolGame();
    buildFactory(ignored.game, ignored.commander);
    const ignoredCap = launchPatrol(
      ignored.game,
      ignored.commander,
      ignored.game.ref(150, 150),
    );
    const ignoredFarTile = ignored.game.ref(170, 170);
    const farShip = ignored.hostile.buildUnit(
      UnitType.Warship,
      ignoredFarTile,
      { patrolTile: ignoredFarTile },
    );
    const portTile = ignored.game.ref(165, 165);
    ignored.hostile.conquer(portTile);
    const port = ignored.hostile.buildUnit(UnitType.Port, portTile, {});
    const trade = ignored.hostile.buildUnit(
      UnitType.TradeShip,
      ignored.game.ref(160, 160),
      { targetUnit: port },
    );
    const emptyTransport = ignored.hostile.buildUnit(
      UnitType.TransportShip,
      ignored.game.ref(45, 12),
      { troops: 0, targetTile: ignored.game.ref(10, 10) },
    );
    const emptyTransportHealth = emptyTransport.health();
    for (let i = 0; i < 150; i++) ignored.game.executeNextTick();

    expect(farShip.health()).toBe(1_000);
    expect(trade.isActive()).toBe(true);
    expect(emptyTransport.health()).toBe(emptyTransportHealth);
    expect(ignoredCap.targetUnit()).toBeUndefined();
  });

  it("drops an automatic ship lock when the ship stops approaching and leaves the border envelope", async () => {
    const { game, commander, hostile } = await createPatrolGame();
    const factory = buildFactory(game, commander);
    const fighter = launchPatrol(game, commander, game.ref(150, 150));
    const farTile = game.ref(170, 170);
    const ship = hostile.buildUnit(UnitType.Warship, farTile, {
      patrolTile: factory.tile(),
    });
    tickUntil(game, () => fighter.targetUnit()?.id() === ship.id(), 30);

    ship.updateWarshipState({ patrolTile: farTile });
    for (let i = 0; i < 30; i++) game.executeNextTick();

    expect(ship.health()).toBe(1_000);
    expect(fighter.targetUnit()).toBeUndefined();
  });

  it.each([AirMissionType.Intercept, AirMissionType.CombatAirPatrol])(
    "treats a hostile %s jet targeting a protected fighter as a direct inbound threat",
    async (mission) => {
      const { game, commander, hostile } = await createPatrolGame();
      const factory = buildFactory(game, commander);
      const fighter = launchPatrol(game, commander, game.ref(150, 150));
      const threatTile = game.ref(170, 170);
      const directThreat = hostile.buildUnit(UnitType.FighterJet, threatTile, {
        aircraftState: {
          mission,
          phase: "outbound",
          homeFactoryId: 999,
          missionEndTick: game.ticks() + 1_000,
          ammo: 1,
          targetedBySam: false,
        },
        targetTile: fighter.tile(),
        targetUnit: fighter,
      });
      hostile.buildUnit(UnitType.Warship, game.ref(160, 160), {
        patrolTile: factory.tile(),
      });

      tickUntil(game, () => fighter.targetUnit() !== undefined, 30);

      expect(fighter.targetUnit()?.id()).toBe(directThreat.id());
    },
  );

  it("preempts an automatic ship chase for a direct inbound fighter but preserves manual locks", async () => {
    const { game, commander, hostile } = await createPatrolGame();
    const factory = buildFactory(game, commander);
    const fighter = launchPatrol(game, commander, game.ref(150, 150));
    const ship = hostile.buildUnit(UnitType.Warship, game.ref(170, 170), {
      patrolTile: factory.tile(),
    });
    tickUntil(game, () => fighter.targetUnit()?.id() === ship.id(), 30);

    const direct = hostileFighter(
      game,
      hostile,
      game.ref(165, 165),
      factory.tile(),
    );
    tickUntil(game, () => fighter.targetUnit()?.id() === direct.id(), 30);
    expect(ship.health()).toBe(1_000);

    const manualShip = hostile.buildUnit(UnitType.Warship, game.ref(150, 165), {
      patrolTile: factory.tile(),
    });
    game.addExecution(
      new AirPatrolCommandExecution(
        commander,
        {
          mission: AirMissionType.NavalStrike,
          targetUnitId: manualShip.id(),
        },
        1,
      ),
    );
    game.executeNextTick();
    const newerDirect = hostileFighter(
      game,
      hostile,
      game.ref(160, 160),
      factory.tile(),
    );
    for (let i = 0; i < 10; i++) game.executeNextTick();

    expect(fighter.targetUnit()?.id()).toBe(manualShip.id());
    expect(newerDirect.isActive()).toBe(true);
  });

  it("destroys an acquired hostile fighter and resumes the same patrol", async () => {
    const { game, commander, hostile } = await createPatrolGame();
    const factory = buildFactory(game, commander);
    const fighter = launchPatrol(game, commander, game.ref(150, 150));
    const fighterId = fighter.id();
    const direct = hostileFighter(
      game,
      hostile,
      game.ref(20, 10),
      factory.tile(),
    );

    tickUntil(game, () => !direct.isActive(), 100);
    tickUntil(game, () => fighter.aircraftState().phase === "patrolling", 100);

    expect(fighter.isActive()).toBe(true);
    expect(fighter.id()).toBe(fighterId);
    expect(fighter.targetUnit()).toBeUndefined();
  });

  it("remains vulnerable to hostile SAM fire and leaves no aircraft residue", async () => {
    const { game, commander, hostile } = await createPatrolGame();
    buildFactory(game, commander);
    const fighter = launchPatrol(game, commander, game.ref(10, 10));
    for (const x of [12, 14]) {
      const tile = game.ref(x, 10);
      hostile.conquer(tile);
      const sam = hostile.buildUnit(UnitType.SAMLauncher, tile, {});
      game.addExecution(new SAMLauncherExecution(hostile, null, sam));
    }

    tickUntil(game, () => !fighter.isActive(), 150);
    for (let i = 0; i < 20; i++) game.executeNextTick();

    expect(commander.units(UnitType.FighterJet)).toHaveLength(0);
    expect(hostile.units(UnitType.SAMMissile)).toHaveLength(0);
  });

  it("revalidates diplomacy before damage and cleans the persistent jet when its owner dies", async () => {
    const { game, commander, hostile } = await createPatrolGame();
    const factory = buildFactory(game, commander);
    const fighter = launchPatrol(game, commander, game.ref(150, 150));
    const ship = hostile.buildUnit(UnitType.Warship, game.ref(150, 150), {
      patrolTile: game.ref(150, 150),
    });
    game.addExecution(
      new AirPatrolCommandExecution(
        commander,
        { mission: AirMissionType.NavalStrike, targetUnitId: ship.id() },
        1,
      ),
    );
    game.executeNextTick();
    const request = commander.createAllianceRequest(hostile);
    expect(request).not.toBeNull();
    request!.accept();
    for (let i = 0; i < 80; i++) game.executeNextTick();

    expect(ship.health()).toBe(1_000);
    expect(fighter.isActive()).toBe(true);
    expect(fighter.aircraftState().phase).toBe("patrolling");

    factory.delete(false);
    for (const tile of Array.from(commander.tiles()))
      commander.relinquish(tile);
    expect(commander.isAlive()).toBe(false);
    game.executeNextTick();
    expect(fighter.isActive()).toBe(false);
    expect(commander.units(UnitType.FighterJet)).toHaveLength(0);
  });

  it("replays a mixed patrol timeline deterministically", async () => {
    const run = async () => {
      const { game, commander, hostile } = await createPatrolGame();
      const factory = buildFactory(game, commander);
      launchPatrol(game, commander, game.ref(150, 150));
      const ship = hostile.buildUnit(UnitType.Warship, game.ref(140, 140), {
        patrolTile: factory.tile(),
      });
      const timeline: unknown[] = [];
      for (let i = 0; i < 220; i++) {
        game.executeNextTick();
        timeline.push(
          commander
            .units(UnitType.FighterJet)
            .sort((a, b) => a.id() - b.id())
            .map((unit) => ({
              hash: unit.hash(),
              id: unit.id(),
              state: { ...unit.aircraftState() },
              target: unit.targetUnit()?.id() ?? null,
              tile: unit.tile(),
            })),
        );
      }
      return {
        timeline,
        shipActive: ship.isActive(),
        shipHealth: ship.health(),
      };
    };

    expect(await run()).toEqual(await run());
  });

  it("hashes its patrol anchor and monotonic command revision", async () => {
    const { game, commander } = await createPatrolGame();
    buildFactory(game, commander);
    const fighter = launchPatrol(game, commander, game.ref(150, 150));
    const initialHash = fighter.hash();

    fighter.updateAircraftState({ commandRevision: 1 });
    const revisedHash = fighter.hash();
    fighter.updateAircraftState({ patrolAnchorTile: game.ref(11, 10) });

    expect(revisedHash).not.toBe(initialHash);
    expect(fighter.hash()).not.toBe(revisedHash);
  });
});
