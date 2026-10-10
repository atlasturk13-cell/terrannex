import { ConstructionExecution } from "../../../src/core/execution/ConstructionExecution";
import {
  Game,
  GameMapType,
  GameType,
  Player,
  PlayerInfo,
  PlayerType,
  STRUCTURE_PLACEMENT_ONLY_SENTINEL,
  Unit,
  UnitType,
} from "../../../src/core/game/Game";
import { WARSHIP_DEPARTURE_INTERVAL_TICKS } from "../../../src/core/game/NavalOperations";
import { setup } from "../../util/Setup";
import { executeTicks } from "../../util/utils";

const singletonStructures = [
  UnitType.Port,
  UnitType.MissileSilo,
  UnitType.DefensePost,
  UnitType.SAMLauncher,
  UnitType.City,
  UnitType.Factory,
] as const;

const playerInfo = new PlayerInfo(
  "builder",
  PlayerType.Human,
  null,
  "builder_id",
);
const targetInfo = new PlayerInfo(
  "target",
  PlayerType.Human,
  null,
  "target_id",
);

async function setupNavalGame(): Promise<{
  game: Game;
  player: Player;
  coast: number;
  water: number;
}> {
  const game = await setup(
    "half_land_half_ocean",
    { infiniteGold: false, instantBuild: true },
    [playerInfo],
  );
  const player = game.player(playerInfo.id);
  const coast = game.ref(7, 10);
  const water = game.ref(8, 10);
  player.conquer(coast);
  player.addGold(100_000_000n);
  return { game, player, coast, water };
}

async function setupNuclearGame(): Promise<{
  game: Game;
  player: Player;
  targetPlayer: Player;
  silo: Unit;
  target: number;
}> {
  const game = await setup(
    "big_plains",
    { infiniteGold: false, instantBuild: true },
    [playerInfo, targetInfo],
  );
  const player = game.player(playerInfo.id);
  const targetPlayer = game.player(targetInfo.id);
  const siloTile = game.ref(10, 10);
  const target = game.ref(50, 50);
  player.conquer(siloTile);
  targetPlayer.conquer(target);
  player.addGold(100_000_000n);
  const silo = player.buildUnit(UnitType.MissileSilo, siloTile, {});
  return { game, player, targetPlayer, silo, target };
}

async function setupExactDepthGame(): Promise<{
  game: Game;
  player: Player;
}> {
  const game = await setup(
    "big_plains",
    {
      depthProgression: true,
      gameMap: GameMapType.TheBox,
      gameType: GameType.Singleplayer,
      infiniteGold: false,
      instantBuild: true,
    },
    [playerInfo],
  );
  const player = game.player(playerInfo.id);
  player.addGold(100_000_000n);
  game.config().structureMinDist = () => 5;
  return { game, player };
}

