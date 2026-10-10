/**
 * BuildPreviewController — build-ghost state machine + click-to-build flow.
 *
 * All rendering for the build ghost (outline, range circle, rail snap,
 * crosshair) lives in the WebGL renderer. This controller owns the state:
 * it queries buildables for the cursor tile, tracks whether the placement
 * is valid, and pushes preview data straight to the WebGL view.
 */

import { EventBus } from "../../core/EventBus";
import {
  listNukeBreakAlliance,
  wouldNukeBreakAlliance,
} from "../../core/execution/Util";
import {
  BuildableUnit,
  bulkCost,
  DepthProgressionStructures,
  MAX_COMMAND_AMOUNT,
  maxBulkAmount,
  PlayerBuildableUnitType,
  STRUCTURE_PLACEMENT_ONLY_SENTINEL,
  Structures,
  UnitType,
} from "../../core/game/Game";
import { TileRef } from "../../core/game/GameMap";
import { UserSettings } from "../../core/game/UserSettings";
import {
  AuthoritativeStructurePlacementOutcomeEvent,
  maxFreshConstructionAmount,
  RequestCommandQuantityEvent,
  RequestStructurePlacementEvent,
  unitTypeTranslationKey,
} from "../CommandQuantity";
import { Controller } from "../Controller";
import {
  ConfirmGhostStructureEvent,
  MouseMoveEvent,
  MouseUpEvent,
} from "../InputHandler";
import { buildNukeTrajectory, MapRenderer } from "../render/gl";
import type { SAMInfo } from "../render/gl/utils/NukeTrajectory";
import type { GhostPreviewData } from "../render/types";
import { TransformHandler } from "../TransformHandler";
import {
  BuildUnitIntentEvent,
  SendUpgradeStructureIntentEvent,
} from "../Transport";
import {
  acceptQueuedStructurePlacement,
  awaitQueuedStructureAcceptance,
  beginQueuedStructureValidation,
  beginRocketTargetSelectionRequest,
  beginStructurePlacementRequest,
  clearRocketTargetSelectionQueue,
  clearRocketTargetSelectionQueueIfCurrent,
  clearStructurePlacementQueue,
  clearStructurePlacementQueueIfCurrent,
  isStructurePlacementTileConfirmed,
  queuedRocketTargets,
  queuedStructurePlacements,
  recordRocketTargetSelection,
  rejectQueuedStructurePlacement,
  startRocketTargetSelectionQueue,
  startStructurePlacementQueue,
  structurePlacementQueueIsCurrent,
  structurePlacementRevision,
  UIState,
} from "../UIState";
import { translateText } from "../Utils";
import { GameView } from "../view";

/** True for nuke types (AtomBomb, HydrogenBomb): ghost is preserved after placement so user can place multiple or keep selection (Enter/key confirm). */
export function shouldPreserveGhostAfterBuild(unitType: UnitType): boolean {
  return unitType === UnitType.AtomBomb || unitType === UnitType.HydrogenBomb;
}

export function resolvedBuildMultiplier(
  depthProgression: boolean,
  unitType: UnitType,
  canUpgrade: boolean,
  requestedMultiplier: number,
): number {
  return depthProgression &&
    canUpgrade &&
    DepthProgressionStructures.has(unitType)
    ? 1
    : requestedMultiplier;
}

// tSamIntercept value used to flag an untargetable (impassable) destination:
// draws the red X marker essentially at the destination while leaving the
// visible line unchanged (1.0 would mean "no marker").
const T_BLOCKED_DST = 0.9999;

/**
 * Whether a SAM belongs in the nuke trajectory preview's threat set.
 * Mirrors SAMLauncherExecution: a SAM ignores a nuke whose owner it's
 * friendly with (same team OR allied).
 * Teammates are excluded unconditionally — a strike can break an alliance
 * but never a team relationship, so a teammate's SAM never engages.
 * Allied SAMs are excluded unless the strike would betray that ally — the
 * alliance breaks at launch, so their SAMs will engage the nuke.
 * (Own SAMs never threaten; the caller filters those out first.)
 */
export function samThreatensNukePreview(
  samOwnerSmallId: number,
  teammateSmallIds: ReadonlySet<number>,
  allySmallIds: ReadonlySet<number>,
  betrayedSmallIds: ReadonlySet<number>,
): boolean {
  if (teammateSmallIds.has(samOwnerSmallId)) return false;
  return (
    !allySmallIds.has(samOwnerSmallId) || betrayedSmallIds.has(samOwnerSmallId)
  );
}

