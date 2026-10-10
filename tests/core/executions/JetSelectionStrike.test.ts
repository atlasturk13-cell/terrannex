import { AirPatrolCommandExecution } from "../../../src/core/execution/AirPatrolCommandExecution";
import { FighterJetExecution } from "../../../src/core/execution/FighterJetExecution";
import { AIRPORT_TAKEOFF_INTERVAL_TICKS } from "../../../src/core/game/AirportOperations";
import {
  AirMissionType,
  Difficulty,
  Game,
  GameMapType,
  Player,
  PlayerInfo,
  PlayerType,
  Unit,
  UnitType,
} from "../../../src/core/game/Game";
import { TileRef } from "../../../src/core/game/GameMap";
import { GameUpdateType } from "../../../src/core/game/GameUpdates";
import { setup } from "../../util/Setup";

const commanderInfo = new PlayerInfo(
  "selection commander",
  PlayerType.Human,
  "JSEL0001",
  "selection-commander-id",
);
const hostileInfo = new PlayerInfo(
  "selection hostile",
  PlayerType.Human,
  "JSEL0002",
  "selection-hostile-id",
);

async function selectionGame(airportProfile = true): Promise<{
  game: Game;
  commander: Player;
  hostile: Player;
}> {
  const game = await setup(
    "big_plains",
    {
      ...(airportProfile
        ? {
            airportOperationsV1: true,
            airSuperiorityV1: true,
            difficulty: Difficulty.Impossible,
            gameMap: GameMapType.NaturalEarthWorld,
          }
        : {}),
      combinedArmsV1: true,
      combinedArmsV2: true,
      instantBuild: true,
    },
    [commanderInfo, hostileInfo],
  );
  const commander = game.player(commanderInfo.id);
  const hostile = game.player(hostileInfo.id);
  commander.addGold(100_000_000n);
  hostile.addGold(100_000_000n);
  commander.conquer(game.ref(5, 5));
  return { game, commander, hostile };
}

function conquerBlock(
  game: Game,
  owner: Player,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): void {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) owner.conquer(game.ref(x, y));
  }
}

