import { aircraftMissileDamage } from "../game/AircraftProfiles";
import { Execution, Game, Player, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PathFinding } from "../pathfinding/PathFinder";
import { PathStatus, SteppingPathFinder } from "../pathfinding/types";

/**
 * A visible, authoritative air-superiority missile. The projectile pursues
 * the target's live tile, then revalidates source, target, type, and diplomacy
 * at impact before applying damage exactly once. In the Airport profile it
 * detonates on contact — the tick the target comes inside its reach — and a
 * hit on a Warship or Transport Ship is lethal; legacy profiles keep the
 * one-tick pause at the reached tile and the base naval hit.
 */
export class FighterMissileExecution implements Execution {
  private active = true;
  private game!: Game;
  private pathFinder!: SteppingPathFinder<TileRef>;
  private missile: Unit | null = null;
  private awaitingImpact = false;
  private readonly releaseTile: TileRef;
  private readonly sourceWasValidAtRelease: boolean;

  constructor(
    private readonly owner: Player,
    private readonly source: Unit,
    private readonly target: Unit,
  ) {
    this.releaseTile = source.tile();
    this.sourceWasValidAtRelease = this.validSource();
  }

  init(game: Game, _ticks: number): void {
    this.game = game;
    this.pathFinder = PathFinding.Air(game);
    const airportOperations = game.config().airportOperationsV1Enabled();
    if (
      !game.config().airSuperiorityV1Enabled() ||
      (airportOperations
        ? !this.sourceWasValidAtRelease
        : !this.validSource()) ||
      !this.validTarget()
    ) {
      this.active = false;
      return;
    }
    const spawnTile = airportOperations ? this.releaseTile : this.source.tile();
    this.missile = this.owner.buildUnit(UnitType.FighterMissile, spawnTile, {
      targetUnit: this.target,
    });
  }

  tick(_ticks: number): void {
    const missile = this.missile;
    if (missile === null || !missile.isActive()) {
      this.active = false;
      return;
    }
    const airportOperations = this.game.config().airportOperationsV1Enabled();
    if ((!airportOperations && !this.validSource()) || !this.validTarget()) {
      this.abort();
      return;
    }

    const speed = this.game.config().fighterMissileSpeed();
    if (airportOperations) {
      // Contact detonation: a target inside this tick's reach is struck this
      // tick, on its own tile. Without it a ship or jet that keeps moving is
      // reached again every tick and never hit.
      if (
        this.game.manhattanDist(missile.tile(), this.target.tile()) <= speed
      ) {
        if (missile.tile() !== this.target.tile()) {
          missile.move(this.target.tile());
        }
        this.impact();
        return;
      }
    } else if (this.awaitingImpact) {
      if (missile.tile() === this.target.tile()) {
        this.impact();
        return;
      }
      // The target moved after the missile reached its prior tile. Resume
      // pursuit instead of detonating at a stale position.
      this.awaitingImpact = false;
    }

    let cursor = missile.tile();
    for (let step = 0; step < speed; step++) {
      const result = this.pathFinder.next(cursor, this.target.tile());
      if (result.status === PathStatus.COMPLETE) {
        if (cursor !== missile.tile()) missile.move(cursor);
        this.awaitingImpact = true;
        return;
      }
      if (result.status === PathStatus.NEXT) {
        cursor = result.node;
      } else if (result.status === PathStatus.NOT_FOUND) {
        this.abort();
        return;
      }
    }
    if (cursor !== missile.tile()) missile.move(cursor);
    this.awaitingImpact = cursor === this.target.tile();
  }

  private validSource(): boolean {
    return (
      this.source.type() === UnitType.FighterJet &&
      this.source.owner() === this.owner &&
      this.source.isActive() &&
      !this.source.isMarkedForDeletion()
    );
  }

  private validTarget(): boolean {
    if (
      !this.target.isActive() ||
      this.target.isMarkedForDeletion() ||
      !this.target.isTargetable() ||
      !this.owner.canAttackPlayer(this.target.owner(), true)
    ) {
      return false;
    }
    return (
      this.target.type() === UnitType.FighterJet ||
      this.target.type() === UnitType.Warship ||
      this.target.type() === UnitType.TransportShip
    );
  }

  private impact(): void {
    const missile = this.missile;
    if (
      missile === null ||
      (!this.game.config().airportOperationsV1Enabled() &&
        !this.validSource()) ||
      !this.validTarget()
    ) {
      this.abort();
      return;
    }

    const targetType = this.target.type();
    const airportOperations = this.game.config().airportOperationsV1Enabled();
    const navalTarget =
      targetType === UnitType.Warship || targetType === UnitType.TransportShip;
    const baseDamage =
      targetType === UnitType.FighterJet
        ? this.game.config().fighterAirDamage()
        : this.game.config().fighterNavalDamage();
    // Airport profile: the one missile that reaches a ship sinks it, and
    // air-to-air hits scale with the airframe. Legacy paths and the F-16 keep
    // the exact base value.
    const damage =
      airportOperations && navalTarget
        ? this.target.health()
        : airportOperations && this.source.type() === UnitType.FighterJet
          ? aircraftMissileDamage(
              baseDamage,
              this.source.aircraftState().aircraftType,
            )
          : baseDamage;
    const targetWasActive = this.target.isActive();
    this.target.modifyHealth(-damage, this.owner);
    if (targetWasActive && !this.target.isActive() && this.source.isActive()) {
      this.source.recordKill(targetType);
    }
    missile.setReachedTarget();
    missile.delete(false);
    this.active = false;
  }

  private abort(): void {
    if (this.missile?.isActive()) this.missile.delete(false);
    this.active = false;
  }

  missileUnitForTesting(): Unit | null {
    return this.missile;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
