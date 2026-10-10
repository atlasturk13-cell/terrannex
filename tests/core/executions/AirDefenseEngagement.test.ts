import { SAMLauncherExecution } from "../../../src/core/execution/SAMLauncherExecution";
import {
  AircraftType,
  AirDefenseSystem,
  AirMissionType,
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

const defenderInfo = new PlayerInfo(
  "air defense defender",
  PlayerType.Human,
  "AIRE0001",
  "air-defense-defender-id",
);
const attackerInfo = new PlayerInfo(
  "air defense attacker",
  PlayerType.Human,
  "AIRE0002",
  "air-defense-attacker-id",
);

async function engagementGame(): Promise<{
  game: Game;
  defender: Player;
  attacker: Player;
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
    [defenderInfo, attackerInfo],
  );
  const defender = game.player(defenderInfo.id);
  const attacker = game.player(attackerInfo.id);
  defender.addGold(100_000_000n);
  attacker.addGold(100_000_000n);
  return { game, defender, attacker };
}

function launcher(
  game: Game,
  owner: Player,
  x: number,
  y: number,
  system?: AirDefenseSystem,
): Unit {
  const sam = owner.buildUnit(
    UnitType.SAMLauncher,
    game.ref(x, y),
    system === undefined ? {} : { airDefenseSystem: system },
  );
  game.addExecution(new SAMLauncherExecution(owner, null, sam));
  return sam;
}