export class BuildPreviewController implements Controller {
  /** Current ghost (null when no build type is active). */
  private ghostUnit: { buildableUnit: BuildableUnit } | null = null;
  private readonly connectedAllySmallIds: Set<number> = new Set();
  private readonly usedSafetyAllies: Set<number> = new Set();
  private readonly mousePos = { x: 0, y: 0 };
  private lastGhostQueryAt: number = 0;
  private confirmRequestId = 0;

  // Validation runs on a snapped tile. Attacks/upgrades follow the cursor at
  // sub-tile precision; fresh structures remain on their resolved legal tile.
  private lastGhostData: GhostPreviewData | null = null;

  // Static inputs for the nuke trajectory preview (source silo + threatening
  // SAMs). Recomputed in the throttled renderGhost path; cursorLoop rebuilds
  // the Bezier each frame with the live cursor position as the destination so
  // the arc tracks the cursor smoothly instead of snapping tile-to-tile.
  private nukeTrajectoryStatic: {
    srcX: number;
    srcY: number;
    directionUp: boolean;
    sams: SAMInfo[];
  } | null = null;

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    public uiState: UIState,
    private transformHandler: TransformHandler,
    private view: MapRenderer,
    private userSettings: UserSettings,
  ) {}

  init() {
    this.eventBus.on(MouseMoveEvent, (e) => this.moveGhost(e));
    this.eventBus.on(MouseUpEvent, (e) => this.requestConfirmStructure(e));
    this.eventBus.on(ConfirmGhostStructureEvent, () =>
      this.requestConfirmStructure(
        new MouseUpEvent(this.mousePos.x, this.mousePos.y),
      ),
    );
    this.eventBus.on(RequestStructurePlacementEvent, (event) => {
      const queue = this.uiState.structurePlacementQueue;
      if (
        queue?.unitType === event.unitType &&
        queue.generation === event.generation
      ) {
        this.requestQueuedStructurePlacement(
          event.targetTile,
          event.generation,
          event.targetTile,
        );
      }
    });
    this.eventBus.on(AuthoritativeStructurePlacementOutcomeEvent, (outcome) =>
      this.applyAuthoritativeStructureOutcome(outcome),
    );

    // Re-emit each frame. Non-structure targets follow the cursor smoothly;
    // valid fresh structures stay snapped to the resolved placement tile.
    // The shader treats (tileX + 0.5, tileY + 0.5) as the icon center (so an
    // integer tile coord centers on that tile), so we subtract 0.5 here to
    // place the icon exactly under the cursor.
    const cursorLoop = () => {
      const ghost = this.lastGhostData;
      const traj = this.nukeTrajectoryStatic;
      if (ghost !== null || traj !== null) {
        const w = this.transformHandler.screenToWorldCoordinatesFloat(
          this.mousePos.x,
          this.mousePos.y,
        );
        if (ghost !== null) {
          const resolvedStructurePlacement =
            Structures.has(ghost.ghostType as UnitType) &&
            ghost.canBuild &&
            !ghost.canUpgrade;
          if (resolvedStructurePlacement) {
            // Ordinary structures may resolve to a nearby legal tile. Keep the
            // icon and radius snapped there so the chosen tile stays visible.
            this.view.updateGhostPreview(ghost);
          } else {
            // The range circle (defense post / SAM / nuke radius) normally
            // follows the cursor, so smooth it the same way as the icon. When
            // upgrading, it stays anchored to the existing structure's tile.
            const radiusFollowsCursor = !(
              ghost.canUpgrade && ghost.upgradeTargetTile !== null
            );
            this.view.updateGhostPreview({
              ...ghost,
              tileX: w.x - 0.5,
              tileY: w.y - 0.5,
              ...(radiusFollowsCursor
                ? { radiusTileX: w.x - 0.5, radiusTileY: w.y - 0.5 }
                : {}),
            });
          }
        }
        if (traj !== null) {
          // Rebuild the arc with the live cursor as the destination (same
          // tile-center convention as the icon: shader adds +0.5).
          const data = buildNukeTrajectory(
            traj.srcX,
            traj.srcY,
            w.x - 0.5,
            w.y - 0.5,
            this.game.height(),
            traj.directionUp,
            traj.sams,
          );
          // Impassable terrain can't be targeted (nukeSpawn rejects it)
          // even though nukes fly over it — mark the destination with the
          // blocked X. Checked per frame so the X tracks the live cursor.
          const tx = Math.floor(w.x);
          const ty = Math.floor(w.y);
          if (
            this.game.isValidCoord(tx, ty) &&
            this.game.isImpassable(this.game.ref(tx, ty))
          ) {
            data.tSamIntercept = Math.min(data.tSamIntercept, T_BLOCKED_DST);
          }
          this.view.updateNukeTrajectory(data);
        }
      }
      requestAnimationFrame(cursorLoop);
    };
    requestAnimationFrame(cursorLoop);
  }

  tick() {
    // Re-query buildables periodically (world state can change — tiles may
    // become buildable as troops/territory move).
    this.syncGhostState();
    this.renderGhost();
  }

  private applyAuthoritativeStructureOutcome({
    tag,
    outcome,
    spawnTile,
  }: AuthoritativeStructurePlacementOutcomeEvent): void {
    if (outcome === "accepted") {
      acceptQueuedStructurePlacement(
        this.uiState,
        tag.generation,
        tag.requestId,
        spawnTile,
      );
    } else {
      rejectQueuedStructurePlacement(
        this.uiState,
        tag.generation,
        tag.requestId,
      );
    }
  }

  /**
   * Reconcile our internal ghost state with uiState.ghostStructure. Other
   * UI bits (build menu, key bindings) toggle uiState; we mirror it here.
   */
  private syncGhostState(): void {
    const target = this.uiState.ghostStructure;
    const queue = this.uiState.structurePlacementQueue;
    const rocketQueue = this.uiState.rocketTargetSelectionQueue;
    if (queue !== undefined && target !== queue.unitType) {
      clearStructurePlacementQueue(this.uiState);
    }
    if (rocketQueue !== undefined && target !== rocketQueue.unitType) {
      clearRocketTargetSelectionQueue(this.uiState);
    }
    if (this.ghostUnit) {
      if (target === null) {
        this.removeGhostStructure();
      } else if (target !== this.ghostUnit.buildableUnit.type) {
        const preserveQueue =
          this.uiState.structurePlacementQueue?.unitType === target ||
          this.uiState.rocketTargetSelectionQueue?.unitType === target;
        this.clearGhostStructure(!preserveQueue);
        this.createGhostStructure(target);
      }
    } else if (target !== null) {
      this.createGhostStructure(target);
    }
  }

  renderGhost() {
    if (!this.ghostUnit) return;

    const now = performance.now();
    if (now - this.lastGhostQueryAt < 50) return;
    this.lastGhostQueryAt = now;
    let tileRef: TileRef | undefined;
    let trajectoryTileRef: TileRef | undefined;
    const tile = this.transformHandler.screenToWorldCoordinates(
      this.mousePos.x,
      this.mousePos.y,
    );
    if (this.game.isValidCoord(tile.x, tile.y)) {
      tileRef = this.game.ref(tile.x, tile.y);
      trajectoryTileRef = tileRef;
      // Impassable terrain is a void — treat hovering over it the same as
      // hovering outside the map (no ghost, no blast circle). The nuke
      // trajectory preview is the exception: nukes fly over impassable
      // terrain, so the arc still renders (with a blocked X at the
      // untargetable destination — see cursorLoop).
      if (this.game.isImpassable(tileRef)) {
        tileRef = undefined;
      }
    }

    // Check if targeting an ally (for nuke warning visual)
    let targetingAlly = false;
    const myPlayer = this.game.myPlayer();
    const nukeType = this.ghostUnit.buildableUnit.type;
    if (
      tileRef &&
      myPlayer &&
      (nukeType === UnitType.AtomBomb || nukeType === UnitType.HydrogenBomb)
    ) {
      this.connectedAllySmallIds.clear();
      const allies = myPlayer.allies();
      for (let i = 0; i < allies.length; i++) {
        const ally = allies[i];
        if (!ally.isDisconnected()) {
          this.connectedAllySmallIds.add(ally.smallID());
        }
      }

      if (this.connectedAllySmallIds.size > 0) {
        targetingAlly = wouldNukeBreakAlliance({
          game: this.game,
          targetTile: tileRef,
          magnitude: this.game.config().nukeMagnitudes(nukeType),
          allySmallIds: this.connectedAllySmallIds,
          threshold: this.game.config().nukeAllianceBreakThreshold(),
        });
      }
    }

    this.game
      ?.myPlayer()
      ?.buildables(tileRef, [this.ghostUnit?.buildableUnit.type])
      .then((buildables) => {
        if (!this.ghostUnit) {
          this.emitGhostPreview(tileRef, targetingAlly, trajectoryTileRef);
          return;
        }

        const unit = buildables.find(
          (u) => u.type === this.ghostUnit!.buildableUnit.type,
        );
        if (!unit) {
          Object.assign(this.ghostUnit.buildableUnit, {
            canBuild: false,
            canUpgrade: false,
          });
          this.emitGhostPreview(tileRef, targetingAlly, trajectoryTileRef);
          return;
        }

        this.ghostUnit.buildableUnit = this.forPlacementQueue(unit);

        this.emitGhostPreview(tileRef, targetingAlly, trajectoryTileRef);
      });
  }

  /**
   * Push a GhostPreviewData snapshot to the WebGL view (StructurePass /
   * RangeCirclePass / RailroadPass / CrosshairPass all read it). null when
   * the ghost can't be placed. smoothLoop interpolates displayed position
   * toward the target tile each frame.
   */
  private emitGhostPreview(
    tileRef: TileRef | undefined,
    targetingAlly: boolean,
    trajectoryTileRef: TileRef | undefined,
  ): void {
    const data = this.buildGhostPreviewData(tileRef, targetingAlly);
    if (data === null) {
      this.lastGhostData = null;
      this.view.updateGhostPreview(null);
    } else {
      this.lastGhostData = data;
    }
    // The trajectory target is tracked separately from the ghost tile:
    // impassable terrain voids the ghost but still gets a trajectory arc.
    this.updateNukeTrajectoryPreview(trajectoryTileRef);
  }

  /**
   * For AtomBomb / HydrogenBomb ghosts, push the Bezier trajectory preview
   * (closest player-owned silo → target, accounting for non-allied SAMs).
   * Cleared whenever the ghost isn't a nuke, has no target, or the player
   * has no silos. Unlike the ghost icon, the trajectory also renders when
   * hovering impassable terrain (cursorLoop adds the blocked X there).
   */
  private updateNukeTrajectoryPreview(tileRef: TileRef | undefined): void {
    if (!this.ghostUnit || tileRef === undefined) {
      this.clearNukeTrajectory();
      return;
    }
    const type = this.ghostUnit.buildableUnit.type;
    if (type !== UnitType.AtomBomb && type !== UnitType.HydrogenBomb) {
      this.clearNukeTrajectory();
      return;
    }
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) {
      this.clearNukeTrajectory();
      return;
    }

    // Mirror PlayerImpl.nukeSpawn (the source NukeExecution actually fires
    // from): only silos that are active, not reloading, and not under
    // construction are eligible, and the nearest (Manhattan distance) is
    // chosen. Keeping these in sync prevents the preview arc from
    // originating from a silo the game wouldn't use.
    const silos = myPlayer
      .units(UnitType.MissileSilo)
      .filter(
        (u) => u.isActive() && !u.isInCooldown() && !u.isUnderConstruction(),
      );
    if (silos.length === 0) {
      this.clearNukeTrajectory();
      return;
    }

    const dstX = this.game.x(tileRef);
    const dstY = this.game.y(tileRef);
    silos.sort(
      (a, b) =>
        Math.abs(this.game.x(a.tile()) - dstX) +
        Math.abs(this.game.y(a.tile()) - dstY) -
        (Math.abs(this.game.x(b.tile()) - dstX) +
          Math.abs(this.game.y(b.tile()) - dstY)),
    );

    const bestSilo = silos[0];
    const directionUp = this.uiState.rocketDirectionUp;
    const srcX = this.game.x(bestSilo.tile());
    const srcY = this.game.y(bestSilo.tile());

    // Non-friendly SAMs threaten the trajectory; own + teammate + allied SAMs
    // don't — except allies this strike would betray: the alliance breaks at
    // launch (NukeExecution.maybeBreakAlliances), so their SAMs will intercept.
    // Teammates have no such exception (a strike never breaks a team).
    // listNukeBreakAlliance is the same function the sim uses there.
    const teammateIds = new Set<number>();
    for (const p of this.game.players()) {
      if (myPlayer.isOnSameTeam(p)) teammateIds.add(p.smallID());
    }
    const allyIds = new Set<number>();
    for (const a of myPlayer.allies()) allyIds.add(a.smallID());
    const betrayedIds: ReadonlySet<number> =
      allyIds.size > 0
        ? listNukeBreakAlliance({
            game: this.game,
            targetTile: tileRef,
            magnitude: this.game.config().nukeMagnitudes(type),
            threshold: this.game.config().nukeAllianceBreakThreshold(),
          })
        : new Set();
    const sams: SAMInfo[] = [];
    for (const s of this.game.units(UnitType.SAMLauncher)) {
      if (!s.isActive()) continue;
      const owner = s.owner();
      if (owner === myPlayer) continue;
      if (
        !samThreatensNukePreview(
          owner.smallID(),
          teammateIds,
          allyIds,
          betrayedIds,
        )
      ) {
        continue;
      }
      const r = this.game
        .config()
        .airDefenseRadius(s.airDefenseSystem(), s.level());
      sams.push({
        x: this.game.x(s.tile()),
        y: this.game.y(s.tile()),
        rangeSq: r * r,
      });
    }

    // Stash the static inputs; cursorLoop rebuilds the Bezier each frame with
    // the live cursor as the destination so the arc tracks smoothly.
    this.nukeTrajectoryStatic = {
      srcX,
      srcY,
      directionUp,
      sams,
    };
  }

  private clearNukeTrajectory(): void {
    this.nukeTrajectoryStatic = null;
    this.view.updateNukeTrajectory(null);
  }

  private buildGhostPreviewData(
    tileRef: TileRef | undefined,
    targetingAlly: boolean,
  ): GhostPreviewData | null {
    if (!this.ghostUnit) return null;
    if (tileRef === undefined) return null;
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return null;

    const u = this.ghostUnit.buildableUnit;
    const placementTile =
      Structures.has(u.type) && u.canUpgrade === false && u.canBuild !== false
        ? u.canBuild
        : tileRef;

    // Upgrade-target tile — only when upgrading an existing unit.
    let upgradeTargetTile: number | null = null;
    if (u.canUpgrade !== false) {
      upgradeTargetTile = this.game.unit(u.canUpgrade)?.tile() ?? null;
    }

    // Range circle: SAM placement preview shows targetable radius; nuke
    // previews show the outer blast radius at the target tile.
    let rangeRadius = 0;
    switch (u.type) {
      case UnitType.SAMLauncher: {
        const level = this.resolveGhostRangeLevel(u) ?? 1;
        // An upgrade previews the existing launcher's system; a fresh
        // placement previews the system chosen for the queued order.
        const queue = this.uiState.structurePlacementQueue;
        const system =
          u.canUpgrade !== false
            ? this.game.unit(u.canUpgrade)?.airDefenseSystem()
            : queue?.unitType === UnitType.SAMLauncher
              ? queue.airDefenseSystem
              : undefined;
        rangeRadius = this.game.config().airDefenseRadius(system, level);
        break;
      }
      case UnitType.AtomBomb:
      case UnitType.HydrogenBomb:
        rangeRadius = this.game.config().nukeMagnitudes(u.type).outer;
        break;
      case UnitType.Factory:
        rangeRadius = this.game.config().trainStationMaxRange();
        break;
      case UnitType.DefensePost:
        rangeRadius = this.game.config().defensePostRange();
        break;
    }
    let radiusTileX = this.game.x(placementTile);
    let radiusTileY = this.game.y(placementTile);
    if (
      rangeRadius > 0 &&
      u.canUpgrade !== false &&
      upgradeTargetTile !== null
    ) {
      radiusTileX = this.game.x(upgradeTargetTile);
      radiusTileY = this.game.y(upgradeTargetTile);
    }

    const isNuke =
      u.type === UnitType.AtomBomb || u.type === UnitType.HydrogenBomb;
    const requestedMultiplier =
      u.canUpgrade !== false || isNuke
        ? (this.uiState.upgradeMultiplier ?? 1)
        : 1;
    const multiplier = resolvedBuildMultiplier(
      this.game.config().depthProgressionEnabled?.() === true,
      u.type,
      u.canUpgrade !== false,
      requestedMultiplier,
    );
    const cost = bulkCost(u, multiplier);
    // Drives the red cost label: gold short of the bulk total, or (for
    // bombs) fewer loaded silo tubes than the selected amount.
    let canAfford = myPlayer.gold() >= cost;
    if (isNuke) {
      canAfford &&= myPlayer.readyMissileCount() >= multiplier;
    }
    return {
      ghostType: u.type,
      tileX: this.game.x(placementTile),
      tileY: this.game.y(placementTile),
      radiusTileX,
      radiusTileY,
      canBuild: u.canBuild !== false,
      canUpgrade: u.canUpgrade !== false,
      cost: Number(cost),
      multiplier: multiplier,
      remainingPlacements: queuedStructurePlacements(this.uiState, u.type),
      remainingTargetSelections: queuedRocketTargets(this.uiState, u.type),
      showCost: this.userSettings.cursorCostLabel(),
      canAfford,
      ghostRailPaths: u.ghostRailPaths,
      overlappingRailroads: u.overlappingRailroads,
      ownerID: myPlayer.smallID(),
      upgradeTargetTile,
      rangeRadius,
      rangeWarning: targetingAlly,
    };
  }

  private isGhostReadyForConfirm(): boolean {
    if (!this.ghostUnit) return false;
    const bu = this.ghostUnit.buildableUnit;
    if (
      queuedStructurePlacements(this.uiState, bu.type) > 0 ||
      queuedRocketTargets(this.uiState, bu.type) > 0
    ) {
      return bu.canBuild !== false;
    }
    return bu.canBuild !== false || bu.canUpgrade !== false;
  }

  private requestConfirmStructure(e: MouseUpEvent): void {
    if (!this.ghostUnit && !this.uiState.ghostStructure) return;
    if (!this.ghostUnit) {
      this.createGhostStructure(this.uiState.ghostStructure);
    }
    const type = this.ghostUnit?.buildableUnit.type;
    const player = this.game.myPlayer();
    if (type === undefined || !player) return;
    const tile = this.transformHandler.screenToWorldCoordinates(e.x, e.y);
    if (!this.game.isValidCoord(tile.x, tile.y)) return;
    const tileRef = this.game.ref(tile.x, tile.y);
    const queue = this.uiState.structurePlacementQueue;
    if (queue?.unitType === type) {
      const expectedSpawnTile = this.ghostUnit?.buildableUnit.canBuild;
      if (expectedSpawnTile === false || expectedSpawnTile === undefined) {
        return;
      }
      this.requestQueuedStructurePlacement(
        tileRef,
        queue.generation,
        expectedSpawnTile,
      );
      return;
    }
    const requestId = ++this.confirmRequestId;
    const revision = structurePlacementRevision(this.uiState);

    // Validate the exact clicked tile. A prior hover result may belong to a
    // different tile and must never consume a queued placement.
    void player.buildables(tileRef, [type]).then((buildables) => {
      if (
        requestId !== this.confirmRequestId ||
        structurePlacementRevision(this.uiState) !== revision ||
        this.ghostUnit?.buildableUnit.type !== type
      ) {
        return;
      }
      const buildableUnit = buildables.find((unit) => unit.type === type);
      if (buildableUnit === undefined) return;
      this.ghostUnit.buildableUnit = this.forPlacementQueue(buildableUnit);
      if (
        Structures.has(type) &&
        buildableUnit.canBuild !== false &&
        buildableUnit.canUpgrade === false
      ) {
        // The exact click query can resolve differently from the last hover.
        // Publish that snapped tile before opening the quantity chooser.
        const preview = this.buildGhostPreviewData(tileRef, false);
        this.lastGhostData = preview;
        this.view.updateGhostPreview(preview);
      }
      if (this.isGhostReadyForConfirm()) this.createStructure(e);
    });
  }

  private requestQueuedStructurePlacement(
    targetTile: TileRef,
    generation: number,
    expectedSpawnTile: TileRef,
  ): void {
    const queue = this.uiState.structurePlacementQueue;
    const player = this.game.myPlayer();
    if (
      player === null ||
      queue === undefined ||
      queue.generation !== generation
    ) {
      return;
    }
    const requestId = ++this.confirmRequestId;
    if (
      !beginQueuedStructureValidation(
        this.uiState,
        generation,
        requestId,
        targetTile,
      )
    ) {
      return;
    }
    const unitType = queue.unitType;
    void player
      .buildables(targetTile, [unitType])
      .then((buildables) => {
        if (!structurePlacementQueueIsCurrent(this.uiState, generation)) {
          return;
        }
        const buildableUnit = buildables.find((unit) => unit.type === unitType);
        if (buildableUnit?.canBuild === false || buildableUnit === undefined) {
          rejectQueuedStructurePlacement(this.uiState, generation, requestId);
          return;
        }
        const spawnTile = buildableUnit.canBuild as TileRef;
        if (spawnTile !== expectedSpawnTile) {
          rejectQueuedStructurePlacement(this.uiState, generation, requestId);
          return;
        }
        if (
          isStructurePlacementTileConfirmed(this.uiState, generation, spawnTile)
        ) {
          rejectQueuedStructurePlacement(this.uiState, generation, requestId);
          return;
        }
        if (
          !awaitQueuedStructureAcceptance(
            this.uiState,
            generation,
            requestId,
            spawnTile,
          )
        ) {
          return;
        }
        this.eventBus.emit(
          new BuildUnitIntentEvent(
            unitType,
            spawnTile,
            STRUCTURE_PLACEMENT_ONLY_SENTINEL,
            1,
            {
              generation,
              requestId,
            },
            undefined,
            queue.airDefenseSystem,
          ),
        );
      })
      .catch(() => {
        rejectQueuedStructurePlacement(this.uiState, generation, requestId);
      });
  }

  private forPlacementQueue(buildableUnit: BuildableUnit): BuildableUnit {
    if (queuedStructurePlacements(this.uiState, buildableUnit.type) === 0) {
      return buildableUnit;
    }
    return {
      ...buildableUnit,
      canUpgrade: false,
      upgradeCosts: undefined,
    };
  }

  private createStructure(e: MouseUpEvent) {
    if (!this.ghostUnit) return;
    if (
      this.ghostUnit.buildableUnit.canBuild === false &&
      this.ghostUnit.buildableUnit.canUpgrade === false
    ) {
      this.removeGhostStructure();
      return;
    }
    const tile = this.transformHandler.screenToWorldCoordinates(e.x, e.y);
    const buildableUnit = this.ghostUnit.buildableUnit;
    const player = this.game.myPlayer();
    if (!player) return;
    if (buildableUnit.canUpgrade !== false) {
      const initial = resolvedBuildMultiplier(
        this.game.config().depthProgressionEnabled?.() === true,
        buildableUnit.type,
        true,
        this.uiState.upgradeMultiplier || 1,
      );
      this.eventBus.emit(
        new RequestCommandQuantityEvent({
          kind: "upgrade",
          itemName: translateText(unitTypeTranslationKey(buildableUnit.type)),
          max: maxBulkAmount(buildableUnit, player.gold()),
          initial,
          totalCost: (amount) => bulkCost(buildableUnit, amount),
          onConfirm: (amount) => {
            this.eventBus.emit(
              new SendUpgradeStructureIntentEvent(
                buildableUnit.canUpgrade as number,
                buildableUnit.type,
                amount,
              ),
            );
            this.removeGhostStructure();
          },
        }),
      );
    } else if (buildableUnit.canBuild !== false) {
      const unitType = buildableUnit.type;
      const targetTile = this.game.ref(tile.x, tile.y);

      if (this.shouldBlockRecentAllyNuke(targetTile, unitType)) {
        return;
      }

      const isTubeLaunched =
        unitType === UnitType.AtomBomb || unitType === UnitType.HydrogenBomb;
      const isSiloLaunched = isTubeLaunched || unitType === UnitType.MIRV;
      const rocketDirectionUp = isTubeLaunched
        ? this.uiState.rocketDirectionUp
        : undefined;
      const activeRocketQueue = this.uiState.rocketTargetSelectionQueue;
      if (
        isTubeLaunched &&
        activeRocketQueue?.unitType === unitType &&
        activeRocketQueue.remaining > 0
      ) {
        this.selectQueuedRocketTarget(
          unitType,
          targetTile,
          activeRocketQueue.generation,
        );
        return;
      }
      const affordable = maxBulkAmount(buildableUnit, player.gold());
      const isStructure = Structures.has(unitType);
      const maximum = Math.min(
        MAX_COMMAND_AMOUNT,
        isSiloLaunched
          ? Math.min(affordable, player.readyMissileCount())
          : isStructure
            ? maxFreshConstructionAmount(
                buildableUnit,
                player.gold(),
                MAX_COMMAND_AMOUNT,
              )
            : affordable,
      );
      const chooserRevision = isStructure
        ? beginStructurePlacementRequest(this.uiState)
        : isSiloLaunched
          ? beginRocketTargetSelectionRequest(this.uiState)
          : undefined;
      this.eventBus.emit(
        new RequestCommandQuantityEvent({
          kind: isStructure ? "construction" : "launch",
          itemName: translateText(unitTypeTranslationKey(unitType)),
          max: maximum,
          initial: isTubeLaunched ? this.uiState.upgradeMultiplier || 1 : 1,
          separatePlacement: isStructure,
          separateTargets: isSiloLaunched,
          totalCost: isStructure
            ? undefined
            : (amount) => bulkCost(buildableUnit, amount),
          onCancel:
            chooserRevision === undefined
              ? undefined
              : () => {
                  const cleared = isStructure
                    ? clearStructurePlacementQueueIfCurrent(
                        this.uiState,
                        chooserRevision,
                      )
                    : clearRocketTargetSelectionQueueIfCurrent(
                        this.uiState,
                        chooserRevision,
                      );
                  if (cleared && isStructure) {
                    this.uiState.ghostStructure = null;
                    this.clearGhostStructure(false);
                  }
                },
          onConfirm: (amount) => {
            if (isStructure) {
              const generation = startStructurePlacementQueue(
                this.uiState,
                unitType,
                amount,
                chooserRevision as number,
              );
              if (generation === false) return;
              this.requestQueuedStructurePlacement(
                targetTile,
                generation,
                buildableUnit.canBuild as TileRef,
              );
              return;
            }
            if (isSiloLaunched && amount > 1) {
              const generation = startRocketTargetSelectionQueue(
                this.uiState,
                unitType,
                amount,
                rocketDirectionUp ?? true,
                chooserRevision as number,
              );
              if (generation === false) return;
              this.selectQueuedRocketTarget(unitType, targetTile, generation);
              return;
            }
            this.eventBus.emit(
              new BuildUnitIntentEvent(
                unitType,
                targetTile,
                rocketDirectionUp,
                amount,
              ),
            );
            if (!shouldPreserveGhostAfterBuild(unitType)) {
              this.removeGhostStructure();
            }
          },
        }),
      );
    } else {
      this.removeGhostStructure();
    }
  }

  private shouldBlockRecentAllyNuke(
    tile: TileRef,
    unitType: UnitType,
  ): boolean {
    const duration = this.userSettings.nukeAllianceSafetyDuration();
    if (
      duration <= 0 ||
      (unitType !== UnitType.AtomBomb &&
        unitType !== UnitType.HydrogenBomb &&
        unitType !== UnitType.MIRV)
    ) {
      return false;
    }

    const alliances = this.game.myPlayer()?.alliances();
    if (!alliances?.length) return false;

    const currentTick = this.game.ticks();
    const freshAllies = new Map<number, number>();
    for (const a of alliances) {
      if (
        !this.usedSafetyAllies.has(a.id) &&
        currentTick - a.createdAt <= duration
      ) {
        freshAllies.set(this.game.player(a.other).smallID(), a.id);
      }
    }
    if (freshAllies.size === 0) return false;

    const broken =
      unitType === UnitType.MIRV
        ? [this.game.ownerID(tile)]
        : listNukeBreakAlliance({
            game: this.game,
            targetTile: tile,
            magnitude: this.game.config().nukeMagnitudes(unitType),
            threshold: this.game.config().nukeAllianceBreakThreshold(),
          });

    let blocked = false;
    for (const smallId of broken) {
      const allianceId = freshAllies.get(smallId);
      if (allianceId !== undefined) {
        this.usedSafetyAllies.add(allianceId);
        blocked = true;
      }
    }

    if (blocked) {
      this.view.triggerBlockedFlash(
        this.game.x(tile) + 0.5,
        this.game.y(tile) + 0.5,
      );
    }
    return blocked;
  }

  private selectQueuedRocketTarget(
    unitType: PlayerBuildableUnitType,
    targetTile: TileRef,
    generation: number,
  ): void {
    const queue = this.uiState.rocketTargetSelectionQueue;
    if (queue?.generation !== generation || queue.unitType !== unitType) return;
    const rocketDirectionUp = queue.rocketDirectionUp;
    const selection = recordRocketTargetSelection(
      this.uiState,
      generation,
      unitType,
      targetTile,
    );
    if (selection === false || selection.targetTiles === undefined) return;
    const targetTiles = [...selection.targetTiles];
    this.eventBus.emit(
      new BuildUnitIntentEvent(
        unitType,
        targetTiles[0],
        rocketDirectionUp,
        targetTiles.length,
        undefined,
        targetTiles,
      ),
    );
    this.clearGhostStructure(false);
  }

  private moveGhost(e: MouseMoveEvent) {
    this.mousePos.x = e.x;
    this.mousePos.y = e.y;
  }

  private createGhostStructure(type: PlayerBuildableUnitType | null) {
    if (type === null) return;
    if (this.game.myPlayer() === null) return;
    this.ghostUnit = {
      buildableUnit: {
        type,
        canBuild: false,
        canUpgrade: false,
        cost: 0n,
        overlappingRailroads: [],
        ghostRailPaths: [],
      },
    };
  }

  private clearGhostStructure(clearQueue = true) {
    this.confirmRequestId++;
    if (clearQueue) {
      clearStructurePlacementQueue(this.uiState);
      if (this.uiState.rocketTargetSelectionQueue !== undefined) {
        clearRocketTargetSelectionQueue(this.uiState);
      }
    }
    this.ghostUnit = null;
    this.lastGhostData = null;
    this.view.updateGhostPreview(null);
    this.clearNukeTrajectory();
  }

  private removeGhostStructure() {
    this.clearGhostStructure();
    this.uiState.ghostStructure = null;
  }

  private resolveGhostRangeLevel(
    buildableUnit: BuildableUnit,
  ): number | undefined {
    if (buildableUnit.type !== UnitType.SAMLauncher) return undefined;
    if (buildableUnit.canUpgrade !== false) {
      const existing = this.game.unit(buildableUnit.canUpgrade);
      if (existing) {
        return existing.level() + 1;
      } else {
        console.error("Failed to find existing SAMLauncher for upgrade");
      }
    }
    return 1;
  }
}
