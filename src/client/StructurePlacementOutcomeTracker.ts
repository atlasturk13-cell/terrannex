import { Structures } from "../core/game/Game";
import type { StructurePlacementOutcomeViewData } from "../core/game/GameUpdates";
import type { ClientID, Turn } from "../core/Schemas";
import type { StructurePlacementIntentTag } from "./CommandQuantity";
import type { BuildUnitIntentEvent } from "./Transport";

/**
 * Binds local-only queue tags to recorded turn identities. Canceled commands
 * remain as tombstones until their exact authoritative outcome arrives.
 */
export class StructurePlacementOutcomeTracker {
  private pending: Array<{
    unitType: BuildUnitIntentEvent["unit"];
    tile: BuildUnitIntentEvent["tile"];
    amount: number;
    tag?: StructurePlacementIntentTag;
  }> = [];
  private byOutcomeKey = new Map<string, StructurePlacementIntentTag>();

  constructor(private readonly clientID: ClientID | undefined) {}

  recordDispatched(intent: BuildUnitIntentEvent): void {
    // Keep untagged physical structure commands as ordering tombstones too.
    // Otherwise an adjacent legacy x1 at the same type/tile could steal the
    // exact recorded turn identity of a tagged queue command.
    if (!Structures.has(intent.unit)) return;
    this.pending.push({
      unitType: intent.unit,
      tile: intent.tile,
      amount: intent.amount ?? 1,
      tag: intent.structurePlacementTag,
    });
  }

  bindTurn(turn: Turn): void {
    for (
      let intentIndex = 0;
      intentIndex < turn.intents.length;
      intentIndex++
    ) {
      const intent = turn.intents[intentIndex];
      if (
        intent.type !== "build_unit" ||
        intent.clientID !== this.clientID ||
        !Structures.has(intent.unit)
      ) {
        continue;
      }
      const pendingIndex = this.pending.findIndex(
        (pending) =>
          pending.unitType === intent.unit &&
          pending.tile === intent.tile &&
          pending.amount === (intent.amount ?? 1),
      );
      if (pendingIndex === -1) continue;
      const [pending] = this.pending.splice(pendingIndex, 1);
      if (pending.tag !== undefined) {
        this.byOutcomeKey.set(
          this.outcomeKey(turn.turnNumber, intentIndex),
          pending.tag,
        );
      }
    }
  }

  resolve(
    outcome: StructurePlacementOutcomeViewData,
  ): StructurePlacementIntentTag | undefined {
    if (outcome.clientID !== this.clientID) return undefined;
    const key = this.outcomeKey(outcome.turnNumber, outcome.intentIndex);
    const tag = this.byOutcomeKey.get(key);
    if (tag !== undefined) this.byOutcomeKey.delete(key);
    return tag;
  }

  private outcomeKey(turnNumber: number, intentIndex: number): string {
    return `${turnNumber}:${intentIndex}`;
  }
}
