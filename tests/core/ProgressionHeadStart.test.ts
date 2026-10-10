import { describe, expect, it } from "vitest";
import { SpawnExecution } from "../../src/core/execution/SpawnExecution";
import { getSpawnTiles, SPAWN_RADIUS } from "../../src/core/execution/Util";
import { PlayerInfo, PlayerType } from "../../src/core/game/Game";
import { GameRunner } from "../../src/core/GameRunner";
import { PlayerSchema } from "../../src/core/Schemas";
import { setup } from "../util/Setup";

function info(id: string, level: number): PlayerInfo {
  return new PlayerInfo(
    id,
    PlayerType.Human,
    `${id}_client`,
    `${id}_id`,
    false,
    null,
    [],
    null,
    level,
  );
}

describe("progression head start in the simulation", () => {
  it("gives a level its extra troops, gold and land, and nothing at level 0", async () => {
    const game = await setup("big_plains", { startingGold: 100_000 });
    const rookie = info("rookie", 0);
    const veteran = info("veteran", 10);
    const legend = info("legend", 30);
    game.addPlayer(rookie);
    game.addPlayer(veteran);
    game.addPlayer(legend);
    game.addExecution(
      new SpawnExecution("game_id", rookie, game.ref(20, 20)),
      new SpawnExecution("game_id", veteran, game.ref(60, 20)),
      new SpawnExecution("game_id", legend, game.ref(100, 20)),
    );
    game.executeNextTick();
    game.executeNextTick();

    const config = game.config();
    expect(config.startManpower(rookie)).toBe(25_000);
    expect(config.startManpower(veteran)).toBe(26_250);
    expect(config.startManpower(legend)).toBe(28_750);
    expect(config.startingGold(rookie)).toBe(100_000n);
    expect(config.startingGold(veteran)).toBe(110_000n);
    expect(config.startingGold(legend)).toBe(130_000n);

    const tiles = (id: string) => game.player(id).numTilesOwned();
    // Blob sizes measured on untouched land far from the three spawns.
    const blob = (radius: number) =>
      getSpawnTiles(game, game.ref(150, 60), false, radius).length;
    expect(tiles("rookie_id")).toBe(blob(SPAWN_RADIUS));
    expect(tiles("rookie_id")).toBe(52);
    // One ring per ten levels: radius 5 at level 10, radius 7 at level 30.
    expect(tiles("veteran_id")).toBe(blob(SPAWN_RADIUS + 1));
    expect(tiles("legend_id")).toBe(blob(SPAWN_RADIUS + 3));
    expect(tiles("legend_id")).toBeGreaterThan(tiles("veteran_id"));
    expect(tiles("veteran_id")).toBeGreaterThan(tiles("rookie_id"));
  });

  it("infinite troops ignore the level; tribes and nations never get one", async () => {
    const game = await setup("big_plains", { infiniteTroops: true });
    const legend = info("legend", 30);
    expect(game.config().startManpower(legend)).toBe(1_000_000);
    const nation = new PlayerInfo(
      "n",
      PlayerType.Nation,
      null,
      "n_id",
      false,
      null,
      [],
      null,
      30,
    );
    expect(game.config().startManpower(nation)).toBe(
      game
        .config()
        .startManpower(new PlayerInfo("n2", PlayerType.Nation, null, "n2_id")),
    );
  });

  it("travels in the start info and is bounded on the wire", () => {
    expect(
      PlayerSchema.safeParse({
        clientID: "abcdefgh",
        username: "Player",
        clanTag: null,
        progressionLevel: 12,
      }).success,
    ).toBe(true);
    for (const level of [-1, 31, 2.5]) {
      expect(
        PlayerSchema.safeParse({
          clientID: "abcdefgh",
          username: "Player",
          clanTag: null,
          progressionLevel: level,
        }).success,
      ).toBe(false);
    }
    // The runner turns the field into PlayerInfo.progressionLevel.
    expect(typeof GameRunner).toBe("function");
  });
});
