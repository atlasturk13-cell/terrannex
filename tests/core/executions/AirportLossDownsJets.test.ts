import { AirPatrolCommandExecution } from "../../../src/core/execution/AirPatrolCommandExecution";
import { FighterJetExecution } from "../../../src/core/execution/FighterJetExecution";
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
import { GameUpdateType, UnitUpdate } from "../../../src/core/game/GameUpdates";
import { setup } from "../../util/Setup";

const commanderInfo = new PlayerInfo(
  "loss commander",
  PlayerType.Human,
  "LOSS0001",
  "loss-commander-id",
);
const hostileInfo = new PlayerInfo(
  "loss hostile",
  PlayerType.Human,
  "LOSS0002",
  "loss-hostile-id",
);

async function lossGame(): Promise<{
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

function launchPatrols(
  game: Game,
  owner: Player,
  anchor: number,
  amount: number,
  aircraftType?: AircraftType.B2,
): Unit[] {
  const before = new Set(owner.units(UnitType.FighterJet).map((u) => u.id()));
  game.addExecution(
    new FighterJetExecution(
      owner,
      {
        mission: AirMissionType.CombatAirPatrol,
        targetTile: anchor,
        ...(aircraftType === undefined ? {} : { aircraftType }),
      },
      amount,
    ),
  );
  tickUntil(
    game,
    () =>
      owner.units(UnitType.FighterJet).filter((u) => !before.has(u.id()))
        .length === amount,
  );
  return owner.units(UnitType.FighterJet).filter((u) => !before.has(u.id()));
}

function tickUntil(game: Game, condition: () => boolean, maximum = 300): void {
  for (let i = 0; i < maximum && !condition(); i++) game.executeNextTick();
  expect(condition()).toBe(true);
}

describe("Airport loss downs its jets", () => {
  afterEach(() => vi.restoreAllMocks());

  it("downs every jet attributed to a destroyed Airport and credits the destroyer", async () => {
    const { game, commander, hostile } = await lossGame();
    const alpha = buildAirport(game, commander, 10, 10);
    const bravo = buildAirport(game, commander, 60, 10);
    commander.conquer(game.ref(35, 10));
    const alphaJets = launchPatrols(game, commander, alpha.tile(), 3);
    const bravoJets = launchPatrols(game, commander, bravo.tile(), 1);
    expect(
      alphaJets.every((j) => j.aircraftState().homeFactoryId === alpha.id()),
    ).toBe(true);
    expect(bravoJets[0].aircraftState().homeFactoryId).toBe(bravo.id());
    const combatKills: number[] = [];
    const addUpdate = game.addUpdate.bind(game);
    vi.spyOn(game, "addUpdate").mockImplementation((update) => {
      if (
        update.type === GameUpdateType.Unit &&
        (update as UnitUpdate).unitType === UnitType.FighterJet &&
        (update as UnitUpdate).combatDestroyed === true
      ) {
        combatKills.push((update as UnitUpdate).id);
      }
      addUpdate(update);
    });

    alpha.delete(true, hostile);
    game.executeNextTick();

    expect(alphaJets.every((jet) => !jet.isActive())).toBe(true);
    expect(alphaJets.every((jet) => jet.wasDestroyedByEnemy())).toBe(true);
    expect(alphaJets.every((jet) => jet.destroyer() === hostile)).toBe(true);
    expect(combatKills.sort()).toEqual(alphaJets.map((j) => j.id()).sort());
    expect(bravoJets[0].isActive()).toBe(true);
    expect(commander.units(UnitType.FighterJet)).toHaveLength(1);
    for (let i = 0; i < 10; i++) game.executeNextTick();
    expect(bravoJets[0].isActive()).toBe(true);
  });

  it("brings down the enemy's patrol when a Jet Attack razes their Airport", async () => {
    const { game, commander, hostile } = await lossGame();
    buildAirport(game, commander, 10, 10);
    conquerBlock(game, hostile, 90, 40, 130, 60);
    hostile.setTroops(1_000_000);
    const enemyBase = hostile.buildUnit(
      UnitType.Airport,
      game.ref(110, 50),
      {},
    );
    const enemyJets = launchPatrols(game, hostile, game.ref(110, 50), 2);
    // Park the enemy patrol far from the blast so only the base loss matters.
    for (const jet of enemyJets) jet.move(game.ref(130, 60));
    // The enemy patrols' missiles now hit on contact, so the raider flies in
    // on a B-2 hull (1,500) that shrugs off their 300-point F-16 hits.
    const raider = launchPatrols(
      game,
      commander,
      game.ref(10, 10),
      1,
      AircraftType.B2,
    )[0];
    expect(raider.aircraftState().aircraftType).toBe(AircraftType.B2);

    game.addExecution(
      new AirPatrolCommandExecution(
        commander,
        {
          mission: AirMissionType.PrecisionStrike,
          targetTile: enemyBase.tile(),
          fighterIds: [raider.id()],
        },
        1,
      ),
    );
    tickUntil(game, () => !enemyBase.isActive(), 100);
    game.executeNextTick();

    expect(enemyJets.every((jet) => !jet.isActive())).toBe(true);
    expect(enemyJets.every((jet) => jet.destroyer() === commander)).toBe(true);
    expect(hostile.units(UnitType.FighterJet)).toHaveLength(0);
    expect(raider.isActive()).toBe(true);
    expect(raider.health()).toBeGreaterThanOrEqual(900);
  });

  it("keeps the previous owner's jets flying when the Airport is merely captured", async () => {
    const { game, commander, hostile } = await lossGame();
    const airport = buildAirport(game, commander, 10, 10);
    const jets = launchPatrols(game, commander, airport.tile(), 2);
    airport.setOwner(hostile);
    for (let i = 0; i < 10; i++) game.executeNextTick();
    expect(jets.every((jet) => jet.isActive())).toBe(true);
    expect(jets.every((jet) => jet.owner() === commander)).toBe(true);
  });

  it("downs direct-strike jets too and leaves Factory-launched legacy jets alone", async () => {
    const { game, commander, hostile } = await lossGame();
    const airport = buildAirport(game, commander, 10, 10);
    conquerBlock(game, hostile, 94, 4, 106, 16);
    hostile.setTroops(1_000_000);
    game.addExecution(
      new FighterJetExecution(
        commander,
        {
          mission: AirMissionType.PrecisionStrike,
          targetTile: game.ref(100, 10),
          aircraftType: AircraftType.B2,
        },
        1,
      ),
    );
    game.executeNextTick();
    const striker = commander.units(UnitType.FighterJet)[0];
    expect(striker.aircraftState().homeFactoryId).toBe(airport.id());
    // A jet from some other base is unaffected by this Airport's loss.
    const stranger = commander.buildUnit(
      UnitType.FighterJet,
      game.ref(20, 20),
      {
        aircraftState: {
          mission: AirMissionType.CombatAirPatrol,
          phase: "patrolling",
          homeFactoryId: 4242,
          missionEndTick: Number.MAX_SAFE_INTEGER,
          ammo: 2,
          targetedBySam: false,
          patrolAnchorTile: game.ref(20, 20),
          commandRevision: 0,
        },
        targetTile: game.ref(20, 20),
      },
    );

    airport.delete(true, hostile);
    game.executeNextTick();
    expect(striker.isActive()).toBe(false);
    expect(striker.wasDestroyedByEnemy()).toBe(true);
    expect(stranger.isActive()).toBe(true);
  });
});