function jet(
  game: Game,
  owner: Player,
  x: number,
  y: number,
  aircraftType?: AircraftType,
): Unit {
  const tile = game.ref(x, y);
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

function warhead(
  game: Game,
  owner: Player,
  type: UnitType.AtomBomb | UnitType.HydrogenBomb | UnitType.MIRVWarhead,
  x: number,
  y: number,
): Unit {
  const trajectory = [0, 1, 2].map((step) => ({
    tile: game.ref(x + step, y),
    targetable: true,
  }));
  return owner.buildUnit(type, game.ref(x, y), {
    targetTile: game.ref(x + 2, y),
    trajectory,
  });
}

describe("Air-defense engagement by system", () => {
  it("engages jets only inside the system's own radius", async () => {
    const { game, defender, attacker } = await engagementGame();
    // Iron Dome: 40 tiles. David's Sling: 60 tiles. The test curve is flat,
    // so each launcher keeps exactly its level-1 radius.
    launcher(game, defender, 100, 100, AirDefenseSystem.IronDome);
    const farFromDome = jet(game, attacker, 100, 155, AircraftType.F16);
    const nearDome = jet(game, attacker, 100, 130, AircraftType.F16);
    launcher(game, defender, 20, 100, AirDefenseSystem.DavidsSling);
    const underSling = jet(game, attacker, 20, 150, AircraftType.F16);
    executeTicks(game, 8);

    expect(farFromDome.health()).toBe(300);
    expect(farFromDome.targetedBySAM()).toBe(false);
    expect(nearDome.health()).toBe(150);
    expect(underSling.isActive()).toBe(false);
  });

  it.each([
    [AirDefenseSystem.IronDome, AircraftType.F16, 150],
    [AirDefenseSystem.PantsirS1, AircraftType.F16, 100],
    [AirDefenseSystem.HisarO, AircraftType.F16, 75],
    [AirDefenseSystem.Patriot, AircraftType.F16, 0],
    [AirDefenseSystem.S400, AircraftType.B2, 1050],
    [AirDefenseSystem.S500, AircraftType.B2, 900],
    [undefined, AircraftType.F16, 125],
  ] as const)(
    "%s hits a %s for its own interceptor damage",
    async (system, aircraftType, hullAfter) => {
      const { game, defender, attacker } = await engagementGame();
      launcher(game, defender, 60, 60, system);
      const target = jet(game, attacker, 60, 66, aircraftType);
      executeTicks(game, 4);
      if (hullAfter === 0) {
        expect(target.isActive()).toBe(false);
      } else {
        expect(target.isActive()).toBe(true);
        expect(target.health()).toBe(hullAfter);
      }
    },
  );

  it.each([
    [AirDefenseSystem.IronDome, UnitType.AtomBomb, true],
    [AirDefenseSystem.IronDome, UnitType.HydrogenBomb, false],
    [AirDefenseSystem.IronDome, UnitType.MIRVWarhead, false],
    [AirDefenseSystem.PantsirS1, UnitType.HydrogenBomb, false],
    [AirDefenseSystem.DavidsSling, UnitType.HydrogenBomb, true],
    [AirDefenseSystem.DavidsSling, UnitType.MIRVWarhead, false],
    [AirDefenseSystem.Patriot, UnitType.MIRVWarhead, true],
    [AirDefenseSystem.S500, UnitType.HydrogenBomb, true],
    [undefined, UnitType.HydrogenBomb, true],
    [undefined, UnitType.MIRVWarhead, true],
  ] as const)(
    "%s against a %s: intercepts %s",
    async (system, type, intercepts) => {
      const { game, defender, attacker } = await engagementGame();
      const sam = launcher(game, defender, 20, 20, system);
      const bomb = warhead(game, attacker, type, 21, 20);
      executeTicks(game, 4);
      expect(bomb.isActive()).toBe(!intercepts);
      expect(sam.missileTimerQueue().length).toBe(intercepts ? 1 : 0);
      if (!intercepts) {
        expect(defender.units(UnitType.SAMMissile)).toHaveLength(0);
      }
    },
  );

  it("lets only the S-500 see and down a stealth F-35", async () => {
    const blind = await engagementGame();
    launcher(blind.game, blind.defender, 60, 60, AirDefenseSystem.S400);
    const hidden = jet(blind.game, blind.attacker, 60, 66, AircraftType.F35);
    executeTicks(blind.game, 6);
    expect(hidden.isActive()).toBe(true);
    expect(hidden.health()).toBe(500);
    expect(hidden.targetedBySAM()).toBe(false);
    expect(blind.defender.units(UnitType.SAMMissile)).toHaveLength(0);

    const seeing = await engagementGame();
    launcher(seeing.game, seeing.defender, 60, 60, AirDefenseSystem.S500);
    const seen = jet(seeing.game, seeing.attacker, 60, 66, AircraftType.F35);
    executeTicks(seeing.game, 6);
    expect(seen.isActive()).toBe(false);
  });

  it.each([
    [AirDefenseSystem.PantsirS1, 30],
    [AirDefenseSystem.DavidsSling, 60],
    [AirDefenseSystem.Patriot, 90],
    [undefined, 90],
  ] as const)("%s reloads one slot in %i ticks", async (system, reload) => {
    const { game, defender, attacker } = await engagementGame();
    const sam = launcher(game, defender, 60, 60, system);
    expect(game.config().airDefenseCooldown(system)).toBe(reload);
    const target = jet(game, attacker, 60, 66, AircraftType.F16);
    let launchedAt: number | null = null;
    let freeAt: number | null = null;
    for (let i = 0; i < 120 && freeAt === null; i++) {
      game.executeNextTick();
      const queue = sam.missileTimerQueue();
      if (launchedAt === null && queue.length === 1) {
        launchedAt = game.ticks();
        // Leave the launcher nothing to shoot at when the slot reloads, so
        // the reload itself is what empties the queue.
        if (target.isActive()) target.delete(false);
      } else if (launchedAt !== null && queue.length === 0) {
        freeAt = game.ticks();
      }
    }
    expect(launchedAt).not.toBeNull();
    expect(freeAt).not.toBeNull();
    expect(freeAt! - launchedAt!).toBe(reload);
  });

  it("keeps the baseline launcher on the shared curve, 175 per hit, every warhead", async () => {
    const { game, defender, attacker } = await engagementGame();
    const sam = launcher(game, defender, 60, 60);
    expect(sam.airDefenseSystem()).toBeUndefined();
    // The test curve is 20 at every level.
    const outside = jet(game, attacker, 60, 85, AircraftType.F16);
    const inside = jet(game, attacker, 60, 75, AircraftType.F16);
    executeTicks(game, 6);
    expect(outside.health()).toBe(300);
    expect(inside.health()).toBe(125);
  });
});
