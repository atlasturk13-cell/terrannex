import { ConstructionExecution } from "../../../src/core/execution/ConstructionExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../../../src/core/game/Game";
import { WARSHIP_DEPARTURE_INTERVAL_TICKS } from "../../../src/core/game/NavalOperations";
import { setup } from "../../util/Setup";

const playerInfo = new PlayerInfo(
  "admiral",
  PlayerType.Human,
  null,
  "admiral_id",
);

async function navalGame(): Promise<{
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
  player.buildUnit(UnitType.Port, coast, {});
  return { game, player, coast, water };
}

function warshipCount(player: Player): number {
  return player.units(UnitType.Warship).length;
}

describe("Staggered warship departure", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("ships of one order leave the port one interval apart, each paid as it leaves", async () => {
    const { game, player, water } = await navalGame();
    player.addGold(100_000_000n);
    expect(WARSHIP_DEPARTURE_INTERVAL_TICKS).toBe(5);

    const order = new ConstructionExecution(
      player,
      UnitType.Warship,
      water,
      undefined,
      3,
    );
    game.addExecution(order);
    game.executeNextTick(); // the order is initialised, nothing launched yet

    const counts: number[] = [];
    const spentAt: bigint[] = [];
    let previousGold = player.gold();
    for (let i = 0; i < 2 * WARSHIP_DEPARTURE_INTERVAL_TICKS + 2; i++) {
      game.executeNextTick();
      counts.push(warshipCount(player));
      spentAt.push(previousGold - player.gold());
      previousGold = player.gold();
    }

    // 1 on the first tick, 2 five ticks later, 3 five ticks after that.
    expect(counts).toEqual([1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3]);
    // Gold leaves only on departure ticks, at the escalating per-ship price.
    const paidTicks = spentAt
      .map((spent, index) => (spent > 0n ? index : -1))
      .filter((index) => index >= 0);
    expect(paidTicks).toEqual([0, 5, 10]);
    expect(spentAt[0]).toBe(250_000n);
    expect(spentAt[5]).toBe(500_000n);
    expect(spentAt[10]).toBe(750_000n);
    expect(order.isActive()).toBe(false);
  });

  test("a single warship still departs on the first tick and the order closes", async () => {
    const { game, player, water } = await navalGame();
    player.addGold(10_000_000n);
    const order = new ConstructionExecution(player, UnitType.Warship, water);
    game.addExecution(order);
    game.executeNextTick();
    game.executeNextTick();
    expect(warshipCount(player)).toBe(1);
    expect(order.isActive()).toBe(false);
  });

  test("losing the port after the first departure ends the order without charging the rest", async () => {
    const { game, player, water } = await navalGame();
    player.addGold(100_000_000n);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const order = new ConstructionExecution(
      player,
      UnitType.Warship,
      water,
      undefined,
      3,
    );
    game.addExecution(order);
    game.executeNextTick();
    game.executeNextTick(); // first ship out
    expect(warshipCount(player)).toBe(1);
    const goldAfterFirst = player.gold();

    for (const port of player.units(UnitType.Port)) port.delete();
    for (let i = 0; i < 3 * WARSHIP_DEPARTURE_INTERVAL_TICKS; i++) {
      game.executeNextTick();
    }

    expect(warshipCount(player)).toBe(1);
    expect(player.gold()).toBe(goldAfterFirst);
    expect(order.isActive()).toBe(false);
  });

  test("running out of gold mid-order skips the unaffordable ships without a partial charge", async () => {
    const { game, player, water } = await navalGame();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // Exactly the first two ships (250k + 500k) plus change; the third costs 750k.
    player.removeGold(player.gold());
    player.addGold(760_000n);
    const order = new ConstructionExecution(
      player,
      UnitType.Warship,
      water,
      undefined,
      3,
    );
    game.addExecution(order);
    for (let i = 0; i < 3 * WARSHIP_DEPARTURE_INTERVAL_TICKS; i++) {
      game.executeNextTick();
    }

    expect(warshipCount(player)).toBe(2);
    expect(player.gold()).toBe(10_000n);
    expect(order.isActive()).toBe(false);
  });
});
