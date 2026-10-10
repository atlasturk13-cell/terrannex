import {
  availableAirportFighterSlots,
  isOperationalAirport,
} from "../../game/AirportOperations";
import {
  AirMissionOrder,
  AirMissionType,
  Difficulty,
  Game,
  Player,
  Unit,
  UnitType,
} from "../../game/Game";
import { PseudoRandom } from "../../PseudoRandom";
import { FighterJetExecution } from "../FighterJetExecution";

/** Bounded strategic-air parity for nations; invoked at their normal decision cadence. */
export class NationFighterBehavior {
  constructor(
    private readonly random: PseudoRandom,
    private readonly game: Game,
    private readonly player: Player,
  ) {}

  maybeLaunchFighter(): boolean {
    const config = this.game.config();
    const difficulty = config.gameConfig().difficulty;
    const airportOperations = config.airportOperationsV1Enabled();
    const launchBaseType = airportOperations
      ? UnitType.Airport
      : UnitType.Factory;
    const hasAirportSlot = airportOperations
      ? this.player
          .units(UnitType.Airport)
          .some(
            (airport) =>
              isOperationalAirport(airport, this.player) &&
              availableAirportFighterSlots(
                this.game,
                airport,
                this.game.ticks(),
              ) > 0,
          )
      : true;
    if (
      difficulty === Difficulty.Easy ||
      config.isUnitDisabled(UnitType.FighterJet) ||
      config.isUnitDisabled(launchBaseType) ||
      this.player.units(launchBaseType).length === 0 ||
      !hasAirportSlot ||
      (!airportOperations &&
        this.player.unitCount(UnitType.FighterJet) >=
          config.fighterMaxActive()) ||
      this.player.gold() <
        config.unitInfo(UnitType.FighterJet).cost(this.game, this.player)
    ) {
      return false;
    }

    const odds =
      difficulty === Difficulty.Medium
        ? 3
        : difficulty === Difficulty.Hard
          ? 2
          : 1;
    if (!this.random.chance(odds)) {
      return false;
    }

    const order = this.selectMission();
    if (order === null) {
      return false;
    }
    this.game.addExecution(new FighterJetExecution(this.player, order));
    return true;
  }

  private selectMission(): AirMissionOrder | null {
    if (this.game.config().airSuperiorityV1Enabled()) {
      const anchor = Array.from(this.player.borderTiles()).sort(
        (a, b) => a - b,
      )[0];
      return anchor === undefined
        ? null
        : {
            mission: AirMissionType.CombatAirPatrol,
            targetTile: anchor,
          };
    }

    const hostileAircraft = this.hostileUnits(UnitType.FighterJet);
    if (this.game.config().combinedArmsV2Enabled()) {
      const activeThreats = hostileAircraft
        .filter((aircraft) => aircraft.aircraftState().phase !== "returning")
        .sort((a, b) => {
          const threatDelta =
            Number(!this.isDirectThreat(a)) - Number(!this.isDirectThreat(b));
          if (threatDelta !== 0) return threatDelta;
          const urgencyDelta =
            a.aircraftState().missionEndTick - b.aircraftState().missionEndTick;
          return urgencyDelta || a.id() - b.id();
        });
      for (const aircraft of activeThreats) {
        if (
          this.player.canBuild(UnitType.FighterJet, aircraft.tile()) !== false
        ) {
          return {
            mission: AirMissionType.Intercept,
            targetUnitId: aircraft.id(),
          };
        }
      }
    } else {
      // Preserve V1's tile-patrol / nearby-ship escort selection exactly.
      for (const aircraft of hostileAircraft) {
        if (
          this.player.canBuild(UnitType.FighterJet, aircraft.tile()) === false
        ) {
          continue;
        }
        const escortedShip = this.player
          .units([UnitType.Warship, UnitType.TransportShip])
          .filter(
            (ship) =>
              this.player.canBuild(UnitType.FighterJet, ship.tile()) !==
                false &&
              this.game.euclideanDistSquared(ship.tile(), aircraft.tile()) <=
                this.game.config().fighterPatrolRadius() ** 2,
          )
          .sort((a, b) => a.id() - b.id())[0];
        return escortedShip === undefined
          ? { mission: AirMissionType.Intercept, targetTile: aircraft.tile() }
          : { mission: AirMissionType.Escort, targetUnitId: escortedShip.id() };
      }
    }

    for (const ship of this.hostileUnits([
      UnitType.Warship,
      UnitType.TransportShip,
    ])) {
      if (this.player.canBuild(UnitType.FighterJet, ship.tile()) !== false) {
        return { mission: AirMissionType.NavalStrike, targetUnitId: ship.id() };
      }
    }

    const strategicTargets = this.hostileUnits([
      UnitType.Factory,
      UnitType.Airport,
      UnitType.SAMLauncher,
      UnitType.MissileSilo,
      UnitType.Port,
      UnitType.City,
    ]);
    for (const target of strategicTargets) {
      if (this.player.canBuild(UnitType.FighterJet, target.tile()) !== false) {
        return {
          mission: AirMissionType.PrecisionStrike,
          targetTile: target.tile(),
        };
      }
    }
    return null;
  }

  private isDirectThreat(aircraft: Unit): boolean {
    const state = aircraft.aircraftState();
    if (state.mission === AirMissionType.PrecisionStrike) {
      const targetTile = aircraft.targetTile();
      if (targetTile === undefined || !this.game.isValidRef(targetTile)) {
        return false;
      }
      const owner = this.game.owner(targetTile);
      return owner.isPlayer() && this.isProtectedPlayer(owner);
    }
    if (state.mission === AirMissionType.NavalStrike) {
      const target = aircraft.targetUnit();
      return (
        target !== undefined &&
        target.isActive() &&
        this.isProtectedPlayer(target.owner())
      );
    }
    return false;
  }

  private isProtectedPlayer(owner: Player): boolean {
    return (
      owner === this.player ||
      this.player.isFriendly(owner) ||
      owner.isFriendly(this.player)
    );
  }

  private hostileUnits(types: UnitType | readonly UnitType[]): Unit[] {
    const units = Array.isArray(types)
      ? this.game.units(types as readonly UnitType[])
      : this.game.units(types as UnitType);
    return units
      .filter(
        (unit) =>
          unit.isActive() &&
          unit.isTargetable() &&
          this.player.canAttackPlayer(unit.owner(), true),
      )
      .sort((a, b) => {
        const typePriority = this.priority(a.type()) - this.priority(b.type());
        return typePriority || a.id() - b.id();
      });
  }

  private priority(type: UnitType): number {
    switch (type) {
      case UnitType.FighterJet:
        return 0;
      case UnitType.Warship:
        return 1;
      case UnitType.TransportShip:
        return 2;
      case UnitType.Factory:
        return 3;
      case UnitType.Airport:
        return 4;
      case UnitType.SAMLauncher:
        return 5;
      case UnitType.MissileSilo:
        return 6;
      case UnitType.Port:
        return 7;
      default:
        return 7;
    }
  }
}
