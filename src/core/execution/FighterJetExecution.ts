import {
  aircraftProfile,
  aircraftSortieCost,
  isPatrolAircraftType,
} from "../game/AircraftProfiles";
import {
  AIRPORT_TAKEOFF_INTERVAL_TICKS,
  availableAirportFighterSlots,
  isOperationalAirport,
  pruneExpiredAirportRearmSlots,
  selectFighterBombReleaseTile,
  selectPatrolAnchors,
} from "../game/AirportOperations";
import {
  AircraftState,
  AircraftType,
  AirMissionOrder,
  AirMissionType,
  Execution,
  Game,
  isUnit,
  LEGACY_MAX_FIGHTER_MISSION_AMOUNT,
  MAX_COMMAND_AMOUNT,
  MAX_FIGHTER_MISSION_AMOUNT,
  Player,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PathFinding } from "../pathfinding/PathFinder";
import { FighterBombExecution } from "./FighterBombExecution";
import { FighterMissileExecution } from "./FighterMissileExecution";

const STRIKE_AMMO = 1;
const LEGACY_PATROL_AMMO = 4;
const INTERCEPT_REPLAN_TICKS = 10;
const PATROL_SCAN_TICKS = 10;

type PatrolMode =
  | "deploying"
  | "patrolling"
  | "manual"
  | "automatic"
  | "egressing";

type PatrolTargetRank = {
  unit: Unit;
  priority: number;
  borderDistance: number;
  fighterDistance: number;
};

type V2Reservation = {
  factory: Unit;
  targetTile: TileRef;
  targetUnit: Unit | null;
  route: TileRef[];
  /** Airport orders: gold and the launch slot were taken at order time. */
  prepaid?: boolean;
  /** Full sortie price of this jet, refunded if it never takes off. */
  sortieCost?: bigint;
  /** Player the strike was aimed at when the order was accepted. */
  strikeVictim?: Player | null;
};

type PendingTakeoff = {
  reservation: V2Reservation;
  takeoffTick: number;
};

type ResolvedMissionTarget = {
  targetTile: TileRef;
  targetUnit: Unit | null;
};

/**
 * One authoritative fighter command. V1 owns one sortie; V2 may atomically
 * reserve up to two deterministic, Factory-launched sorties, while the Airport
 * profile is bounded by physical slots and gold. Aircraft never conquer
 * territory or become a source for another attack. Sorties return to their
 * launch tile, while Combat Air Patrol remains airborne and reuses the same
 * unit until it is destroyed or its owner leaves the game.
 */
export class FighterJetExecution implements Execution {
  private active = true;
  private mg!: Game;
  private fighter: Unit | null = null;
  private homeFactory: Unit | null = null;
  private homeTile!: TileRef;
  private route: TileRef[] = [];
  private routeIndex = 0;
  private motionPlanId = 0;
  private lastAttackTick = Number.MIN_SAFE_INTEGER;
  private nextInterceptReplanTick = 0;
  private nextGlobalDefenseScanTick = 0;
  private interceptTargetUnitId: number | null = null;
  private childSorties: FighterJetExecution[] | null = null;
  private pendingTakeoffs: PendingTakeoff[] = [];
  private patrolMode: PatrolMode = "deploying";
  private handledPatrolCommandRevision = 0;
  private nextPatrolScanTick = 0;
  private nextPatrolReplanTick = 0;
  private activePatrolMissile: FighterMissileExecution | null = null;
  private manualStrikeTargetTile: TileRef | null = null;
  /** Player a strike was aimed at; keeps razed ground a valid strike point. */
  private strikeVictim: Player | null = null;

  constructor(
    private readonly player: Player,
    private readonly order: AirMissionOrder,
    private readonly requestedAmount: number = 1,
    private readonly v2Reservation?: V2Reservation,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    if (
      mg.config().isUnitDisabled(UnitType.FighterJet) ||
      mg.inSpawnPhase() ||
      !this.player.isAlive()
    ) {
      this.active = false;
      return;
    }

    const directAirportStrike =
      mg.config().airportOperationsV1Enabled() &&
      this.order.mission === AirMissionType.PrecisionStrike;
    if (
      mg.config().airSuperiorityV1Enabled() &&
      this.order.mission !== AirMissionType.CombatAirPatrol &&
      !directAirportStrike
    ) {
      this.active = false;
      return;
    }

    if (this.v2Reservation !== undefined) {
      this.initV2Reserved(ticks, this.v2Reservation);
      return;
    }

    if (mg.config().combinedArmsV2Enabled()) {
      this.initV2Batch(ticks);
      return;
    }

    if (this.order.mission === AirMissionType.CombatAirPatrol) {
      this.active = false;
      return;
    }

    // Quantity and targeted interception were introduced by V2. Old configs
    // accept only the exact one-sortie command they have always simulated.
    if (this.requestedAmount !== 1) {
      this.active = false;
      return;
    }

    const targetTile = this.validatedTargetTile();
    if (targetTile === false) {
      this.active = false;
      return;
    }

    const spawnTile = this.player.canBuild(UnitType.FighterJet, targetTile);
    if (spawnTile === false) {
      this.active = false;
      return;
    }

    const homeFactory = this.player
      .units(UnitType.Factory)
      .filter(
        (factory) =>
          factory.tile() === spawnTile &&
          factory.isActive() &&
          !factory.isUnderConstruction() &&
          !factory.isMarkedForDeletion(),
      )
      .sort((a, b) => a.id() - b.id())[0];
    if (homeFactory === undefined) {
      this.active = false;
      return;
    }
    this.homeFactory = homeFactory;

    const cooldown = mg.config().fighterLaunchCooldown();
    while (
      this.homeFactory.missileTimerQueue().length > 0 &&
      ticks - this.homeFactory.missileTimerQueue()[0] >= cooldown
    ) {
      this.homeFactory.reloadMissile();
    }
    if (this.homeFactory.missileTimerQueue().length > 0) {
      this.active = false;
      return;
    }

    this.homeTile = this.homeFactory.tile();
    const targetUnit =
      "targetUnitId" in this.order
        ? mg.unit(this.order.targetUnitId)
        : undefined;
    const travelTicks = Math.ceil(
      mg.manhattanDist(this.homeTile, targetTile) / mg.config().fighterSpeed(),
    );
    const ammo =
      this.order.mission === AirMissionType.Intercept ||
      this.order.mission === AirMissionType.Escort
        ? LEGACY_PATROL_AMMO
        : STRIKE_AMMO;

    this.fighter = this.player.buildUnit(UnitType.FighterJet, this.homeTile, {
      aircraftState: {
        mission: this.order.mission,
        phase: "outbound",
        homeFactoryId: this.homeFactory.id(),
        missionEndTick:
          ticks + mg.config().fighterMissionDuration() + travelTicks,
        ammo,
        targetedBySam: false,
      },
      targetTile,
      targetUnit,
    });
    this.homeFactory.launch();
    if (!this.setRoute(targetTile, ticks)) {
      this.finishSortie();
    }
  }

