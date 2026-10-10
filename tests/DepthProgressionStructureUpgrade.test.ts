import { describe, expect, it } from "vitest";
import { Executor } from "../src/core/execution/ExecutionManager";
import { UpgradeStructureExecution } from "../src/core/execution/UpgradeStructureExecution";
import {
  Game,
  GameMapType,
  GameType,
  Player,
  PlayerInfo,
  PlayerType,
  Unit,
  UnitType,
} from "../src/core/game/Game";
import { StampedIntentSchema } from "../src/core/Schemas";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

const DEPTH_STRUCTURES = [
  UnitType.Port,
  UnitType.City,
  UnitType.Factory,
  UnitType.MissileSilo,
  UnitType.SAMLauncher,
] as const;

interface Fixture {
  game: Game;
  player: Player;
  other: Player;
}

async function fixture(): Promise<Fixture> {
  const game = await setup("plains", {
    gameMap: GameMapType.TheBox,
    gameType: GameType.Singleplayer,
    depthProgression: true,
    instantBuild: true,
    nations: "disabled",
  });
  const playerInfo = new PlayerInfo(
    "Depth builder",
    PlayerType.Human,
    "Depth001",
    "depth-player",
  );
  const otherInfo = new PlayerInfo(
    "Other builder",
    PlayerType.Human,
    "Other001",
    "other-player",
  );
  game.addPlayer(playerInfo);
  game.addPlayer(otherInfo);
  const player = game.player(playerInfo.id);
  const other = game.player(otherInfo.id);
  player.conquer(game.ref(20, 20));
  player.conquer(game.ref(80, 80));
  other.conquer(game.ref(10, 10));
  return { game, player, other };
}

function totalUpgradeCost(
  game: Game,
  player: Player,
  type: UnitType,
  amount: number,
): bigint {
  const info = game.unitInfo(type);
  let total = 0n;
  for (let i = 0; i < amount; i++) total += info.cost(game, player, i);
  return total;
}

function upgrade(game: Game, player: Player, unit: Unit, amount: number): void {
  game.addExecution(new UpgradeStructureExecution(player, unit.id(), amount));
  game.executeNextTick();
}

function snapshot(player: Player, unit: Unit) {
  return {
    constructed: player.unitsConstructed(unit.type()),
    gold: player.gold(),
    level: unit.level(),
    queue: [...unit.missileTimerQueue()],
  };
}

