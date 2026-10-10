import { AirPatrolCommandExecution } from "../../../src/core/execution/AirPatrolCommandExecution";
import { FighterBombExecution } from "../../../src/core/execution/FighterBombExecution";
import { FighterJetExecution } from "../../../src/core/execution/FighterJetExecution";
import { aircraftProfile } from "../../../src/core/game/AircraftProfiles";
import {
  AircraftType,
  AirMissionType,
  Difficulty,
  Game,
  GameMapType,
  MessageType,
  Player,
  PlayerInfo,
  PlayerType,
  Unit,
  UnitType,
} from "../../../src/core/game/Game";
import { TileRef } from "../../../src/core/game/GameMap";
import {
  AirStrikeEventUpdate,
  GameUpdateType,
} from "../../../src/core/game/GameUpdates";
import { setup } from "../../util/Setup";

const commanderInfo = new PlayerInfo(
  "raze commander",
  PlayerType.Human,
  "RAZE0001",
  "raze-commander-id",
);
const hostileInfo = new PlayerInfo(
  "raze hostile",
  PlayerType.Human,
  "RAZE0002",
  "raze-hostile-id",
);
const allyInfo = new PlayerInfo(
  "raze ally",
  PlayerType.Human,
  "RAZE0003",
  "raze-ally-id",
);

async function razeGame(): Promise<{
  game: Game;
  commander: Player;
  hostile: Player;
  ally: Player;
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
    [commanderInfo, hostileInfo, allyInfo],
  );
  const commander = game.player(commanderInfo.id);
  const hostile = game.player(hostileInfo.id);
  const ally = game.player(allyInfo.id);
  commander.addGold(100_000_000n);
  hostile.addGold(100_000_000n);
  return { game, commander, hostile, ally };
}

function buildAirport(game: Game, owner: Player, x = 10, y = 10): Unit {
  const tile = game.ref(x, y);
  owner.conquer(tile);
  return owner.buildUnit(UnitType.Airport, tile, {});
}

/** Give `owner` every tile of the square [x0..x1] × [y0..y1]. */
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

function discTiles(game: Game, center: TileRef, radius: number): TileRef[] {
  const tiles: TileRef[] = [];
  const cx = game.x(center);
  const cy = game.y(center);
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy <= radius * radius) {
        tiles.push(game.ref(cx + dx, cy + dy));
      }
    }
  }
  return tiles;
}

function launchStrike(
  game: Game,
  owner: Player,
  targetTile: TileRef,
  aircraftType: AircraftType,
  amount = 1,
): void {
  game.addExecution(
    new FighterJetExecution(
      owner,
      { mission: AirMissionType.PrecisionStrike, targetTile, aircraftType },
      amount,
    ),
  );
  game.executeNextTick();
}