  /**
   * V2 performs one atomic preflight for the whole player-requested batch.
   * Only after target, cap, gold, Factory slots, and every route succeed do
   * the reserved single-sortie executions mutate authoritative state.
   */
  private initV2Batch(ticks: number): void {
    if (this.mg.config().airportOperationsV1Enabled()) {
      this.initAirportBatch(ticks);
      return;
    }
    const amount = this.requestedAmount;
    if (
      !Number.isInteger(amount) ||
      amount < 1 ||
      amount > LEGACY_MAX_FIGHTER_MISSION_AMOUNT ||
      this.mg.isSpawnImmunityActive() ||
      this.mg.config().isUnitDisabled(UnitType.Factory) ||
      this.player.unitCount(UnitType.FighterJet) + amount >
        this.mg.config().fighterMaxActive()
    ) {
      this.active = false;
      return;
    }

    const resolvedTarget = this.resolveV2MissionTarget();
    if (resolvedTarget === false) {
      this.active = false;
      return;
    }

    const cooldown = this.mg.config().fighterLaunchCooldown();
    const rangeSquared = this.mg.config().fighterRange() ** 2;
    const factories = this.player
      .units(UnitType.Factory)
      .filter((factory) => {
        const queue = factory.missileTimerQueue();
        const ready = queue.length === 0 || ticks - queue[0] >= cooldown;
        return (
          factory.owner() === this.player &&
          factory.isActive() &&
          !factory.isUnderConstruction() &&
          !factory.isMarkedForDeletion() &&
          ready &&
          this.mg.euclideanDistSquared(
            factory.tile(),
            resolvedTarget.targetTile,
          ) <= rangeSquared
        );
      })
      .sort((a, b) => {
        const distanceDelta =
          this.mg.euclideanDistSquared(a.tile(), resolvedTarget.targetTile) -
          this.mg.euclideanDistSquared(b.tile(), resolvedTarget.targetTile);
        return distanceDelta || a.id() - b.id();
      })
      .slice(0, amount);
    if (factories.length !== amount) {
      this.active = false;
      return;
    }

    const info = this.mg.config().unitInfo(UnitType.FighterJet);
    let totalCost = 0n;
    for (let i = 0; i < amount; i++) {
      totalCost += info.cost(this.mg, this.player, i);
    }
    if (this.player.gold() < totalCost) {
      this.active = false;
      return;
    }

    const reservations: V2Reservation[] = [];
    for (const factory of factories) {
      const route = this.sampleRoute(factory.tile(), resolvedTarget.targetTile);
      if (route === null) {
        this.active = false;
        return;
      }
      reservations.push({
        factory,
        targetTile: resolvedTarget.targetTile,
        targetUnit: resolvedTarget.targetUnit,
        route,
      });
    }

    this.childSorties = reservations.map((reservation) => {
      const child = new FighterJetExecution(
        this.player,
        this.order,
        1,
        reservation,
      );
      child.init(this.mg, ticks);
      return child;
    });
    this.active = this.childSorties.some((child) => child.isActive());
  }

  /**
   * Airport operations reserve the complete multi-base order before the first
   * jet, gold deduction, or cooldown mutation. Once accepted, the whole order
   * is charged and every launch slot is taken at once, and the jets then take
   * off one at a time at a fixed tick cadence; a jet whose Airport is gone
   * before its turn is refunded and never launched.
   */
  private initAirportBatch(ticks: number): void {
    const amount = this.requestedAmount;
    if (
      !Number.isInteger(amount) ||
      amount < 1 ||
      amount > MAX_FIGHTER_MISSION_AMOUNT ||
      amount > MAX_COMMAND_AMOUNT ||
      this.mg.isSpawnImmunityActive() ||
      this.mg.config().isUnitDisabled(UnitType.Airport)
    ) {
      this.active = false;
      return;
    }

    // A persistent patrol is an F-16, an F-35 or a B-2 (PATROL_AIRCRAFT_TYPES).
    if (
      this.order.mission === AirMissionType.CombatAirPatrol &&
      !isPatrolAircraftType(this.order.aircraftType)
    ) {
      this.active = false;
      return;
    }

    const resolvedTarget = this.resolveV2MissionTarget();
    if (resolvedTarget === false) {
      this.active = false;
      return;
    }

    const rangeSquared = this.mg.config().fighterRange() ** 2;
    const airports = this.player
      .units(UnitType.Airport)
      .filter(
        (airport) =>
          isOperationalAirport(airport, this.player) &&
          availableAirportFighterSlots(this.mg, airport, ticks) > 0 &&
          this.mg.euclideanDistSquared(
            airport.tile(),
            resolvedTarget.targetTile,
          ) <= rangeSquared,
      )
      .sort((a, b) => {
        const distanceDelta =
          this.mg.euclideanDistSquared(a.tile(), resolvedTarget.targetTile) -
          this.mg.euclideanDistSquared(b.tile(), resolvedTarget.targetTile);
        return distanceDelta || a.id() - b.id();
      });

    // Patrol jets of one order spread over distinct border anchors; strikes
    // share the one target and its recorded victim.
    const persistentPatrol =
      this.order.mission === AirMissionType.CombatAirPatrol;
    const anchors = persistentPatrol
      ? selectPatrolAnchors(this.mg, this.player, this.order.targetTile, amount)
      : [];
    if (persistentPatrol && anchors.length !== amount) {
      this.active = false;
      return;
    }
    const holder = this.mg.owner(resolvedTarget.targetTile);
    const strikeVictim =
      this.order.mission === AirMissionType.PrecisionStrike && holder.isPlayer()
        ? holder
        : null;

    const reservations: V2Reservation[] = [];
    const routes = new Map<string, TileRef[]>();
    for (const airport of airports) {
      const slots = Math.min(
        availableAirportFighterSlots(this.mg, airport, ticks),
        amount - reservations.length,
      );
      if (slots <= 0) continue;
      for (let slot = 0; slot < slots; slot++) {
        const targetTile = persistentPatrol
          ? anchors[reservations.length]
          : resolvedTarget.targetTile;
        const routeTarget =
          this.order.mission === AirMissionType.PrecisionStrike
            ? selectFighterBombReleaseTile(this.mg, airport.tile(), targetTile)
            : targetTile;
        if (routeTarget === null) {
          this.active = false;
          return;
        }
        const routeKey = `${airport.id()}:${routeTarget}`;
        let route = routes.get(routeKey);
        if (route === undefined) {
          const sampled = this.sampleRoute(airport.tile(), routeTarget);
          if (sampled === null) {
            this.active = false;
            return;
          }
          route = sampled;
          routes.set(routeKey, route);
        }
        reservations.push({
          factory: airport,
          targetTile,
          targetUnit: resolvedTarget.targetUnit,
          route: [...route],
          prepaid: true,
          strikeVictim,
        });
      }
      if (reservations.length === amount) break;
    }
    if (reservations.length !== amount) {
      this.active = false;
      return;
    }

    const info = this.mg.config().unitInfo(UnitType.FighterJet);
    let totalCost = 0n;
    for (let i = 0; i < amount; i++) {
      const sortieCost = aircraftSortieCost(
        info.cost(this.mg, this.player, i),
        this.airportAircraftType(),
      );
      reservations[i].sortieCost = sortieCost;
      totalCost += sortieCost;
    }
    if (this.player.gold() < totalCost) {
      this.active = false;
      return;
    }

    // The complete order is charged and every launch slot is taken now,
    // after the atomic preflight; the jets then leave one at a time.
    this.player.removeGold(totalCost);
    for (const reservation of reservations) reservation.factory.launch();
    this.pendingTakeoffs = reservations.map((reservation, index) => ({
      reservation,
      takeoffTick: ticks + index * AIRPORT_TAKEOFF_INTERVAL_TICKS,
    }));
    this.childSorties = [];
    this.launchDueSorties(ticks);
    this.active =
      this.pendingTakeoffs.length > 0 ||
      this.childSorties.some((child) => child.isActive());
  }