describe("depth progression structure upgrades", () => {
  it.each(DEPTH_STRUCTURES)(
    "atomically raises %s from L1 to L5 and hard-stops there",
    async (type) => {
      const { game, player } = await fixture();
      player.addGold(100_000_000n);
      const unit = player.buildUnit(type, game.ref(20, 20), {});
      const total = totalUpgradeCost(game, player, type, 4);
      const goldBefore = player.gold();
      const constructedBefore = player.unitsConstructed(type);

      upgrade(game, player, unit, 4);

      expect(unit.level()).toBe(5);
      expect(player.gold()).toBe(goldBefore - total);
      expect(player.unitsConstructed(type)).toBe(constructedBefore + 4);
      if (type === UnitType.MissileSilo || type === UnitType.SAMLauncher) {
        expect(unit.missileTimerQueue()).toHaveLength(4);
      }

      const atCap = snapshot(player, unit);
      upgrade(game, player, unit, 1);
      expect(snapshot(player, unit)).toEqual(atCap);
      expect(player.canUpgradeUnit(unit)).toBe(false);
      const buildable = player
        .buildableUnits(unit.tile(), [type])
        .find((entry) => entry.type === type)!;
      expect(buildable.canUpgrade).toBe(false);
      expect(buildable.canBuild).toBe(false);
    },
  );

  it("rejects L1 amount 5 but accepts exact remaining amount 4", async () => {
    const { game, player } = await fixture();
    player.addGold(10_000_000n);
    const city = player.buildUnit(UnitType.City, game.ref(20, 20), {});
    const before = snapshot(player, city);

    upgrade(game, player, city, 5);
    expect(snapshot(player, city)).toEqual(before);

    const total = totalUpgradeCost(game, player, UnitType.City, 4);
    const goldBefore = player.gold();
    upgrade(game, player, city, 4);
    expect(city.level()).toBe(5);
    expect(player.gold()).toBe(goldBefore - total);
  });

  it("rejects an unaffordable bulk request without a partial level or spend", async () => {
    const { game, player } = await fixture();
    const city = player.buildUnit(UnitType.City, game.ref(20, 20), {});
    const total = totalUpgradeCost(game, player, UnitType.City, 4);
    player.addGold(total - 1n);
    const before = snapshot(player, city);

    upgrade(game, player, city, 4);

    expect(snapshot(player, city)).toEqual(before);
  });

  it("rejects invalid amounts, owner, marked, under-construction, stale and disabled targets", async () => {
    const invalidAmounts = [0, -1, 1.5, Number.NaN];
    for (const amount of invalidAmounts) {
      const { game, player } = await fixture();
      player.addGold(10_000_000n);
      const city = player.buildUnit(UnitType.City, game.ref(20, 20), {});
      const before = snapshot(player, city);
      upgrade(game, player, city, amount);
      expect(snapshot(player, city)).toEqual(before);
    }

    {
      const { game, player, other } = await fixture();
      player.addGold(10_000_000n);
      other.addGold(10_000_000n);
      const city = player.buildUnit(UnitType.City, game.ref(20, 20), {});
      const before = snapshot(player, city);
      upgrade(game, other, city, 1);
      expect(snapshot(player, city)).toEqual(before);
    }

    for (const mutate of [
      (unit: Unit) => unit.markForDeletion(),
      (unit: Unit) => unit.setUnderConstruction(true),
    ]) {
      const { game, player } = await fixture();
      player.addGold(10_000_000n);
      const city = player.buildUnit(UnitType.City, game.ref(20, 20), {});
      mutate(city);
      const before = snapshot(player, city);
      upgrade(game, player, city, 1);
      expect(snapshot(player, city)).toEqual(before);
    }

    {
      const { game, player } = await fixture();
      player.addGold(10_000_000n);
      const city = player.buildUnit(UnitType.City, game.ref(20, 20), {});
      (city as unknown as { _active: boolean })._active = false;
      const before = snapshot(player, city);
      upgrade(game, player, city, 1);
      expect(snapshot(player, city)).toEqual(before);
    }

    {
      const { game, player } = await fixture();
      player.addGold(10_000_000n);
      const city = player.buildUnit(UnitType.City, game.ref(20, 20), {});
      const goldBefore = player.gold();
      const constructedBefore = player.unitsConstructed(UnitType.City);
      const id = city.id();
      city.delete(false);
      game.addExecution(new UpgradeStructureExecution(player, id, 1));
      game.executeNextTick();
      expect(game.unit(id)).toBeUndefined();
      expect(player.gold()).toBe(goldBefore);
      expect(player.unitsConstructed(UnitType.City)).toBe(constructedBefore);
    }

    {
      const { game, player } = await fixture();
      player.addGold(10_000_000n);
      const silo = player.buildUnit(UnitType.MissileSilo, game.ref(20, 20), {});
      game.config().gameConfig().disabledUnits = [UnitType.MissileSilo];
      const before = snapshot(player, silo);
      upgrade(game, player, silo, 1);
      expect(snapshot(player, silo)).toEqual(before);
    }
  });

  it.each([UnitType.MissileSilo, UnitType.SAMLauncher])(
    "keeps %s queue and cooldown state unchanged on failed preflight",
    async (type) => {
      const { game, player } = await fixture();
      const unit = player.buildUnit(type, game.ref(20, 20), {});
      const total = totalUpgradeCost(game, player, type, 4);
      player.addGold(total - 1n);
      const before = snapshot(player, unit);

      upgrade(game, player, unit, 4);

      expect(snapshot(player, unit)).toEqual(before);
      expect(unit.isInCooldown()).toBe(false);
    },
  );

  it("rejects singleton build amounts, permits an authoritative x1 upgrade, blocks L5 duplicates, and permits a far structure", async () => {
    const { game, player } = await fixture();
    player.addGold(100_000_000n);
    const city = player.buildUnit(UnitType.City, game.ref(20, 20), {});
    const executor = new Executor(game, "StructD1", player.clientID()!);
    const rawBuild = (tile: number, amount?: number) => {
      const intent = StampedIntentSchema.parse({
        type: "build_unit",
        unit: UnitType.City,
        tile,
        clientID: player.clientID(),
        ...(amount === undefined ? {} : { amount }),
      });
      game.addExecution(executor.createExec(intent));
      executeTicks(game, 2);
    };

    player.removeGold(player.gold());
    const unaffordable = snapshot(player, city);
    rawBuild(city.tile());
    expect(snapshot(player, city)).toEqual(unaffordable);
    expect(player.units(UnitType.City)).toHaveLength(1);

    player.addGold(100_000_000n);
    city.setUnderConstruction(true);
    const invalidTarget = snapshot(player, city);
    rawBuild(city.tile());
    expect(snapshot(player, city)).toEqual(invalidTarget);
    expect(player.units(UnitType.City)).toHaveLength(1);
    city.setUnderConstruction(false);

    const rejectedBatch = snapshot(player, city);
    rawBuild(city.tile(), 5);
    expect(snapshot(player, city)).toEqual(rejectedBatch);
    expect(player.units(UnitType.City)).toHaveLength(1);

    const firstCost = totalUpgradeCost(game, player, UnitType.City, 1);
    const firstGold = player.gold();
    upgrade(game, player, city, 1);
    expect(city.level()).toBe(2);
    expect(player.units(UnitType.City)).toHaveLength(1);
    expect(player.gold()).toBe(firstGold - firstCost);

    upgrade(game, player, city, 3);
    expect(city.level()).toBe(5);
    const atCap = snapshot(player, city);
    rawBuild(city.tile());
    expect(snapshot(player, city)).toEqual(atCap);
    expect(player.units(UnitType.City)).toHaveLength(1);

    const farGold = player.gold();
    rawBuild(game.ref(80, 80));
    expect(player.units(UnitType.City)).toHaveLength(2);
    expect(player.gold()).toBeLessThan(farGold);
  });

  it("keeps Defense Post at honest fixed L1 with no colocated duplicate", async () => {
    const { game, player } = await fixture();
    player.addGold(10_000_000n);
    const post = player.buildUnit(UnitType.DefensePost, game.ref(20, 20), {});
    expect(player.canUpgradeUnit(post)).toBe(false);
    const before = snapshot(player, post);
    upgrade(game, player, post, 1);
    expect(snapshot(player, post)).toEqual(before);

    const executor = new Executor(game, "StructD2", player.clientID()!);
    const intent = StampedIntentSchema.parse({
      type: "build_unit",
      unit: UnitType.DefensePost,
      tile: post.tile(),
      clientID: player.clientID(),
    });
    game.addExecution(executor.createExec(intent));
    executeTicks(game, 2);
    expect(player.units(UnitType.DefensePost)).toHaveLength(1);
    expect(snapshot(player, post)).toEqual(before);
  });
});
