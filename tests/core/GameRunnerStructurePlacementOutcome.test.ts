import { describe, expect, test } from "vitest";
import { Executor } from "../../src/core/execution/ExecutionManager";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../../src/core/game/Game";
import type { GameUpdateViewData } from "../../src/core/game/GameUpdates";
import { GameRunner } from "../../src/core/GameRunner";
import type { StampedIntent } from "../../src/core/Schemas";
import { setup } from "../util/Setup";

const gameID = "structure-outcome-game";
const clientID = "structure-outcome-client";

async function outcomeRunner(): Promise<{
  game: Game;
  player: Player;
  runTurn: (intents?: StampedIntent[]) => void;
  updates: GameUpdateViewData[];
}> {
  const info = new PlayerInfo(
    "builder",
    PlayerType.Human,
    clientID,
    "structure-outcome-player",
  );
  const game = await setup(
    "half_land_half_ocean",
    { infiniteGold: false, instantBuild: true },
    [info],
  );
  const player = game.player(info.id);
  player.addGold(100_000_000n);
  const updates: GameUpdateViewData[] = [];
  const runner = new GameRunner(
    game,
    new Executor(game, gameID, clientID),
    (update) => {
      if (!("errMsg" in update)) updates.push(update);
    },
  );
  let turnNumber = 0;
  return {
    game,
    player,
    updates,
    runTurn: (intents = []) => {
      runner.addTurn({ intents, turnNumber: turnNumber++ });
      expect(runner.executeNextTick()).toBe(true);
    },
  };
}

describe("GameRunner structure placement outcomes", () => {
  test("reports the exact accepted turn intent only when execution builds", async () => {
    const { game, player, runTurn, updates } = await outcomeRunner();
    const tile = game.ref(7, 10);
    player.conquer(tile);
    runTurn([
      {
        amount: 1,
        clientID,
        rocketDirectionUp: false,
        tile,
        type: "build_unit",
        unit: UnitType.City,
      },
    ]);
    expect(
      updates[updates.length - 1]?.structurePlacementOutcomes,
    ).toBeUndefined();

    runTurn();
    expect(updates[updates.length - 1]?.structurePlacementOutcomes).toEqual([
      {
        clientID,
        intentIndex: 0,
        outcome: "accepted",
        spawnTile: tile,
        tile,
        turnNumber: 0,
        unitID: expect.any(Number),
        unitType: UnitType.City,
      },
    ]);
    expect(player.units(UnitType.City)).toHaveLength(1);
  });

  test("reports a definitive rejection without creating a structure", async () => {
    const { game, player, runTurn, updates } = await outcomeRunner();
    const unownedTile = game.ref(1, 1);
    runTurn([
      {
        amount: 1,
        clientID,
        rocketDirectionUp: false,
        tile: unownedTile,
        type: "build_unit",
        unit: UnitType.City,
      },
    ]);
    runTurn();

    expect(updates[updates.length - 1]?.structurePlacementOutcomes).toEqual([
      {
        clientID,
        intentIndex: 0,
        outcome: "rejected",
        tile: unownedTile,
        turnNumber: 0,
        unitType: UnitType.City,
      },
    ]);
    expect(player.units(UnitType.City)).toHaveLength(0);
  });
});