  /**
   * Start every reserved jet whose takeoff tick has come, in order. A jet
   * whose Airport is no longer this player's operational base, or whose
   * owner is gone, is refunded instead of launched.
   */
  private launchDueSorties(ticks: number): void {
    while (
      this.pendingTakeoffs.length > 0 &&
      this.pendingTakeoffs[0].takeoffTick <= ticks
    ) {
      const { reservation } = this.pendingTakeoffs.shift()!;
      if (
        !this.player.isAlive() ||
        !isOperationalAirport(reservation.factory, this.player)
      ) {
        if (this.player.isAlive() && reservation.sortieCost !== undefined) {
          this.player.addGold(reservation.sortieCost);
        }
        continue;
      }
      const child = new FighterJetExecution(
        this.player,
        this.order,
        1,
        reservation,
      );
      child.init(this.mg, ticks);
      this.childSorties!.push(child);
    }
  }

  private initV2Reserved(ticks: number, reservation: V2Reservation): void {
    this.homeFactory = reservation.factory;
    this.homeTile = reservation.factory.tile();
    if (this.order.mission === AirMissionType.PrecisionStrike) {
      if (reservation.strikeVictim !== undefined) {
        this.strikeVictim = reservation.strikeVictim;
      } else {
        const holder = this.mg.owner(reservation.targetTile);
        this.strikeVictim = holder.isPlayer() ? holder : null;
      }
    }

    const cooldown = this.mg.config().fighterLaunchCooldown();
    if (this.mg.config().airportOperationsV1Enabled()) {
      pruneExpiredAirportRearmSlots(this.mg, this.homeFactory, ticks);
    } else {
      while (
        this.homeFactory.missileTimerQueue().length > 0 &&
        ticks - this.homeFactory.missileTimerQueue()[0] >= cooldown
      ) {
        this.homeFactory.reloadMissile();
      }
    }

    const travelTicks = Math.ceil(
      this.mg.manhattanDist(this.homeTile, reservation.targetTile) /
        this.fighterSpeed(),
    );
    const persistentPatrol =
      this.order.mission === AirMissionType.CombatAirPatrol;
    const ammo =
      this.order.mission === AirMissionType.Intercept ||
      this.order.mission === AirMissionType.Escort ||
      persistentPatrol
        ? this.mg.config().fighterPatrolAmmo()
        : STRIKE_AMMO;

    const aircraftState: AircraftState = {
      mission: this.order.mission,
      phase: "outbound",
      homeFactoryId: this.homeFactory.id(),
      missionEndTick: persistentPatrol
        ? Number.MAX_SAFE_INTEGER
        : ticks + this.mg.config().fighterMissionDuration() + travelTicks,
      ammo,
      targetedBySam: false,
    };
    // Every Airport-profile sortie keeps its model, so a patrol later
    // retasked to Jet Attack drops the ordnance it was launched with.
    if (
      this.mg.config().airportOperationsV1Enabled() &&
      "aircraftType" in this.order &&
      this.order.aircraftType !== undefined
    ) {
      aircraftState.aircraftType = this.order.aircraftType;
    }
    if (persistentPatrol) {
      aircraftState.patrolAnchorTile = reservation.targetTile;
      aircraftState.commandRevision = 0;
    }

    const goldBeforeBuild = this.player.gold();
    this.fighter = this.player.buildUnit(UnitType.FighterJet, this.homeTile, {
      aircraftState,
      targetTile: reservation.targetTile,
      targetUnit: reservation.targetUnit ?? undefined,
    });
    // A prepaid Airport sortie was charged in full when the order was
    // accepted; hand back exactly what buildUnit took again.
    if (reservation.prepaid === true) {
      this.player.addGold(goldBeforeBuild - this.player.gold());
    }
    this.interceptTargetUnitId =
      this.order.mission === AirMissionType.Intercept
        ? (reservation.targetUnit?.id() ?? null)
        : null;
    this.nextInterceptReplanTick = ticks + INTERCEPT_REPLAN_TICKS;
    this.nextGlobalDefenseScanTick = ticks + INTERCEPT_REPLAN_TICKS;
    if (persistentPatrol) {
      this.patrolMode = "deploying";
      this.handledPatrolCommandRevision = 0;
      this.nextPatrolScanTick = ticks + PATROL_SCAN_TICKS;
      this.nextPatrolReplanTick = ticks + INTERCEPT_REPLAN_TICKS;
    }
    if (reservation.prepaid !== true) this.homeFactory.launch();
    this.installRoute(reservation.route, reservation.targetTile, ticks);
  }

  tick(ticks: number): void {
    if (this.childSorties !== null) {
      this.launchDueSorties(ticks);
      for (const child of this.childSorties) {
        if (child.isActive()) child.tick(ticks);
      }
      this.active =
        this.pendingTakeoffs.length > 0 ||
        this.childSorties.some((child) => child.isActive());
      return;
    }

    const fighter = this.fighter;
    if (fighter === null || !fighter.isActive()) {
      this.active = false;
      return;
    }
    if (fighter.owner() !== this.player) {
      fighter.delete(false);
      this.active = false;
      return;
    }

    // An Airport-profile jet goes down with its base: a destroyed Airport
    // takes every jet it launched, credited to the Airport's destroyer so
    // the jet breaks up with the combat-kill marker. A captured Airport is
    // still standing and keeps its previous owner's jets in the air.
    if (
      this.mg.config().airportOperationsV1Enabled() &&
      this.homeFactory !== null &&
      !this.homeFactory.isActive()
    ) {
      fighter.delete(true, this.homeFactory.destroyer());
      this.active = false;
      return;
    }

    if (this.order.mission === AirMissionType.CombatAirPatrol) {
      if (!this.player.isAlive()) {
        this.finishSortie();
        return;
      }
      this.tickCombatAirPatrol(ticks);
      return;
    }

    const state = fighter.aircraftState();
    if (
      state.phase !== "returning" &&
      (ticks >= state.missionEndTick || !this.homeFactoryOperational())
    ) {
      this.beginReturn(ticks);
      return;
    }

    switch (state.phase) {
      case "outbound":
        this.tickOutbound(ticks);
        return;
      case "engaging":
        this.tickEngaging(ticks);
        return;
      case "returning":
        if (this.advanceRoute()) {
          this.finishSortie();
        }
        return;
    }
  }

