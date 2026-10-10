import { AirPatrolCommandExecution } from "../../../src/core/execution/AirPatrolCommandExecution";
import { FighterJetExecution } from "../../../src/core/execution/FighterJetExecution";
import { FighterMissileExecution } from "../../../src/core/execution/FighterMissileExecution";
import { selectFighterBombReleaseTile } from "../../../src/core/game/AirportOperations";
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
import { TileRef } from "../../../src/core/game/GameMap";
import { setup } from "../../util/Setup";

const commanderInfo = new PlayerInfo(
  "overfly commander",
  PlayerType.Human,
  "OVFL0001",
  "overfly-commander-id",
);
const hostileInfo = new PlayerInfo(
  "overfly hostile",
  PlayerType.Human,
  "OVFL0002",
  "overfly-hostile-id",
);

async function overflyGame(): Promise<{
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

function buildAirport(game: Game, owner: Player, x: number, y: number): Unit {
  const tile = game.ref(x, y);
  owner.conquer(tile);
  return owner.buildUnit(UnitType.Airport, tile, {});
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

function tickUntil(
  game: Game,
  condition: () => boolean,
  maximum = 200,
): number {
  let elapsed = 0;
  while (elapsed < maximum && !condition()) {
    game.executeNextTick();
    elapsed++;
  }
  expect(condition()).toBe(true);
  return elapsed;
}

describe("Overfly strike release", () => {
  it("resolves the release tile to the target itself", async () => {
    const { game } = await overflyGame();
    expect(game.config().fighterBombStandOffRange()).toBe(0);
    const target = game.ref(120, 40);
    expect(selectFighterBombReleaseTile(game, game.ref(10, 10), target)).toBe(
      target,
    );
    expect(selectFighterBombReleaseTile(game, target, target)).toBe(target);
  });

  it("drops the tick the jet reaches the target and detonates within two ticks", async () => {
    const { game, commander, hostile } = await overflyGame();
    buildAirport(game, commander, 10, 10);
    const target = game.ref(70, 10);
    conquerBlock(game, hostile, 64, 4, 76, 16);
    hostile.setTroops(1_000_000);
    game.addExecution(
      new FighterJetExecution(commander, {
        mission: AirMissionType.CombatAirPatrol,
        targetTile: game.ref(10, 10),
        aircraftType: AircraftType.B2,
      }),
    );
    game.executeNextTick();
    const jet = commander.units(UnitType.FighterJet)[0];
    tickUntil(game, () => jet.aircraftState().phase === "patrolling", 100);
    const start = jet.tile();
    expect(game.manhattanDist(start, target)).toBe(60);

    game.addExecution(
      new AirPatrolCommandExecution(
        commander,
        { mission: AirMissionType.PrecisionStrike, targetTile: target },
        1,
      ),
    );
    const trail: TileRef[] = [];
    let ticksToRelease = 0;
    while (
      commander.units(UnitType.FighterBomb).length === 0 &&
      ticksToRelease < 60
    ) {
      game.executeNextTick();
      ticksToRelease++;
      trail.push(jet.tile());
    }
    const bomb = commander.units(UnitType.FighterBomb)[0];
    expect(bomb).toBeDefined();
    expect(bomb.tile()).toBe(target);
    expect(jet.tile()).toBe(target);
    // 60 tiles at 11 tiles per tick: the jet needed six moves, and released
    // on the very tick it arrived (one extra tick for the command itself).
    expect(ticksToRelease).toBeLessThanOrEqual(8);
    expect(trail.filter((tile) => tile === target)).toHaveLength(1);
    const troopsBefore = hostile.troops();
    const ticksToImpact = tickUntil(game, () => !bomb.isActive(), 10);
    expect(ticksToImpact).toBeLessThanOrEqual(2);
    expect(bomb.reachedTarget()).toBe(true);
    expect(hostile.troops()).toBeLessThan(troopsBefore);
    expect(game.hasFallout(target)).toBe(true);
    tickUntil(game, () => jet.aircraftState().phase === "patrolling", 100);
    expect(jet.isActive()).toBe(true);
    expect(jet.tile()).toBe(start);
  });

  it("does not let the missile cadence delay a drop", async () => {
    const { game, commander, hostile } = await overflyGame();
    buildAirport(game, commander, 10, 10);
    const target = game.ref(30, 10);
    conquerBlock(game, hostile, 26, 6, 34, 14);
    hostile.setTroops(1_000_000);
    const launch = new FighterJetExecution(commander, {
      mission: AirMissionType.CombatAirPatrol,
      targetTile: game.ref(10, 10),
    });
    game.addExecution(launch);
    game.executeNextTick();
    const jet = commander.units(UnitType.FighterJet)[0];
    tickUntil(game, () => jet.aircraftState().phase === "patrolling", 100);
    // The jet loiters right over the strike point and has "just fired" a
    // missile: the old three-tick cadence gate would have held the drop.
    jet.move(target);
    const sortie = (
      launch as unknown as { childSorties: Array<Record<string, unknown>> }
    ).childSorties[0];
    sortie.lastAttackTick = game.ticks();
    game.addExecution(
      new AirPatrolCommandExecution(
        commander,
        { mission: AirMissionType.PrecisionStrike, targetTile: target },
        1,
      ),
    );
    const commandTick = game.ticks();
    tickUntil(
      game,
      () => commander.units(UnitType.FighterBomb).length === 1,
      10,
    );
    expect(game.ticks() - commandTick).toBeLessThanOrEqual(2);
    expect(commander.units(UnitType.FighterBomb)[0].tile()).toBe(target);
    // A live missile from the same jet is unaffected by the drop.
    const hostileJet = hostile.buildUnit(
      UnitType.FighterJet,
      game.ref(40, 10),
      {
        aircraftState: {
          mission: AirMissionType.CombatAirPatrol,
          phase: "patrolling",
          homeFactoryId: 999,
          missionEndTick: Number.MAX_SAFE_INTEGER,
          ammo: 2,
          targetedBySam: false,
          patrolAnchorTile: game.ref(40, 10),
          commandRevision: 0,
        },
        targetTile: game.ref(40, 10),
      },
    );
    const shot = new FighterMissileExecution(commander, jet, hostileJet);
    game.addExecution(shot);
    tickUntil(game, () => !shot.isActive(), 20);
    expect(hostileJet.isActive()).toBe(false);
  });

  it("drops a direct Airport strike over the target as well", async () => {
    const { game, commander, hostile } = await overflyGame();
    buildAirport(game, commander, 10, 10);
    const target = game.ref(50, 30);
    conquerBlock(game, hostile, 46, 26, 54, 34);
    hostile.setTroops(1_000_000);
    game.addExecution(
      new FighterJetExecution(
        commander,
        {
          mission: AirMissionType.PrecisionStrike,
          targetTile: target,
          aircraftType: AircraftType.F16,
        },
        1,
      ),
    );
    game.executeNextTick();
    const jet = commander.units(UnitType.FighterJet)[0];
    tickUntil(game, () => commander.units(UnitType.FighterBomb).length === 1);
    expect(jet.tile()).toBe(target);
    expect(commander.units(UnitType.FighterBomb)[0].tile()).toBe(target);
    tickUntil(game, () => commander.units(UnitType.FighterBomb).length === 0);
    expect(hostile.troops()).toBe(900_000);
  });
});
