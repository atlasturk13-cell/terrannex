import { ConstructionExecution } from "../../../src/core/execution/ConstructionExecution";
import { Executor } from "../../../src/core/execution/ExecutionManager";
import { airDefenseCost } from "../../../src/core/game/AirDefenseProfiles";
import {
  AirDefenseSystem,
  Game,
  GameMapType,
  Player,
  PlayerInfo,
  PlayerType,
  Unit,
  UnitType,
} from "../../../src/core/game/Game";
import { setup } from "../../util/Setup";
import { executeTicks } from "../../util/utils";

const builderInfo = new PlayerInfo(
  "air defense builder",
  PlayerType.Human,
  "AIRD0001",
  "air-defense-builder-id",
);

async function builderGame(gold = 100_000_000n): Promise<{
  game: Game;
  player: Player;
}> {
  const game = await setup(
    "big_plains",
    {
      airportOperationsV1: true,
      airSuperiorityV1: true,
      combinedArmsV1: true,
      combinedArmsV2: true,
      gameMap: GameMapType.NaturalEarthWorld,
      instantBuild: true,
    },
    [builderInfo],
  );
  const player = game.player(builderInfo.id);
  for (let y = 5; y <= 15; y++) {
    for (let x = 5; x <= 130; x++) player.conquer(game.ref(x, y));
  }
  player.addGold(gold);
  return { game, player };
}

function build(
  game: Game,
  player: Player,
  x: number,
  type: UnitType,
  system?: AirDefenseSystem,
): ConstructionExecution {
  const execution = new ConstructionExecution(
    player,
    type,
    game.ref(x, 10),
    undefined,
    undefined,
    undefined,
    system,
  );
  game.addExecution(execution);
  executeTicks(game, 3);
  return execution;
}

function launcherAt(player: Player, game: Game, x: number): Unit | undefined {
  return player
    .units(UnitType.SAMLauncher)
    .find((unit) => unit.tile() === game.ref(x, 10));
}

describe("Air-defense system build", () => {
  it("builds each system at its own price and records it on the unit and its update", async () => {
    const { game, player } = await builderGame();
    const price = () => game.unitInfo(UnitType.SAMLauncher).cost(game, player);

    let base = price();
    let gold = player.gold();
    expect(
      build(
        game,
        player,
        10,
        UnitType.SAMLauncher,
        AirDefenseSystem.S500,
      ).placementOutcome(),
    ).toBe("accepted");
    const s500 = launcherAt(player, game, 10);
    expect(s500?.airDefenseSystem()).toBe(AirDefenseSystem.S500);
    expect(s500?.toUpdate().airDefenseSystem).toBe("s500");
    expect(gold - player.gold()).toBe(
      airDefenseCost(base, AirDefenseSystem.S500),
    );
    expect(gold - player.gold()).toBe(base * 2n);

    base = price();
    gold = player.gold();
    build(game, player, 40, UnitType.SAMLauncher, AirDefenseSystem.IronDome);
    const ironDome = launcherAt(player, game, 40);
    expect(ironDome?.airDefenseSystem()).toBe(AirDefenseSystem.IronDome);
    expect(gold - player.gold()).toBe(base / 2n);

    base = price();
    gold = player.gold();
    build(game, player, 70, UnitType.SAMLauncher);
    const baseline = launcherAt(player, game, 70);
    expect(baseline?.airDefenseSystem()).toBeUndefined();
    expect(baseline?.toUpdate().airDefenseSystem).toBeUndefined();
    expect(gold - player.gold()).toBe(base);
    expect(player.units(UnitType.SAMLauncher)).toHaveLength(3);
    expect(
      new Set([s500!.hash(), ironDome!.hash(), baseline!.hash()]).size,
    ).toBe(3);
  });

  it("rejects a system the player cannot afford before any mutation, while the baseline still builds", async () => {
    const { game, player } = await builderGame(0n);
    const base = game.unitInfo(UnitType.SAMLauncher).cost(game, player);
    player.addGold(base + base / 2n);
    const gold = player.gold();
    const unaffordable = build(
      game,
      player,
      10,
      UnitType.SAMLauncher,
      AirDefenseSystem.S500,
    );
    expect(unaffordable.placementOutcome()).toBe("rejected");
    expect(player.units(UnitType.SAMLauncher)).toHaveLength(0);
    expect(player.gold()).toBe(gold);

    const affordable = build(
      game,
      player,
      10,
      UnitType.SAMLauncher,
      AirDefenseSystem.HisarO,
    );
    expect(affordable.placementOutcome()).toBe("accepted");
    expect(launcherAt(player, game, 10)?.airDefenseSystem()).toBe(
      AirDefenseSystem.HisarO,
    );
    expect(gold - player.gold()).toBe((base * 60n) / 100n);
  });

  it("refuses to build any other structure as an air-defense system", async () => {
    const { game, player } = await builderGame();
    const gold = player.gold();
    for (const type of [
      UnitType.City,
      UnitType.MissileSilo,
      UnitType.DefensePost,
    ]) {
      const execution = build(game, player, 10, type, AirDefenseSystem.Patriot);
      expect(execution.placementOutcome()).toBe("rejected");
      expect(player.units(type)).toHaveLength(0);
    }
    expect(player.gold()).toBe(gold);
  });

  it("executes a stamped local build intent carrying the system", async () => {
    const { game, player } = await builderGame();
    const executor = new Executor(game, "AIRDGAME", builderInfo.clientID!);
    game.addExecution(
      executor.createExec({
        type: "build_unit",
        unit: UnitType.SAMLauncher,
        tile: game.ref(100, 10),
        airDefenseSystem: AirDefenseSystem.Patriot,
        clientID: builderInfo.clientID!,
      }),
    );
    executeTicks(game, 3);
    const patriot = launcherAt(player, game, 100);
    expect(patriot?.airDefenseSystem()).toBe(AirDefenseSystem.Patriot);
    expect(patriot?.level()).toBe(1);
  });
});
