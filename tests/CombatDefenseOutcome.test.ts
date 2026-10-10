import { Config } from "../src/core/configuration/Config";
import { AttackExecution } from "../src/core/execution/AttackExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  TerraNullius,
  UnitType,
} from "../src/core/game/Game";
import { TileRef } from "../src/core/game/GameMap";
import { setup } from "./util/Setup";
import { TestConfig } from "./util/TestConfig";

const ATTACK_TICKS = 20;

interface CombatOutcome {
  dispatchedTroops: number;
  attackerTilesGained: number;
  defenderTilesLost: number;
  remainingAttackTroops: number;
  attackerTroops: number;
  defenderTroops: number;
  attackStillActive: boolean;
}

class ProductionAttackConfig extends TestConfig {
  override attackLogic(
    game: Game,
    attackTroops: number,
    attacker: Player,
    defender: Player | TerraNullius,
    tileToConquer: TileRef,
  ) {
    return Config.prototype.attackLogic.call(
      this,
      game,
      attackTroops,
      attacker,
      defender,
      tileToConquer,
    );
  }

  override attackTilesPerTick(
    attackTroops: number,
    attacker: Player,
    defender: Player | TerraNullius,
    numAdjacentTilesWithEnemy: number,
  ): number {
    return Config.prototype.attackTilesPerTick.call(
      this,
      attackTroops,
      attacker,
      defender,
      numAdjacentTilesWithEnemy,
    );
  }
}

async function runCombat(defended: boolean): Promise<CombatOutcome> {
  const attackerInfo = new PlayerInfo(
    "Attacker",
    PlayerType.Human,
    "AtkCli01",
    "Attacker",
  );
  const defenderInfo = new PlayerInfo(
    "Defender",
    PlayerType.Human,
    "DefCli01",
    "Defender",
  );
  const game = await setup(
    "plains",
    { instantBuild: true },
    [attackerInfo, defenderInfo],
    undefined,
    ProductionAttackConfig,
  );
  const attacker = game.player(attackerInfo.id);
  const defender = game.player(defenderInfo.id);

  // Two equal rectangles share one long, deterministic front. They are large
  // enough that the defender cannot hit the small-player annexation shortcut.
  for (let y = 30; y < 70; y++) {
    for (let x = 10; x < 30; x++) attacker.conquer(game.ref(x, y));
    for (let x = 30; x < 50; x++) defender.conquer(game.ref(x, y));
  }
  attacker.addTroops(75_000);
  defender.addTroops(75_000);

  if (defended) {
    defender.buildUnit(UnitType.DefensePost, game.ref(35, 50), {});
  }

  const attackerTilesBefore = attacker.numTilesOwned();
  const defenderTilesBefore = defender.numTilesOwned();
  const attackerTroopsBefore = attacker.troops();
  game.addExecution(new AttackExecution(null, attacker, defender.id()));

  // The first tick initializes the production execution and dispatches troops;
  // subsequent ticks progressively resolve the border capture.
  game.executeNextTick();
  const dispatchedTroops = attacker.outgoingAttacks()[0]?.troops() ?? 0;
  for (let tick = 0; tick < ATTACK_TICKS; tick++) game.executeNextTick();

  const attack = attacker.outgoingAttacks()[0];
  const outcome = {
    dispatchedTroops,
    attackerTilesGained: attacker.numTilesOwned() - attackerTilesBefore,
    defenderTilesLost: defenderTilesBefore - defender.numTilesOwned(),
    remainingAttackTroops: attack?.troops() ?? 0,
    attackerTroops: attacker.troops(),
    defenderTroops: defender.troops(),
    attackStillActive: attack?.isActive() ?? false,
  };

  expect(dispatchedTroops).toBe(attackerTroopsBefore / 5);
  expect(outcome.attackerTilesGained).toBeGreaterThan(0);
  expect(outcome.defenderTilesLost).toBe(outcome.attackerTilesGained);
  for (const value of Object.values(outcome)) {
    if (typeof value === "number") {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
    }
  }
  return outcome;
}

describe("production combat and defense outcome", () => {
  it("makes an in-range Defense Post measurably slow the same progressive attack", async () => {
    const open = await runCombat(false);
    const defended = await runCombat(true);
    const openRepeat = await runCombat(false);
    const defendedRepeat = await runCombat(true);

    expect(openRepeat).toEqual(open);
    expect(defendedRepeat).toEqual(defended);
    expect(open.attackStillActive).toBe(true);
    expect(defended.attackStillActive).toBe(true);
    expect(open.attackerTilesGained).toBe(72);
    expect(defended.attackerTilesGained).toBe(25);
    expect(defended.attackerTilesGained).toBeLessThan(open.attackerTilesGained);
    expect(defended.remainingAttackTroops).toBeLessThan(
      open.remainingAttackTroops,
    );
    expect(defended.defenderTroops).toBeGreaterThan(open.defenderTroops);
  });
});
