import type { GameEvent } from "../core/EventBus";
import type {
  BuildableUnit,
  Gold,
  PlayerBuildableUnitType,
} from "../core/game/Game";
import {
  AircraftType,
  MAX_COMMAND_AMOUNT,
  StrikeTargetClass,
} from "../core/game/Game";
import type { TileRef } from "../core/game/GameMap";

export type CommandQuantityKind =
  | "construction"
  | "upgrade"
  | "launch"
  | "fighter";

export interface CommandQuantityRequest {
  kind: CommandQuantityKind;
  itemName: string;
  max: number;
  initial?: number;
  uniquePlacement?: boolean;
  /** Each selected copy is confirmed on its own map tile. */
  separatePlacement?: boolean;
  /** Each selected rocket is confirmed on its own user-chosen target tile. */
  separateTargets?: boolean;
  /** Every selected fighter uses the same user-chosen target. */
  sharedTarget?: boolean;
  /**
   * Jet Attack strike plans with the victim's live structure counts. The
   * tile plan is always offered; a class with no structures is shown inert.
   * Several classes can be chosen at once; the jets are shared equally.
   */
  strikeTargets?: readonly StrikeTargetChoice[];
  /**
   * Jet Attack: the eligible airborne jets, nearest to the target first. The
   * dialog then becomes a jet picker (all selected by default) and reports
   * the chosen unit IDs; the amount is the number of chosen jets.
   */
  jets?: readonly StrikeJetChoice[];
  totalCost?: (amount: number) => Gold;
  onConfirm: (
    amount: number,
    /** Chosen strike plans, normalized (enum order; All or the tile alone). */
    strikeTargets?: readonly StrikeTargetClass[],
    fighterIds?: number[],
  ) => void;
  onCancel?: () => void;
}

export interface StrikeTargetChoice {
  id: StrikeTargetClass;
  count: number;
}

export interface StrikeJetChoice {
  id: number;
  aircraftType: AircraftType | undefined;
  /** Manhattan tiles from the jet to the strike point. */
  distance: number;
  health: number;
  maxHealth: number;
}

/**
 * Client-only request for the shared in-game quantity dialog. The callback is
 * deliberately kept out of network schemas; only its confirmed integer is
 * converted into an authoritative intent.
 */
export class RequestCommandQuantityEvent implements GameEvent {
  constructor(public readonly request: CommandQuantityRequest) {}
}

/** Routes direct-menu and ghost placements through the same exact validation. */
export class RequestStructurePlacementEvent implements GameEvent {
  constructor(
    public readonly unitType: PlayerBuildableUnitType,
    public readonly targetTile: TileRef,
    public readonly generation: number,
  ) {}
}

/** Client-only identity; deliberately omitted from the recorded build intent. */
export interface StructurePlacementIntentTag {
  generation: number;
  requestId: number;
}

/** Definitive result returned by the deterministic worker execution. */
export class AuthoritativeStructurePlacementOutcomeEvent implements GameEvent {
  constructor(
    public readonly tag: StructurePlacementIntentTag,
    public readonly outcome: "accepted" | "rejected",
    public readonly spawnTile?: TileRef,
    public readonly unitID?: number,
  ) {}
}

export function normalizedQuantityMaximum(maximum: number): number {
  if (!Number.isFinite(maximum)) return 0;
  return Math.max(0, Math.floor(maximum));
}

/**
 * Largest separately placed structure count whose exact cumulative fresh-build
 * price is currently affordable. Missing future prices fail closed at x1.
 */
export function maxFreshConstructionAmount(
  buildableUnit: BuildableUnit,
  gold: Gold,
  limit = MAX_COMMAND_AMOUNT,
): number {
  const cappedLimit = Math.min(
    MAX_COMMAND_AMOUNT,
    Math.max(0, Math.floor(limit)),
  );
  let maximum = 0;
  for (let amount = 1; amount <= cappedLimit; amount++) {
    const total =
      buildableUnit.freshBuildCosts?.[amount - 1] ??
      (amount === 1 ? buildableUnit.cost : undefined);
    if (total === undefined || total > gold) break;
    maximum = amount;
  }
  return maximum;
}

export function unitTypeTranslationKey(type: string): string {
  return `unit_type.${type.toLowerCase().replace(/\s+/g, "_")}`;
}
