import {
  AIR_DEFENSE_SYSTEMS,
  airDefenseCost,
  airDefenseCountersStealth,
  airDefenseEngagesWarhead,
  airDefenseProfile,
  airDefenseRadius,
  airDefenseSystemsForRange,
  isAirDefenseSystem,
} from "../../src/core/game/AirDefenseProfiles";
import {
  AirDefenseRange,
  AirDefenseSystem,
  UnitType,
} from "../../src/core/game/Game";
import { setup } from "../util/Setup";

const SHORT = [
  AirDefenseSystem.PantsirS1,
  AirDefenseSystem.IronDome,
  AirDefenseSystem.HisarO,
  AirDefenseSystem.DavidsSling,
];
const LONG = [
  AirDefenseSystem.Patriot,
  AirDefenseSystem.Siper,
  AirDefenseSystem.S400,
  AirDefenseSystem.S500,
];

describe("Air-defense profiles", () => {
  it("splits eight systems into a short-range and a long-range class", () => {
    expect(AIR_DEFENSE_SYSTEMS).toEqual([...SHORT, ...LONG]);
    expect(airDefenseSystemsForRange(AirDefenseRange.Short)).toEqual(SHORT);
    expect(airDefenseSystemsForRange(AirDefenseRange.Long)).toEqual(LONG);
    expect(Object.values(AirDefenseSystem).sort()).toEqual(
      [...AIR_DEFENSE_SYSTEMS].sort(),
    );
    expect(isAirDefenseSystem("s400")).toBe(true);
    expect(isAirDefenseSystem("s300")).toBe(false);
    expect(isAirDefenseSystem(undefined)).toBe(false);
  });

  it("pins every system's power exactly as the contract table says", () => {
    const table = AIR_DEFENSE_SYSTEMS.map((system) => {
      const p = airDefenseProfile(system);
      return [
        system,
        p.range,
        p.radius,
        p.reloadTicks,
        p.jetDamage,
        p.warheads.length,
        p.countersStealth,
        p.costPercent,
      ];
    });
    expect(table).toEqual([
      ["pantsir_s1", "short", 35, 30, 200, 1, false, 45],
      ["iron_dome", "short", 40, 40, 150, 1, false, 50],
      ["hisar_o", "short", 48, 50, 225, 1, false, 60],
      ["davids_sling", "short", 60, 60, 300, 2, false, 80],
      ["patriot", "long", 80, 90, 300, 3, false, 100],
      ["siper", "long", 95, 80, 350, 3, false, 120],
      ["s400", "long", 110, 70, 450, 3, false, 150],
      ["s500", "long", 130, 60, 600, 3, true, 200],
    ]);
  });

  it("keeps every short-range radius below every long-range radius and prices climb within a class", () => {
    const shortRadii = SHORT.map((s) => airDefenseProfile(s).radius);
    const longRadii = LONG.map((s) => airDefenseProfile(s).radius);
    expect(Math.max(...shortRadii)).toBeLessThan(Math.min(...longRadii));
    for (const group of [SHORT, LONG]) {
      const radii = group.map((s) => airDefenseProfile(s).radius);
      const costs = group.map((s) => airDefenseProfile(s).costPercent);
      expect([...radii].sort((a, b) => a - b)).toEqual(radii);
      expect([...costs].sort((a, b) => a - b)).toEqual(costs);
    }
    expect(airDefenseProfile(AirDefenseSystem.S500).jetDamage).toBe(
      Math.max(
        ...AIR_DEFENSE_SYSTEMS.map((s) => airDefenseProfile(s).jetDamage),
      ),
    );
    expect(airDefenseProfile(AirDefenseSystem.IronDome).jetDamage).toBe(
      Math.min(
        ...AIR_DEFENSE_SYSTEMS.map((s) => airDefenseProfile(s).jetDamage),
      ),
    );
  });

  it("engages atom bombs everywhere, hydrogen bombs from David's Sling up, MIRV warheads only long range, and stealth only from the S-500", () => {
    for (const system of AIR_DEFENSE_SYSTEMS) {
      expect(airDefenseEngagesWarhead(system, UnitType.AtomBomb)).toBe(true);
      expect(airDefenseEngagesWarhead(system, UnitType.MIRV)).toBe(false);
    }
    for (const system of SHORT) {
      expect(airDefenseEngagesWarhead(system, UnitType.MIRVWarhead)).toBe(
        false,
      );
      expect(airDefenseEngagesWarhead(system, UnitType.HydrogenBomb)).toBe(
        system === AirDefenseSystem.DavidsSling,
      );
    }
    for (const system of LONG) {
      expect(airDefenseEngagesWarhead(system, UnitType.HydrogenBomb)).toBe(
        true,
      );
      expect(airDefenseEngagesWarhead(system, UnitType.MIRVWarhead)).toBe(true);
      expect(airDefenseCountersStealth(system)).toBe(
        system === AirDefenseSystem.S500,
      );
    }
    for (const system of SHORT) {
      expect(airDefenseCountersStealth(system)).toBe(false);
    }
    // The baseline launcher: every warhead, never stealth.
    expect(airDefenseEngagesWarhead(undefined, UnitType.AtomBomb)).toBe(true);
    expect(airDefenseEngagesWarhead(undefined, UnitType.HydrogenBomb)).toBe(
      true,
    );
    expect(airDefenseEngagesWarhead(undefined, UnitType.MIRVWarhead)).toBe(
      true,
    );
    expect(airDefenseEngagesWarhead(undefined, UnitType.MIRV)).toBe(false);
    expect(airDefenseCountersStealth(undefined)).toBe(false);
  });

  it("prices each system as an exact percentage of the launcher cost and leaves the baseline alone", () => {
    expect(airDefenseCost(1_500_000n, undefined)).toBe(1_500_000n);
    expect(airDefenseCost(1_500_000n, AirDefenseSystem.PantsirS1)).toBe(
      675_000n,
    );
    expect(airDefenseCost(1_500_000n, AirDefenseSystem.IronDome)).toBe(
      750_000n,
    );
    expect(airDefenseCost(1_500_000n, AirDefenseSystem.Patriot)).toBe(
      1_500_000n,
    );
    expect(airDefenseCost(1_500_000n, AirDefenseSystem.S500)).toBe(3_000_000n);
    expect(airDefenseCost(3_000_000n, AirDefenseSystem.S400)).toBe(4_500_000n);
  });

  it("grows each system's level-1 radius along the shared curve and keeps the baseline curve, reload and hit", async () => {
    // The production curve: 70 at level 1, ~102 at level 5.
    const curve = (level: number) => 150 - 480 / (level + 5);
    expect(airDefenseRadius(undefined, curve(1), curve(1))).toBe(curve(1));
    expect(airDefenseRadius(undefined, curve(5), curve(1))).toBe(curve(5));
    expect(
      airDefenseRadius(AirDefenseSystem.IronDome, curve(1), curve(1)),
    ).toBe(40);
    expect(airDefenseRadius(AirDefenseSystem.S500, curve(1), curve(1))).toBe(
      130,
    );
    expect(
      airDefenseRadius(AirDefenseSystem.S500, curve(5), curve(1)),
    ).toBeCloseTo(130 + (curve(5) - curve(1)), 10);
    expect(
      airDefenseRadius(AirDefenseSystem.IronDome, curve(3), curve(1)),
    ).toBeCloseTo(40 + (curve(3) - curve(1)), 10);

    // The test config flattens the shared curve to 20 at every level, so a
    // system keeps exactly its level-1 radius there.
    const game = await setup("big_plains", { instantBuild: true });
    const config = game.config();
    for (const level of [1, 2, 3, 4, 5]) {
      expect(config.airDefenseRadius(undefined, level)).toBe(
        config.samRange(level),
      );
      expect(config.airDefenseRadius(AirDefenseSystem.S500, level)).toBe(130);
      expect(config.airDefenseRadius(AirDefenseSystem.IronDome, level)).toBe(
        40,
      );
    }

    expect(config.airDefenseCooldown(undefined)).toBe(config.SAMCooldown());
    expect(config.airDefenseCooldown(AirDefenseSystem.Patriot)).toBe(
      config.SAMCooldown(),
    );
    expect(config.airDefenseCooldown(AirDefenseSystem.PantsirS1)).toBe(
      config.tempoDurationTicks(30),
    );
    expect(config.airDefenseCooldown(AirDefenseSystem.S500)).toBe(
      config.tempoDurationTicks(60),
    );

    expect(config.airDefenseJetDamage(undefined)).toBe(
      config.fighterSamDamage(),
    );
    expect(config.airDefenseJetDamage(undefined)).toBe(175);
    expect(config.airDefenseJetDamage(AirDefenseSystem.IronDome)).toBe(150);
    expect(config.airDefenseJetDamage(AirDefenseSystem.S500)).toBe(600);
  });
});
