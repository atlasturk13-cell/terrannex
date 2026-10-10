import { airDefenseCost } from "../game/AirDefenseProfiles";
import {
  AirDefenseSystem,
  DepthProgressionStructures,
  Execution,
  Game,
  Player,
  STRUCTURE_PLACEMENT_ONLY_SENTINEL,
  Tick,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { WARSHIP_DEPARTURE_INTERVAL_TICKS } from "../game/NavalOperations";
import { AirportExecution } from "./AirportExecution";
import { CityExecution } from "./CityExecution";
import { DefensePostExecution } from "./DefensePostExecution";
import { FactoryExecution } from "./FactoryExecution";
import { MirvExecution } from "./MIRVExecution";
import { MissileSiloExecution } from "./MissileSiloExecution";
import { NukeExecution } from "./NukeExecution";
import { PortExecution } from "./PortExecution";
import { SAMLauncherExecution } from "./SAMLauncherExecution";
import { UpgradeStructureExecution } from "./UpgradeStructureExecution";
import { WarshipExecution } from "./WarshipExecution";

export type StructurePlacementOutcome = "pending" | "accepted" | "rejected";

export class ConstructionExecution implements Execution {
  private structure: Unit | null = null;
  private active: boolean = true;
  private mg: Game;

  private ticksUntilComplete: Tick;
  /** Client-observable result for one physical structure placement. */
  private structurePlacementOutcome: StructurePlacementOutcome = "pending";
  private structureSpawnTile: TileRef | undefined;
  private structureUnitID: number | undefined;
  /** Warship orders: ships still waiting to leave, and when the next one may. */
  private warshipsRemaining = 0;
  private nextWarshipDepartureTick: Tick = 0;

  constructor(
    private player: Player,
    private constructionType: UnitType,
    private tile: TileRef,
    private rocketDirectionUp?: boolean,
    private amount?: number,
    private targetTiles?: readonly TileRef[],
    /** SAM Launcher only: the air-defense system to build it as. */
    private airDefenseSystem?: AirDefenseSystem,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;

    const amount = this.amount ?? 1;
    if (amount !== 1 && !this.supportsBatchConstruction()) {
      console.warn(
        `cannot build singleton construction ${this.constructionType} with amount ${amount}`,
      );
      this.active = false;
      this.structurePlacementOutcome = "rejected";
      return;
    }

    if (
      this.targetTiles !== undefined &&
      (!this.supportsBatchConstruction() ||
        this.targetTiles.length !== amount ||
        this.targetTiles[0] !== this.tile ||
        this.targetTiles.some((target) => !this.mg.isValidRef(target)))
    ) {
      console.warn(
        `cannot build ${this.constructionType} with an invalid explicit target list`,
      );
      this.active = false;
      this.structurePlacementOutcome = "rejected";
      return;
    }

    if (this.mg.config().isUnitDisabled(this.constructionType)) {
      console.warn(
        `cannot build construction ${this.constructionType} because it is disabled`,
      );
      this.active = false;
      this.structurePlacementOutcome = "rejected";
      return;
    }

    if (
      this.airDefenseSystem !== undefined &&
      this.constructionType !== UnitType.SAMLauncher
    ) {
      console.warn(
        `cannot build ${this.constructionType} as air-defense system ${this.airDefenseSystem}`,
      );
      this.active = false;
      this.structurePlacementOutcome = "rejected";
      return;
    }

    if (!this.mg.isValidRef(this.tile)) {
      console.warn(`cannot build construction invalid tile ${this.tile}`);
      this.active = false;
      this.structurePlacementOutcome = "rejected";
      return;
    }
  }

  tick(ticks: number): void {
    if (this.warshipsRemaining > 0) {
      this.launchDueWarships(ticks);
      return;
    }
    if (this.structure === null) {
      const info = this.mg.unitInfo(this.constructionType);
      // For non-structure units (nukes/warship), charge once and delegate to specialized executions.
      const isStructure = this.isStructure(this.constructionType);
      const placementOnly =
        isStructure &&
        this.rocketDirectionUp === STRUCTURE_PLACEMENT_ONLY_SENTINEL;
      if (!isStructure) {
        if (this.constructionType === UnitType.Warship) {
          this.startWarshipOrder(ticks);
          return;
        }
        // Defer validation and gold deduction to the specific execution
        this.completeConstruction();
        this.active = false;
        return;
      }

      if (this.mg.config().depthProgressionEnabled()) {
        const existing = this.player.findExistingUnitToUpgrade(
          this.constructionType,
          this.tile,
        );
        if (existing !== false) {
          // Raw colocated build intents are authoritative too: upgrade exactly
          // one level through the same atomic preflight. L5, invalid and fixed
          // L1 targets are consumed as a no-op, never as an overlapping build.
          if (DepthProgressionStructures.has(this.constructionType)) {
            if (!placementOnly) {
              this.mg.addExecution(
                new UpgradeStructureExecution(this.player, existing.id(), 1),
              );
            }
          }
          this.structurePlacementOutcome = "rejected";
          this.active = false;
          return;
        }
      }

      // Structures: build real unit and mark under construction
      const exactPlacement =
        placementOnly || this.constructionType === UnitType.Airport;
      const spawnTile = exactPlacement
        ? this.player.canBuildExact(this.constructionType, this.tile)
        : this.player.canBuild(this.constructionType, this.tile);
      if (spawnTile === false) {
        console.warn(`cannot build ${this.constructionType}`);
        this.structurePlacementOutcome = "rejected";
        this.active = false;
        return;
      }
      // canBuild checked the baseline price; a dearer air-defense system is
      // priced here, before any mutation.
      if (
        this.airDefenseSystem !== undefined &&
        this.player.gold() <
          airDefenseCost(info.cost(this.mg, this.player), this.airDefenseSystem)
      ) {
        console.warn(
          `cannot afford air-defense system ${this.airDefenseSystem}`,
        );
        this.structurePlacementOutcome = "rejected";
        this.active = false;
        return;
      }
      this.structure = this.player.buildUnit(
        this.constructionType,
        spawnTile,
        this.airDefenseSystem === undefined
          ? {}
          : { airDefenseSystem: this.airDefenseSystem },
      );
      this.structureSpawnTile = spawnTile;
      this.structureUnitID = this.structure.id();
      this.structurePlacementOutcome = "accepted";
      const duration = info.constructionDuration ?? 0;
      if (duration > 0) {
        this.structure.setUnderConstruction(true);
        this.ticksUntilComplete = duration;
        return;
      }
      // No construction time
      this.completeConstruction();
      this.active = false;
      return;
    }

    if (!this.structure.isActive()) {
      this.active = false;
      return;
    }

    if (this.player !== this.structure.owner()) {
      this.player = this.structure.owner();
    }

    if (this.ticksUntilComplete === 0) {
      this.player = this.structure.owner();
      this.completeConstruction();
      this.active = false;
      return;
    }
    this.ticksUntilComplete--;
  }

  private completeConstruction() {
    if (this.structure) {
      this.structure.setUnderConstruction(false);
    }
    const player = this.player;
    switch (this.constructionType) {
      case UnitType.AtomBomb:
      case UnitType.HydrogenBomb: {
        const count = this.amount ?? 1;
        const targets =
          this.targetTiles ?? Array<TileRef>(count).fill(this.tile);
        for (const target of targets) {
          // NukeExecution staggers same-tick launches per silo itself.
          this.mg.addExecution(
            new NukeExecution(
              this.constructionType,
              player,
              target,
              null,
              -1,
              0,
              this.rocketDirectionUp,
            ),
          );
        }
        break;
      }
      case UnitType.MIRV: {
        const count = this.amount ?? 1;
        const targets =
          this.targetTiles ?? Array<TileRef>(count).fill(this.tile);
        for (const target of targets) {
          // Each MIRV preflights its own ready silo; extras beyond the ready
          // silo count fail closed without spending gold.
          this.mg.addExecution(new MirvExecution(player, target));
        }
        break;
      }
      case UnitType.Warship:
        // Orders go through startWarshipOrder; a stray call launches one ship.
        this.mg.addExecution(
          new WarshipExecution({ owner: player, patrolTile: this.tile }),
        );
        break;
      case UnitType.Port:
        this.mg.addExecution(new PortExecution(this.structure!));
        break;
      case UnitType.MissileSilo:
        this.mg.addExecution(new MissileSiloExecution(this.structure!));
        break;
      case UnitType.DefensePost:
        this.mg.addExecution(new DefensePostExecution(this.structure!));
        break;
      case UnitType.SAMLauncher:
        this.mg.addExecution(
          new SAMLauncherExecution(player, null, this.structure!),
        );
        break;
      case UnitType.City:
        this.mg.addExecution(new CityExecution(this.structure!));
        break;
      case UnitType.Factory:
        this.mg.addExecution(new FactoryExecution(this.structure!));
        break;
      case UnitType.Airport:
        this.mg.addExecution(new AirportExecution(this.structure!));
        break;
      case UnitType.Barracks:
        // Passive: population and training speed are read from the unit.
        break;
      default:
        console.warn(
          `unit type ${this.constructionType} cannot be constructed`,
        );
        break;
    }
  }

  /**
   * A warship order leaves the port one ship at a time, like jets of one
   * Airport order leave the runway. The first ship departs on this tick
   * exactly as a single order always has (its own execution validates the
   * port and pays); the rest follow WARSHIP_DEPARTURE_INTERVAL_TICKS apart.
   */
  private startWarshipOrder(ticks: Tick): void {
    this.mg.addExecution(
      new WarshipExecution({ owner: this.player, patrolTile: this.tile }),
    );
    this.warshipsRemaining = (this.amount ?? 1) - 1;
    this.nextWarshipDepartureTick = ticks + WARSHIP_DEPARTURE_INTERVAL_TICKS;
    this.active = this.warshipsRemaining > 0;
  }

  /**
   * Each following ship is paid when it leaves, as it always was, so a ship
   * whose owner died, lost the port or ran out of gold in the meantime ends
   * the order without a partial charge instead of stacking a failed launch.
   */
  private launchDueWarships(ticks: Tick): void {
    if (ticks < this.nextWarshipDepartureTick) return;
    if (
      !this.player.isAlive() ||
      this.player.canBuild(UnitType.Warship, this.tile) === false
    ) {
      console.warn(
        `warship order for ${this.player.name()} ends with ${this.warshipsRemaining} ship(s) not launched`,
      );
      this.warshipsRemaining = 0;
      this.active = false;
      return;
    }
    this.mg.addExecution(
      new WarshipExecution({ owner: this.player, patrolTile: this.tile }),
    );
    this.warshipsRemaining--;
    this.nextWarshipDepartureTick = ticks + WARSHIP_DEPARTURE_INTERVAL_TICKS;
    this.active = this.warshipsRemaining > 0;
  }

  private isStructure(type: UnitType): boolean {
    switch (type) {
      case UnitType.Port:
      case UnitType.MissileSilo:
      case UnitType.DefensePost:
      case UnitType.SAMLauncher:
      case UnitType.City:
      case UnitType.Factory:
      case UnitType.Airport:
      case UnitType.Barracks:
        return true;
      default:
        return false;
    }
  }

  /**
   * Repeatable single-unit commands. Each copy still runs its own authoritative
   * preflight (silo/port availability, gold, target validity) so an oversized
   * order degrades to the legal subset instead of mutating on failure.
   */
  private supportsBatchConstruction(): boolean {
    return (
      this.constructionType === UnitType.AtomBomb ||
      this.constructionType === UnitType.HydrogenBomb ||
      this.constructionType === UnitType.MIRV ||
      this.constructionType === UnitType.Warship
    );
  }

  /** Definitive result once authoritative execution accepts or rejects x1. */
  placementOutcome(): StructurePlacementOutcome {
    return this.structurePlacementOutcome;
  }

  placementSpawnTile(): TileRef | undefined {
    return this.structureSpawnTile;
  }

  placementUnitID(): number | undefined {
    return this.structureUnitID;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
