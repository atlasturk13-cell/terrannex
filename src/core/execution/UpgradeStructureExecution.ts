import {
  DEPTH_STRUCTURE_MAX_LEVEL,
  DepthProgressionStructures,
  Execution,
  Game,
  Player,
  Unit,
} from "../game/Game";

export class UpgradeStructureExecution implements Execution {
  private structure: Unit | undefined;
  private cost: bigint;

  constructor(
    private player: Player,
    private unitId: number,
    private amount: number = 1,
  ) {}

  init(mg: Game, ticks: number): void {
    if (mg.config().depthProgressionEnabled()) {
      this.initDepthProgression(mg);
      return;
    }

    // Preserve the legacy partial/beyond-L5 behavior when the local profile is
    // absent or explicitly disabled.
    this.structure = mg.unit(this.unitId);
    if (this.structure && this.structure.owner() !== this.player) {
      console.warn(`structure not owned by player`);
      this.structure = undefined;
    }

    if (this.structure === undefined) {
      console.warn(`structure is undefined`);
      return;
    }

    for (let i = 0; i < this.amount; i++) {
      if (!this.player.canUpgradeUnit(this.structure)) {
        if (i === 0) {
          console.warn(
            `[UpgradeStructureExecution] unit type ${this.structure.type()} cannot be upgraded`,
          );
        }
        break;
      }
      this.player.upgradeUnit(this.structure);
    }
    return;
  }

  private initDepthProgression(mg: Game): void {
    if (!Number.isInteger(this.amount) || this.amount <= 0) {
      console.warn(`[UpgradeStructureExecution] invalid amount ${this.amount}`);
      return;
    }

    const structure = mg.unit(this.unitId);
    if (structure === undefined) {
      console.warn(`[UpgradeStructureExecution] structure is undefined`);
      return;
    }

    const type = structure.type();
    if (
      !DepthProgressionStructures.has(type) ||
      mg.config().isUnitDisabled(type) ||
      mg.unitInfo(type).upgradable !== true ||
      structure.owner() !== this.player ||
      !structure.isActive() ||
      structure.isMarkedForDeletion() ||
      structure.isUnderConstruction() ||
      !this.player.isAlive() ||
      structure.level() + this.amount > DEPTH_STRUCTURE_MAX_LEVEL
    ) {
      console.warn(
        `[UpgradeStructureExecution] ${type} failed atomic upgrade preflight`,
      );
      return;
    }

    const info = mg.unitInfo(type);
    let totalCost = 0n;
    for (let i = 0; i < this.amount; i++) {
      totalCost += info.cost(mg, this.player, i);
    }
    if (this.player.gold() < totalCost) {
      console.warn(
        `[UpgradeStructureExecution] insufficient gold for atomic upgrade`,
      );
      return;
    }

    // All validation and pricing completes before the first mutation. Cost is
    // recalculated by upgradeUnit after each constructed-count increment; the
    // preflight offsets above mirror those exact sequential prices.
    this.structure = structure;
    this.cost = totalCost;
    for (let i = 0; i < this.amount; i++) {
      this.player.upgradeUnit(structure);
    }
  }

  tick(ticks: number): void {
    return;
  }

  isActive(): boolean {
    return false;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