  private tickOutbound(ticks: number): void {
    if (
      this.mg.config().combinedArmsV2Enabled() &&
      this.order.mission === AirMissionType.Intercept
    ) {
      if (this.tickTargetedIntercept(ticks)) return;
      if (this.maybeAcquireGlobalDefenseTarget(ticks)) {
        this.tickTargetedIntercept(ticks);
        return;
      }
    }

    if (!this.targetStillValid()) {
      this.beginReturn(ticks);
      return;
    }
    if (!this.advanceRoute()) {
      return;
    }

    const fighter = this.fighter!;
    switch (this.order.mission) {
      case AirMissionType.Intercept:
      case AirMissionType.Escort:
        fighter.updateAircraftState({ phase: "engaging" });
        this.tickEngaging(ticks);
        return;
      case AirMissionType.NavalStrike: {
        const target = this.targetUnit();
        if (target === null) {
          this.beginReturn(ticks);
          return;
        }
        if (
          this.mg.manhattanDist(fighter.tile(), target.tile()) >
          this.mg.config().fighterEngagementRange()
        ) {
          this.setRoute(target.tile(), ticks);
          return;
        }
        target.modifyHealth(
          -this.mg.config().fighterNavalDamage(),
          this.player,
        );
        fighter.updateAircraftState({ ammo: 0 });
        this.beginReturn(ticks);
        return;
      }
      case AirMissionType.PrecisionStrike: {
        if (this.mg.config().airportOperationsV1Enabled()) {
          this.mg.addExecution(
            new FighterBombExecution(
              this.player,
              fighter,
              this.order.targetTile,
              this.strikeVictim ?? undefined,
            ),
          );
          fighter.updateAircraftState({ ammo: 0 });
          this.beginReturn(ticks);
          return;
        }
        const owner = this.mg.owner(this.order.targetTile);
        if (owner.isPlayer() && this.player.canAttackPlayer(owner)) {
          const proportionalDamage = this.mg.config().combinedArmsV2Enabled()
            ? Math.floor(
                (owner.troops() *
                  this.mg.config().fighterPrecisionTroopPercent()) /
                  100,
              )
            : Math.floor(owner.troops() * 0.05);
          const boundedDamage = Math.min(
            this.mg.config().fighterPrecisionTroopDamage(),
            proportionalDamage,
          );
          owner.removeTroops(boundedDamage);
        }
        fighter.updateAircraftState({ ammo: 0 });
        this.beginReturn(ticks);
        return;
      }
    }
  }

  private tickEngaging(ticks: number): void {
    const fighter = this.fighter!;
    if (fighter.aircraftState().ammo <= 0) {
      this.beginReturn(ticks);
      return;
    }

    if (
      this.mg.config().combinedArmsV2Enabled() &&
      this.order.mission === AirMissionType.Intercept
    ) {
      if (this.tickTargetedIntercept(ticks)) return;
      if (this.maybeAcquireGlobalDefenseTarget(ticks)) {
        this.tickTargetedIntercept(ticks);
        return;
      }
    }

    if (this.order.mission === AirMissionType.Escort) {
      const escorted = this.targetUnit();
      if (escorted === null || !this.isFriendlyEscortTarget(escorted)) {
        this.beginReturn(ticks);
        return;
      }
      this.engageHostileAircraft(ticks, escorted.tile());
      if (
        this.routeIndex >= this.route.length &&
        this.mg.manhattanDist(fighter.tile(), escorted.tile()) >
          this.mg.config().fighterEngagementRange()
      ) {
        this.setRoute(escorted.tile(), ticks);
      }
      if (this.routeIndex < this.route.length) {
        this.advanceRoute();
      }
      return;
    }

    this.engageHostileAircraft(ticks, fighter.tile());
  }

  private engageHostileAircraft(ticks: number, anchor: TileRef): void {
    if (
      ticks - this.lastAttackTick <
      this.mg.config().fighterAttackCooldown()
    ) {
      return;
    }
    const targets = this.mg
      .nearbyUnits(
        anchor,
        this.mg.config().fighterPatrolRadius(),
        UnitType.FighterJet,
        ({ unit }) =>
          isUnit(unit) &&
          (this.mg.config().combinedArmsV2Enabled()
            ? this.isValidInterceptTarget(unit)
            : unit !== this.fighter &&
              unit.isTargetable() &&
              this.player.canAttackPlayer(unit.owner(), true)),
      )
      .sort((a, b) => {
        if (this.mg.config().combinedArmsV2Enabled()) {
          const threatDelta =
            Number(!this.isDirectThreatToPlayer(a.unit)) -
            Number(!this.isDirectThreatToPlayer(b.unit));
          if (threatDelta !== 0) return threatDelta;
        }
        return a.distSquared - b.distSquared || a.unit.id() - b.unit.id();
      });
    const target = targets[0]?.unit;
    if (target === undefined) {
      return;
    }

    target.modifyHealth(-this.mg.config().fighterAirDamage(), this.player);
    const fighter = this.fighter!;
    fighter.updateAircraftState({ ammo: fighter.aircraftState().ammo - 1 });
    this.lastAttackTick = ticks;
  }

