import { describe, expect, it } from "vitest";
import { UnitView } from "../../../src/client/view/UnitView";
import { AirDefenseSystem, UnitType } from "../../../src/core/game/Game";
import { makeGameView, makeUnitUpdate, stubConfig } from "../../util/viewStubs";

describe("UnitView air-defense system", () => {
  it("forwards the system into the render state and the accessor", () => {
    const game = makeGameView();
    const s500 = new UnitView(
      game,
      makeUnitUpdate({
        id: 9,
        unitType: UnitType.SAMLauncher,
        airDefenseSystem: AirDefenseSystem.S500,
      }),
    );
    expect(s500.airDefenseSystem()).toBe(AirDefenseSystem.S500);
    expect(s500.state.airDefenseSystem).toBe("s500");

    const baseline = new UnitView(
      game,
      makeUnitUpdate({ id: 10, unitType: UnitType.SAMLauncher }),
    );
    expect(baseline.airDefenseSystem()).toBeUndefined();
    expect(baseline.state.airDefenseSystem).toBeUndefined();

    baseline.update(
      makeUnitUpdate({
        id: 10,
        unitType: UnitType.SAMLauncher,
        airDefenseSystem: AirDefenseSystem.IronDome,
      }),
    );
    expect(baseline.airDefenseSystem()).toBe(AirDefenseSystem.IronDome);
  });

  it("measures readiness against the system's own reload", () => {
    const game = makeGameView({
      config: stubConfig({
        airDefenseCooldown: (system?: AirDefenseSystem) =>
          system === AirDefenseSystem.PantsirS1 ? 30 : 90,
      } as never),
    });
    game.ticks = () => 115;
    const pantsir = new UnitView(
      game,
      makeUnitUpdate({
        id: 1,
        unitType: UnitType.SAMLauncher,
        airDefenseSystem: AirDefenseSystem.PantsirS1,
        level: 1,
        missileTimerQueue: [100],
      }),
    );
    const patriot = new UnitView(
      game,
      makeUnitUpdate({
        id: 2,
        unitType: UnitType.SAMLauncher,
        airDefenseSystem: AirDefenseSystem.Patriot,
        level: 1,
        missileTimerQueue: [100],
      }),
    );
    // 15 ticks into a 30-tick reload versus a 90-tick reload.
    expect(pantsir.missileReadinesss()).toBeCloseTo(15 / 30, 10);
    expect(patriot.missileReadinesss()).toBeCloseTo(15 / 90, 10);
  });
});
