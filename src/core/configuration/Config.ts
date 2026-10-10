import { z } from "zod";
import { PlayerView } from "../../client/view";
import { AssetManifest } from "../AssetUrls";
import {
  airDefenseProfile,
  airDefenseRadius,
} from "../game/AirDefenseProfiles";
import { DoomsdayClockSpeed } from "../game/DoomsdayClock";
import {
  AirDefenseSystem,
  Difficulty,
  Game,
  GameMapType,
  GameMode,
  GameType,
  Gold,
  MatchTempo,
  Player,
  PlayerInfo,
  PlayerType,
  TerrainType,
  TerraNullius,
  Tick,
  UnitInfo,
  UnitType,
  VictoryCondition,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { isLocalProvenanceSafeMap } from "../game/LocalProvenanceSafeMaps";
import { UserSettings } from "../game/UserSettings";
import {
  applyPerMille,
  applyPerMilleBigint,
  progressionBonus,
} from "../Progression";
import { GameConfig, LocalSkirmishProfile, TeamCountConfig } from "../Schemas";
import { NukeType } from "../StatsSchemas";
import { assertNever, sigmoid, toInt, within } from "../Util";

declare global {
  interface Window {
    BOOTSTRAP_CONFIG?: {
      gitCommit?: string;
      assetManifest?: AssetManifest;
      cdnBase?: string;
      gameEnv?: string;
      numWorkers?: number;
      turnstileSiteKey?: string;
      jwtAudience?: string;
      instanceId?: string;
      // Private localhost builds disable production services and unverified
      // runtime assets. Optional for compatibility with archived app shells.
      localOnly?: boolean;
      // Hosted profile (PUBLIC_ORIGIN set): legal pages and hosted surfaces exist.
      hosted?: boolean;
      // Hosted profile: public lobbies and the private-lobby flow are shown.
      multiplayer?: boolean;
      // Complete corresponding source of this build (AGPL network offer).
      sourceUrl?: string | null;
      // Hosted profile with ADSENSE_CLIENT: publisher id and menu ad unit.
      adsense?: { client: string; menuSlot: string | null } | null;
      // Desktop-only: explicit game-server host for the WebSocket origin.
      // Absent on the web build (client falls back to same-origin location).
      serverHost?: string;
    };
  }
}

export enum GameEnv {
  Dev,
  Preprod,
  Prod,
}

export function parseGameEnv(value: string | undefined): GameEnv {
  switch (value) {
    case "dev":
      return GameEnv.Dev;
    case "staging":
      return GameEnv.Preprod;
    case "prod":
      return GameEnv.Prod;
    default:
      throw new Error(`unsupported game env: ${value}`);
  }
}

export interface NukeMagnitude {
  inner: number;
  outer: number;
}

const DEFENSE_DEBUFF_MIDPOINT = 150_000;
const DEFENSE_DEBUFF_DECAY_RATE = Math.LN2 / 50000;
const DEFAULT_SPAWN_IMMUNITY_TICKS = 5 * 10;

const LOCAL_THE_BOX_WILDERNESS = {
  attackerTroopLossDivisor: 7,
  frontierTilesPerAdjacentTile: 0.86,
} as const;

export const JwksSchema = z.object({
  keys: z
    .object({
      alg: z.literal("EdDSA"),
      crv: z.literal("Ed25519"),
      kty: z.literal("OKP"),
      x: z.string(),
    })
    .array()
    .min(1),
});

/** SAM launcher construction duration in ticks (non-instant-build). */
export const SAM_CONSTRUCTION_TICKS = 30 * 10;

// Doomsday Clock tunables (anti-stall). Off unless enabled in GameConfig.
// Times in seconds. The required map share rises in waves (levels + times in
// DoomsdayClock.ts, chosen by `speed`). A side caught below the bar gets a
// warnSeconds cooldown ("Danger, decay in Xs"), then troops bleed DOWN TO A
// FLOOR (drainFloorPercent of max), not to zero: the warn (30s) + the linear
// drain (~90s from full troops, sooner with fewer troops or a shrinking
// territory) make ~2 minutes from caught to the floor. A doomed side is crippled
// to 5% of max, not eliminated, so a brief dip below the bar is recoverable (the
// drain stops the moment it climbs back); the rising bar still guarantees a
// finish by squeezing territory and leaving the doomed side easy to conquer.
const DOOMSDAY_CLOCK_DEFAULTS = {
  enabled: false,
  speed: "normal" as DoomsdayClockSpeed,
  warnSeconds: 30, // cooldown (the flashing danger cue) before decay begins
  drainStartPercent: 2, // starts bleeding at once (already beats troop income)
  drainMaxPercent: 5,
  drainRampSeconds: 90, // ramps LINEARLY to the max over this long
  drainFloorPercent: 5, // drain settles here: crippled to 5% of max, never wiped
  // The floor decays start -> drainFloorPercent over floorDecaySeconds, leaving
  // one comeback window with a usable army. It must not be permanent: maxTroops is
  // sublinear (~100k at one tile), so a fixed 40% is ~40k troops on a single tile.
  floorStartPercent: 40,
  floorDecaySeconds: 90,
  // TERRITORY ROT — the finisher, since the drain never kills. rotDeathSeconds is
  // a DEADLINE, not a rate: the territory is gone this long after the skull
  // appeared, whatever it holds. 0 disables rot. Timeline:
  //
  //   0s    skull blinks, warn countdown
  //   30s   skull steady, troops draining              (warnSeconds)
  //   120s  floor at 5%, territory rotting, skull RED  (warn + floorDecay)
  //   150s  nothing left, eliminated                   (rotDeathSeconds)
  rotDeathSeconds: 150,
  // Grainy opening: pinholes across this share of the territory before the holes
  // grow together. Held to a third of the rot window, so shortening the window
  // shortens this too: at 20s the speckle WAS the death rather than its opening.
  rotGrainSeconds: 10,
  rotSpecklePercent: 15,
  // Warships bleed on their OWN gentler start + a STEEP (convex) ramp to a much
  // higher ceiling. A ship caught when its side is first doomed lasts about as
  // long as troops (the low start + no income ≈ the troop net rate), but the rate
  // curves up sharply (warshipDrainCurveExponent), so once a side has been under
  // the clock the full ramp, ships drop to the same floor in ~2s (50%/s), not
  // sunk. Ships only.
  warshipDrainStartPercent: 1,
  warshipDrainMaxPercent: 50,
  warshipDrainCurveExponent: 8, // >1 = convex: stays gentle early, then spikes
};

export class Config {
  private unitInfoCache = new Map<UnitType, UnitInfo>();
  constructor(
    private _gameConfig: GameConfig,
    private _userSettings: UserSettings | null,
    private _isReplay: boolean,
    public readonly listed: boolean = false,
  ) {}

  isReplay(): boolean {
    return this._isReplay;
  }

  traitorDefenseDebuff(): number {
    return 0.5;
  }
  traitorSpeedDebuff(): number {
    return 0.8;
  }

  private usesLocalTheBoxWildernessProfile(
    attacker: Player,
    defender: Player | TerraNullius,
  ): boolean {
    return (
      !defender.isPlayer() &&
      this._gameConfig.localSkirmishProfile === LocalSkirmishProfile.TheBox &&
      this._gameConfig.gameType === GameType.Singleplayer &&
      this._gameConfig.gameMap === GameMapType.TheBox &&
      attacker.type() === PlayerType.Human
    );
  }
  traitorDuration(): number {
    return 30 * 10; // 30 seconds
  }

  // Doomsday Clock config, resolved against defaults. One read per tick.
  doomsdayClockConfig(): typeof DOOMSDAY_CLOCK_DEFAULTS {
    const c = this._gameConfig.doomsdayClock;
    const d = DOOMSDAY_CLOCK_DEFAULTS;
    return {
      enabled: c?.enabled ?? d.enabled,
      speed: c?.speed ?? d.speed,
      // Drain/warn tuning is internal (not wire-configurable): always defaults.
      warnSeconds: d.warnSeconds,
      drainStartPercent: d.drainStartPercent,
      drainMaxPercent: d.drainMaxPercent,
      drainRampSeconds: d.drainRampSeconds,
      drainFloorPercent: d.drainFloorPercent,
      floorStartPercent: d.floorStartPercent,
      floorDecaySeconds: d.floorDecaySeconds,
      rotDeathSeconds: d.rotDeathSeconds,
      rotGrainSeconds: d.rotGrainSeconds,
      rotSpecklePercent: d.rotSpecklePercent,
      warshipDrainStartPercent: d.warshipDrainStartPercent,
      warshipDrainMaxPercent: d.warshipDrainMaxPercent,
      warshipDrainCurveExponent: d.warshipDrainCurveExponent,
    };
  }
  spawnImmunityDuration(): Tick {
    return (
      this._gameConfig.spawnImmunityDuration ?? DEFAULT_SPAWN_IMMUNITY_TICKS
    );
  }
  nationSpawnImmunityDuration(): Tick {
    return DEFAULT_SPAWN_IMMUNITY_TICKS;
  }
  hasExtendedSpawnImmunity(): boolean {
    return this.spawnImmunityDuration() > DEFAULT_SPAWN_IMMUNITY_TICKS;
  }

  gameConfig(): GameConfig {
    return this._gameConfig;
  }

  depthProgressionEnabled(): boolean {
    return (
      this._gameConfig.depthProgression === true &&
      this._gameConfig.gameType === GameType.Singleplayer &&
      isLocalProvenanceSafeMap(this._gameConfig.gameMap)
    );
  }

  combinedArmsV1Enabled(): boolean {
    return this._gameConfig.combinedArmsV1 === true;
  }

  combinedArmsV2Enabled(): boolean {
    return (
      this._gameConfig.combinedArmsV1 === true &&
      this._gameConfig.combinedArmsV2 === true
    );
  }

  airSuperiorityV1Enabled(): boolean {
    return (
      this._gameConfig.airSuperiorityV1 === true &&
      this.combinedArmsV2Enabled() &&
      this._gameConfig.gameType === GameType.Singleplayer &&
      isLocalProvenanceSafeMap(this._gameConfig.gameMap)
    );
  }

  airportOperationsV1Enabled(): boolean {
    return (
      this._gameConfig.airportOperationsV1 === true &&
      this.airSuperiorityV1Enabled() &&
      this._gameConfig.gameType === GameType.Singleplayer &&
      isLocalProvenanceSafeMap(this._gameConfig.gameMap)
    );
  }

  userSettings(): UserSettings {
    if (this._userSettings === null) {
      throw new Error("userSettings is null");
    }
    return this._userSettings;
  }

  cityTroopIncrease(): number {
    return 250_000;
  }

  /** Population of a player's capital before any City or Barracks. */
  capitalPopulation(): number {
    return 150_000;
  }

  /** People housed by each completed Barracks level. */
  barracksPopulationIncrease(): number {
    return 50_000;
  }

  /**
   * Troop production multiplier from completed Barracks levels: +25% per
   * level, at most four times the base rate (12 levels).
   */
  barracksTroopRateMultiplier(barracksLevels: number): number {
    return Math.min(4, 1 + 0.25 * Math.max(0, barracksLevels));
  }

  /** Summed levels of a player's finished structures of one type. */
  completedStructureLevels(
    player: Player | PlayerView,
    type: UnitType.City | UnitType.Barracks,
  ): number {
    return player
      .units(type)
      .filter((unit) => !unit.isUnderConstruction())
      .reduce((total, unit) => total + unit.level(), 0);
  }

  falloutDefenseModifier(falloutRatio: number): number {
    // falloutRatio is between 0 and 1
    // So defense modifier is between [5, 2.5]
    return 5 - falloutRatio * 2;
  }
  msPerTick(): number {
    return 100;
  }
  matchTempo(): MatchTempo {
    return this._gameConfig.matchTempo ?? MatchTempo.Medium;
  }
  victoryCondition(): VictoryCondition {
    return this._gameConfig.victoryCondition ?? VictoryCondition.Territory;
  }
  tempoRateMultiplier(): number {
    const tempo = this.matchTempo();
    switch (tempo) {
      case MatchTempo.Slow:
        return 0.75;
      case MatchTempo.Medium:
        return 1;
      case MatchTempo.Fast:
        return 1.5;
      default:
        return assertNever(tempo);
    }
  }
  tempoDurationTicks(baseTicks: number): number {
    if (baseTicks === 0) return 0;
    return Math.max(1, Math.round(baseTicks / this.tempoRateMultiplier()));
  }
  SAMCooldown(): number {
    return this.tempoDurationTicks(90);
  }
  fighterLaunchCooldown(): number {
    return this.tempoDurationTicks(20 * 10);
  }
  fighterMissionDuration(): number {
    return this.combinedArmsV2Enabled() ? 45 * 10 : 30 * 10;
  }
  fighterRange(): number {
    // A finite exact integer keeps distance comparisons deterministic while
    // making every valid tile on every shipped map reachable in V2.
    return this.combinedArmsV2Enabled() ? Number.MAX_SAFE_INTEGER : 240;
  }
  fighterSpeed(): number {
    return this.combinedArmsV2Enabled() ? 8 : 4;
  }
  fighterMaxActive(): number {
    return this.combinedArmsV2Enabled() ? 2 : 4;
  }
  fighterEngagementRange(): number {
    return this.combinedArmsV2Enabled() ? 24 : 14;
  }
  fighterPatrolRadius(): number {
    return this.combinedArmsV2Enabled() ? 64 : 42;
  }
  fighterAttackCooldown(): number {
    const baseCooldown = this.airportOperationsV1Enabled()
      ? 3
      : this.combinedArmsV2Enabled()
        ? 6
        : 8;
    return this.tempoDurationTicks(baseCooldown);
  }
  fighterPatrolAmmo(): number {
    return this.combinedArmsV2Enabled() ? 2 : 4;
  }
  fighterAirDamage(): number {
    return this.combinedArmsV2Enabled() ? 300 : 80;
  }
  fighterNavalDamage(): number {
    return this.combinedArmsV2Enabled() ? 600 : 260;
  }
  fighterPrecisionTroopDamage(): number {
    return this.combinedArmsV2Enabled() ? 100_000 : 20_000;
  }
  fighterPrecisionTroopPercent(): number {
    return this.combinedArmsV2Enabled() ? 10 : 5;
  }
  fighterSamDamage(): number {
    return 175;
  }
  fighterMissileSpeed(): number {
    if (this.airportOperationsV1Enabled()) return 12;
    // Faster than a V2 fighter (8), while still leaving readable intermediate
    // frames across the 24-tile engagement envelope.
    return 9;
  }
  fighterBombSpeed(): number {
    return 8;
  }
  /**
   * Manhattan distance short of the target at which a Jet Attack releases its
   * bomb. Zero: the jet flies over the target and drops on arrival.
   */
  fighterBombStandOffRange(): number {
    return 0;
  }
  SiloCooldown(): number {
    return this.tempoDurationTicks(90);
  }

  defensePostRange(): number {
    return 30;
  }

  defensePostDefenseBonus(): number {
    return 5;
  }

  defensePostSpeedBonus(): number {
    return 3;
  }

  playerTeams(): TeamCountConfig {
    return this._gameConfig.playerTeams ?? 0;
  }

  spawnNations(): boolean {
    return this._gameConfig.nations !== "disabled";
  }

  isUnitDisabled(unitType: UnitType): boolean {
    if (unitType === UnitType.FighterJet && !this.combinedArmsV1Enabled()) {
      return true;
    }
    if (unitType === UnitType.Airport && !this.airportOperationsV1Enabled()) {
      return true;
    }
    return this._gameConfig.disabledUnits?.includes(unitType) ?? false;
  }

  bots(): number {
    return this._gameConfig.bots;
  }
  instantBuild(): boolean {
    return this._gameConfig.instantBuild;
  }
  disableNavMesh(): boolean {
    return this._gameConfig.disableNavMesh ?? false;
  }
  disableAlliances(): boolean {
    // customAllianceDuration === 0 disables alliances (the "custom alliances"
    // control at 0). The legacy boolean is still honored for older configs.
    return (
      this._gameConfig.customAllianceDuration === 0 ||
      (this._gameConfig.disableAlliances ?? false)
    );
  }
  waterNukes(): boolean {
    return this._gameConfig.waterNukes ?? false;
  }
  isRandomSpawn(): boolean {
    return this._gameConfig.randomSpawn;
  }
  infiniteGold(): boolean {
    return this._gameConfig.infiniteGold;
  }
  donateGold(): boolean {
    return this._gameConfig.donateGold;
  }
  infiniteTroops(): boolean {
    return this._gameConfig.infiniteTroops;
  }
  donateTroops(): boolean {
    return this._gameConfig.donateTroops;
  }
  goldMultiplier(): number {
    return this._gameConfig.goldMultiplier ?? 1;
  }
  startingGold(playerInfo: PlayerInfo): Gold {
    if (playerInfo.playerType === PlayerType.Bot) {
      return 0n;
    }
    return this.startingGoldFor(playerInfo);
  }

  trainSpawnRate(numPlayerFactories: number): number {
    // hyperbolic decay, midpoint at 10 factories
    // expected number of trains = numPlayerFactories  / trainSpawnRate(numPlayerFactories)
    return (numPlayerFactories + 10) * 15;
  }
  trainGold(
    rel: "self" | "team" | "ally" | "other",
    citiesVisited: number,
    player: Player | PlayerView,
  ): Gold {
    // No penalty for the first 10 cities.
    citiesVisited = Math.max(0, citiesVisited - 9);
    let baseGold: number;
    switch (rel) {
      case "ally":
        baseGold = 35_000;
        break;
      case "team":
      case "other":
        baseGold = 25_000;
        break;
      case "self":
        baseGold = 10_000;
        break;
    }
    const distPenalty = citiesVisited * 5_000;
    const gold = Math.max(5000, baseGold - distPenalty);
    return toInt(gold * this.goldMultiplierFor(player));
  }

  trainStationMinRange(): number {
    return 15;
  }
  trainStationMaxRange(): number {
    return 110;
  }
  railroadMaxSize(): number {
    return this.trainStationMaxRange() * 1.4142;
  }

  tradeShipGold(dist: number, player: Player | PlayerView): Gold {
    if (this.depthProgressionEnabled()) {
      const baseGold = Math.floor(50_000 + 100 * dist);
      const portLevels = this.effectivePortLevels(player);
      let portMultiplier = 1;
      for (let i = 0; i < portLevels; i++) {
        portMultiplier += 0.25 * Math.pow(0.9, i);
      }
      return BigInt(
        Math.floor(baseGold * portMultiplier * this.goldMultiplierFor(player)),
      );
    }

    // Sigmoid: concave start, sharp S-curve middle, linear end - heavily punishes trades under range debuff.
    const debuff = this.tradeShipShortRangeDebuff();
    const baseGold =
      75_000 / (1 + Math.exp(-0.03 * (dist - debuff))) + 50 * dist;
    return BigInt(Math.floor(baseGold * this.goldMultiplierFor(player)));
  }

  effectivePortLevels(player: Player | PlayerView): number {
    let total = 0;
    for (const port of player.units(UnitType.Port)) {
      if (!port.isActive() || port.isUnderConstruction()) continue;
      const level = Math.floor(port.level());
      if (!Number.isFinite(level)) continue;
      total += Math.max(0, Math.min(5, level));
    }
    return total;
  }

  // Probability of trade ship spawn = 1 / tradeShipSpawnRate
  tradeShipSpawnRate(
    tradeShipSpawnRejections: number,
    numTradeShips: number,
  ): number {
    const decayRate = Math.LN2 / 50;

    // Approaches 0 as numTradeShips increase
    const baseSpawnRate = 1 - sigmoid(numTradeShips, decayRate, 400);

    // Pity timer: increases spawn chance after consecutive rejections
    const rejectionModifier = 1 / (tradeShipSpawnRejections + 1);

    return Math.floor((100 * rejectionModifier) / baseSpawnRate);
  }

  unitInfo(type: UnitType): UnitInfo {
    const cached = this.unitInfoCache.get(type);
    if (cached !== undefined) {
      return cached;
    }

    let info: UnitInfo;
    switch (type) {
      case UnitType.TransportShip:
        info = {
          cost: () => 0n,
        };
        break;
      case UnitType.Warship:
        info = {
          cost: this.costWrapper(
            (numUnits: number) => Math.min(1_000_000, (numUnits + 1) * 250_000),
            UnitType.Warship,
          ),
          maxHealth: 1000,
        };
        break;
      case UnitType.FighterJet:
        info = {
          cost: this.costWrapper(() => 750_000, UnitType.FighterJet),
          maxHealth: 300,
          damage: this.fighterAirDamage(),
        };
        break;
      case UnitType.FighterMissile:
        info = {
          cost: () => 0n,
        };
        break;
      case UnitType.FighterBomb:
        info = {
          cost: () => 0n,
        };
        break;
      case UnitType.Shell:
        info = {
          cost: () => 0n,
          damage: 250,
        };
        break;
      case UnitType.SAMMissile:
        info = {
          cost: () => 0n,
        };
        break;
      case UnitType.Port:
        info = {
          cost: this.costWrapper(
            (numUnits: number) =>
              Math.min(1_000_000, Math.pow(2, numUnits) * 125_000),
            UnitType.Port,
            UnitType.Factory,
          ),
          constructionDuration: this.instantBuild()
            ? 0
            : this.tempoDurationTicks(5 * 10),
          upgradable: true,
        };
        break;
      case UnitType.AtomBomb:
        info = {
          cost: this.costWrapper(() => 750_000, UnitType.AtomBomb),
        };
        break;
      case UnitType.HydrogenBomb:
        info = {
          cost: this.costWrapper(() => 5_000_000, UnitType.HydrogenBomb),
        };
        break;
      case UnitType.MIRV:
        info = {
          cost: (game: Game, player: Player) => {
            if (
              player.type() === PlayerType.Human &&
              this.hasInfiniteGoldFor(player)
            ) {
              return 0n;
            }
            return 25_000_000n + game.stats().numMirvsLaunched() * 15_000_000n;
          },
        };
        break;
      case UnitType.MIRVWarhead:
        info = {
          cost: () => 0n,
        };
        break;
      case UnitType.TradeShip:
        info = {
          cost: () => 0n,
        };
        break;
      case UnitType.MissileSilo:
        info = {
          cost: this.costWrapper(() => 1_000_000, UnitType.MissileSilo),
          constructionDuration: this.instantBuild()
            ? 0
            : this.tempoDurationTicks(10 * 10),
          upgradable: true,
        };
        break;
      case UnitType.DefensePost:
        info = {
          cost: this.costWrapper(
            (numUnits: number) => Math.min(250_000, (numUnits + 1) * 50_000),
            UnitType.DefensePost,
          ),
          constructionDuration: this.instantBuild()
            ? 0
            : this.tempoDurationTicks(5 * 10),
        };
        break;
      case UnitType.SAMLauncher:
        info = {
          cost: this.costWrapper(
            (numUnits: number) =>
              Math.min(3_000_000, (numUnits + 1) * 1_500_000),
            UnitType.SAMLauncher,
          ),
          constructionDuration: this.instantBuild()
            ? 0
            : this.tempoDurationTicks(SAM_CONSTRUCTION_TICKS),
          upgradable: true,
        };
        break;
      case UnitType.City:
        info = {
          cost: this.costWrapper(
            (numUnits: number) =>
              Math.min(1_000_000, Math.pow(2, numUnits) * 125_000),
            UnitType.City,
          ),
          constructionDuration: this.instantBuild()
            ? 0
            : this.tempoDurationTicks(2 * 10),
          upgradable: true,
        };
        break;
      case UnitType.Factory:
        info = {
          cost: this.costWrapper(
            (numUnits: number) =>
              Math.min(1_000_000, Math.pow(2, numUnits) * 125_000),
            UnitType.Factory,
            UnitType.Port,
          ),
          constructionDuration: this.instantBuild()
            ? 0
            : this.tempoDurationTicks(2 * 10),
          upgradable: true,
        };
        break;
      case UnitType.Airport:
        info = {
          cost: this.costWrapper(
            (numUnits: number) =>
              Math.min(2_000_000, Math.pow(2, numUnits) * 500_000),
            UnitType.Airport,
          ),
          constructionDuration: this.instantBuild()
            ? 0
            : this.tempoDurationTicks(2 * 10),
        };
        break;
      case UnitType.Barracks:
        info = {
          cost: this.costWrapper(
            (numUnits: number) =>
              Math.min(600_000, Math.pow(2, numUnits) * 75_000),
            UnitType.Barracks,
          ),
          constructionDuration: this.instantBuild()
            ? 0
            : this.tempoDurationTicks(15 * 10),
          upgradable: true,
        };
        break;
      case UnitType.Train:
        info = {
          cost: () => 0n,
        };
        break;
      default:
        assertNever(type);
    }

    this.unitInfoCache.set(type, info);
    return info;
  }

  private hasInfiniteGoldFor(player: Player | PlayerView): boolean {
    if (this.infiniteGold()) return true;
    const hc = this._gameConfig.hostCheats;
    return (hc?.infiniteGold ?? false) && player.isLobbyCreator();
  }

  private hasInfiniteTroopsFor(player: Player | PlayerView): boolean {
    if (this.infiniteTroops()) return true;
    return (
      (this._gameConfig.hostCheats?.infiniteTroops ?? false) &&
      player.isLobbyCreator()
    );
  }

  private hasInfiniteTroopsForInfo(playerInfo: PlayerInfo): boolean {
    if (this.infiniteTroops()) return true;
    return (
      (this._gameConfig.hostCheats?.infiniteTroops ?? false) &&
      playerInfo.isLobbyCreator
    );
  }

  private goldMultiplierFor(player: Player | PlayerView): number {
    const base = this.goldMultiplier();
    const hc = this._gameConfig.hostCheats;
    if (hc?.goldMultiplier && player.isLobbyCreator()) {
      return hc.goldMultiplier;
    }
    return base;
  }

  public conquerGoldAmount(captured: Player): Gold {
    if (
      captured.type() === PlayerType.Bot ||
      captured.type() === PlayerType.Nation
    ) {
      return captured.gold();
    } else {
      return captured.gold() / 2n;
    }
  }

  private startingGoldFor(playerInfo: PlayerInfo): Gold {
    let base = BigInt(this._gameConfig.startingGold ?? 0);
    const hc = this._gameConfig.hostCheats;
    if (hc?.startingGold && playerInfo.isLobbyCreator) {
      base += BigInt(hc.startingGold);
    }
    // Account progression: a little more starting gold per level.
    return applyPerMilleBigint(
      base,
      progressionBonus(playerInfo.progressionLevel).goldPerMille,
    );
  }

  private costWrapper(
    costFn: (units: number) => number,
    ...types: UnitType[]
  ): (g: Game, p: Player, extraUnits?: number) => bigint {
    return (game: Game, player: Player, extraUnits: number = 0) => {
      if (
        player.type() === PlayerType.Human &&
        this.hasInfiniteGoldFor(player)
      ) {
        return 0n;
      }
      const numUnits = types.reduce(
        (acc, type) =>
          acc +
          Math.min(player.unitsOwned(type), player.unitsConstructed(type)),
        0,
      );
      return BigInt(costFn(numUnits + extraUnits));
    };
  }

  defaultDonationAmount(sender: Player): number {
    return Math.floor(sender.troops() / 3);
  }
  donateCooldown(): Tick {
    return 10 * 10;
  }
  embargoAllCooldown(): Tick {
    return 10 * 10;
  }
  deletionMarkDuration(): Tick {
    return 30 * 10;
  }

  deleteUnitCooldown(): Tick {
    return 30 * 10;
  }
  emojiMessageDuration(): Tick {
    return 5 * 10;
  }
  emojiMessageCooldown(): Tick {
    return 5 * 10;
  }
  quickChatCooldown(): Tick {
    return 3 * 10;
  }
  targetDuration(): Tick {
    return 10 * 10;
  }
  targetCooldown(): Tick {
    return 15 * 10;
  }
  allianceRequestDuration(): Tick {
    return 20 * 10;
  }
  allianceRequestCooldown(): Tick {
    return 30 * 10;
  }
  allianceDuration(): Tick {
    // Host can set a custom alliance duration in minutes (1-15); 0 disables
    // alliances (see disableAlliances). Falls back to the 5 minute default.
    const m = this._gameConfig.customAllianceDuration;
    if (typeof m === "number" && m > 0) return m * 60 * 10;
    return 300 * 10; // 5 minutes.
  }
  temporaryEmbargoDuration(): Tick {
    return 300 * 10; // 5 minutes.
  }
  minDistanceBetweenPlayers(): number {
    return 30;
  }

  percentageTilesOwnedToWin(): number {
    if (this._gameConfig.gameMode === GameMode.Team) {
      return 95;
    }
    return 80;
  }
  armyLimitWarningThreshold(): number {
    return 0.8;
  }
  boatMaxNumber(): number {
    if (this.isUnitDisabled(UnitType.TransportShip)) {
      return 0;
    }
    return 3;
  }
  numSpawnPhaseTurns(): number {
    if (this._gameConfig.gameType === GameType.Singleplayer) {
      return 100;
    }
    if (this.isRandomSpawn()) {
      return 150;
    }
    return 300;
  }
  numBots(): number {
    return this.bots();
  }

  attackLogic(
    gm: Game,
    attackTroops: number,
    attacker: Player,
    defender: Player | TerraNullius,
    tileToConquer: TileRef,
  ): {
    attackerTroopLoss: number;
    defenderTroopLoss: number;
    tilesPerTickUsed: number;
  } {
    let mag;
    let speed;
    const type = gm.terrainType(tileToConquer);
    switch (type) {
      case TerrainType.Plains:
        mag = 80;
        speed = 16.5;
        break;
      case TerrainType.Highland:
        mag = 100;
        speed = 20;
        break;
      case TerrainType.Mountain:
        mag = 120;
        speed = 25;
        break;
      case TerrainType.Impassable:
        throw new Error(`impassable terrain cannot be attacked`);
      default:
        throw new Error(`terrain type ${type} not supported`);
    }
    if (defender.isPlayer()) {
      for (const dp of gm.nearbyUnits(
        tileToConquer,
        gm.config().defensePostRange(),
        UnitType.DefensePost,
      )) {
        if (dp.unit.owner() === defender) {
          mag *= this.defensePostDefenseBonus();
          speed *= this.defensePostSpeedBonus();
          break;
        }
      }
    }

    if (gm.hasFallout(tileToConquer)) {
      const falloutRatio = gm.numTilesWithFallout() / gm.numLandTiles();
      mag *= this.falloutDefenseModifier(falloutRatio);
      speed *= this.falloutDefenseModifier(falloutRatio);
    }

    if (attacker.isPlayer() && defender.isPlayer()) {
      if (defender.isDisconnected() && attacker.isOnSameTeam(defender)) {
        // No troop loss if defender is disconnected and on same team
        mag = 0;
      }
      if (
        (attacker.type() === PlayerType.Human ||
          attacker.type() === PlayerType.Nation) &&
        defender.type() === PlayerType.Bot
      ) {
        mag *= 0.7;
      }
    }

    if (defender.isPlayer()) {
      const defenseSig =
        1 -
        sigmoid(
          defender.numTilesOwned(),
          DEFENSE_DEBUFF_DECAY_RATE,
          DEFENSE_DEBUFF_MIDPOINT,
        );

      const largeDefenderSpeedDebuff = 0.7 + 0.3 * defenseSig;
      const largeDefenderAttackDebuff = 0.7 + 0.3 * defenseSig;

      let largeAttackBonus = 1;
      if (attacker.numTilesOwned() > 100_000) {
        largeAttackBonus = Math.sqrt(100_000 / attacker.numTilesOwned()) ** 0.7;
      }
      let largeAttackerSpeedBonus = 1;
      if (attacker.numTilesOwned() > 100_000) {
        largeAttackerSpeedBonus = (100_000 / attacker.numTilesOwned()) ** 0.6;
      }

      const defenderTroopLoss = defender.troops() / defender.numTilesOwned();
      const traitorMod = defender.isTraitor() ? this.traitorDefenseDebuff() : 1;
      const currentAttackerLoss =
        within(defender.troops() / attackTroops, 0.6, 2) *
        mag *
        0.8 *
        largeDefenderAttackDebuff *
        largeAttackBonus *
        traitorMod;
      const altAttackerLoss =
        1.3 * defenderTroopLoss * (mag / 100) * traitorMod;
      const attackerTroopLoss =
        0.6 * currentAttackerLoss + 0.4 * altAttackerLoss;

      return {
        attackerTroopLoss,
        defenderTroopLoss,
        tilesPerTickUsed:
          within(defender.troops() / (5 * attackTroops), 0.2, 1.5) *
          speed *
          largeDefenderSpeedDebuff *
          largeAttackerSpeedBonus *
          (defender.isTraitor() ? this.traitorSpeedDebuff() : 1),
      };
    } else {
      return {
        attackerTroopLoss:
          attacker.type() === PlayerType.Bot
            ? mag / 10
            : mag /
              (this.usesLocalTheBoxWildernessProfile(attacker, defender)
                ? LOCAL_THE_BOX_WILDERNESS.attackerTroopLossDivisor
                : 5),
        defenderTroopLoss: 0,
        tilesPerTickUsed: within(
          (2000 * Math.max(10, speed)) / attackTroops,
          5,
          100,
        ),
      };
    }
  }

  attackTilesPerTick(
    attackTroops: number,
    attacker: Player,
    defender: Player | TerraNullius,
    numAdjacentTilesWithEnemy: number,
  ): number {
    if (defender.isPlayer()) {
      return (
        within(((5 * attackTroops) / defender.troops()) * 2, 0.01, 0.5) *
        numAdjacentTilesWithEnemy *
        3
      );
    } else {
      return (
        numAdjacentTilesWithEnemy *
        (this.usesLocalTheBoxWildernessProfile(attacker, defender)
          ? LOCAL_THE_BOX_WILDERNESS.frontierTilesPerAdjacentTile
          : 2)
      );
    }
  }

  boatAttackAmount(attacker: Player, defender: Player | TerraNullius): number {
    return Math.floor(attacker.troops() / 5);
  }

  warshipShellLifetime(): number {
    return 20; // in ticks (one tick is 100ms)
  }

  radiusPortSpawn() {
    return 20;
  }

  tradeShipShortRangeDebuff(): number {
    return 300;
  }

  proximityBonusPortsNb(totalPorts: number) {
    return within(totalPorts / 3, 4, totalPorts);
  }

  attackAmount(attacker: Player, defender: Player | TerraNullius) {
    if (attacker.type() === PlayerType.Bot) {
      return attacker.troops() / 20;
    } else {
      return attacker.troops() / 5;
    }
  }

  startManpower(playerInfo: PlayerInfo): number {
    if (playerInfo.playerType === PlayerType.Bot) {
      return 10_000;
    }
    if (playerInfo.playerType === PlayerType.Nation) {
      switch (this._gameConfig.difficulty) {
        case Difficulty.Easy:
          return 12_500;
        case Difficulty.Medium:
          return 18_750;
        case Difficulty.Hard:
          return 25_000; // Like humans
        case Difficulty.Impossible:
          return 31_250;
        default:
          assertNever(this._gameConfig.difficulty);
      }
    }
    if (this.hasInfiniteTroopsForInfo(playerInfo)) return 1_000_000;
    // Account progression: a few more starting troops per level.
    return applyPerMille(
      25_000,
      progressionBonus(playerInfo.progressionLevel).troopsPerMille,
    );
  }

  /**
   * The troop cap, shown to players as population. Players and nations grow
   * people in cities, not on land: a fixed capital population plus every
   * completed City level and every completed Barracks level. Territory adds
   * nothing (it only makes room for more cities and barracks). Tribes (bots)
   * never build, so they keep the land-based cap.
   */
  maxTroops(player: Player | PlayerView): number {
    if (player.type() === PlayerType.Bot) {
      return (
        (2 * (Math.pow(player.numTilesOwned(), 0.6) * 1000 + 50000) +
          this.completedStructureLevels(player, UnitType.City) *
            this.cityTroopIncrease()) /
        3
      );
    }
    const maxTroops =
      player.type() === PlayerType.Human && this.hasInfiniteTroopsFor(player)
        ? 1_000_000_000
        : this.capitalPopulation() +
          this.completedStructureLevels(player, UnitType.City) *
            this.cityTroopIncrease() +
          this.completedStructureLevels(player, UnitType.Barracks) *
            this.barracksPopulationIncrease();

    if (player.type() === PlayerType.Human) {
      return maxTroops;
    }

    switch (this._gameConfig.difficulty) {
      case Difficulty.Easy:
        return maxTroops * 0.5;
      case Difficulty.Medium:
        return maxTroops * 0.75;
      case Difficulty.Hard:
        return maxTroops * 1; // Like humans
      case Difficulty.Impossible:
        return maxTroops * 1.25;
      default:
        assertNever(this._gameConfig.difficulty);
    }
  }

  private nationRateModifier(): number {
    switch (this._gameConfig.difficulty) {
      case Difficulty.Easy:
        return 0.9;
      case Difficulty.Medium:
        return 0.95;
      case Difficulty.Hard:
        return 1;
      case Difficulty.Impossible:
        return 1.05;
      default:
        assertNever(this._gameConfig.difficulty);
    }
  }

  /**
   * Troops trained per tick. For players and nations the pace follows the
   * population (a bigger population trains more people) and every Barracks
   * level adds a quarter on top; it slows as the army fills the population
   * (troops aboard warships count) and an army above the population, after a
   * City is lost, slowly dwindles back to it. Tribes keep their old rules.
   */
  troopIncreaseRate(player: Player | PlayerView): number {
    const max = this.maxTroops(player);
    if (player.type() === PlayerType.Bot) {
      return this.tribeTroopIncreaseRate(player, max);
    }
    const embarkedTroops = player
      .units(UnitType.Warship)
      .reduce(
        (total, warship) => total + (warship.isActive() ? warship.troops() : 0),
        0,
      );
    const troops = player.troops();
    const population = troops + embarkedTroops;
    if (!Number.isFinite(max) || max <= 0 || !Number.isFinite(population)) {
      return 0;
    }
    const modifier =
      player.type() === PlayerType.Nation ? this.nationRateModifier() : 1;
    const tempo = this.tempoRateMultiplier();

    if (population > max) {
      const overflow = Math.min(troops, population - max);
      const decay =
        (10 + Math.pow(troops, 0.73) / 4) * (overflow / max) * tempo;
      return Number.isFinite(decay) ? -Math.min(overflow, decay) : 0;
    }

    const remaining = max - population;
    if (remaining === 0) return 0;
    const base = 10 + Math.pow(max, 0.73) / 8;
    const barracks = this.barracksTroopRateMultiplier(
      this.completedStructureLevels(player, UnitType.Barracks),
    );
    const rate = Math.min(
      base * within(remaining / max, 0, 1) * barracks * modifier * tempo,
      remaining,
    );
    return Number.isFinite(rate) ? Math.max(0, rate) : 0;
  }

  /** The pre-population rules, kept for tribes (bots), which never build. */
  private tribeTroopIncreaseRate(
    player: Player | PlayerView,
    max: number,
  ): number {
    if (this.depthProgressionEnabled()) {
      const embarkedTroops = player
        .units(UnitType.Warship)
        .reduce(
          (total, warship) =>
            total + (warship.isActive() ? warship.troops() : 0),
          0,
        );
      const population = player.troops() + embarkedTroops;

      if (!Number.isFinite(max) || max <= 0 || !Number.isFinite(population)) {
        return 0;
      }

      const remaining = Math.max(0, max - population);
      if (remaining === 0) {
        return 0;
      }

      const base = 10 + Math.pow(max, 0.73) / 6;
      const headroom = within(remaining / max, 0, 1);
      const rate = Math.min(
        base * headroom * 0.2 * this.tempoRateMultiplier(),
        remaining,
      );
      return Number.isFinite(rate) ? Math.max(0, rate) : 0;
    }

    let toAdd = 10 + Math.pow(player.troops(), 0.73) / 4;
    toAdd *= 1 - player.troops() / max;
    toAdd *= 0.5;
    toAdd *= this.tempoRateMultiplier();
    return Math.min(player.troops() + toAdd, max) - player.troops();
  }

  goldAdditionRate(player: Player | PlayerView): Gold {
    const multiplier = this.goldMultiplierFor(player);
    let baseRate: bigint;
    if (player.type() === PlayerType.Bot) {
      baseRate = 50n;
    } else {
      baseRate = 100n;
    }
    return BigInt(
      Math.floor(Number(baseRate) * multiplier * this.tempoRateMultiplier()),
    );
  }

  nukeMagnitudes(unitType: UnitType): NukeMagnitude {
    switch (unitType) {
      case UnitType.MIRVWarhead:
        return { inner: 12, outer: 18 };
      case UnitType.AtomBomb:
        return { inner: 12, outer: 30 };
      case UnitType.HydrogenBomb:
        return { inner: 80, outer: 100 };
    }
    throw new Error(`Unknown nuke type: ${unitType}`);
  }

  nukeAllianceBreakThreshold(): number {
    return 100;
  }

  nukeSpeed(unitType: UnitType): number {
    switch (unitType) {
      case UnitType.AtomBomb:
      case UnitType.HydrogenBomb:
        return 10;
      case UnitType.MIRV:
        return 15;
      case UnitType.MIRVWarhead:
        return 22;
    }
    throw new Error(`Unknown nuke type: ${unitType}`);
  }

  defaultNukeTargetableRange(): number {
    return 150;
  }

  defaultSamRange(): number {
    return 70;
  }

  /**
   * Engagement radius of a SAM Launcher built as `system` at `level`: the
   * system's level-1 radius plus the shared curve's growth since level 1. A
   * missing system is the unchanged baseline curve.
   */
  airDefenseRadius(
    system: AirDefenseSystem | undefined,
    level: number,
  ): number {
    return airDefenseRadius(system, this.samRange(level), this.samRange(1));
  }

  /** Reload ticks of one interceptor slot; the baseline keeps SAMCooldown. */
  airDefenseCooldown(system: AirDefenseSystem | undefined): number {
    if (system === undefined) return this.SAMCooldown();
    return this.tempoDurationTicks(airDefenseProfile(system).reloadTicks);
  }

  /** Hull damage one interceptor deals to a jet; baseline keeps 175. */
  airDefenseJetDamage(system: AirDefenseSystem | undefined): number {
    if (system === undefined) return this.fighterSamDamage();
    return airDefenseProfile(system).jetDamage;
  }

  samRange(level: number): number {
    // rational growth function (level 1 = 70, level 5 just above hydro range, asymptotically approaches 150)
    return this.maxSamRange() - 480 / (level + 5);
  }

  maxSamRange(): number {
    return 150;
  }

  defaultSamMissileSpeed(): number {
    return 12;
  }

  // Humans can be soldiers, soldiers attacking, soldiers in boat etc.
  nukeDeathFactor(
    nukeType: NukeType,
    humans: number,
    tilesOwned: number,
    maxTroops: number,
  ): number {
    if (nukeType !== UnitType.MIRVWarhead) {
      return (5 * humans) / Math.max(1, tilesOwned);
    }
    const targetTroops = 0.03 * maxTroops;
    const excessTroops = Math.max(0, humans - targetTroops);
    const scalingFactor = 500;

    const steepness = 2;
    const normalizedExcess = excessTroops / maxTroops;
    return scalingFactor * (1 - Math.exp(-steepness * normalizedExcess));
  }

  structureMinDist(): number {
    return 15;
  }

  shellLifetime(): number {
    return 50;
  }

  warshipPatrolRange(): number {
    return 100;
  }

  warshipTargettingRange(): number {
    return 130;
  }

  warshipShellAttackRate(): number {
    return 20;
  }

  warshipDockingRange(): number {
    return 5;
  }

  warshipPortHealingBonusPerLevel(): number {
    return 5;
  }

  /** Health at or below which a warship retreats to repair, as a percent of its
   *  (veterancy-adjusted) max health, so the threshold scales with max health. */
  warshipRetreatHealthPercent(): number {
    return 75;
  }

  warshipPassiveHealing(): number {
    return 1;
  }

  warshipPassiveHealingRange(): number {
    return 150;
  }

  warshipPortSwitchThreshold(): number {
    return 0.75;
  }

  // --- Warship veterancy ---

  /** Maximum veterancy level a warship can reach. */
  warshipMaxVeterancy(): number {
    return 3;
  }

  /** Max-health boost per veterancy level, as an integer percent of base max
   *  health. Integer-only to keep src/core deterministic (no float constants). */
  warshipVeterancyHealthBonus(): number {
    return 20;
  }

  /** Shell-damage boost per veterancy level, as an integer percent of the
   *  rolled damage. Integer-only to keep src/core deterministic. */
  warshipVeterancyShellDamageBonus(): number {
    return 20;
  }

  /** Transport ships a warship must destroy to gain one veterancy level. */
  warshipVeterancyTransportKills(): number {
    return 10;
  }

  /** Trade ships a warship must capture to gain one veterancy level. */
  warshipVeterancyTradeCaptures(): number {
    return 25;
  }

  defensePostShellAttackRate(): number {
    return 100;
  }

  safeFromPiratesCooldownMax(): number {
    return 20;
  }

  defensePostTargettingRange(): number {
    return 75;
  }

  allianceExtensionPromptOffset(): number {
    return 300; // 30 seconds before expiration
  }
}