function airbornePatrol(
  game: Game,
  owner: Player,
  tile: TileRef,
  aircraftType?: AircraftType,
): Unit {
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

function recordStrikes(game: Game): AirStrikeEventUpdate[] {
  const strikes: AirStrikeEventUpdate[] = [];
  const addUpdate = game.addUpdate.bind(game);
  vi.spyOn(game, "addUpdate").mockImplementation((update) => {
    if (update.type === GameUpdateType.AirStrikeEvent) strikes.push(update);
    addUpdate(update);
  });
  return strikes;
}

function tickUntil(game: Game, condition: () => boolean, maximum = 300): void {
  for (let i = 0; i < maximum && !condition(); i++) game.executeNextTick();
  expect(condition()).toBe(true);
}

describe("Air strike razing", () => {
  afterEach(() => vi.restoreAllMocks());

  it("razes an F-16 disc of radius two into unowned fallout without capturing", async () => {
    const { game, commander, hostile } = await razeGame();
    buildAirport(game, commander);
    const target = game.ref(120, 20);
    conquerBlock(game, hostile, 114, 14, 126, 26);
    hostile.setTroops(1_000_000);
    const tilesBefore = hostile.numTilesOwned();
    // Razing is a ground effect: an airborne unit over the crater only takes
    // the bounded conventional area hit.
    const overflyingJet = airbornePatrol(game, hostile, game.ref(121, 20));
    const strikes = recordStrikes(game);

    launchStrike(game, commander, target, AircraftType.F16);
    tickUntil(game, () => commander.units(UnitType.FighterBomb).length === 1);
    const bomb = commander.units(UnitType.FighterBomb)[0];
    tickUntil(game, () => !bomb.isActive());

    expect(overflyingJet.isActive()).toBe(true);
    expect(overflyingJet.health()).toBe(150);
    const disc = discTiles(
      game,
      target,
      aircraftProfile(AircraftType.F16).razeRadius,
    );
    expect(disc).toHaveLength(13);
    for (const tile of disc) {
      expect(game.hasOwner(tile)).toBe(false);
      expect(game.hasFallout(tile)).toBe(true);
      expect(game.isLand(tile)).toBe(true);
    }
    for (const tile of [
      game.ref(123, 20),
      game.ref(120, 23),
      game.ref(122, 22),
      game.ref(118, 18),
    ]) {
      expect(game.owner(tile)).toBe(hostile);
      expect(game.hasFallout(tile)).toBe(false);
    }
    expect(hostile.numTilesOwned()).toBe(tilesBefore - 13);
    expect(commander.numTilesOwned()).toBe(1);
    expect(hostile.troops()).toBe(900_000);
    expect(strikes).toHaveLength(1);
    expect(strikes[0]).toMatchObject({
      attacker: commander.id(),
      target: hostile.id(),
      tile: target,
      troops: 100_000,
      structures: 0,
      tilesRazed: 13,
      aircraftType: AircraftType.F16,
    });
  });

  it("razes a wider B-2 disc, kills hostile ground units on it and spares the rest", async () => {
    const { game, commander, hostile } = await razeGame();
    buildAirport(game, commander);
    const target = game.ref(120, 40);
    conquerBlock(game, hostile, 112, 32, 128, 48);
    hostile.setTroops(1_000_000);
    const razedCity = hostile.buildUnit(UnitType.City, game.ref(123, 40), {});
    const razedSam = hostile.buildUnit(
      UnitType.SAMLauncher,
      game.ref(120, 44),
      {},
    );
    const survivingPost = hostile.buildUnit(
      UnitType.DefensePost,
      game.ref(126, 40),
      {},
    );
    const strikes = recordStrikes(game);

    launchStrike(game, commander, target, AircraftType.B2);
    tickUntil(game, () => commander.units(UnitType.FighterBomb).length === 1);
    const bomb = commander.units(UnitType.FighterBomb)[0];
    tickUntil(game, () => !bomb.isActive());

    const radius = aircraftProfile(AircraftType.B2).razeRadius;
    expect(radius).toBe(5);
    const disc = discTiles(game, target, radius);
    expect(disc).toHaveLength(81);
    for (const tile of disc) {
      expect(game.hasOwner(tile)).toBe(false);
      expect(game.hasFallout(tile)).toBe(true);
    }
    expect(game.owner(game.ref(126, 40))).toBe(hostile);
    expect(game.owner(game.ref(124, 44))).toBe(hostile);
    expect(razedCity.isActive()).toBe(false);
    expect(razedSam.isActive()).toBe(false);
    expect(survivingPost.isActive()).toBe(true);
    expect(strikes).toHaveLength(1);
    expect(strikes[0].tilesRazed).toBe(81);
    expect(strikes[0].structures).toBe(2);
    expect(strikes[0].troops).toBe(250_000);
  });

  it("spares own and allied land, and never turns land into water", async () => {
    const { game, commander, hostile, ally } = await razeGame();
    buildAirport(game, commander);
    const target = game.ref(120, 60);
    conquerBlock(game, hostile, 116, 56, 124, 64);
    const ownTile = game.ref(121, 60);
    const allyTile = game.ref(119, 60);
    const neutralTile = game.ref(120, 61);
    commander.conquer(ownTile);
    ally.conquer(allyTile);
    hostile.relinquish(neutralTile);
    const request = commander.createAllianceRequest(ally);
    expect(request).not.toBeNull();
    request!.accept();
    const ownPost = commander.buildUnit(UnitType.DefensePost, ownTile, {});
    hostile.setTroops(500_000);

    launchStrike(game, commander, target, AircraftType.F16);
    tickUntil(game, () => commander.units(UnitType.FighterBomb).length === 1);
    const bomb = commander.units(UnitType.FighterBomb)[0];
    tickUntil(game, () => !bomb.isActive());

    expect(bomb.reachedTarget()).toBe(true);
    expect(game.owner(ownTile)).toBe(commander);
    expect(game.hasFallout(ownTile)).toBe(false);
    expect(ownPost.isActive()).toBe(true);
    expect(game.owner(allyTile)).toBe(ally);
    expect(game.hasFallout(allyTile)).toBe(false);
    expect(game.hasOwner(neutralTile)).toBe(false);
    expect(game.hasFallout(neutralTile)).toBe(true);
    expect(game.hasOwner(target)).toBe(false);
    expect(game.hasFallout(target)).toBe(true);
    for (const tile of discTiles(game, target, 2)) {
      expect(game.isLand(tile)).toBe(true);
    }
  });

  it("lets a jet ordered before the crater still bomb the razed point", async () => {
    const { game, commander, hostile } = await razeGame();
    buildAirport(game, commander);
    const target = game.ref(120, 80);
    conquerBlock(game, hostile, 114, 74, 126, 86);
    hostile.setTroops(1_000_000);
    const strikes = recordStrikes(game);
    const incoming = vi.spyOn(game, "displayIncomingUnit");

    launchStrike(game, commander, target, AircraftType.F16);
    for (let i = 0; i < 8; i++) game.executeNextTick();
    expect(game.owner(target)).toBe(hostile);
    // A second order is accepted while the point is still hostile land.
    launchStrike(game, commander, target, AircraftType.F16);
    tickUntil(game, () => commander.units(UnitType.FighterJet).length === 2);

    tickUntil(game, () => strikes.length === 1);
    expect(game.hasOwner(target)).toBe(false);
    expect(game.hasFallout(target)).toBe(true);
    expect(hostile.troops()).toBe(900_000);
    // The later jet is still on its run over what is now a crater.
    const later = commander
      .units(UnitType.FighterJet)
      .find((jet) => jet.aircraftState().phase === "outbound");
    expect(later).toBeDefined();

    tickUntil(game, () => strikes.length === 2);
    expect(hostile.troops()).toBe(810_000);
    expect(strikes[1].target).toBe(hostile.id());
    expect(strikes[1].tile).toBe(target);
    expect(strikes[1].tilesRazed).toBe(0);
    expect(incoming).toHaveBeenLastCalledWith(
      expect.any(Number),
      expect.stringContaining("AIR STRIKE INBOUND"),
      MessageType.AIR_STRIKE_INBOUND,
      hostile.id(),
    );
  });

  it("lets a bomb released over razed ground hit its ordered victim", async () => {
    const { game, commander, hostile } = await razeGame();
    const airport = buildAirport(game, commander);
    const source = airbornePatrol(game, commander, game.ref(10, 10));
    source.updateAircraftState({ homeFactoryId: airport.id() });
    const crater = game.ref(40, 10);
    conquerBlock(game, hostile, 36, 6, 44, 14);
    hostile.setTroops(1_000_000);
    hostile.relinquish(crater);
    game.setFallout(crater, true);

    // Without a recorded victim an unowned point is not a target.
    const blind = new FighterBombExecution(commander, source, crater);
    game.addExecution(blind);
    game.executeNextTick();
    expect(blind.isActive()).toBe(false);
    expect(commander.units(UnitType.FighterBomb)).toHaveLength(0);

    const aimed = new FighterBombExecution(commander, source, crater, hostile);
    game.addExecution(aimed);
    game.executeNextTick();
    const bomb = aimed.bombUnitForTesting();
    expect(bomb?.isActive()).toBe(true);
    tickUntil(game, () => !aimed.isActive(), 30);
    expect(bomb?.reachedTarget()).toBe(true);
    expect(hostile.troops()).toBe(900_000);
    // The surrounding hostile ring is razed by this bomb.
    expect(game.hasOwner(game.ref(41, 10))).toBe(false);
    expect(game.hasFallout(game.ref(41, 10))).toBe(true);
  });

  it("keeps a patrol jet on its bomb run when an earlier jet of the order razed the point", async () => {
    const { game, commander, hostile } = await razeGame();
    buildAirport(game, commander);
    const target = game.ref(120, 100);
    conquerBlock(game, hostile, 114, 94, 126, 106);
    hostile.setTroops(1_000_000);
    game.addExecution(
      new FighterJetExecution(
        commander,
        {
          mission: AirMissionType.CombatAirPatrol,
          targetTile: game.ref(10, 10),
        },
        2,
      ),
    );
    game.executeNextTick();
    tickUntil(game, () => commander.units(UnitType.FighterJet).length === 2);
    const jets = commander.units(UnitType.FighterJet);
    expect(jets).toHaveLength(2);
    tickUntil(
      game,
      () => jets.every((jet) => jet.aircraftState().phase === "patrolling"),
      100,
    );
    jets[0].move(target);
    jets[1].move(game.ref(10, 100));
    const strikes = recordStrikes(game);

    game.addExecution(
      new AirPatrolCommandExecution(
        commander,
        { mission: AirMissionType.PrecisionStrike, targetTile: target },
        2,
      ),
    );
    tickUntil(game, () => strikes.length === 1, 100);
    expect(game.hasOwner(target)).toBe(false);
    expect(commander.units(UnitType.FighterBomb)).toHaveLength(0);
    // The distant jet has not released yet and still heads for the crater.
    expect(jets.some((jet) => jet.aircraftState().phase === "outbound")).toBe(
      true,
    );

    tickUntil(game, () => strikes.length === 2, 100);
    expect(strikes.map((strike) => strike.target)).toEqual([
      hostile.id(),
      hostile.id(),
    ]);
    expect(hostile.troops()).toBe(810_000);
    tickUntil(
      game,
      () => jets.every((jet) => jet.aircraftState().phase === "patrolling"),
      100,
    );
    expect(jets.every((jet) => jet.isActive())).toBe(true);
  });

  it("aborts over ground that became friendly and rejects a bomb on own land", async () => {
    const { game, commander, hostile } = await razeGame();
    const airport = buildAirport(game, commander);
    const source = commander.buildUnit(UnitType.FighterJet, game.ref(10, 10), {
      aircraftState: {
        mission: AirMissionType.CombatAirPatrol,
        phase: "patrolling",
        homeFactoryId: airport.id(),
        missionEndTick: Number.MAX_SAFE_INTEGER,
        ammo: 2,
        targetedBySam: false,
        patrolAnchorTile: game.ref(10, 10),
        commandRevision: 0,
      },
      targetTile: game.ref(10, 10),
    });
    const ownLand = game.ref(12, 10);
    commander.conquer(ownLand);
    const rejected = new FighterBombExecution(commander, source, ownLand);
    game.addExecution(rejected);
    game.executeNextTick();
    expect(rejected.isActive()).toBe(false);
    expect(commander.units(UnitType.FighterBomb)).toHaveLength(0);

    const target = game.ref(34, 10);
    hostile.conquer(target);
    hostile.setTroops(1_000_000);
    const bombExec = new FighterBombExecution(commander, source, target);
    game.addExecution(bombExec);
    game.executeNextTick();
    const bomb = bombExec.bombUnitForTesting()!;
    hostile.relinquish(target);
    commander.conquer(target);
    tickUntil(game, () => !bombExec.isActive(), 20);
    expect(bomb.reachedTarget()).toBe(false);
    expect(hostile.troops()).toBe(1_000_000);
    expect(game.owner(target)).toBe(commander);
  });
});
