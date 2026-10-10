import { describe, expect, it, vi } from "vitest";
import type { LobbyConfig } from "../../src/client/ClientGameRunner";
import { BuildUnitIntentEvent, Transport } from "../../src/client/Transport";
import { EventBus } from "../../src/core/EventBus";
import { AirDefenseSystem, UnitType } from "../../src/core/game/Game";

describe("Transport air-defense build intent", () => {
  it("sends the chosen system inside the build_unit intent", () => {
    const eventBus = new EventBus();
    const transport = new Transport({} as LobbyConfig, eventBus);
    const sendIntent = vi.fn(() => true);
    Object.assign(transport, { sendIntent });

    eventBus.emit(
      new BuildUnitIntentEvent(
        UnitType.SAMLauncher,
        42,
        false,
        1,
        undefined,
        undefined,
        AirDefenseSystem.S500,
      ),
    );

    expect(sendIntent).toHaveBeenCalledWith({
      airDefenseSystem: AirDefenseSystem.S500,
      amount: 1,
      rocketDirectionUp: false,
      targetTiles: undefined,
      tile: 42,
      type: "build_unit",
      unit: UnitType.SAMLauncher,
    });
  });

  it("leaves the field undefined for a plain launcher", () => {
    const eventBus = new EventBus();
    const transport = new Transport({} as LobbyConfig, eventBus);
    const sendIntent = vi.fn(() => true);
    Object.assign(transport, { sendIntent });

    eventBus.emit(new BuildUnitIntentEvent(UnitType.SAMLauncher, 7));

    expect(sendIntent).toHaveBeenCalledOnce();
    expect(
      (
        sendIntent.mock.calls[0] as unknown as [{ airDefenseSystem?: string }]
      )[0].airDefenseSystem,
    ).toBeUndefined();
  });
});
