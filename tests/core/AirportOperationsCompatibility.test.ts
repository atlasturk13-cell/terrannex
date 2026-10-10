import { FighterJetExecution } from "../../src/core/execution/FighterJetExecution";
import {
  AirMissionType,
  GameMapType,
  GameType,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../../src/core/game/Game";
import { GameStartInfo } from "../../src/core/Schemas";
import { toWireGameStartInfo } from "../../src/core/Util";
import { setup } from "../util/Setup";

const playerInfo = new PlayerInfo(
  "legacy airport probe",
  PlayerType.Human,
  "LEGACY01",
  "legacy-airport-probe-id",
);

function startInfo(config: Record<string, unknown>): GameStartInfo {
  return {
    gameID: "AIRPORT1",
    lobbyCreatedAt: 0,
    config,
    players: [],
  } as unknown as GameStartInfo;
}

describe("Airport operations replay compatibility", () => {
  it("preserves admitted recorded flags and strips stale copies without mutation", () => {
    const admitted = startInfo({
      airportOperationsV1: true,
      airSuperiorityV1: true,
      combinedArmsV1: true,
      combinedArmsV2: true,
      gameType: GameType.Singleplayer,
      gameMap: GameMapType.NaturalEarthWorld,
    });
    expect(toWireGameStartInfo(admitted)).toBe(admitted);

    for (const config of [
      {
        airportOperationsV1: true,
        gameType: GameType.Public,
        gameMap: GameMapType.NaturalEarthWorld,
      },
      {
        airportOperationsV1: true,
        gameType: GameType.Singleplayer,
        gameMap: GameMapType.World,
      },
      {
        airportOperationsV1: true,
        airSuperiorityV1: true,
        combinedArmsV1: true,
        combinedArmsV2: false,
        gameType: GameType.Singleplayer,
        gameMap: GameMapType.NaturalEarthWorld,
      },
    ]) {
      const stale = startInfo(config);
      const wire = toWireGameStartInfo(stale);
      expect(wire).not.toBe(stale);
      expect(wire.config.airportOperationsV1).toBeUndefined();
      expect(stale.config.airportOperationsV1).toBe(true);
    }
  });

  it("keeps the legacy Factory path and rejects a forged three-sortie order atomically", async () => {
    const game = await setup(
      "big_plains",
      {
        airSuperiorityV1: true,
        combinedArmsV1: true,
        combinedArmsV2: true,
        gameMap: GameMapType.NaturalEarthWorld,
        instantBuild: true,
      },
      [playerInfo],
    );
    const player = game.player(playerInfo.id);
    player.addGold(50_000_000n);
    const factories = [10, 30, 50].map((x) => {
      const tile = game.ref(x, 10);
      player.conquer(tile);
      return player.buildUnit(UnitType.Factory, tile, {});
    });
    const goldBefore = player.gold();

    game.addExecution(
      new FighterJetExecution(
        player,
        {
          mission: AirMissionType.CombatAirPatrol,
          targetTile: game.ref(100, 100),
        },
        3,
      ),
    );
    game.executeNextTick();

    expect(game.config().airportOperationsV1Enabled()).toBe(false);
    expect(game.config().fighterAttackCooldown()).toBe(6);
    expect(game.config().fighterMissileSpeed()).toBe(9);
    expect(player.units(UnitType.FighterJet)).toHaveLength(0);
    expect(
      factories.every((factory) => factory.missileTimerQueue().length === 0),
    ).toBe(true);
    expect(player.gold()).toBe(goldBefore);
  });
});
