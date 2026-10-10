import { describe, expect, it, vi } from "vitest";
import type { LobbyConfig } from "../../src/client/ClientGameRunner";
import { AuthoritativeStructurePlacementOutcomeEvent } from "../../src/client/CommandQuantity";
import {
  BuildUnitIntentDispatchedEvent,
  BuildUnitIntentEvent,
  LaunchAirMissionIntentEvent,
  SendCommandAirPatrolIntentEvent,
  Transport,
} from "../../src/client/Transport";
import { EventBus } from "../../src/core/EventBus";
import {
  AircraftType,
  AirMissionType,
  StrikeTargetClass,
  UnitType,
} from "../../src/core/game/Game";

describe("Transport fighter mission quantity", () => {
  it("preserves the ordered target list for a multi-rocket batch", () => {
    const eventBus = new EventBus();
    const transport = new Transport({} as LobbyConfig, eventBus);
    const sendIntent = vi.fn(() => true);
    Object.assign(transport, { sendIntent });

    eventBus.emit(
      new BuildUnitIntentEvent(
        UnitType.AtomBomb,
        42,
        true,
        3,
        undefined,
        [42, 84, 126],
      ),
    );

    expect(sendIntent).toHaveBeenCalledWith({
      amount: 3,
      rocketDirectionUp: true,
      targetTiles: [42, 84, 126],
      tile: 42,
      type: "build_unit",
      unit: UnitType.AtomBomb,
    });
  });

  it("maps the selected amount into the launch_air_mission intent", () => {
    const eventBus = new EventBus();
    const transport = new Transport({} as LobbyConfig, eventBus);
    const sendIntent = vi.fn();
    Object.assign(transport, { sendIntent });
    const order = {
      mission: AirMissionType.Intercept,
      targetTile: 42,
    } as const;

    eventBus.emit(new LaunchAirMissionIntentEvent(order, 2));

    expect(sendIntent).toHaveBeenCalledOnce();
    expect(sendIntent).toHaveBeenCalledWith({
      type: "launch_air_mission",
      order,
      amount: 2,
    });
  });

  it("keeps one sortie as the client event default", () => {
    const eventBus = new EventBus();
    const transport = new Transport({} as LobbyConfig, eventBus);
    const sendIntent = vi.fn();
    Object.assign(transport, { sendIntent });
    const order = {
      mission: AirMissionType.PrecisionStrike,
      targetTile: 7,
    } as const;

    eventBus.emit(new LaunchAirMissionIntentEvent(order));

    expect(sendIntent).toHaveBeenCalledWith({
      type: "launch_air_mission",
      order,
      amount: 1,
    });
  });

  it("preserves the selected aircraft type in a precision-strike order", () => {
    const eventBus = new EventBus();
    const transport = new Transport({} as LobbyConfig, eventBus);
    const sendIntent = vi.fn();
    Object.assign(transport, { sendIntent });
    const order = {
      mission: AirMissionType.PrecisionStrike,
      targetTile: 70,
      aircraftType: AircraftType.F35,
    } as const;

    eventBus.emit(new LaunchAirMissionIntentEvent(order, 3));

    expect(sendIntent).toHaveBeenCalledWith({
      type: "launch_air_mission",
      order,
      amount: 3,
    });
  });

  it("maps an airborne CAP quantity into the dedicated command intent", () => {
    const eventBus = new EventBus();
    const transport = new Transport({} as LobbyConfig, eventBus);
    const sendIntent = vi.fn();
    Object.assign(transport, { sendIntent });
    const order = {
      mission: AirMissionType.NavalStrike,
      targetUnitId: 77,
    } as const;

    eventBus.emit(new SendCommandAirPatrolIntentEvent(order, 2));

    expect(sendIntent).toHaveBeenCalledOnce();
    expect(sendIntent).toHaveBeenCalledWith({
      type: "command_air_patrol",
      order,
      amount: 2,
    });
  });

  it("guards an unresolved tagged tile until its exact old outcome arrives", () => {
    const eventBus = new EventBus();
    const transport = new Transport({} as LobbyConfig, eventBus);
    const sendIntent = vi.fn(() => true);
    Object.assign(transport, { sendIntent });
    const dispatched = vi.fn();
    const outcomes = vi.fn();
    eventBus.on(BuildUnitIntentDispatchedEvent, dispatched);
    eventBus.on(AuthoritativeStructurePlacementOutcomeEvent, outcomes);
    const oldTag = { generation: 1, requestId: 10 };
    const blockedTag = { generation: 3, requestId: 11 };
    const retryTag = { generation: 3, requestId: 12 };

    eventBus.emit(
      new BuildUnitIntentEvent(UnitType.City, 35, false, 1, oldTag),
    );
    eventBus.emit(
      new BuildUnitIntentEvent(UnitType.City, 35, false, 1, blockedTag),
    );

    expect(sendIntent).toHaveBeenCalledOnce();
    expect(dispatched).toHaveBeenCalledOnce();
    expect(outcomes).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "rejected", tag: blockedTag }),
    );

    eventBus.emit(
      new AuthoritativeStructurePlacementOutcomeEvent(oldTag, "accepted", 35),
    );
    eventBus.emit(
      new BuildUnitIntentEvent(UnitType.City, 35, false, 1, retryTag),
    );

    expect(sendIntent).toHaveBeenCalledTimes(2);
    expect(dispatched).toHaveBeenCalledTimes(2);
  });

  it("passes a Jet Attack strike plan through the command_air_patrol intent", () => {
    const eventBus = new EventBus();
    const transport = new Transport({} as LobbyConfig, eventBus);
    const sendIntent = vi.fn();
    Object.assign(transport, { sendIntent });
    const order = {
      mission: AirMissionType.PrecisionStrike,
      targetTile: 84,
      targetClass: StrikeTargetClass.AirDefense,
    } as const;

    eventBus.emit(new SendCommandAirPatrolIntentEvent(order, 3));

    expect(sendIntent).toHaveBeenCalledOnce();
    expect(sendIntent).toHaveBeenCalledWith({
      type: "command_air_patrol",
      order,
      amount: 3,
    });
  });

  it("passes the chosen jet IDs through the command_air_patrol intent", () => {
    const eventBus = new EventBus();
    const transport = new Transport({} as LobbyConfig, eventBus);
    const sendIntent = vi.fn();
    Object.assign(transport, { sendIntent });
    const order = {
      mission: AirMissionType.PrecisionStrike as const,
      targetTile: 84,
      fighterIds: [12, 7],
    };

    eventBus.emit(new SendCommandAirPatrolIntentEvent(order, 2));

    expect(sendIntent).toHaveBeenCalledWith({
      type: "command_air_patrol",
      order,
      amount: 2,
    });
  });
});
