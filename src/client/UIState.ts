import {
  AirDefenseSystem,
  MAX_UPGRADE_AMOUNT,
  PlayerBuildableUnitType,
  UnitType,
} from "../core/game/Game";
import type { TileRef } from "../core/game/GameMap";

export type StructurePlacementPending =
  | {
      stage: "validating";
      requestId: number;
      targetTile: TileRef;
    }
  | {
      stage: "awaiting_acceptance";
      requestId: number;
      targetTile: TileRef;
      spawnTile: TileRef;
    };

export interface StructurePlacementQueue {
  /** Cancellation identity captured by every async validation/ack path. */
  generation: number;
  unitType: PlayerBuildableUnitType;
  /** Number of placements not yet observed in authoritative game state. */
  remaining: number;
  confirmedTiles: readonly TileRef[];
  pending?: StructurePlacementPending;
  /** SAM Launcher orders: the air-defense system every copy is built as. */
  airDefenseSystem?: AirDefenseSystem;
}

export type MultiTargetRocketType =
  | UnitType.AtomBomb
  | UnitType.HydrogenBomb
  | UnitType.MIRV;

export interface RocketTargetSelectionQueue {
  /** Cancellation identity captured by each target click. */
  generation: number;
  unitType: MultiTargetRocketType;
  /** Original quantity chosen by the player. */
  requestedTotal: number;
  /** Number of rockets which still need a user-chosen target. */
  remaining: number;
  /** Target points selected so far, in launch order. */
  selectedTargets: readonly TileRef[];
  rocketDirectionUp: boolean;
}

export interface UIState {
  attackRatio: number;
  ghostStructure: PlayerBuildableUnitType | null;
  rocketDirectionUp: boolean;
  upgradeMultiplier: number;
  /** True while the Airport command drawer owns the next map click. */
  airportTargetSelectionActive?: boolean;
  structurePlacementQueue?: StructurePlacementQueue;
  rocketTargetSelectionQueue?: RocketTargetSelectionQueue;
  /** Monotonic client-only cancellation identity. */
  structurePlacementRevision?: number;
}

export function structurePlacementRevision(uiState: UIState): number {
  return uiState.structurePlacementRevision ?? 0;
}

function advanceStructurePlacementRevision(uiState: UIState): number {
  const next = structurePlacementRevision(uiState) + 1;
  uiState.structurePlacementRevision = next;
  return next;
}

/** Invalidates any older modal callback before a structure chooser opens. */
export function beginStructurePlacementRequest(uiState: UIState): number {
  uiState.structurePlacementQueue = undefined;
  uiState.rocketTargetSelectionQueue = undefined;
  return advanceStructurePlacementRevision(uiState);
}

/** Starts a queue only if the chooser which created it is still current. */
export function startStructurePlacementQueue(
  uiState: UIState,
  unitType: PlayerBuildableUnitType,
  amount: number,
  chooserRevision: number,
  airDefenseSystem?: AirDefenseSystem,
): number | false {
  if (structurePlacementRevision(uiState) !== chooserRevision) return false;
  const remaining = Math.max(0, Math.floor(amount));
  if (remaining === 0) return false;
  const generation = advanceStructurePlacementRevision(uiState);
  uiState.rocketTargetSelectionQueue = undefined;
  uiState.structurePlacementQueue = {
    generation,
    unitType,
    remaining,
    confirmedTiles: [],
    ...(airDefenseSystem === undefined ? {} : { airDefenseSystem }),
  };
  uiState.ghostStructure = unitType;
  uiState.upgradeMultiplier = 1;
  return generation;
}

export function isMultiTargetRocketType(
  unitType: PlayerBuildableUnitType,
): unitType is MultiTargetRocketType {
  return (
    unitType === UnitType.AtomBomb ||
    unitType === UnitType.HydrogenBomb ||
    unitType === UnitType.MIRV
  );
}

/** Invalidates an older modal callback before a rocket quantity chooser opens. */
export function beginRocketTargetSelectionRequest(uiState: UIState): number {
  uiState.structurePlacementQueue = undefined;
  uiState.rocketTargetSelectionQueue = undefined;
  return advanceStructurePlacementRevision(uiState);
}

/**
 * Arms an exact sequence in which every rocket gets one explicit map click.
 * The first click is the tile which opened the quantity chooser.
 */
export function startRocketTargetSelectionQueue(
  uiState: UIState,
  unitType: PlayerBuildableUnitType,
  amount: number,
  rocketDirectionUp: boolean,
  chooserRevision: number,
): number | false {
  if (
    structurePlacementRevision(uiState) !== chooserRevision ||
    !isMultiTargetRocketType(unitType) ||
    !Number.isInteger(amount) ||
    amount < 2 ||
    amount > MAX_UPGRADE_AMOUNT
  ) {
    return false;
  }
  const generation = advanceStructurePlacementRevision(uiState);
  uiState.structurePlacementQueue = undefined;
  uiState.rocketTargetSelectionQueue = {
    generation,
    unitType,
    requestedTotal: amount,
    remaining: amount,
    selectedTargets: [],
    rocketDirectionUp,
  };
  uiState.ghostStructure = unitType;
  uiState.upgradeMultiplier = 1;
  return generation;
}

export function rocketTargetSelectionQueueIsCurrent(
  uiState: UIState,
  generation: number,
): boolean {
  return (
    uiState.rocketTargetSelectionQueue?.generation === generation &&
    structurePlacementRevision(uiState) === generation
  );
}

export function queuedRocketTargets(
  uiState: UIState,
  unitType: PlayerBuildableUnitType,
): number {
  const queue = uiState.rocketTargetSelectionQueue;
  return queue?.unitType === unitType ? queue.remaining : 0;
}

