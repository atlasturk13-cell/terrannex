import {
  aircraftProfile,
  aircraftTroopDamage,
  effectiveAircraftType,
} from "../game/AircraftProfiles";
import {
  AircraftType,
  AirMissionType,
  Execution,
  Game,
  MessageType,
  Player,
  Structures,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { GameUpdateType } from "../game/GameUpdates";
import { PathFinding } from "../pathfinding/PathFinder";
import { PathStatus, SteppingPathFinder } from "../pathfinding/types";

/** Units a razed tile never destroys: airborne units, projectiles, warheads. */
const RAZE_IMMUNE_UNITS: ReadonlySet<UnitType> = new Set([
  UnitType.FighterJet,
  UnitType.FighterMissile,
  UnitType.FighterBomb,
  UnitType.AtomBomb,
  UnitType.HydrogenBomb,
  UnitType.MIRV,
  UnitType.MIRVWarhead,
  UnitType.SAMMissile,
  UnitType.Shell,
]);

/**
 * A visible conventional Jet Attack projectile. It owns no nuke state or nuke
 * statistic. Every profile applies a bounded troop loss to the victim, razes
 * the land around the impact (hostile tiles are relinquished and become
 * fallout, unowned land becomes fallout, hostile units on razed tiles die),
 * applies a small conventional area hit against hostile health-bearing units
 * and destroys the nearest hostile structures inside its profile radius, then
 * publishes one AirStrikeEvent so the client can show the impact and the
 * exact loss. Nothing is ever captured and no land becomes water. The victim
 * is warned while the bomb is in flight, and a bomb aimed at ground an earlier
 * bomb already razed still detonates against the recorded victim.
 */
export class FighterBombExecution implements Execution {
  private active = true;
  private game!: Game;
  private pathFinder!: SteppingPathFinder<TileRef>;
  private bomb: Unit | null = null;
  private awaitingImpact = false;
  private impacted = false;
  private victim: Player | null = null;
  private readonly releaseTile: TileRef;
  private readonly sourceWasValidAtRelease: boolean;
  private readonly aircraftType: AircraftType | undefined;

  constructor(
    private readonly owner: Player,
    private readonly source: Unit,
    private readonly targetTile: TileRef,
    /** Player the order was aimed at, for a target tile that is now unowned. */
    private readonly orderedVictim?: Player,
  ) {
    this.releaseTile = source.tile();
    this.sourceWasValidAtRelease = this.validSourceAtRelease();
    this.aircraftType =
      source.type() === UnitType.FighterJet
        ? source.aircraftState().aircraftType
        : undefined;
  }

  init(game: Game, _ticks: number): void {
    this.game = game;
    this.pathFinder = PathFinding.Air(game);
    if (
      !game.config().airportOperationsV1Enabled() ||
      !this.sourceWasValidAtRelease
    ) {
      this.active = false;
      return;
    }
    const holder = game.owner(this.targetTile);
    this.victim = holder.isPlayer() ? holder : (this.orderedVictim ?? null);
    if (!this.validTarget()) {
      this.active = false;
      return;
    }
    this.bomb = this.owner.buildUnit(UnitType.FighterBomb, this.releaseTile, {
      targetTile: this.targetTile,
    });
    const victim = this.currentVictim();
    if (victim !== null) {
      game.displayIncomingUnit(
        this.bomb.id(),
        // TODO TranslateText
        `✈️ ${this.owner.displayName()} - AIR STRIKE INBOUND`,
        MessageType.AIR_STRIKE_INBOUND,
        victim.id(),
      );
    }
  }

  tick(_ticks: number): void {
    const bomb = this.bomb;
    if (bomb === null || !bomb.isActive()) {
      this.active = false;
      return;
    }
    if (!this.validTarget()) {
      this.abort();
      return;
    }

    if (this.awaitingImpact) {
      if (bomb.tile() === this.targetTile) {
        this.impact();
        return;
      }
      this.awaitingImpact = false;
    }

    let cursor = bomb.tile();
    const speed = aircraftProfile(this.aircraftType).bombSpeed;
    for (let step = 0; step < speed; step++) {
      const result = this.pathFinder.next(cursor, this.targetTile);
      if (result.status === PathStatus.COMPLETE) {
        if (cursor !== bomb.tile()) bomb.move(cursor);
        this.awaitingImpact = true;
        return;
      }
      if (result.status === PathStatus.NEXT) {
        cursor = result.node;
      } else {
        this.abort();
        return;
      }
    }
    if (cursor !== bomb.tile()) bomb.move(cursor);
    this.awaitingImpact = cursor === this.targetTile;
  }

  private validSourceAtRelease(): boolean {
    return (
      this.source.type() === UnitType.FighterJet &&
      this.source.owner() === this.owner &&
      this.source.isActive() &&
      !this.source.isMarkedForDeletion() &&
      (this.source.aircraftState().mission === AirMissionType.CombatAirPatrol ||
        this.source.aircraftState().mission === AirMissionType.PrecisionStrike)
    );
  }

  /**
   * Hostile-held passable land is valid; so is unowned passable land (razed
   * ground) while the recorded victim is alive and attackable. Own, friendly
   * or immune ground aborts the bomb.
   */
  private validTarget(): boolean {
    if (
      !this.game.isValidRef(this.targetTile) ||
      !this.game.isLand(this.targetTile) ||
      this.game.isImpassable(this.targetTile)
    ) {
      return false;
    }
    const victim = this.currentVictim();
    return (
      victim !== null &&
      victim !== this.owner &&
      victim.isAlive() &&
      this.owner.canAttackPlayer(victim)
    );
  }

  private currentVictim(): Player | null {
    const holder = this.game.owner(this.targetTile);
    return holder.isPlayer() ? holder : this.victim;
  }

  private impact(): void {
    const bomb = this.bomb;
    if (this.impacted || bomb === null || !this.validTarget()) {
      this.abort();
      return;
    }
    const victim = this.currentVictim();
    if (victim === null) {
      this.abort();
      return;
    }
    this.impacted = true;
    const troopLoss = aircraftTroopDamage(victim.troops(), this.aircraftType);
    victim.removeTroops(troopLoss);
    const razed = this.razeArea();
    const structures = razed.structures + this.destroyStructures();
    this.applyAreaUnitDamage();
    this.game.addUpdate({
      type: GameUpdateType.AirStrikeEvent,
      attacker: this.owner.id(),
      target: victim.id(),
      tile: this.targetTile,
      troops: troopLoss,
      structures,
      tilesRazed: razed.tiles,
      aircraftType: effectiveAircraftType(this.aircraftType),
    });
    bomb.setReachedTarget();
    bomb.delete(false);
    this.active = false;
  }

  /**
   * Raze the disc around the impact. Hostile-owned passable land is
   * relinquished and marked fallout, unowned passable land is marked fallout,
   * and every hostile ground unit standing on a razed tile is destroyed. Own
   * and friendly land is spared, nothing is captured, no land becomes water.
   * Deterministic: row-major tile order, then unit ID order.
   */
  private razeArea(): { tiles: number; structures: number } {
    const radius = aircraftProfile(this.aircraftType).razeRadius;
    if (radius <= 0) return { tiles: 0, structures: 0 };
    const radiusSquared = radius * radius;
    const centerX = this.game.x(this.targetTile);
    const centerY = this.game.y(this.targetTile);
    const razed = new Set<TileRef>();
    let tiles = 0;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy > radiusSquared) continue;
        const x = centerX + dx;
        const y = centerY + dy;
        if (!this.game.isValidCoord(x, y)) continue;
        const tile = this.game.ref(x, y);
        if (!this.game.isLand(tile) || this.game.isImpassable(tile)) continue;
        const holder = this.game.owner(tile);
        let changed = false;
        if (holder.isPlayer()) {
          if (holder === this.owner || !this.owner.canAttackPlayer(holder)) {
            continue;
          }
          holder.relinquish(tile);
          changed = true;
        }
        if (!this.game.hasFallout(tile)) {
          this.game.setFallout(tile, true);
          changed = true;
        }
        if (changed) tiles++;
        razed.add(tile);
      }
    }

    let structures = 0;
    const casualties = this.game
      .units()
      .filter(
        (unit) =>
          unit.isActive() &&
          !unit.isMarkedForDeletion() &&
          razed.has(unit.tile()) &&
          !RAZE_IMMUNE_UNITS.has(unit.type()) &&
          unit.owner() !== this.owner &&
          this.owner.canAttackPlayer(unit.owner()),
      )
      .sort((a, b) => a.id() - b.id());
    for (const unit of casualties) {
      if (Structures.has(unit.type())) structures++;
      unit.delete(true, this.owner);
    }
    return { tiles, structures };
  }

  /**
   * Destroy the nearest hostile structures inside the profile radius. The
   * impact tile itself always qualifies (radius 0), so a strike aimed at an
   * enemy building has a legible result. Deterministic order: distance, ID.
   */
  private destroyStructures(): number {
    const profile = aircraftProfile(this.aircraftType);
    if (profile.maxStructures <= 0) return 0;
    const radiusSquared = profile.structureRadius * profile.structureRadius;
    const targets = this.game
      .units()
      .filter(
        (unit) =>
          unit.isActive() &&
          !unit.isMarkedForDeletion() &&
          Structures.has(unit.type()) &&
          this.owner.canAttackPlayer(unit.owner(), true) &&
          this.game.euclideanDistSquared(unit.tile(), this.targetTile) <=
            radiusSquared,
      )
      .map((unit) => ({
        unit,
        distance: this.game.euclideanDistSquared(unit.tile(), this.targetTile),
      }))
      .sort((a, b) => a.distance - b.distance || a.unit.id() - b.unit.id())
      .slice(0, profile.maxStructures);
    for (const { unit } of targets) {
      unit.delete(true, this.owner);
    }
    return targets.length;
  }

  private applyAreaUnitDamage(): void {
    const profile = aircraftProfile(this.aircraftType);
    if (
      profile.areaRadius <= 0 ||
      profile.areaUnitDamage <= 0 ||
      profile.maxAreaTargets <= 0
    ) {
      return;
    }

    const radiusSquared = profile.areaRadius * profile.areaRadius;
    const targets = this.game
      .units()
      .filter(
        (unit) =>
          unit.isActive() &&
          !unit.isMarkedForDeletion() &&
          unit.hasHealth() &&
          this.owner.canAttackPlayer(unit.owner(), true) &&
          this.game.euclideanDistSquared(unit.tile(), this.targetTile) <=
            radiusSquared,
      )
      .map((unit) => ({
        unit,
        distance: this.game.euclideanDistSquared(unit.tile(), this.targetTile),
      }))
      .sort((a, b) => a.distance - b.distance || a.unit.id() - b.unit.id())
      .slice(0, profile.maxAreaTargets);

    for (const { unit } of targets) {
      unit.modifyHealth(-profile.areaUnitDamage, this.owner);
    }
  }

  private abort(): void {
    if (this.bomb?.isActive()) this.bomb.delete(false);
    this.active = false;
  }

  bombUnitForTesting(): Unit | null {
    return this.bomb;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
