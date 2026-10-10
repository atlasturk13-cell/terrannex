import { aircraftBypassesSAM } from "../game/AircraftProfiles";
import { airDefenseCountersStealth } from "../game/AirDefenseProfiles";
import {
  Execution,
  Game,
  MessageType,
  Player,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PathFinding } from "../pathfinding/PathFinder";
import { PathStatus, SteppingPathFinder } from "../pathfinding/types";
import { NukeType } from "../StatsSchemas";

export class SAMMissileExecution implements Execution {
  private active = true;
  private pathFinder: SteppingPathFinder<TileRef>;
  private SAMMissile: Unit | undefined;
  private mg: Game;
  private speed: number = 0;

  constructor(
    private spawn: TileRef,
    private _owner: Player,
    private ownerUnit: Unit,
    private target: Unit,
    private targetTile: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    this.pathFinder = PathFinding.Air(mg);
    this.mg = mg;
    this.speed = this.mg.config().defaultSamMissileSpeed();
    this.tick(ticks);
  }

  tick(ticks: number): void {
    this.SAMMissile ??= this._owner.buildUnit(UnitType.SAMMissile, this.spawn, {
      targetUnit: this.target,
    });
    if (!this.SAMMissile.isActive()) {
      this.active = false;
      return;
    }
    // The MIRV carrier itself can't be intercepted, only its warheads
    const nukesWhitelist = [
      UnitType.AtomBomb,
      UnitType.HydrogenBomb,
      UnitType.MIRVWarhead,
      UnitType.FighterJet,
    ];
    if (
      !this.target.isActive() ||
      !this.ownerUnit.isActive() ||
      this.target.owner() === this.SAMMissile.owner() ||
      (this.target.type() === UnitType.FighterJet &&
        this.mg.config().airportOperationsV1Enabled() &&
        aircraftBypassesSAM(this.target.aircraftState()) &&
        !airDefenseCountersStealth(this.ownerUnit.airDefenseSystem())) ||
      !nukesWhitelist.includes(this.target.type())
    ) {
      // Clear the flag so other SAMs can re-target this nuke
      if (this.target.isActive()) {
        this.target.setTargetedBySAM(false);
      }
      this.SAMMissile.delete(false);
      this.active = false;
      return;
    }
    if (
      this.target.type() === UnitType.FighterJet &&
      this.mg.manhattanDist(this.SAMMissile.tile(), this.target.tile()) <=
        this.speed
    ) {
      this.interceptTarget();
      return;
    }
    for (let i = 0; i < this.speed; i++) {
      const destination =
        this.target.type() === UnitType.FighterJet
          ? this.target.tile()
          : this.targetTile;
      const result = this.pathFinder.next(this.SAMMissile.tile(), destination);
      if (result.status === PathStatus.COMPLETE) {
        this.interceptTarget();
        return;
      } else if (result.status === PathStatus.NEXT) {
        this.SAMMissile.move(result.node);
      }
    }
  }

  private interceptTarget(): void {
    const targetType = this.target.type();
    this.mg.displayMessage(
      "events_display.missile_intercepted",
      MessageType.SAM_HIT,
      this._owner.id(),
      undefined,
      { unit: targetType },
    );
    this.active = false;
    if (targetType === UnitType.FighterJet) {
      this.target.setTargetedBySAM(false);
      // The launcher's system sets the hit; the baseline keeps 175.
      this.target.modifyHealth(
        -this.mg
          .config()
          .airDefenseJetDamage(this.ownerUnit.airDefenseSystem()),
        this._owner,
      );
    } else {
      this.target.delete(true, this._owner);
      this.mg.stats().bombIntercept(this._owner, targetType as NukeType, 1);
    }
    this.SAMMissile?.delete(false);
  }

  isActive(): boolean {
    return this.active;
  }
  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