  private tickTargetedIntercept(ticks: number): boolean {
    if (this.interceptTargetUnitId === null) return false;
    let target = this.mg.unit(this.interceptTargetUnitId);
    if (target === undefined || !this.isValidInterceptTarget(target)) {
      this.interceptTargetUnitId = null;
      this.fighter!.setTargetUnit(undefined);
      if ("targetUnitId" in this.order) {
        this.beginReturn(ticks);
        return true;
      }
      target = this.selectGlobalDefenseTarget() ?? undefined;
      if (target === undefined) {
        return false;
      }
      this.trackInterceptTarget(target, ticks);
      this.nextGlobalDefenseScanTick = ticks + INTERCEPT_REPLAN_TICKS;
    } else if (
      !("targetUnitId" in this.order) &&
      ticks >= this.nextGlobalDefenseScanTick
    ) {
      this.nextGlobalDefenseScanTick = ticks + INTERCEPT_REPLAN_TICKS;
      const candidate = this.selectGlobalDefenseTarget();
      if (
        candidate !== null &&
        candidate.id() !== target.id() &&
        this.compareGlobalDefensePriority(candidate, target) < 0
      ) {
        target = candidate;
        this.trackInterceptTarget(target, ticks);
      }
    }

    const fighter = this.fighter!;
    if (
      this.mg.manhattanDist(fighter.tile(), target.tile()) <=
      this.mg.config().fighterEngagementRange()
    ) {
      fighter.updateAircraftState({ phase: "engaging" });
      if (
        ticks - this.lastAttackTick >=
        this.mg.config().fighterAttackCooldown()
      ) {
        target.modifyHealth(-this.mg.config().fighterAirDamage(), this.player);
        fighter.updateAircraftState({
          ammo: fighter.aircraftState().ammo - 1,
        });
        this.lastAttackTick = ticks;
      }
      return true;
    }

    if (
      ticks >= this.nextInterceptReplanTick ||
      this.routeIndex >= this.route.length
    ) {
      const aim = this.interceptAimTile(target);
      if (!this.setRoute(aim, ticks)) {
        this.beginReturn(ticks);
        return true;
      }
      this.nextInterceptReplanTick = ticks + INTERCEPT_REPLAN_TICKS;
    }
    this.advanceRoute();
    return true;
  }

  private maybeAcquireGlobalDefenseTarget(ticks: number): boolean {
    if (ticks < this.nextGlobalDefenseScanTick) return false;
    this.nextGlobalDefenseScanTick = ticks + INTERCEPT_REPLAN_TICKS;
    const target = this.selectGlobalDefenseTarget();
    if (target === null) return false;
    this.trackInterceptTarget(target, ticks);
    return true;
  }

  private trackInterceptTarget(target: Unit, ticks: number): void {
    this.interceptTargetUnitId = target.id();
    this.fighter!.setTargetUnit(target);
    const aim = this.interceptAimTile(target);
    this.setRoute(aim, ticks);
    this.nextInterceptReplanTick = ticks + INTERCEPT_REPLAN_TICKS;
  }

  private tickCombatAirPatrol(ticks: number): void {
    const fighter = this.fighter!;
    if (
      !this.mg.config().airSuperiorityV1Enabled() ||
      this.mg.config().airportOperationsV1Enabled()
    ) {
      const revision = fighter.aircraftState().commandRevision ?? 0;
      if (revision !== this.handledPatrolCommandRevision) {
        this.handledPatrolCommandRevision = revision;
        if (!this.beginManualPatrolCommand(ticks)) {
          this.beginPatrolEgress(ticks);
          return;
        }
      }
    }

    switch (this.patrolMode) {
      case "deploying":
      case "egressing":
        if (this.advanceRoute()) {
          this.enterPatrolling(ticks);
        }
        return;
      case "manual":
      case "automatic":
        this.tickPatrolEngagement(ticks);
        return;
      case "patrolling": {
        if (ticks < this.nextPatrolScanTick) return;
        this.nextPatrolScanTick = ticks + PATROL_SCAN_TICKS;
        const target = this.selectPatrolTarget();
        if (target !== null) {
          this.beginAutomaticPatrolEngagement(target, ticks);
        }
        return;
      }
    }
  }

  private beginManualPatrolCommand(ticks: number): boolean {
    const fighter = this.fighter!;
    const target = fighter.targetUnit();
    if (this.mg.config().airportOperationsV1Enabled()) {
      const targetTile = fighter.targetTile();
      if (
        target !== undefined ||
        targetTile === undefined ||
        !this.isValidPatrolLandTarget(targetTile)
      ) {
        return false;
      }
      const releaseTile = selectFighterBombReleaseTile(
        this.mg,
        fighter.tile(),
        targetTile,
      );
      if (releaseTile === null) return false;
      this.manualStrikeTargetTile = targetTile;
      const holder = this.mg.owner(targetTile);
      this.strikeVictim = holder.isPlayer() ? holder : null;
      if (!this.setRoute(releaseTile, ticks)) return false;
      this.patrolMode = "manual";
      this.nextPatrolReplanTick = ticks + INTERCEPT_REPLAN_TICKS;
      return true;
    }
    if (target !== undefined) {
      if (!this.isValidPatrolUnitTarget(target)) return false;
      fighter.setTargetTile(target.tile());
      if (!this.setRoute(target.tile(), ticks)) return false;
    } else {
      const tile = fighter.targetTile();
      if (tile === undefined || !this.isValidPatrolLandTarget(tile)) {
        return false;
      }
      if (!this.setRoute(tile, ticks)) return false;
    }
    this.patrolMode = "manual";
    this.nextPatrolReplanTick = ticks + INTERCEPT_REPLAN_TICKS;
    return true;
  }

