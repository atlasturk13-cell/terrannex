import {
  Execution,
  Game,
  Player,
  PlayerType,
  Unit,
  UnitType,
  WARSHIP_MARINE_CAPACITY,
  WARSHIP_MARINE_DOCK_RADIUS,
} from "../game/Game";

export class SetWarshipCargoExecution implements Execution {
  constructor(
    private readonly owner: Player,
    private readonly unitId: number,
    private readonly targetCargo: number,
  ) {}

  init(mg: Game, _ticks: number): void {
    if (!mg.config().depthProgressionEnabled()) return;
    if (
      !Number.isInteger(this.targetCargo) ||
      this.targetCargo < 0 ||
      this.targetCargo > WARSHIP_MARINE_CAPACITY ||
      !this.owner.isAlive() ||
      this.owner.type() === PlayerType.Bot
    ) {
      return;
    }

    const warship = mg.unit(this.unitId);
    if (!this.validWarship(warship)) return;
    const currentCargo = warship.troops();
    if (
      !Number.isInteger(currentCargo) ||
      currentCargo < 0 ||
      currentCargo > WARSHIP_MARINE_CAPACITY ||
      warship.warshipState().isInCombat === true
    ) {
      return;
    }

    const waterComponent = mg.getWaterComponent(warship.tile());
    if (waterComponent === null) return;
    const docked = mg
      .nearbyUnits(warship.tile(), WARSHIP_MARINE_DOCK_RADIUS, UnitType.Port)
      .some(
        ({ unit: port }) =>
          port.isActive() &&
          !port.isMarkedForDeletion() &&
          !port.isUnderConstruction() &&
          (port.owner() === this.owner ||
            port.owner().isFriendly(this.owner)) &&
          mg.euclideanDistSquared(warship.tile(), port.tile()) <=
            WARSHIP_MARINE_DOCK_RADIUS ** 2 &&
          mg.hasWaterComponent(port.tile(), waterComponent),
      );
    if (!docked) return;

    const delta = this.targetCargo - currentCargo;
    if (delta > 0 && this.owner.troops() < delta) return;

    // Every validation completes before either side of the transfer mutates.
    if (delta > 0) {
      this.owner.removeTroops(delta);
    } else if (delta < 0) {
      this.owner.addTroops(-delta);
    }
    warship.setTroops(this.targetCargo);
    warship.updateWarshipState({
      boardingTargetId: undefined,
      boardingTicks: 0,
    });
  }

  private validWarship(warship: Unit | undefined): warship is Unit {
    return (
      warship !== undefined &&
      warship.type() === UnitType.Warship &&
      warship.owner() === this.owner &&
      warship.isActive() &&
      !warship.isMarkedForDeletion() &&
      !warship.isUnderConstruction()
    );
  }

  tick(_ticks: number): void {}

  isActive(): boolean {
    return false;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