describe("ConstructionExecution quantity authority", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test.each(singletonStructures)(
    "rejects amount > 1 for singleton structure %s without mutation",
    async (type) => {
      const { game, player, coast } = await setupNavalGame();
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const goldBefore = player.gold();
      const unitsBefore = player.units(type).length;
      const constructedBefore = player.unitsConstructed(type);

      game.addExecution(
        new ConstructionExecution(player, type, coast, undefined, 2),
      );
      executeTicks(game, 4);

      expect(player.gold()).toBe(goldBefore);
      expect(player.units(type)).toHaveLength(unitsBefore);
      expect(player.unitsConstructed(type)).toBe(constructedBefore);
    },
  );

  test("builds every requested Warship from one order, each paying its own price", async () => {
    const { game, player, coast, water } = await setupNavalGame();
    player.buildUnit(UnitType.Port, coast, {});
    const goldBefore = player.gold();
    const constructedBefore = player.unitsConstructed(UnitType.Warship);
    const singleCost = game.unitInfo(UnitType.Warship).cost(game, player, 0);

    game.addExecution(
      new ConstructionExecution(player, UnitType.Warship, water, undefined, 3),
    );
    // The ships of one order leave WARSHIP_DEPARTURE_INTERVAL_TICKS apart.
    executeTicks(game, 2 + 2 * WARSHIP_DEPARTURE_INTERVAL_TICKS);

    expect(player.units(UnitType.Warship)).toHaveLength(3);
    expect(player.unitsConstructed(UnitType.Warship)).toBe(
      constructedBefore + 3,
    );
    expect(goldBefore - player.gold()).toBeGreaterThanOrEqual(singleCost * 3n);
  });

  test("launches one MIRV per ready silo from one order and fails the rest closed", async () => {
    const { game, player, silo, target } = await setupNuclearGame();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const secondSiloTile = game.ref(20, 10);
    player.conquer(secondSiloTile);
    const secondSilo = player.buildUnit(
      UnitType.MissileSilo,
      secondSiloTile,
      {},
    );
    const goldBefore = player.gold();
    const constructedBefore = player.unitsConstructed(UnitType.MIRV);
    const singleCost = game.unitInfo(UnitType.MIRV).cost(game, player, 0);

    game.addExecution(
      new ConstructionExecution(player, UnitType.MIRV, target, undefined, 3),
    );
    executeTicks(game, 5);

    expect(player.units(UnitType.MIRV)).toHaveLength(2);
    expect(player.unitsConstructed(UnitType.MIRV)).toBe(constructedBefore + 2);
    expect(silo.missileTimerQueue()).toHaveLength(1);
    expect(secondSilo.missileTimerQueue()).toHaveLength(1);
    // The third MIRV had no ready silo: no unit, no gold, no cooldown.
    expect(goldBefore - player.gold()).toBeGreaterThanOrEqual(singleCost * 2n);
    expect(goldBefore - player.gold()).toBeLessThan(singleCost * 3n);
  });

  test("rejects a stale MIRV x1 without mutating diplomacy or launch state", async () => {
    const { game, player, targetPlayer, silo, target } =
      await setupNuclearGame();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const request = player.createAllianceRequest(targetPlayer);
    expect(request).not.toBeNull();
    request!.accept();
    expect(player.isAlliedWith(targetPlayer)).toBe(true);

    // Simulate a chooser result becoming stale before authoritative execution.
    silo.launch();
    const goldBefore = player.gold();
    const queueBefore = [...silo.missileTimerQueue()];
    const constructedBefore = player.unitsConstructed(UnitType.MIRV);
    const playerRelationBefore = player.relation(targetPlayer);
    const targetRelationBefore = targetPlayer.relation(player);
    const betrayalsBefore = player.betrayals();

    game.addExecution(
      new ConstructionExecution(player, UnitType.MIRV, target, undefined, 1),
    );
    executeTicks(game, 5);

    expect(player.gold()).toBe(goldBefore);
    expect(player.units(UnitType.MIRV)).toHaveLength(0);
    expect(player.unitsConstructed(UnitType.MIRV)).toBe(constructedBefore);
    expect(silo.missileTimerQueue()).toEqual(queueBefore);
    expect(player.isAlliedWith(targetPlayer)).toBe(true);
    expect(player.relation(targetPlayer)).toBe(playerRelationBefore);
    expect(targetPlayer.relation(player)).toBe(targetRelationBefore);
    expect(player.betrayals()).toBe(betrayalsBefore);
  });

  test("keeps a missing amount compatible with one singleton construction", async () => {
    const { game, player, coast } = await setupNavalGame();
    const cost = game.unitInfo(UnitType.City).cost(game, player);
    const goldBefore = player.gold();

    game.addExecution(new ConstructionExecution(player, UnitType.City, coast));
    executeTicks(game, 3);

    expect(player.units(UnitType.City)).toHaveLength(1);
    expect(player.unitsConstructed(UnitType.City)).toBe(1);
    expect(player.gold()).toBe(goldBefore - cost);
  });

  test("keeps a missing amount compatible with one Warship", async () => {
    const { game, player, coast, water } = await setupNavalGame();
    player.buildUnit(UnitType.Port, coast, {});
    const cost = game.unitInfo(UnitType.Warship).cost(game, player);
    const goldBefore = player.gold();

    game.addExecution(
      new ConstructionExecution(player, UnitType.Warship, water),
    );
    executeTicks(game, 4);

    expect(player.units(UnitType.Warship)).toHaveLength(1);
    expect(player.unitsConstructed(UnitType.Warship)).toBe(1);
    expect(player.gold()).toBe(goldBefore - cost);
  });

  test("keeps a missing amount compatible with one MIRV", async () => {
    const { game, player, silo, target } = await setupNuclearGame();
    const cost = game.unitInfo(UnitType.MIRV).cost(game, player);
    const goldBefore = player.gold();

    game.addExecution(new ConstructionExecution(player, UnitType.MIRV, target));
    executeTicks(game, 5);

    expect(player.units(UnitType.MIRV)).toHaveLength(1);
    expect(player.unitsConstructed(UnitType.MIRV)).toBe(1);
    expect(player.gold()).toBe(goldBefore - cost);
    expect(silo.missileTimerQueue()).toHaveLength(1);
  });

  test.each([UnitType.AtomBomb, UnitType.HydrogenBomb])(
    "preserves valid batching for %s",
    async (type) => {
      const { game, player, silo, target } = await setupNuclearGame();
      silo.increaseLevel();
      silo.reloadMissile();
      const cost = game.unitInfo(type).cost(game, player);
      const goldBefore = player.gold();

      game.addExecution(
        new ConstructionExecution(player, type, target, undefined, 2),
      );
      executeTicks(game, 5);

      expect(player.units(type)).toHaveLength(2);
      expect(player.unitsConstructed(type)).toBe(2);
      expect(player.gold()).toBe(goldBefore - cost * 2n);
      expect(silo.missileTimerQueue()).toHaveLength(2);
    },
  );

  test.each([UnitType.AtomBomb, UnitType.HydrogenBomb])(
    "launches %s toward each explicit user-selected target",
    async (type) => {
      const { game, player, targetPlayer, silo, target } =
        await setupNuclearGame();
      const secondTarget = game.ref(55, 55);
      targetPlayer.conquer(secondTarget);
      silo.increaseLevel();
      silo.reloadMissile();

      game.addExecution(
        new ConstructionExecution(player, type, target, true, 2, [
          target,
          secondTarget,
        ]),
      );
      executeTicks(game, 5);

      expect(
        player
          .units(type)
          .map((unit) => unit.targetTile())
          .sort((a, b) => (a ?? 0) - (b ?? 0)),
      ).toEqual([target, secondTarget].sort((a, b) => a - b));
    },
  );

  test("rejects a mismatched explicit rocket target list before mutation", async () => {
    const { game, player, silo, target } = await setupNuclearGame();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    silo.increaseLevel();
    silo.reloadMissile();
    const goldBefore = player.gold();
    const queueBefore = [...silo.missileTimerQueue()];

    game.addExecution(
      new ConstructionExecution(player, UnitType.AtomBomb, target, true, 2, [
        target,
      ]),
    );
    executeTicks(game, 3);

    expect(player.units(UnitType.AtomBomb)).toHaveLength(0);
    expect(player.gold()).toBe(goldBefore);
    expect(silo.missileTimerQueue()).toEqual(queueBefore);
  });

  test("placement-only construction builds the exact resolved tile", async () => {
    const { game, player } = await setupExactDepthGame();
    for (let x = 30; x <= 35; x++) player.conquer(game.ref(x, 30));
    const clicked = game.ref(30, 30);
    const resolved = game.ref(35, 30);
    player.buildUnit(UnitType.City, clicked, {});
    expect(player.canBuild(UnitType.Factory, clicked)).toBe(resolved);
    expect(player.canBuildExact(UnitType.Factory, resolved)).toBe(resolved);
    const execution = new ConstructionExecution(
      player,
      UnitType.Factory,
      resolved,
      STRUCTURE_PLACEMENT_ONLY_SENTINEL,
      1,
    );

    game.addExecution(execution);
    executeTicks(game, 3);

    expect(execution.placementOutcome()).toBe("accepted");
    expect(execution.placementSpawnTile()).toBe(resolved);
    expect(player.units(UnitType.Factory).map((unit) => unit.tile())).toEqual([
      resolved,
    ]);
  });

  test("placement-only race rejects without upgrading or debiting", async () => {
    const { game, player } = await setupExactDepthGame();
    const target = game.ref(30, 30);
    player.conquer(target);
    expect(player.canBuildExact(UnitType.City, target)).toBe(target);
    const existing = player.buildUnit(UnitType.City, target, {});
    const goldBefore = player.gold();
    const constructedBefore = player.unitsConstructed(UnitType.City);
    const execution = new ConstructionExecution(
      player,
      UnitType.City,
      target,
      STRUCTURE_PLACEMENT_ONLY_SENTINEL,
      1,
    );

    game.addExecution(execution);
    executeTicks(game, 3);

    expect(execution.placementOutcome()).toBe("rejected");
    expect(player.units(UnitType.City)).toEqual([existing]);
    expect(existing.level()).toBe(1);
    expect(player.gold()).toBe(goldBefore);
    expect(player.unitsConstructed(UnitType.City)).toBe(constructedBefore);
  });

  test("legacy colocated structure intent keeps its replay upgrade behavior", async () => {
    const { game, player } = await setupExactDepthGame();
    const target = game.ref(30, 30);
    player.conquer(target);
    const existing = player.buildUnit(UnitType.City, target, {});
    const constructedBefore = player.unitsConstructed(UnitType.City);

    game.addExecution(
      new ConstructionExecution(player, UnitType.City, target, undefined, 1),
    );
    executeTicks(game, 3);

    expect(existing.level()).toBe(2);
    expect(player.units(UnitType.City)).toEqual([existing]);
    expect(player.unitsConstructed(UnitType.City)).toBe(constructedBefore + 1);
  });
});