  private tickPatrolEngagement(ticks: number): void {
    if (this.mg.config().airSuperiorityV1Enabled()) {
      if (this.activePatrolMissile?.isActive()) return;
      this.activePatrolMissile = null;
    }

    if (this.patrolMode === "automatic" && ticks >= this.nextPatrolScanTick) {
      this.nextPatrolScanTick = ticks + PATROL_SCAN_TICKS;
      const best = this.selectPatrolTarget();
      const current = this.fighter!.targetUnit();
      if (best === null) {
        this.beginPatrolEgress(ticks);
        return;
      }
      if (best.id() !== current?.id()) {
        this.beginAutomaticPatrolEngagement(best, ticks);
        return;
      }
    }

    const fighter = this.fighter!;
    const target = fighter.targetUnit();
    if (target !== undefined) {
      if (!this.isValidPatrolUnitTarget(target)) {
        this.beginPatrolEgress(ticks);
        return;
      }

      const engagementRange = this.mg.config().fighterEngagementRange();
      if (
        this.mg.manhattanDist(fighter.tile(), target.tile()) <= engagementRange
      ) {
        if (
          this.patrolMode === "automatic" &&
          !this.isEligibleAutomaticPatrolTarget(target)
        ) {
          this.beginPatrolEgress(ticks);
          return;
        }
        if (
          ticks - this.lastAttackTick <
          this.mg.config().fighterAttackCooldown()
        ) {
          return;
        }
        if (this.mg.config().airSuperiorityV1Enabled()) {
          const missile = new FighterMissileExecution(
            this.player,
            fighter,
            target,
          );
          this.activePatrolMissile = missile;
          this.mg.addExecution(missile);
        } else {
          if (target.type() === UnitType.FighterJet) {
            target.modifyHealth(
              -this.mg.config().fighterAirDamage(),
              this.player,
            );
          } else {
            target.modifyHealth(
              -this.mg.config().fighterNavalDamage(),
              this.player,
            );
          }
        }
        this.lastAttackTick = ticks;

        if (
          !this.mg.config().airSuperiorityV1Enabled() &&
          (target.type() !== UnitType.FighterJet || !target.isActive())
        ) {
          this.beginPatrolEgress(ticks);
        }
        return;
      }

      if (
        ticks >= this.nextPatrolReplanTick ||
        this.routeIndex >= this.route.length
      ) {
        if (!this.setRoute(target.tile(), ticks)) {
          this.beginPatrolEgress(ticks);
          return;
        }
        this.nextPatrolReplanTick = ticks + INTERCEPT_REPLAN_TICKS;
      }
      this.advanceRoute();
      return;
    }

    if (this.patrolMode !== "manual") {
      this.beginPatrolEgress(ticks);
      return;
    }
    const targetTile = fighter.targetTile();
    if (this.mg.config().airportOperationsV1Enabled()) {
      const strikeTarget = this.manualStrikeTargetTile;
      if (strikeTarget === null || !this.isValidStrikePoint(strikeTarget)) {
        this.beginPatrolEgress(ticks);
        return;
      }
      // Jets of one order leave their anchors one after another.
      const departureTick = fighter.aircraftState().departureTick;
      if (departureTick !== undefined && ticks < departureTick) return;
      if (!this.advanceRoute()) return;
      // The drop happens the tick the jet reaches its release point; the
      // missile cadence never delays a bomb.
      this.mg.addExecution(
        new FighterBombExecution(
          this.player,
          fighter,
          strikeTarget,
          this.strikeVictim ?? undefined,
        ),
      );
      this.manualStrikeTargetTile = null;
      this.strikeVictim = null;
      this.beginPatrolEgress(ticks);
      return;
    }
    if (targetTile === undefined || !this.isValidPatrolLandTarget(targetTile)) {
      this.beginPatrolEgress(ticks);
      return;
    }
    if (!this.advanceRoute()) return;
    if (
      ticks - this.lastAttackTick <
      this.mg.config().fighterAttackCooldown()
    ) {
      return;
    }
    const owner = this.mg.owner(targetTile);
    if (!owner.isPlayer() || !this.player.canAttackPlayer(owner)) {
      this.beginPatrolEgress(ticks);
      return;
    }
    const proportionalDamage = Math.floor(
      (owner.troops() * this.mg.config().fighterPrecisionTroopPercent()) / 100,
    );
    owner.removeTroops(
      Math.min(
        this.mg.config().fighterPrecisionTroopDamage(),
        proportionalDamage,
      ),
    );
    this.lastAttackTick = ticks;
    this.beginPatrolEgress(ticks);
  }

  private beginAutomaticPatrolEngagement(target: Unit, ticks: number): void {
    const fighter = this.fighter!;
    fighter.setTargetUnit(target);
    fighter.setTargetTile(target.tile());
    if (!this.setRoute(target.tile(), ticks)) {
      fighter.setTargetUnit(undefined);
      this.enterPatrolling(ticks);
      return;
    }
    this.patrolMode = "automatic";
    this.nextPatrolReplanTick = ticks + INTERCEPT_REPLAN_TICKS;
    fighter.updateAircraftState({ phase: "engaging" });
  }

  private beginPatrolEgress(ticks: number): void {
    const fighter = this.fighter;
    if (fighter === null || !fighter.isActive()) {
      this.active = false;
      return;
    }
    const anchor = this.nearestPatrolAnchor(fighter.tile());
    if (anchor === null) {
      this.finishSortie();
      return;
    }

    fighter.setTargetUnit(undefined);
    this.manualStrikeTargetTile = null;
    this.strikeVictim = null;
    fighter.setTargetTile(anchor);
    this.patrolMode = "egressing";
    if (!this.setRoute(anchor, ticks)) {
      fighter.setTargetTile(fighter.tile());
      this.patrolMode = "patrolling";
      this.nextPatrolScanTick = ticks + PATROL_SCAN_TICKS;
      fighter.updateAircraftState({
        phase: "patrolling",
        patrolAnchorTile: fighter.tile(),
        departureTick: undefined,
      });
      return;
    }
    fighter.updateAircraftState({
      phase: "outbound",
      patrolAnchorTile: anchor,
      departureTick: undefined,
    });
  }

  private enterPatrolling(ticks: number): void {
    const fighter = this.fighter!;
    const anchor = fighter.aircraftState().patrolAnchorTile ?? fighter.tile();
    fighter.setTargetUnit(undefined);
    fighter.setTargetTile(anchor);
    this.patrolMode = "patrolling";
    this.nextPatrolScanTick = ticks + PATROL_SCAN_TICKS;
    fighter.updateAircraftState({
      phase: "patrolling",
      patrolAnchorTile: anchor,
    });
  }

  private selectPatrolTarget(): Unit | null {
    const fighter = this.fighter;
    if (fighter === null) return null;
    const borders = Array.from(this.player.borderTiles()).sort((a, b) => a - b);
    if (borders.length === 0) return null;

    const ranked: PatrolTargetRank[] = [];
    for (const unit of this.mg.units([
      UnitType.FighterJet,
      UnitType.Warship,
      UnitType.TransportShip,
    ])) {
      const rank = this.rankAutomaticPatrolTarget(unit, borders);
      if (rank !== null) ranked.push(rank);
    }

    ranked.sort(
      (a, b) =>
        a.priority - b.priority ||
        a.borderDistance - b.borderDistance ||
        a.fighterDistance - b.fighterDistance ||
        a.unit.id() - b.unit.id(),
    );
    return ranked[0]?.unit ?? null;
  }

  private isEligibleAutomaticPatrolTarget(unit: Unit): boolean {
    const borders = Array.from(this.player.borderTiles()).sort((a, b) => a - b);
    return (
      borders.length > 0 &&
      this.rankAutomaticPatrolTarget(unit, borders) !== null
    );
  }

  private rankAutomaticPatrolTarget(
    unit: Unit,
    borders: readonly TileRef[],
  ): PatrolTargetRank | null {
    const fighter = this.fighter;
    if (fighter === null || !this.isValidPatrolUnitTarget(unit)) return null;

    const currentBorderDistance = this.distanceToPatrolBorder(
      unit.tile(),
      borders,
    );
    let priority: number;
    let borderDistance = currentBorderDistance;

    if (unit.type() === UnitType.FighterJet) {
      priority = this.isDirectPatrolThreatToPlayer(unit) ? 0 : 2;
    } else {
      const declaredTarget =
        unit.targetTile() ??
        (unit.type() === UnitType.Warship
          ? unit.warshipState().patrolTile
          : undefined);
      const declaredBorderDistance =
        declaredTarget === undefined
          ? Number.MAX_SAFE_INTEGER
          : this.distanceToPatrolBorder(declaredTarget, borders);
      const declaredOwner =
        declaredTarget === undefined ? null : this.mg.owner(declaredTarget);
      const approaching =
        declaredOwner === this.player ||
        declaredBorderDistance <= this.mg.config().fighterPatrolRadius();
      const near =
        currentBorderDistance <= this.mg.config().fighterPatrolRadius();
      if (!approaching && !near) return null;
      priority = approaching ? 1 : unit.type() === UnitType.Warship ? 3 : 4;
      borderDistance = Math.min(currentBorderDistance, declaredBorderDistance);
    }

    return {
      unit,
      priority,
      borderDistance,
      fighterDistance: this.mg.manhattanDist(fighter.tile(), unit.tile()),
    };
  }