function buildCap(
  game: Game,
  owner: Player,
  tile: TileRef,
  phase: "patrolling" | "returning" = "patrolling",
): Unit {
  return owner.buildUnit(UnitType.FighterJet, tile, {
    aircraftState: {
      mission: AirMissionType.CombatAirPatrol,
      phase,
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

function command(
  game: Game,
  player: Player,
  targetTile: TileRef,
  amount: number,
  fighterIds?: number[],
): number {
  game.addExecution(
    new AirPatrolCommandExecution(
      player,
      {
        mission: AirMissionType.PrecisionStrike,
        targetTile,
        ...(fighterIds === undefined ? {} : { fighterIds }),
      },
      amount,
    ),
  );
  const commandTick = game.ticks();
  game.executeNextTick();
  return commandTick;
}

function tickUntil(game: Game, condition: () => boolean, maximum = 300): void {
  for (let i = 0; i < maximum && !condition(); i++) game.executeNextTick();
  expect(condition()).toBe(true);
}

describe("Jet selection and staggered departure", () => {
  afterEach(() => vi.restoreAllMocks());

  it("retasks exactly the chosen jets, nearest first, with staggered departures", async () => {
    const { game, commander, hostile } = await selectionGame();
    conquerBlock(game, hostile, 80, 10, 120, 30);
    const click = game.ref(100, 20);
    const jets = [
      buildCap(game, commander, game.ref(100, 20)),
      buildCap(game, commander, game.ref(105, 20)),
      buildCap(game, commander, game.ref(100, 32)),
      buildCap(game, commander, game.ref(70, 20)),
    ];

    const commandTick = command(game, commander, click, 2, [
      jets[2].id(),
      jets[0].id(),
    ]);

    expect(jets.map((jet) => jet.aircraftState().commandRevision)).toEqual([
      1, 0, 1, 0,
    ]);
    expect(jets.map((jet) => jet.aircraftState().phase)).toEqual([
      "outbound",
      "patrolling",
      "outbound",
      "patrolling",
    ]);
    expect(jets[0].targetTile()).toBe(click);
    expect(jets[2].targetTile()).toBe(click);
    // Departure order follows distance to the strike point, not the order
    // the IDs were listed in.
    expect(jets[0].aircraftState().departureTick).toBe(commandTick + 1);
    expect(jets[2].aircraftState().departureTick).toBe(
      commandTick + 1 + AIRPORT_TAKEOFF_INTERVAL_TICKS,
    );
    expect(jets[1].aircraftState().departureTick).toBeUndefined();
    expect(jets[3].aircraftState().departureTick).toBeUndefined();
  });

  it("rejects a selection that is not exactly this player's airborne patrol jets", async () => {
    const { game, commander, hostile } = await selectionGame();
    conquerBlock(game, hostile, 80, 40, 120, 60);
    const click = game.ref(100, 50);
    const own = buildCap(game, commander, game.ref(100, 50));
    const ownToo = buildCap(game, commander, game.ref(102, 50));
    const returning = buildCap(game, commander, game.ref(104, 50), "returning");
    const foreign = buildCap(game, hostile, game.ref(106, 50));
    const untouched = () => {
      expect(
        [own, ownToo, returning, foreign].map(
          (jet) => jet.aircraftState().commandRevision,
        ),
      ).toEqual([0, 0, 0, 0]);
    };

    command(game, commander, click, 1, [424242]);
    untouched();
    command(game, commander, click, 1, [foreign.id()]);
    untouched();
    command(game, commander, click, 1, [returning.id()]);
    untouched();
    command(game, commander, click, 2, [own.id(), own.id()]);
    untouched();
    command(game, commander, click, 2, [own.id()]);
    untouched();
    command(game, commander, click, 2, [own.id(), ownToo.id(), 424242]);
    untouched();

    command(game, commander, click, 2, [ownToo.id(), own.id()]);
    expect(own.aircraftState().commandRevision).toBe(1);
    expect(ownToo.aircraftState().commandRevision).toBe(1);
    expect(returning.aircraftState().commandRevision).toBe(0);
    expect(foreign.aircraftState().commandRevision).toBe(0);
  });

  it("holds each jet at its anchor until its departure tick and clears the hold afterwards", async () => {
    const { game, commander, hostile } = await selectionGame();
    const airportTile = game.ref(10, 10);
    commander.conquer(airportTile);
    commander.buildUnit(UnitType.Airport, airportTile, {});
    conquerBlock(game, hostile, 94, 4, 106, 16);
    hostile.setTroops(1_000_000);
    const target = game.ref(100, 10);
    game.addExecution(
      new FighterJetExecution(
        commander,
        { mission: AirMissionType.CombatAirPatrol, targetTile: airportTile },
        3,
      ),
    );
    tickUntil(game, () => commander.units(UnitType.FighterJet).length === 3);
    const jets = commander.units(UnitType.FighterJet);
    tickUntil(
      game,
      () => jets.every((jet) => jet.aircraftState().phase === "patrolling"),
      100,
    );
    const start = game.ref(70, 10);
    for (const jet of jets) jet.move(start);
    const strikeTicks: number[] = [];
    const addUpdate = game.addUpdate.bind(game);
    vi.spyOn(game, "addUpdate").mockImplementation((update) => {
      if (update.type === GameUpdateType.AirStrikeEvent) {
        strikeTicks.push(game.ticks());
      }
      addUpdate(update);
    });

    const commandTick = command(game, commander, target, 3);
    const ordered = [...jets].sort((a, b) => a.id() - b.id());
    expect(ordered.map((jet) => jet.aircraftState().departureTick)).toEqual([
      commandTick + 1,
      commandTick + 3,
      commandTick + 5,
    ]);

    // The jets act on the order from the tick after it; from then on one
    // jet leaves the anchor every cadence tick.
    const moved = () => ordered.map((jet) => jet.tile() !== start);
    expect(moved()).toEqual([false, false, false]);
    game.executeNextTick();
    expect(moved()).toEqual([true, false, false]);
    game.executeNextTick();
    expect(moved()).toEqual([true, false, false]);
    game.executeNextTick();
    expect(moved()).toEqual([true, true, false]);
    game.executeNextTick();
    expect(moved()).toEqual([true, true, false]);
    game.executeNextTick();
    expect(moved()).toEqual([true, true, true]);

    tickUntil(game, () => strikeTicks.length === 3, 100);
    expect(strikeTicks[1] - strikeTicks[0]).toBeGreaterThanOrEqual(2);
    expect(strikeTicks[2] - strikeTicks[1]).toBeGreaterThanOrEqual(2);
    tickUntil(
      game,
      () => jets.every((jet) => jet.aircraftState().phase === "patrolling"),
      100,
    );
    expect(
      jets.every((jet) => jet.aircraftState().departureTick === undefined),
    ).toBe(true);
  });

  it("changes the unit hash with the departure hold and keeps legacy orders untouched", async () => {
    const { game, commander, hostile } = await selectionGame(false);
    conquerBlock(game, hostile, 80, 10, 120, 30);
    const click = game.ref(100, 20);
    const jet = buildCap(game, commander, game.ref(100, 20));
    const before = jet.hash();
    jet.updateAircraftState({ departureTick: 7 });
    expect(jet.hash()).not.toBe(before);
    jet.updateAircraftState({ departureTick: undefined });
    expect(jet.hash()).toBe(before);

    // Outside the Airport profile an explicit selection is refused and a
    // plain order sets no hold.
    command(game, commander, click, 1, [jet.id()]);
    expect(jet.aircraftState().commandRevision).toBe(0);
    command(game, commander, click, 1);
    expect(jet.aircraftState().commandRevision).toBe(1);
    expect(jet.aircraftState().departureTick).toBeUndefined();
  });
});
