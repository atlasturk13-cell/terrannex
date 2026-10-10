import { NukeMagnitude } from "../src/core/configuration/Config";
import { NukeExecution } from "../src/core/execution/NukeExecution";
import { SpawnExecution } from "../src/core/execution/SpawnExecution";
import {
  CITY_FOOTPRINT_BASE_RADIUS,
  CITY_FOOTPRINT_RADIUS_PER_LEVEL,
  cityFootprintRadius,
  cityFootprintTiles,
  cityLevelsLost,
} from "../src/core/game/CityFootprint";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { setup } from "./util/Setup";
import { TestConfig } from "./util/TestConfig";
import { constructionExecution, executeTicks } from "./util/utils";

/** Real-sized blasts so a bomb can cover part of a footprint. */
class BlastConfig extends TestConfig {
  nukeMagnitudes(_: UnitType): NukeMagnitude {
    return { inner: 8, outer: 8 };
  }
}

describe("city footprint math", () => {
  test("radius grows with level from the base radius", () => {
    expect(cityFootprintRadius(1)).toBe(CITY_FOOTPRINT_BASE_RADIUS);
    expect(cityFootprintRadius(3)).toBe(
      CITY_FOOTPRINT_BASE_RADIUS + 2 * CITY_FOOTPRINT_RADIUS_PER_LEVEL,
    );
    expect(cityFootprintRadius(0)).toBe(CITY_FOOTPRINT_BASE_RADIUS);
  });

  test("levels lost is the rounded share of destroyed footprint", () => {
    expect(cityLevelsLost(3, 0, 100)).toBe(0);
    expect(cityLevelsLost(3, 10, 100)).toBe(0); // 0.3 → 0
    expect(cityLevelsLost(3, 20, 100)).toBe(1); // 0.6 → 1
    expect(cityLevelsLost(3, 50, 100)).toBe(2); // 1.5 → 2 (half rounds up)
    expect(cityLevelsLost(3, 80, 100)).toBe(2); // 2.4 → 2
    expect(cityLevelsLost(3, 100, 100)).toBe(3);
    expect(cityLevelsLost(1, 1, 100)).toBe(0);
    expect(cityLevelsLost(1, 60, 100)).toBe(1);
    expect(cityLevelsLost(3, 5, 0)).toBe(0);
  });
});

describe("city footprint on the map", () => {
  let game: Game;

  beforeEach(async () => {
    game = await setup("plains", { infiniteGold: true, instantBuild: true });
  });

  test("footprint is the land disc around the centre, clipped to the map", () => {
    const centre = game.ref(50, 50);
    const tiles = cityFootprintTiles(game, centre, 1);
    const r = cityFootprintRadius(1);
    expect(tiles).toContain(centre);
    expect(tiles).toContain(game.ref(50 + r, 50));
    expect(tiles).not.toContain(game.ref(50 + r + 1, 50));
    expect(tiles).not.toContain(game.ref(50 + r, 50 + r));
    for (const t of tiles) {
      expect(game.euclideanDistSquared(centre, t)).toBeLessThanOrEqual(r * r);
    }
    // A corner city keeps only the quarter disc that is on the map.
    const corner = cityFootprintTiles(game, game.ref(0, 0), 1);
    expect(corner.length).toBeLessThan(tiles.length / 3);
    expect(corner.length).toBeGreaterThan(0);
  });

  test("a bigger city has a bigger footprint", () => {
    const centre = game.ref(50, 50);
    expect(cityFootprintTiles(game, centre, 3).length).toBeGreaterThan(
      cityFootprintTiles(game, centre, 1).length * 2,
    );
  });
});

describe("nuking a city", () => {
  let game: Game;
  let attacker: Player;
  let victim: Player;

  function nuke(x: number, y: number) {
    game.addExecution(
      new NukeExecution(UnitType.AtomBomb, attacker, game.ref(x, y), null),
    );
    executeTicks(game, 60);
  }

  beforeEach(async () => {
    game = await setup(
      "plains",
      { infiniteGold: true, instantBuild: true },
      [],
      undefined,
      BlastConfig,
    );
    const attackerInfo = new PlayerInfo(
      "attacker",
      PlayerType.Human,
      null,
      "attacker",
    );
    const victimInfo = new PlayerInfo(
      "victim",
      PlayerType.Human,
      null,
      "victim",
    );
    game.addPlayer(attackerInfo);
    game.addPlayer(victimInfo);
    game.addExecution(
      new SpawnExecution(
        "game_id",
        game.player(attackerInfo.id).info(),
        game.ref(5, 5),
      ),
      new SpawnExecution(
        "game_id",
        game.player(victimInfo.id).info(),
        game.ref(50, 50),
      ),
    );
    executeTicks(game, 3);
    attacker = game.player("attacker");
    victim = game.player("victim");
    constructionExecution(game, attacker, 5, 5, UnitType.MissileSilo);
    constructionExecution(game, victim, 50, 50, UnitType.City);
    const city = victim.units(UnitType.City)[0];
    city.increaseLevel();
    city.increaseLevel();
    expect(city.level()).toBe(3);
  });

  test("a direct hit on the centre destroys the city", () => {
    nuke(50, 50);
    expect(victim.units(UnitType.City)).toHaveLength(0);
  });

  test("a blast on the outskirts only knocks off levels", () => {
    // Level 3 → radius 10. A radius-8 blast centred 12 tiles away erases a
    // slice of the footprint (never the centre) — roughly a third of it.
    nuke(62, 50);
    const cities = victim.units(UnitType.City);
    expect(cities).toHaveLength(1);
    expect(cities[0].level()).toBeLessThan(3);
    expect(cities[0].level()).toBeGreaterThanOrEqual(1);
  });

  test("a blast that barely reaches the footprint leaves the city intact", () => {
    // Blast edge (8) meets the footprint edge (10) at 18 tiles; a few tiles.
    nuke(67, 50);
    const cities = victim.units(UnitType.City);
    expect(cities).toHaveLength(1);
    expect(cities[0].level()).toBe(3);
  });

  test("other structures inside the blast are still destroyed outright", () => {
    expect(attacker.units(UnitType.MissileSilo)).toHaveLength(1);
    nuke(6, 6);
    expect(attacker.units(UnitType.MissileSilo)).toHaveLength(0);
  });
});