  private isValidPatrolUnitTarget(unit: Unit): boolean {
    if (
      unit === this.fighter ||
      !unit.isActive() ||
      !unit.isTargetable() ||
      !this.player.canAttackPlayer(unit.owner(), true)
    ) {
      return false;
    }
    if (unit.type() === UnitType.FighterJet) {
      return (
        this.mg.config().airSuperiorityV1Enabled() ||
        unit.aircraftState().phase !== "returning"
      );
    }
    return (
      unit.type() === UnitType.Warship ||
      (unit.type() === UnitType.TransportShip &&
        (this.mg.config().airSuperiorityV1Enabled() || unit.troops() > 0))
    );
  }

  /**
   * Hostile land is a valid strike point; so is ground an earlier bomb of the
   * same order already razed (unowned fallout) while the recorded victim can
   * still be attacked, so follow-up jets do not turn back over a crater.
   */
  private isValidStrikePoint(tile: TileRef): boolean {
    if (this.isValidPatrolLandTarget(tile)) return true;
    const victim = this.strikeVictim;
    return (
      victim !== null &&
      this.mg.config().airportOperationsV1Enabled() &&
      this.mg.isValidRef(tile) &&
      this.mg.isLand(tile) &&
      !this.mg.isImpassable(tile) &&
      !this.mg.hasOwner(tile) &&
      victim.isAlive() &&
      this.player.canAttackPlayer(victim)
    );
  }

  private isValidPatrolLandTarget(tile: TileRef): boolean {
    if (
      !this.mg.isValidRef(tile) ||
      !this.mg.isLand(tile) ||
      this.mg.isImpassable(tile)
    ) {
      return false;
    }
    const owner = this.mg.owner(tile);
    return owner.isPlayer() && this.player.canAttackPlayer(owner);
  }

  private nearestPatrolAnchor(reference: TileRef): TileRef | null {
    let best: TileRef | null = null;
    let bestDistance = Number.MAX_SAFE_INTEGER;
    for (const border of this.player.borderTiles()) {
      const distance = this.mg.manhattanDist(reference, border);
      if (
        distance < bestDistance ||
        (distance === bestDistance && (best === null || border < best))
      ) {
        best = border;
        bestDistance = distance;
      }
    }
    return best;
  }

  private distanceToPatrolBorder(
    tile: TileRef,
    borders: readonly TileRef[],
  ): number {
    let best = Number.MAX_SAFE_INTEGER;
    for (const border of borders) {
      best = Math.min(best, this.mg.manhattanDist(tile, border));
      if (best === 0) return 0;
    }
    return best;
  }

  private resolveV2MissionTarget(): ResolvedMissionTarget | false {
    if (this.order.mission === AirMissionType.CombatAirPatrol) {
      if (!this.mg.isValidRef(this.order.targetTile)) return false;
      const anchor = this.nearestPatrolAnchor(this.order.targetTile);
      return anchor === null ? false : { targetTile: anchor, targetUnit: null };
    }

    if (this.order.mission === AirMissionType.Intercept) {
      if ("targetUnitId" in this.order) {
        const target = this.mg.unit(this.order.targetUnitId);
        return target !== undefined && this.isValidInterceptTarget(target)
          ? { targetTile: this.interceptAimTile(target), targetUnit: target }
          : false;
      }
      if (!this.mg.isValidRef(this.order.targetTile)) return false;
      const target = this.selectGlobalDefenseTarget();
      return target === null
        ? { targetTile: this.order.targetTile, targetUnit: null }
        : { targetTile: this.interceptAimTile(target), targetUnit: target };
    }

    if (this.order.mission === AirMissionType.PrecisionStrike) {
      const tile = this.order.targetTile;
      if (!this.mg.isValidRef(tile)) return false;
      const owner = this.mg.owner(tile);
      return this.mg.isLand(tile) &&
        !this.mg.isImpassable(tile) &&
        owner.isPlayer() &&
        this.player.canAttackPlayer(owner)
        ? { targetTile: tile, targetUnit: null }
        : false;
    }

    const target = this.mg.unit(this.order.targetUnitId);
    if (target === undefined || !target.isActive() || !target.isTargetable()) {
      return false;
    }
    if (this.order.mission === AirMissionType.NavalStrike) {
      return this.isShip(target) &&
        this.player.canAttackPlayer(target.owner(), true)
        ? { targetTile: target.tile(), targetUnit: target }
        : false;
    }
    return this.isFriendlyEscortTarget(target)
      ? { targetTile: target.tile(), targetUnit: target }
      : false;
  }

  private selectGlobalDefenseTarget(): Unit | null {
    const targets = this.mg
      .units(UnitType.FighterJet)
      .filter((unit) => this.isValidInterceptTarget(unit))
      .sort((a, b) => this.compareGlobalDefensePriority(a, b));
    return targets[0] ?? null;
  }

  private compareGlobalDefensePriority(a: Unit, b: Unit): number {
    const threatDelta =
      Number(!this.isDirectThreatToPlayer(a)) -
      Number(!this.isDirectThreatToPlayer(b));
    if (threatDelta !== 0) return threatDelta;
    const urgencyDelta =
      a.aircraftState().missionEndTick - b.aircraftState().missionEndTick;
    return urgencyDelta || a.id() - b.id();
  }

  private isValidInterceptTarget(unit: Unit): boolean {
    return (
      unit !== this.fighter &&
      unit.type() === UnitType.FighterJet &&
      unit.isActive() &&
      unit.isTargetable() &&
      unit.aircraftState().phase !== "returning" &&
      this.player.canAttackPlayer(unit.owner(), true)
    );
  }

  private isDirectThreatToPlayer(unit: Unit): boolean {
    const state = unit.aircraftState();
    if (state.phase === "returning") return false;
    if (state.mission === AirMissionType.PrecisionStrike) {
      const tile = unit.targetTile();
      if (tile === undefined || !this.mg.isValidRef(tile)) return false;
      const owner = this.mg.owner(tile);
      return owner.isPlayer() && this.isProtectedPlayer(owner);
    }
    if (state.mission === AirMissionType.NavalStrike) {
      const target = unit.targetUnit();
      return (
        target !== undefined &&
        target.isActive() &&
        this.isProtectedPlayer(target.owner())
      );
    }
    return false;
  }