/** Records one point and returns the complete ordered target list when full. */
export function recordRocketTargetSelection(
  uiState: UIState,
  generation: number,
  unitType: PlayerBuildableUnitType,
  targetTile: TileRef,
): { remaining: number; targetTiles?: readonly TileRef[] } | false {
  const queue = uiState.rocketTargetSelectionQueue;
  if (
    !rocketTargetSelectionQueueIsCurrent(uiState, generation) ||
    queue === undefined ||
    queue.unitType !== unitType ||
    queue.remaining < 1
  ) {
    return false;
  }
  const selectedTargets = [...queue.selectedTargets, targetTile];
  const remaining = queue.requestedTotal - selectedTargets.length;
  if (remaining === 0) {
    uiState.rocketTargetSelectionQueue = undefined;
    uiState.ghostStructure = null;
    advanceStructurePlacementRevision(uiState);
    return { remaining: 0, targetTiles: selectedTargets };
  }
  uiState.rocketTargetSelectionQueue = {
    ...queue,
    remaining,
    selectedTargets,
  };
  return { remaining };
}

export function clearRocketTargetSelectionQueue(uiState: UIState): number {
  uiState.rocketTargetSelectionQueue = undefined;
  return advanceStructurePlacementRevision(uiState);
}

export function clearRocketTargetSelectionQueueIfCurrent(
  uiState: UIState,
  expectedRevision: number,
): boolean {
  if (structurePlacementRevision(uiState) !== expectedRevision) return false;
  clearRocketTargetSelectionQueue(uiState);
  return true;
}

/** Synchronously cancels callbacks from the current or any older queue. */
export function clearStructurePlacementQueue(uiState: UIState): number {
  uiState.structurePlacementQueue = undefined;
  return advanceStructurePlacementRevision(uiState);
}

export function clearStructurePlacementQueueIfCurrent(
  uiState: UIState,
  expectedRevision: number,
): boolean {
  if (structurePlacementRevision(uiState) !== expectedRevision) return false;
  clearStructurePlacementQueue(uiState);
  return true;
}

export function queuedStructurePlacements(
  uiState: UIState,
  unitType: PlayerBuildableUnitType,
): number {
  const queue = uiState.structurePlacementQueue;
  return queue?.unitType === unitType ? queue.remaining : 0;
}

export function structurePlacementQueueIsCurrent(
  uiState: UIState,
  generation: number,
): boolean {
  const queue = uiState.structurePlacementQueue;
  return (
    queue?.generation === generation &&
    structurePlacementRevision(uiState) === generation
  );
}

export function beginQueuedStructureValidation(
  uiState: UIState,
  generation: number,
  requestId: number,
  targetTile: TileRef,
): boolean {
  const queue = uiState.structurePlacementQueue;
  if (
    !structurePlacementQueueIsCurrent(uiState, generation) ||
    queue === undefined ||
    queue.remaining < 1 ||
    queue.pending !== undefined
  ) {
    return false;
  }
  uiState.structurePlacementQueue = {
    ...queue,
    pending: { stage: "validating", requestId, targetTile },
  };
  return true;
}

export function awaitQueuedStructureAcceptance(
  uiState: UIState,
  generation: number,
  requestId: number,
  spawnTile: TileRef,
): boolean {
  const queue = uiState.structurePlacementQueue;
  if (
    !structurePlacementQueueIsCurrent(uiState, generation) ||
    queue?.pending?.stage !== "validating" ||
    queue.pending.requestId !== requestId
  ) {
    return false;
  }
  uiState.structurePlacementQueue = {
    ...queue,
    pending: {
      stage: "awaiting_acceptance",
      requestId,
      targetTile: queue.pending.targetTile,
      spawnTile,
    },
  };
  return true;
}

/** Clears one rejected validation/intent without consuming the queue. */
export function rejectQueuedStructurePlacement(
  uiState: UIState,
  generation: number,
  requestId: number,
): boolean {
  const queue = uiState.structurePlacementQueue;
  if (
    !structurePlacementQueueIsCurrent(uiState, generation) ||
    queue?.pending?.requestId !== requestId
  ) {
    return false;
  }
  uiState.structurePlacementQueue = { ...queue, pending: undefined };
  return true;
}

/** Consumes one placement only after its tagged authoritative acceptance. */
export function acceptQueuedStructurePlacement(
  uiState: UIState,
  generation: number,
  requestId: number,
  authoritativeSpawnTile?: TileRef,
): number | false {
  const queue = uiState.structurePlacementQueue;
  if (
    !structurePlacementQueueIsCurrent(uiState, generation) ||
    queue?.pending?.stage !== "awaiting_acceptance" ||
    queue.pending.requestId !== requestId
  ) {
    return false;
  }
  const remaining = queue.remaining - 1;
  if (remaining <= 0) {
    uiState.structurePlacementQueue = undefined;
    uiState.ghostStructure = null;
    advanceStructurePlacementRevision(uiState);
    return 0;
  }
  uiState.structurePlacementQueue = {
    ...queue,
    remaining,
    confirmedTiles: [
      ...queue.confirmedTiles,
      authoritativeSpawnTile ?? queue.pending.spawnTile,
    ],
    pending: undefined,
  };
  return remaining;
}

export function isStructurePlacementTileConfirmed(
  uiState: UIState,
  generation: number,
  tile: TileRef,
): boolean {
  const queue = uiState.structurePlacementQueue;
  return (
    structurePlacementQueueIsCurrent(uiState, generation) &&
    queue?.confirmedTiles.includes(tile) === true
  );
}
