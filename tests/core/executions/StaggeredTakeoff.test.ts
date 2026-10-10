import { FighterJetExecution } from "../../../src/core/execution/FighterJetExecution";
import {
  AIRPORT_TAKEOFF_INTERVAL_TICKS,
  PATROL_ANCHOR_SPACING,
  selectPatrolAnchors,
} from "../../../src/core/game/AirportOperations";
import {
  AircraftType,
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
import { GameUpdateType } from "../../../src/core/game/GameUpdates";
import { setup } from "../../util/Setup";

const commanderInfo = new PlayerInfo(
  "takeoff commander",
  PlayerType.Human,
  "TKOF0001",
  "takeoff-commander-id",
);
const hostileInfo = new PlayerInfo(
  "takeoff hostile",
  PlayerType.Human,
  "TKOF0002",
  "takeoff-hostile-id",
);

async function takeoffGame(): Promise<{
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

function buildAirport(game: Game, owner: Player, x: number, y: number): Unit {
  const tile = game.ref(x, y);
  owner.conquer(tile);
  return owner.buildUnit(UnitType.Airport, tile, {});
}

function tickUntil(game: Game, condition: () => boolean, maximum = 300): void {
  for (let i = 0; i < maximum && !condition(); i++) game.executeNextTick();
  expect(condition()).toBe(true);
}

describe("Staggered Airport takeoff", () => {
  afterEach(() => vi.restoreAllMocks());

  it("takes off one jet per cadence tick and charges the whole order once", async () => {
    const { game, commander } = await takeoffGame();
    const airport = buildAirport(game, commander, 10, 10);
    const goldBefore = commander.gold();
    expect(AIRPORT_TAKEOFF_INTERVAL_TICKS).toBe(2);

    game.addExecution(
      new FighterJetExecution(
        commander,
        { mission: AirMissionType.CombatAirPatrol, targetTile: airport.tile() },
        4,
      ),
    );
    const counts: number[] = [];
    for (let i = 0; i < 8; i++) {
      game.executeNextTick();
      counts.push(commander.units(UnitType.FighterJet).length);
      expect(commander.gold()).toBe(goldBefore - 3_000_000n);
      expect(airport.missileTimerQueue()).toHaveLength(4);
    }
    expect(counts).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
    const jets = commander.units(UnitType.FighterJet);
    expect(new Set(jets.map((jet) => jet.id())).size).toBe(4);
    expect(jets.every((jet) => jet.aircraftState().homeFactoryId === 1)).toBe(
      true,
    );
  });

  it("spreads the jets of one patrol order over distinct border anchors", async () => {
    const { game, commander } = await takeoffGame();
    conquerBlock(game, commander, 40, 40, 70, 70);
    const airport = buildAirport(game, commander, 55, 55);
    const click = game.ref(40, 40);

    const anchors = selectPatrolAnchors(game, commander, click, 4);
    expect(anchors).toHaveLength(4);
    expect(new Set(anchors).size).toBe(4);
    expect(anchors[0]).toBe(click);
    for (let i = 0; i < anchors.length; i++) {
      for (let j = i + 1; j < anchors.length; j++) {
        expect(
          game.manhattanDist(anchors[i], anchors[j]),
        ).toBeGreaterThanOrEqual(PATROL_ANCHOR_SPACING);
      }
    }
    // Nearest first: no later anchor is closer to the click than an earlier one.
    for (let i = 1; i < anchors.length; i++) {
      expect(game.manhattanDist(click, anchors[i])).toBeGreaterThanOrEqual(
        game.manhattanDist(click, anchors[i - 1]),
      );
    }

    game.addExecution(
      new FighterJetExecution(
        commander,
        { mission: AirMissionType.CombatAirPatrol, targetTile: click },
        4,
      ),
    );
    tickUntil(game, () => commander.units(UnitType.FighterJet).length === 4);
    const jets = commander.units(UnitType.FighterJet);
    tickUntil(
      game,
      () => jets.every((jet) => jet.aircraftState().phase === "patrolling"),
      100,
    );
    expect(jets.map((jet) => jet.aircraftState().patrolAnchorTile)).toEqual(
      anchors,
    );
    expect(new Set(jets.map((jet) => jet.tile())).size).toBe(4);
    expect(
      jets.every((jet) => jet.aircraftState().homeFactoryId === airport.id()),
    ).toBe(true);
  });

  it("relaxes the spacing on a small border before reusing anchors", async () => {
    const { game, commander, hostile } = await takeoffGame();
    // A 3×3 base has an eight-tile border: four jets still get four distinct
    // anchors (spacing falls back to 3, then 1) instead of stacking.
    conquerBlock(game, commander, 90, 90, 92, 92);
    const centre = game.ref(91, 91);
    const anchors = selectPatrolAnchors(game, commander, centre, 4);
    expect(anchors).toHaveLength(4);
    expect(new Set(anchors).size).toBe(4);
    expect(anchors.every((anchor) => game.owner(anchor) === commander)).toBe(
      true,
    );
    // Nine jets exceed the eight border tiles: the ninth reuses the first.
    const nine = selectPatrolAnchors(game, commander, centre, 9);
    expect(new Set(nine).size).toBe(8);
    expect(nine[8]).toBe(nine[0]);

    const lone = game.ref(120, 120);
    commander.conquer(lone);
    hostile.conquer(game.ref(150, 150));
    expect(selectPatrolAnchors(game, hostile, lone, 3)).toEqual([
      game.ref(150, 150),
      game.ref(150, 150),
      game.ref(150, 150),
    ]);
    expect(selectPatrolAnchors(game, commander, lone, 0)).toEqual([]);
    const nobody = game.player(hostileInfo.id);
    nobody.relinquish(game.ref(150, 150));
    expect(selectPatrolAnchors(game, nobody, lone, 2)).toEqual([]);
  });

  it("refunds the jets still waiting when the Airport is destroyed", async () => {
    const { game, commander, hostile } = await takeoffGame();
    const airport = buildAirport(game, commander, 10, 10);
    const goldBefore = commander.gold();
    game.addExecution(
      new FighterJetExecution(
        commander,
        { mission: AirMissionType.CombatAirPatrol, targetTile: airport.tile() },
        4,
      ),
    );
    game.executeNextTick();
    expect(commander.units(UnitType.FighterJet)).toHaveLength(1);
    expect(commander.gold()).toBe(goldBefore - 3_000_000n);

    airport.delete(true, hostile);
    for (let i = 0; i < 10; i++) game.executeNextTick();
    // The airborne jet went down with its base; the three waiting sorties
    // never took off and their full price came back.
    expect(commander.units(UnitType.FighterJet)).toHaveLength(0);
    expect(commander.gold()).toBe(goldBefore - 750_000n);
  });

  it("staggers a direct B-2 strike order and every jet still bombs its victim", async () => {
    const { game, commander, hostile } = await takeoffGame();
    buildAirport(game, commander, 10, 10);
    const target = game.ref(100, 10);
    conquerBlock(game, hostile, 94, 4, 106, 16);
    hostile.setTroops(1_000_000);
    const goldBefore = commander.gold();
    const strikes: number[] = [];
    const addUpdate = game.addUpdate.bind(game);
    vi.spyOn(game, "addUpdate").mockImplementation((update) => {
      if (update.type === GameUpdateType.AirStrikeEvent)
        strikes.push(update.tile);
      addUpdate(update);
    });

    game.addExecution(
      new FighterJetExecution(
        commander,
        {
          mission: AirMissionType.PrecisionStrike,
          targetTile: target,
          aircraftType: AircraftType.B2,
        },
        3,
      ),
    );
    game.executeNextTick();
    expect(commander.units(UnitType.FighterJet)).toHaveLength(1);
    expect(commander.gold()).toBe(goldBefore - 11_250_000n);
    tickUntil(
      game,
      () => commander.units(UnitType.FighterJet).length === 3,
      10,
    );
    expect(commander.gold()).toBe(goldBefore - 11_250_000n);

    tickUntil(game, () => strikes.length === 3, 100);
    expect(strikes).toEqual([target, target, target]);
    expect(hostile.troops()).toBe(421_875);
    expect(game.hasFallout(target)).toBe(true);
    tickUntil(
      game,
      () => commander.units(UnitType.FighterJet).length === 0,
      100,
    );
  });
});
