import {
  AIRPORT_TAKEOFF_INTERVAL_TICKS,
  selectFighterBombReleaseTile,
} from "../game/AirportOperations";
import {
  AirMissionType,
  AirPatrolCommandOrder,
  Execution,
  Game,
  LEGACY_MAX_FIGHTER_MISSION_AMOUNT,
  MAX_FIGHTER_MISSION_AMOUNT,
  Player,
  STRIKE_TARGET_CLASS_UNITS,
  StrikeTargetClass,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { dealStrikeTargets, normalizeStrikeClasses } from "../game/StrikePlan";
import { PathFinding } from "../pathfinding/PathFinder";

type ResolvedCommandTarget = {
  tile: TileRef;
  unit: Unit | undefined;
};

type StrikeAssignment = {
  fighter: Unit;
  tile: TileRef;
};

/**
 * Atomically retasks an exact number of already-airborne combat-air-patrol
 * fighters. The long-lived FighterJetExecution notices commandRevision and
 * owns all subsequent movement and combat; this execution only validates and
 * publishes the authoritative command. A Jet Attack may carry strike plans
 * (one or several structure classes of the clicked tile's owner): the jets
 * are shared equally over the chosen classes and, inside a class, dealt over
 * its structures nearest to the click first; the whole order still succeeds
 * or fails as one. An Airport
 * order may name the exact jets to send; the jets of one order leave their
 * anchors one after another at the Airport takeoff cadence.
 */
export class AirPatrolCommandExecution implements Execution {
  constructor(
    private readonly player: Player,
    private readonly order: AirPatrolCommandOrder,
    private readonly amount: number,
  ) {}

  init(game: Game, ticks: number): void {
    const airportOperations = game.config().airportOperationsV1Enabled();
    if (
      !game.config().combinedArmsV2Enabled() ||
      (game.config().airSuperiorityV1Enabled() && !airportOperations) ||
      (airportOperations &&
        this.order.mission !== AirMissionType.PrecisionStrike) ||
      !this.player.isAlive() ||
      !Number.isInteger(this.amount) ||
      this.amount < 1 ||
      this.amount >
        (airportOperations
          ? MAX_FIGHTER_MISSION_AMOUNT
          : LEGACY_MAX_FIGHTER_MISSION_AMOUNT)
    ) {
      return;
    }

    const target = this.resolveTarget(game);
    if (target === null) return;
    const strikeGroups = this.resolveStrikeGroups(game, target);
    if (strikeGroups === null) return;

    const fighters = this.selectFighters(game, target.tile);
    if (fighters === null) return;

    const strikeTiles = dealStrikeTargets(fighters.length, strikeGroups);
    const assignments: StrikeAssignment[] = fighters.map((fighter, index) => ({
      fighter,
      tile: strikeTiles[index],
    }));

    // Air paths normally exist between every pair of valid map tiles, but
    // preflight each selected fighter so an unexpected pathfinder failure can
    // never leave a player-requested group partially retasked.
    for (const { fighter, tile } of assignments) {
      const routeTarget = airportOperations
        ? selectFighterBombReleaseTile(game, fighter.tile(), tile)
        : tile;
      if (routeTarget === null) return;
      const path = PathFinding.Air(game).findPath(fighter.tile(), routeTarget);
      if (
        path === null ||
        path.length === 0 ||
        path[path.length - 1] !== routeTarget
      ) {
        return;
      }
    }

    assignments.forEach(({ fighter, tile }, index) => {
      // Target setters do not emit an update on their own. Write them before
      // aircraft state so commandRevision publishes the complete command.
      fighter.setTargetUnit(target.unit);
      fighter.setTargetTile(tile);
      fighter.updateAircraftState({
        commandRevision: (fighter.aircraftState().commandRevision ?? 0) + 1,
        phase: "outbound",
        // Airport orders leave one jet at a time, starting on the first tick
        // the jets can act on the order; legacy state is untouched.
        ...(airportOperations
          ? {
              departureTick: ticks + 1 + index * AIRPORT_TAKEOFF_INTERVAL_TICKS,
            }
          : {}),
      });
    });
  }

  private isEligibleFighter(fighter: Unit): boolean {
    return (
      fighter.type() === UnitType.FighterJet &&
      fighter.owner() === this.player &&
      fighter.isActive() &&
      !fighter.isMarkedForDeletion() &&
      fighter.aircraftState().mission === AirMissionType.CombatAirPatrol &&
      fighter.aircraftState().phase !== "returning"
    );
  }

  /**
   * The exact jets named on an Airport strike order (each must be this
   * player's live airborne patrol jet, named once, and their number must
   * equal the amount), or the nearest `amount` eligible jets. Either way the
   * result is ordered by distance to the strike point, then unit ID, which
   * also fixes the departure order. Null rejects the whole order.
   */
  private selectFighters(game: Game, referenceTile: TileRef): Unit[] | null {
    const byDistance = (a: Unit, b: Unit): number => {
      const distanceDelta =
        game.euclideanDistSquared(a.tile(), referenceTile) -
        game.euclideanDistSquared(b.tile(), referenceTile);
      return distanceDelta || a.id() - b.id();
    };
    const fighterIds =
      this.order.mission === AirMissionType.PrecisionStrike
        ? this.order.fighterIds
        : undefined;
    if (fighterIds !== undefined) {
      if (
        !game.config().airportOperationsV1Enabled() ||
        fighterIds.length !== this.amount ||
        new Set(fighterIds).size !== fighterIds.length
      ) {
        return null;
      }
      const chosen: Unit[] = [];
      for (const id of fighterIds) {
        const fighter = game.unit(id);
        if (fighter === undefined || !this.isEligibleFighter(fighter)) {
          return null;
        }
        chosen.push(fighter);
      }
      return chosen.sort(byDistance);
    }
    const fighters = this.player
      .units(UnitType.FighterJet)
      .filter((fighter) => this.isEligibleFighter(fighter))
      .sort(byDistance)
      .slice(0, this.amount);
    return fighters.length === this.amount ? fighters : null;
  }

  private resolveTarget(game: Game): ResolvedCommandTarget | null {
    if (this.order.mission === AirMissionType.PrecisionStrike) {
      const tile = this.order.targetTile;
      if (
        !game.isValidRef(tile) ||
        !game.isLand(tile) ||
        game.isImpassable(tile)
      ) {
        return null;
      }
      const owner = game.owner(tile);
      return owner.isPlayer() && this.player.canAttackPlayer(owner)
        ? { tile, unit: undefined }
        : null;
    }

    const target = game.unit(this.order.targetUnitId);
    if (
      target === undefined ||
      !target.isActive() ||
      !target.isTargetable() ||
      !this.player.canAttackPlayer(target.owner(), true)
    ) {
      return null;
    }

    if (this.order.mission === AirMissionType.Intercept) {
      return target.type() === UnitType.FighterJet &&
        target.aircraftState().phase !== "returning"
        ? { tile: target.tile(), unit: target }
        : null;
    }

    return target.type() === UnitType.Warship ||
      (target.type() === UnitType.TransportShip && target.troops() > 0)
      ? { tile: target.tile(), unit: target }
      : null;
  }

  /**
   * The tile plan (or a missing plan) keeps the clicked tile. Any other plan
   * is Airport-profile only. Each chosen class resolves to the tiles of the
   * victim's live structures of that class, ordered by distance to the click
   * and then by unit ID; the jets are later shared equally over the classes
   * that still have structures. When none of the chosen classes has any, the
   * order is rejected before any mutation.
   */
  private resolveStrikeGroups(
    game: Game,
    target: ResolvedCommandTarget,
  ): TileRef[][] | null {
    if (this.order.mission !== AirMissionType.PrecisionStrike) {
      return [[target.tile]];
    }
    const { targetClass, targetClasses } = this.order;
    if (targetClass !== undefined && targetClasses !== undefined) return null;
    const classes = normalizeStrikeClasses(
      targetClasses ?? (targetClass === undefined ? [] : [targetClass]),
    );
    if (classes.length === 1 && classes[0] === StrikeTargetClass.Tile) {
      return [[target.tile]];
    }
    if (!game.config().airportOperationsV1Enabled()) return null;

    const victim = game.owner(target.tile);
    if (!victim.isPlayer()) return null;
    const groups = classes
      .map((targetClassId) =>
        game
          .units(STRIKE_TARGET_CLASS_UNITS[targetClassId])
          .filter(
            (unit) =>
              unit.owner() === victim &&
              unit.isActive() &&
              !unit.isMarkedForDeletion() &&
              game.isLand(unit.tile()) &&
              !game.isImpassable(unit.tile()),
          )
          .sort((a, b) => {
            const distanceDelta =
              game.euclideanDistSquared(a.tile(), target.tile) -
              game.euclideanDistSquared(b.tile(), target.tile);
            return distanceDelta || a.id() - b.id();
          })
          .map((unit) => unit.tile()),
      )
      .filter((tiles) => tiles.length > 0);
    return groups.length > 0 ? groups : null;
  }

  tick(_ticks: number): void {}

  isActive(): boolean {
    return false;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