  private isDirectPatrolThreatToPlayer(unit: Unit): boolean {
    if (unit.aircraftState().phase === "returning") return false;
    const target = unit.targetUnit();
    if (
      target !== undefined &&
      target.isActive() &&
      this.isProtectedPlayer(target.owner())
    ) {
      return true;
    }
    const tile = unit.targetTile();
    if (tile === undefined || !this.mg.isValidRef(tile)) return false;
    const owner = this.mg.owner(tile);
    return owner.isPlayer() && this.isProtectedPlayer(owner);
  }

  private isProtectedPlayer(owner: Player): boolean {
    return (
      owner === this.player ||
      this.player.isFriendly(owner) ||
      owner.isFriendly(this.player)
    );
  }

  private interceptAimTile(target: Unit): TileRef {
    const declaredDestination = target.targetTile();
    if (declaredDestination === undefined || this.fighter === null) {
      return declaredDestination ?? target.tile();
    }

    // Lead an inbound strike at its declared destination. Once the defender
    // reaches that point, fall back to the aircraft's live tile so a delayed
    // or redirected target is pursued rather than orbiting a stale waypoint.
    const engagementRange = this.mg.config().fighterEngagementRange();
    return this.mg.manhattanDist(this.fighter.tile(), declaredDestination) <=
      engagementRange &&
      this.mg.manhattanDist(this.fighter.tile(), target.tile()) >
        engagementRange
      ? target.tile()
      : declaredDestination;
  }

  private validatedTargetTile(): TileRef | false {
    if ("targetTile" in this.order) {
      const tile = this.order.targetTile;
      if (!this.mg.isValidRef(tile)) {
        return false;
      }
      if (this.order.mission === AirMissionType.PrecisionStrike) {
        const owner = this.mg.owner(tile);
        if (
          !this.mg.isLand(tile) ||
          this.mg.isImpassable(tile) ||
          !owner.isPlayer() ||
          !this.player.canAttackPlayer(owner)
        ) {
          return false;
        }
      }
      return tile;
    }

    const target = this.mg.unit(this.order.targetUnitId);
    if (target === undefined || !target.isActive() || !target.isTargetable()) {
      return false;
    }
    if (this.order.mission === AirMissionType.Intercept) {
      // Targeted interception is V2-only. The old tile form above retains the
      // exact V1 command and simulation path.
      return false;
    }
    if (this.order.mission === AirMissionType.NavalStrike) {
      if (
        !this.isShip(target) ||
        !this.player.canAttackPlayer(target.owner(), true)
      ) {
        return false;
      }
    } else if (!this.isFriendlyEscortTarget(target)) {
      return false;
    }
    return target.tile();
  }

  private targetStillValid(): boolean {
    if (this.order.mission === AirMissionType.Intercept) {
      return true;
    }
    if (this.order.mission === AirMissionType.PrecisionStrike) {
      return this.isValidStrikePoint(this.order.targetTile);
    }
    const target = this.targetUnit();
    if (target === null) return false;
    return this.order.mission === AirMissionType.NavalStrike
      ? this.isShip(target) && this.player.canAttackPlayer(target.owner(), true)
      : this.isFriendlyEscortTarget(target);
  }

  private targetUnit(): Unit | null {
    if (!("targetUnitId" in this.order)) return null;
    const target = this.mg.unit(this.order.targetUnitId);
    return target !== undefined && target.isActive() ? target : null;
  }

  private isShip(unit: Unit): boolean {
    return (
      unit.type() === UnitType.Warship || unit.type() === UnitType.TransportShip
    );
  }

  private isFriendlyEscortTarget(unit: Unit): boolean {
    return (
      this.isShip(unit) &&
      (unit.owner() === this.player || this.player.isFriendly(unit.owner()))
    );
  }

  private homeFactoryOperational(): boolean {
    return (
      this.homeFactory !== null &&
      this.homeFactory.isActive() &&
      this.homeFactory.owner() === this.player &&
      !this.homeFactory.isMarkedForDeletion() &&
      !this.homeFactory.isUnderConstruction()
    );
  }

  private beginReturn(ticks: number): void {
    const fighter = this.fighter;
    if (fighter === null || !fighter.isActive()) {
      this.active = false;
      return;
    }
    fighter.setTargetUnit(undefined);
    fighter.setTargetTile(this.homeTile);
    fighter.updateAircraftState({ phase: "returning" });
    if (!this.setRoute(this.homeTile, ticks)) {
      this.finishSortie();
    }
  }

  private setRoute(target: TileRef, ticks: number): boolean {
    const fighter = this.fighter;
    if (fighter === null || !fighter.isActive()) return false;
    const sampled = this.sampleRoute(fighter.tile(), target);
    if (sampled === null) return false;

    this.installRoute(sampled, target, ticks);
    return true;
  }

  private sampleRoute(from: TileRef, target: TileRef): TileRef[] | null {
    const fullPath = PathFinding.Air(this.mg).findPath(from, target);
    if (fullPath === null || fullPath.length === 0) return null;

    const speed = Math.max(1, this.fighterSpeed());
    const sampled: TileRef[] = [fullPath[0]];
    for (let i = speed; i < fullPath.length - 1; i += speed) {
      sampled.push(fullPath[i]);
    }
    const destination = fullPath[fullPath.length - 1];
    if (sampled[sampled.length - 1] !== destination) {
      sampled.push(destination);
    }

    return sampled;
  }

  private airportAircraftType(): AircraftType | undefined {
    return "aircraftType" in this.order ? this.order.aircraftType : undefined;
  }

  /**
   * Airport-profile jets fly at their airframe's speed on every mission,
   * patrol included; the built unit's state is authoritative once it exists.
   */
  private fighterSpeed(): number {
    if (!this.mg.config().airportOperationsV1Enabled()) {
      return this.mg.config().fighterSpeed();
    }
    return aircraftProfile(
      this.fighter?.aircraftState().aircraftType ?? this.airportAircraftType(),
    ).speed;
  }

  private installRoute(
    sampled: TileRef[],
    target: TileRef,
    ticks: number,
  ): void {
    const fighter = this.fighter!;
    this.route = sampled;
    this.routeIndex = 1;
    this.motionPlanId++;
    fighter.setTargetTile(target);
    this.mg.recordMotionPlan({
      kind: "grid",
      unitId: fighter.id(),
      planId: this.motionPlanId,
      startTick: ticks + 1,
      ticksPerStep: 1,
      path: sampled,
    });
  }

  private advanceRoute(): boolean {
    const fighter = this.fighter!;
    if (this.routeIndex >= this.route.length) {
      return true;
    }
    fighter.move(this.route[this.routeIndex++]);
    return this.routeIndex >= this.route.length;
  }

  private finishSortie(): void {
    if (this.fighter?.isActive()) {
      this.fighter.delete(false);
    }
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
