import { AirPatrolCommandExecution } from "../../../src/core/execution/AirPatrolCommandExecution";
import { Executor } from "../../../src/core/execution/ExecutionManager";
import {
  AirMissionType,
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  Unit,
  UnitType,
} from "../../../src/core/game/Game";
import { PathFinding } from "../../../src/core/pathfinding/PathFinder";
import {
  CommandAirPatrolIntentSchema,
  StampedIntentSchema,
} from "../../../src/core/Schemas";
import { setup } from "../../util/Setup";

const attackerInfo = new PlayerInfo(
  "CAP commander",
  PlayerType.Human,
  "CAPCMD01",
  "cap-commander-id",
);
const defenderInfo = new PlayerInfo(
  "CAP target",
  PlayerType.Human,
  "CAPTGT01",
  "cap-target-id",
);

async function createGame(v2 = true): Promise<{
  game: Game;
  attacker: Player;
  defender: Player;
}> {
  const game = await setup(
    "big_plains",
    {
      combinedArmsV1: true,
      combinedArmsV2: v2,
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

function buildCap(
  game: Game,
  owner: Player,
  x: number,
  y: number,
  commandRevision?: number,
): Unit {
  const tile = game.ref(x, y);
  owner.conquer(tile);
  return owner.buildUnit(UnitType.FighterJet, tile, {
    aircraftState: {
      mission: AirMissionType.CombatAirPatrol,
      phase: "patrolling",
      homeFactoryId: 999,
      missionEndTick: game.ticks() + 1_000,
      ammo: 1,
      targetedBySam: false,
      patrolAnchorTile: tile,
      commandRevision,
    },
    targetTile: tile,
  });
}

function buildHostileFighter(
  game: Game,
  owner: Player,
  x: number,
  y: number,
  phase: "engaging" | "returning" = "engaging",
): Unit {
  const tile = game.ref(x, y);
  return owner.buildUnit(UnitType.FighterJet, tile, {
    aircraftState: {
      mission: AirMissionType.Intercept,
      phase,
      homeFactoryId: 998,
      missionEndTick: game.ticks() + 1_000,
      ammo: 1,
      targetedBySam: false,
    },
    targetTile: tile,
  });
}

describe("AirPatrolCommandExecution", () => {
  afterEach(() => vi.restoreAllMocks());

  it("retasks the exact closest amount with stable unit-ID ties and no economy mutation", async () => {
    const { game, attacker, defender } = await createGame();
    const factoryTile = game.ref(8, 8);
    attacker.conquer(factoryTile);
    const factory = attacker.buildUnit(UnitType.Factory, factoryTile, {});
    const far = buildCap(game, attacker, 5, 10, 4);
    const tieLow = buildCap(game, attacker, 20, 9);
    const tieHigh = buildCap(game, attacker, 20, 11, 8);
    const hostile = buildHostileFighter(game, defender, 30, 10);
    const goldBefore = attacker.gold();
    const queueBefore = [...factory.missileTimerQueue()];

    game.addExecution(
      new AirPatrolCommandExecution(
        attacker,
        { mission: AirMissionType.Intercept, targetUnitId: hostile.id() },
        2,
      ),
    );
    game.executeNextTick();

    expect(far.aircraftState()).toMatchObject({
      phase: "patrolling",
      commandRevision: 4,
    });
    expect(far.targetUnit()).toBeUndefined();
    expect(tieLow.targetUnit()).toBe(hostile);
    expect(tieLow.targetTile()).toBe(hostile.tile());
    expect(tieLow.aircraftState()).toMatchObject({
      phase: "outbound",
      commandRevision: 1,
    });
    expect(tieHigh.targetUnit()).toBe(hostile);
    expect(tieHigh.aircraftState()).toMatchObject({
      phase: "outbound",
      commandRevision: 9,
    });
    expect(attacker.gold()).toBe(goldBefore);
    expect(factory.missileTimerQueue()).toEqual(queueBefore);
  });

  it("atomically does nothing when the requested CAP amount is unavailable", async () => {
    const { game, attacker, defender } = await createGame();
    const cap = buildCap(game, attacker, 10, 10, 3);
    const anchor = cap.targetTile();
    const hostile = buildHostileFighter(game, defender, 30, 10);

    game.addExecution(
      new AirPatrolCommandExecution(
        attacker,
        { mission: AirMissionType.Intercept, targetUnitId: hostile.id() },
        2,
      ),
    );
    game.executeNextTick();

    expect(cap.aircraftState()).toMatchObject({
      phase: "patrolling",
      commandRevision: 3,
    });
    expect(cap.targetUnit()).toBeUndefined();
    expect(cap.targetTile()).toBe(anchor);
  });

  it("rejects invalid amounts at both schema and execution boundaries", async () => {
    const { game, attacker, defender } = await createGame();
    const cap = buildCap(game, attacker, 10, 10, 6);
    const anchor = cap.targetTile();
    const hostile = buildHostileFighter(game, defender, 30, 10);
    const order = {
      mission: AirMissionType.Intercept,
      targetUnitId: hostile.id(),
    } as const;

    for (const amount of [0, 3, 1.5]) {
      expect(
        CommandAirPatrolIntentSchema.safeParse({
          type: "command_air_patrol",
          order,
          amount,
        }).success,
      ).toBe(false);
      game.addExecution(new AirPatrolCommandExecution(attacker, order, amount));
      game.executeNextTick();
    }

    expect(cap.aircraftState()).toMatchObject({
      phase: "patrolling",
      commandRevision: 6,
    });
    expect(cap.targetUnit()).toBeUndefined();
    expect(cap.targetTile()).toBe(anchor);
  });

  it("selects only active, non-returning, non-deleting CAP fighters", async () => {
    const { game, attacker, defender } = await createGame();
    const eligible = buildCap(game, attacker, 5, 10, 1);
    const returning = buildCap(game, attacker, 20, 10, 2);
    returning.updateAircraftState({ phase: "returning" });
    const deleting = buildCap(game, attacker, 22, 10, 3);
    deleting.markForDeletion();
    const hostile = buildHostileFighter(game, defender, 30, 10);

    game.addExecution(
      new AirPatrolCommandExecution(
        attacker,
        { mission: AirMissionType.Intercept, targetUnitId: hostile.id() },
        1,
      ),
    );
    game.executeNextTick();

    expect(eligible.targetUnit()).toBe(hostile);
    expect(eligible.aircraftState().commandRevision).toBe(2);
    expect(returning.targetUnit()).toBeUndefined();
    expect(returning.aircraftState().commandRevision).toBe(2);
    expect(deleting.targetUnit()).toBeUndefined();
    expect(deleting.aircraftState().commandRevision).toBe(3);
  });

  it("preflights every route before mutating any selected fighter", async () => {
    const { game, attacker, defender } = await createGame();
    const first = buildCap(game, attacker, 10, 10, 2);
    const second = buildCap(game, attacker, 12, 10, 5);
    const hostile = buildHostileFighter(game, defender, 30, 10);
    const firstAnchor = first.targetTile();
    const secondAnchor = second.targetTile();
    const pathfinder = PathFinding.Air(game);
    const realFindPath = pathfinder.findPath.bind(pathfinder);
    vi.spyOn(pathfinder, "findPath")
      .mockImplementationOnce(realFindPath)
      .mockReturnValueOnce(null);
    vi.spyOn(PathFinding, "Air").mockReturnValue(pathfinder);

    game.addExecution(
      new AirPatrolCommandExecution(
        attacker,
        { mission: AirMissionType.Intercept, targetUnitId: hostile.id() },
        2,
      ),
    );
    game.executeNextTick();

    expect(first.aircraftState()).toMatchObject({
      phase: "patrolling",
      commandRevision: 2,
    });
    expect(second.aircraftState()).toMatchObject({
      phase: "patrolling",
      commandRevision: 5,
    });
    expect(first.targetTile()).toBe(firstAnchor);
    expect(second.targetTile()).toBe(secondAnchor);
    expect(first.targetUnit()).toBeUndefined();
    expect(second.targetUnit()).toBeUndefined();
  });

  it("accepts hostile military ships and clears a prior unit for a legal precision target", async () => {
    const { game, attacker, defender } = await createGame();
    const cap = buildCap(game, attacker, 10, 10);
    const warshipTile = game.ref(20, 10);
    const warship = defender.buildUnit(UnitType.Warship, warshipTile, {
      patrolTile: warshipTile,
    });
    const transportTile = game.ref(22, 10);
    const transport = defender.buildUnit(
      UnitType.TransportShip,
      transportTile,
      {
        troops: 10_000,
        targetTile: game.ref(10, 10),
      },
    );

    for (const target of [warship, transport]) {
      game.addExecution(
        new AirPatrolCommandExecution(
          attacker,
          {
            mission: AirMissionType.NavalStrike,
            targetUnitId: target.id(),
          },
          1,
        ),
      );
      game.executeNextTick();
      expect(cap.targetUnit()).toBe(target);
      expect(cap.targetTile()).toBe(target.tile());
    }

    const precisionTile = game.ref(30, 10);
    expect(game.isLand(precisionTile)).toBe(true);
    expect(game.isImpassable(precisionTile)).toBe(false);
    defender.conquer(precisionTile);
    game.addExecution(
      new AirPatrolCommandExecution(
        attacker,
        {
          mission: AirMissionType.PrecisionStrike,
          targetTile: precisionTile,
        },
        1,
      ),
    );
    game.executeNextTick();

    expect(cap.targetUnit()).toBeUndefined();
    expect(cap.targetTile()).toBe(precisionTile);
    expect(cap.aircraftState()).toMatchObject({
      phase: "outbound",
      commandRevision: 3,
    });
  });

  it("rejects stale, returning, wrong-type, friendly, and invalid-land targets without mutation", async () => {
    const { game, attacker, defender } = await createGame();
    const cap = buildCap(game, attacker, 10, 10, 7);
    const anchor = cap.targetTile();
    const returning = buildHostileFighter(game, defender, 20, 10, "returning");
    const hostileFactoryTile = game.ref(22, 10);
    defender.conquer(hostileFactoryTile);
    const hostileFactory = defender.buildUnit(
      UnitType.Factory,
      hostileFactoryTile,
      {},
    );
    const friendlyShipTile = game.ref(24, 10);
    const friendlyShip = attacker.buildUnit(
      UnitType.Warship,
      friendlyShipTile,
      {
        patrolTile: friendlyShipTile,
      },
    );
    const stale = buildHostileFighter(game, defender, 26, 10);
    stale.delete(false);
    const untargetable = buildHostileFighter(game, defender, 28, 10);
    untargetable.setTargetable(false);
    const tradeShip = defender.buildUnit(UnitType.TradeShip, game.ref(32, 10), {
      targetUnit: friendlyShip,
    });
    const emptyTransport = defender.buildUnit(
      UnitType.TransportShip,
      game.ref(34, 10),
      { troops: 0, targetTile: game.ref(10, 10) },
    );
    const invalidOrders = [
      { mission: AirMissionType.Intercept, targetUnitId: returning.id() },
      {
        mission: AirMissionType.Intercept,
        targetUnitId: hostileFactory.id(),
      },
      {
        mission: AirMissionType.NavalStrike,
        targetUnitId: hostileFactory.id(),
      },
      {
        mission: AirMissionType.NavalStrike,
        targetUnitId: friendlyShip.id(),
      },
      { mission: AirMissionType.Intercept, targetUnitId: stale.id() },
      {
        mission: AirMissionType.Intercept,
        targetUnitId: untargetable.id(),
      },
      {
        mission: AirMissionType.NavalStrike,
        targetUnitId: tradeShip.id(),
      },
      {
        mission: AirMissionType.NavalStrike,
        targetUnitId: emptyTransport.id(),
      },
      {
        mission: AirMissionType.PrecisionStrike,
        targetTile: game.width() * game.height() + 1,
      },
      {
        mission: AirMissionType.PrecisionStrike,
        targetTile: game.ref(10, 10),
      },
    ] as const;

    for (const order of invalidOrders) {
      game.addExecution(new AirPatrolCommandExecution(attacker, order, 1));
      game.executeNextTick();
    }

    expect(cap.aircraftState()).toMatchObject({
      phase: "patrolling",
      commandRevision: 7,
    });
    expect(cap.targetUnit()).toBeUndefined();
    expect(cap.targetTile()).toBe(anchor);
  });

  it("is V2-only and is wired through the authoritative Executor", async () => {
    const legacy = await createGame(false);
    const legacyCap = buildCap(legacy.game, legacy.attacker, 10, 10, 1);
    const legacyTarget = buildHostileFighter(
      legacy.game,
      legacy.defender,
      20,
      10,
    );
    legacy.game.addExecution(
      new AirPatrolCommandExecution(
        legacy.attacker,
        {
          mission: AirMissionType.Intercept,
          targetUnitId: legacyTarget.id(),
        },
        1,
      ),
    );
    legacy.game.executeNextTick();
    expect(legacyCap.aircraftState().commandRevision).toBe(1);

    const { game, attacker, defender } = await createGame();
    const cap = buildCap(game, attacker, 10, 10);
    const target = buildHostileFighter(game, defender, 20, 10);
    const intent = StampedIntentSchema.parse({
      type: "command_air_patrol",
      clientID: attacker.clientID(),
      order: {
        mission: AirMissionType.Intercept,
        targetUnitId: target.id(),
      },
      amount: 1,
    });

    game.addExecution(
      new Executor(game, "cap-command", attacker.clientID()!).createExec(
        intent,
      ),
    );
    game.executeNextTick();

    expect(cap.targetUnit()).toBe(target);
    expect(cap.aircraftState()).toMatchObject({
      phase: "outbound",
      commandRevision: 1,
    });
  });
});
