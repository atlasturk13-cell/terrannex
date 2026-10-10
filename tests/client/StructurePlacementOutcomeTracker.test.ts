import { describe, expect, it } from "vitest";
import { StructurePlacementOutcomeTracker } from "../../src/client/StructurePlacementOutcomeTracker";
import { BuildUnitIntentEvent } from "../../src/client/Transport";
import { UnitType } from "../../src/core/game/Game";
import type { StructurePlacementOutcomeViewData } from "../../src/core/game/GameUpdates";
import type { Turn } from "../../src/core/Schemas";

const clientID = "local-client";
const tile = 42;

function structureOutcome(
  turnNumber: number,
  intentIndex: number,
  outcome: "accepted" | "rejected" = "accepted",
  outcomeClientID = clientID,
): StructurePlacementOutcomeViewData {
  return {
    clientID: outcomeClientID,
    intentIndex,
    outcome,
    tile,
    turnNumber,
    unitType: UnitType.City,
  };
}

describe("StructurePlacementOutcomeTracker", () => {
  it("keeps canceled same-tile commands as exact tombstones", () => {
    const tracker = new StructurePlacementOutcomeTracker(clientID);
    const oldTag = { generation: 1, requestId: 1 };
    const newTag = { generation: 3, requestId: 2 };
    tracker.recordDispatched(
      new BuildUnitIntentEvent(UnitType.City, tile, undefined, 1, oldTag),
    );
    tracker.recordDispatched(
      new BuildUnitIntentEvent(UnitType.City, tile, undefined, 1, newTag),
    );
    const turn: Turn = {
      turnNumber: 8,
      intents: [
        {
          amount: 1,
          clientID,
          tile,
          type: "build_unit",
          unit: UnitType.City,
        },
        {
          amount: 1,
          clientID,
          tile,
          type: "build_unit",
          unit: UnitType.City,
        },
      ],
    };

    tracker.bindTurn(turn);

    expect(tracker.resolve(structureOutcome(8, 1))).toEqual(newTag);
    expect(tracker.resolve(structureOutcome(8, 0))).toEqual(oldTag);
    expect(tracker.resolve(structureOutcome(8, 0))).toBeUndefined();
  });

  it("does not match another client's same-type same-tile outcome", () => {
    const tracker = new StructurePlacementOutcomeTracker(clientID);
    const tag = { generation: 2, requestId: 7 };
    tracker.recordDispatched(
      new BuildUnitIntentEvent(UnitType.City, tile, undefined, 1, tag),
    );
    tracker.bindTurn({
      turnNumber: 9,
      intents: [
        {
          amount: 1,
          clientID,
          tile,
          type: "build_unit",
          unit: UnitType.City,
        },
      ],
    });

    expect(
      tracker.resolve(structureOutcome(9, 0, "accepted", "other-client")),
    ).toBeUndefined();
    expect(tracker.resolve(structureOutcome(9, 0))).toEqual(tag);
  });

  it("preserves ordering across an adjacent untagged structure command", () => {
    const tracker = new StructurePlacementOutcomeTracker(clientID);
    const tag = { generation: 4, requestId: 11 };
    tracker.recordDispatched(new BuildUnitIntentEvent(UnitType.City, tile));
    tracker.recordDispatched(
      new BuildUnitIntentEvent(UnitType.City, tile, undefined, 1, tag),
    );
    tracker.bindTurn({
      turnNumber: 10,
      intents: [
        {
          clientID,
          tile,
          type: "build_unit",
          unit: UnitType.City,
        },
        {
          amount: 1,
          clientID,
          tile,
          type: "build_unit",
          unit: UnitType.City,
        },
      ],
    });

    expect(tracker.resolve(structureOutcome(10, 0))).toBeUndefined();
    expect(tracker.resolve(structureOutcome(10, 1))).toEqual(tag);
  });
});
