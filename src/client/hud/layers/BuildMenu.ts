import { css, html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { translateText } from "../../../client/Utils";
import { assetUrl } from "../../../core/AssetUrls";
import { EventBus } from "../../../core/EventBus";
import {
  airDefenseCost,
  airDefenseProfile,
  airDefenseSystemsForRange,
} from "../../../core/game/AirDefenseProfiles";
import {
  aircraftProfile,
  aircraftSortieCost,
} from "../../../core/game/AircraftProfiles";
import {
  AircraftType,
  AirDefenseRange,
  AirDefenseSystem,
  AirMissionOrder,
  AirMissionType,
  AIRPORT_FIGHTER_CAPACITY,
  BuildableUnit,
  BuildMenus,
  bulkCost,
  Gold,
  LEGACY_MAX_FIGHTER_MISSION_AMOUNT,
  MAX_COMMAND_AMOUNT,
  MAX_FIGHTER_MISSION_AMOUNT,
  maxBulkAmount,
  PATROL_AIRCRAFT_TYPES,
  PatrolAircraftType,
  PlayerBuildableUnitType,
  PlayerType,
  StrikeTargetClass,
  Structures,
  UnitType,
} from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import {
  evenStrikeShares,
  normalizeStrikeClasses,
} from "../../../core/game/StrikePlan";
import { ClientEnv } from "../../ClientEnv";
import {
  type CommandQuantityRequest,
  maxFreshConstructionAmount,
  normalizedQuantityMaximum,
  RequestCommandQuantityEvent,
  RequestStructurePlacementEvent,
  type StrikeJetChoice,
  type StrikeTargetChoice,
} from "../../CommandQuantity";
import { Controller } from "../../Controller";
import {
  CloseViewEvent,
  MouseDownEvent,
  ShowBuildMenuEvent,
  ShowEmojiMenuEvent,
} from "../../InputHandler";
import { TransformHandler } from "../../TransformHandler";
import {
  BuildUnitIntentEvent,
  LaunchAirMissionIntentEvent,
  SendUpgradeStructureIntentEvent,
} from "../../Transport";
import {
  beginRocketTargetSelectionRequest,
  beginStructurePlacementRequest,
  clearRocketTargetSelectionQueueIfCurrent,
  clearStructurePlacementQueueIfCurrent,
  recordRocketTargetSelection,
  startRocketTargetSelectionQueue,
  startStructurePlacementQueue,
  UIState,
} from "../../UIState";
import { renderNumber } from "../../Utils";
import { GameView, UnitView } from "../../view";
import {
  depthFixedStructureNote,
  depthMaximumStructureNote,
  depthStructureUpgradeDetails,
} from "./lib/DepthStructureProgression";
import { unitCountDisplay } from "./lib/UnitCountDisplay";
const warshipIcon = assetUrl("images/BattleshipIconWhite.svg");
const fighterJetIcon = assetUrl("sprites/fighterJet.png");
/** Original top-down illustration per airframe (see scripts/dev/generate-airframe-art.mjs). */
function aircraftArtUrl(aircraftType: AircraftType): string {
  return assetUrl(`images/aircraft/${aircraftType}.svg`);
}
const airportIcon = assetUrl("images/AirportIconWhite.svg");
const barracksIcon = assetUrl("images/BarracksIconWhite.svg");
const cityIcon = assetUrl("images/CityIconWhite.svg");
const factoryIcon = assetUrl("images/FactoryIconWhite.svg");
const goldCoinIcon = assetUrl("images/GoldCoinIcon.svg");
const mirvIcon = assetUrl("images/MIRVIcon.svg");
const missileSiloIcon = assetUrl("images/MissileSiloIconWhite.svg");
const hydrogenBombIcon = assetUrl("images/MushroomCloudIconWhite.svg");
const atomBombIcon = assetUrl("images/NukeIconWhite.svg");
const portIcon = assetUrl("images/PortIcon.svg");
const samlauncherIcon = assetUrl("images/SamLauncherIconWhite.svg");
const shieldIcon = assetUrl("images/ShieldIconWhite.svg");

export interface BuildItemDisplay {
  unitType: PlayerBuildableUnitType;
  icon: string;
  description?: string;
  key?: string;
  countable?: boolean;
}

type FighterReadinessState =
  | "ready"
  | "insufficient_gold"
  | "spawn_immunity"
  | "sortie_cap"
  | "airport_required"
  | "airport_building"
  | "airport_full"
  | "airport_cooldown"
  | "factory_required"
  | "factory_cooldown"
  | "unavailable";

type FighterCommandRole =
  | "air_defense"
  | "tactical_strike"
  | "combat_air_patrol"
  | "air_superiority_patrol";

const FIGHTER_COMMAND_ROLES: readonly FighterCommandRole[] = [
  "air_defense",
  "tactical_strike",
  "combat_air_patrol",
];

type QuantityReturnScreen = "hidden" | "build" | "fighter";

const CONSTRUCTION_QUANTITY_PRESETS = [1, 2, 3, 5, 10] as const;
const REPEATABLE_QUANTITY_PRESETS = [1, 2, 3, 5, 10] as const;
const FIGHTER_QUANTITY_PRESETS = [1, 2, 5] as const;
const AIRPORT_FIGHTER_QUANTITY_PRESETS = [1, 2, 3, 5, 10] as const;

type AirportLaunchDraft = {
  airportId: number;
  airportTile: TileRef;
  fighterBuildable: BuildableUnit;
  aircraftType: AircraftType;
  amount: number;
  customQuantity: boolean;
  customQuantityValue: string;
  targetTile: TileRef | null;
  choosingTarget: boolean;
  targetErrorKey: string | null;
};

type AirportKeyboardTarget = {
  label: string;
  tile: TileRef;
};

type PatrolModelOrder = Extract<
  AirMissionOrder,
  { mission: AirMissionType.CombatAirPatrol }
>;

type AirDefensePickerState = {
  buildable: BuildableUnit;
  tile: TileRef;
  /** Null while the range class is still being chosen. */
  range: AirDefenseRange | null;
  /**
   * Where Back / cancel lead: the map when the picker was opened on a hidden
   * panel (radial menu, shortcuts), the build table when opened from it.
   */
  returnScreen: "hidden" | "build";
};

/** Strike drawer airframes: the same ladder as the patrol picker. */
const AIRPORT_AIRCRAFT: readonly AircraftType[] = PATROL_AIRCRAFT_TYPES;
const CUSTOM_AIRCRAFT_QUANTITY_PATTERN = /^[1-9]\d*$/;

export const buildCategoryMeta = [
  { id: "land", titleKey: "build_menu.category.land" },
  { id: "naval", titleKey: "build_menu.category.naval" },
  { id: "air", titleKey: "build_menu.category.air" },
  { id: "strategic", titleKey: "build_menu.category.strategic" },
] as const;

export const buildTable: BuildItemDisplay[][] = [
  [
    {
      unitType: UnitType.DefensePost,
      icon: shieldIcon,
      description: "build_menu.desc.defense_post",
      key: "unit_type.defense_post",
      countable: true,
    },
    {
      unitType: UnitType.City,
      icon: cityIcon,
      description: "build_menu.desc.city",
      key: "unit_type.city",
      countable: true,
    },
    {
      unitType: UnitType.Barracks,
      icon: barracksIcon,
      description: "build_menu.desc.barracks",
      key: "unit_type.barracks",
      countable: true,
    },
    {
      unitType: UnitType.Factory,
      icon: factoryIcon,
      description: "build_menu.desc.factory",
      key: "unit_type.factory",
      countable: true,
    },
  ],
  [
    {
      unitType: UnitType.Warship,
      icon: warshipIcon,
      description: "build_menu.desc.warship",
      key: "unit_type.warship",
      countable: true,
    },
    {
      unitType: UnitType.Port,
      icon: portIcon,
      description: "build_menu.desc.port",
      key: "unit_type.port",
      countable: true,
    },
  ],
  [
    {
      unitType: UnitType.Airport,
      icon: airportIcon,
      description: "build_menu.desc.airport",
      key: "unit_type.airport",
      countable: true,
    },
    {
      unitType: UnitType.FighterJet,
      icon: fighterJetIcon,
      description: "build_menu.desc.fighter_jet",
      key: "unit_type.fighter_jet",
      countable: true,
    },
    {
      unitType: UnitType.SAMLauncher,
      icon: samlauncherIcon,
      description: "build_menu.desc.sam_launcher",
      key: "unit_type.sam_launcher",
      countable: true,
    },
  ],
  [
    {
      unitType: UnitType.AtomBomb,
      icon: atomBombIcon,
      description: "build_menu.desc.atom_bomb",
      key: "unit_type.atom_bomb",
      countable: false,
    },
    {
      unitType: UnitType.MIRV,
      icon: mirvIcon,
      description: "build_menu.desc.mirv",
      key: "unit_type.mirv",
      countable: false,
    },
    {
      unitType: UnitType.HydrogenBomb,
      icon: hydrogenBombIcon,
      description: "build_menu.desc.hydrogen_bomb",
      key: "unit_type.hydrogen_bomb",
      countable: false,
    },
    {
      unitType: UnitType.MissileSilo,
      icon: missileSiloIcon,
      description: "build_menu.desc.missile_silo",
      key: "unit_type.missile_silo",
      countable: true,
    },
  ],
];

export const flattenedBuildTable = buildTable.flat();

@customElement("build-menu")
export class BuildMenu extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;
  public uiState: UIState;
  private clickedTile: TileRef;
  public playerBuildables: BuildableUnit[] | null = null;
  private filteredBuildTable: BuildItemDisplay[][] = buildTable;
  @state()
  private fighterMissionPicker = false;
  @state()
  private quantityRequest: CommandQuantityRequest | null = null;
  @state()
  private quantityValue = 1;
  @state()
  private airportLaunchDraft: AirportLaunchDraft | null = null;
  /** Air Superiority Patrol chosen; the airframe step is showing. */
  private patrolModelOrder: PatrolModelOrder | null = null;
  /** SAM Launcher chosen; the range-class / system steps are showing. */
  @state()
  private airDefensePicker: AirDefensePickerState | null = null;
  /** Strike plans currently chosen (several allowed; the tile or All alone). */
  private quantityStrikeTargets = new Set<StrikeTargetClass>([
    StrikeTargetClass.Tile,
  ]);
  /** Jet picker: unit IDs currently chosen for the strike. */
  private quantitySelectedJets = new Set<number>();
  @state()
  private airportKeyboardTargets: readonly AirportKeyboardTarget[] = [];
  @state()
  private airportKeyboardTargetsLoading = false;
  private airportKeyboardTargetRequestId = 0;
  private quantityReturnScreen: QuantityReturnScreen = "hidden";
  private buildablesRequestId = 0;
  public transformHandler: TransformHandler;

  init() {
    this.eventBus.on(ShowBuildMenuEvent, (e) => {
      if (!this.game.myPlayer()?.isAlive()) {
        return;
      }
      if (!this._hidden) {
        // Players sometimes hold control while building a unit,
        // so if the menu is already open, ignore the event.
        return;
      }
      const clickedCell = this.transformHandler.screenToWorldCoordinates(
        e.x,
        e.y,
      );
      if (!this.game.isValidCoord(clickedCell.x, clickedCell.y)) {
        return;
      }
      const tile = this.game.ref(clickedCell.x, clickedCell.y);
      this.showMenu(tile);
    });
    this.eventBus.on(CloseViewEvent, () => this.hideMenu());
    this.eventBus.on(ShowEmojiMenuEvent, () => this.hideMenu());
    this.eventBus.on(MouseDownEvent, () => {
      if (!this.isChoosingAirportTarget) this.hideMenu();
    });
    this.eventBus.on(RequestCommandQuantityEvent, (event) =>
      this.requestQuantity(event.request),
    );
  }

  tick() {
    if (!this._hidden) {
      this.refresh();
    }
  }

  static styles = css`
    :host {
      display: block;
      font-family: var(
        --font-ui,
        ui-sans-serif,
        system-ui,
        -apple-system,
        BlinkMacSystemFont,
        "Segoe UI",
        sans-serif
      );
    }
    .build-menu {
      box-sizing: border-box;
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      z-index: 9999;
      background-color: #1e1e1e;
      padding: 15px;
      box-shadow: 0 0 20px rgba(0, 0, 0, 0.5);
      border-radius: 10px;
      display: flex;
      flex-direction: column;
      align-items: center;
      max-width: 95vw;
      max-height: 95vh;
      overflow-y: auto;
    }
    .build-description {
      font-size: 12px;
      line-height: 1.3;
      text-align: center;
    }
    .build-row {
      display: flex;
      justify-content: center;
      flex-wrap: wrap;
      width: 100%;
    }
    .build-category {
      width: 100%;
      padding: 8px 0 4px;
      border-top: 1px solid #334155;
    }
    .build-category:first-of-type {
      padding-top: 0;
      border-top: 0;
    }
    .build-category-title {
      margin: 0 8px 2px;
      color: #a5f3fc;
      font-size: 12px;
      font-weight: 700;
      line-height: 1.4;
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }
    .build-button {
      position: relative;
      width: 120px;
      min-height: 154px;
      border: 2px solid #444;
      background-color: #2c2c2c;
      color: white;
      border-radius: 12px;
      cursor: pointer;
      transition: all 0.3s ease;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      margin: 8px;
      padding: 10px;
      gap: 5px;
      font-family: inherit;
    }
    .build-button:not([aria-disabled="true"]):hover {
      background-color: #3a3a3a;
      transform: scale(1.05);
      border-color: #666;
    }
    .build-button:not([aria-disabled="true"]):active {
      background-color: #4a4a4a;
      transform: scale(0.95);
    }
    .build-button[aria-disabled="true"] {
      background-color: #1a1a1a;
      border-color: #333;
      cursor: not-allowed;
      opacity: 0.7;
    }
    .build-button[aria-disabled="true"] img {
      opacity: 0.5;
    }
    .build-button[aria-disabled="true"] .build-cost {
      color: #ff4444;
    }
    .build-button:focus-visible {
      outline: 3px solid #67e8f9;
      outline-offset: 3px;
      border-color: #a5f3fc;
      box-shadow: 0 0 0 2px #0f172a;
    }
    .build-disabled-reason {
      color: #fca5a5;
      font-size: 11px;
      line-height: 1.2;
      text-align: center;
    }
    .airport-capacity {
      color: #a5f3fc;
      font-size: 11px;
      font-weight: 700;
      line-height: 1.3;
      text-align: center;
    }
    .build-icon {
      font-size: 40px;
      margin-bottom: 5px;
    }
    .build-name {
      font-size: 14px;
      font-weight: bold;
      margin-bottom: 5px;
      text-align: center;
    }
    .build-cost {
      font-size: 14px;
    }
    .depth-upgrade {
      display: flex;
      flex-direction: column;
      gap: 2px;
      color: #dbeafe;
      font-size: 11px;
      line-height: 1.2;
      text-align: center;
    }
    .depth-upgrade-effect {
      color: #a7f3d0;
    }
    .hidden {
      display: none !important;
    }
    .build-count-chip {
      position: absolute;
      top: -10px;
      right: -10px;
      background-color: #2c2c2c;
      color: white;
      padding: 2px 10px;
      border-radius: 10000px;
      transition: all 0.3s ease;
      font-size: 12px;
      display: flex;
      justify-content: center;
      align-content: center;
      border: 1px solid #444;
    }
    .build-button:not([aria-disabled="true"]):hover > .build-count-chip {
      background-color: #3a3a3a;
      border-color: #666;
    }
    .build-button:not([aria-disabled="true"]):active > .build-count-chip {
      background-color: #4a4a4a;
    }
    .build-button[aria-disabled="true"] > .build-count-chip {
      background-color: #1a1a1a;
      border-color: #333;
      cursor: not-allowed;
    }
    .fighter-mission-header {
      box-sizing: border-box;
      width: min(660px, 100%);
      min-width: 0;
      max-width: 100%;
      padding: 4px 16px 12px;
      text-align: center;
    }
    .fighter-mission-header h2 {
      margin: 0 0 6px;
      color: #f8fafc;
      font-size: 20px;
      letter-spacing: 0.04em;
    }
    .fighter-mission-header p {
      margin: 0;
      color: #cbd5e1;
      font-size: 13px;
      line-height: 1.45;
    }
    .fighter-status {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 6px 12px;
      margin-top: 10px;
      padding: 8px 10px;
      border: 1px solid #334155;
      border-radius: 8px;
      background: #0f172a;
      color: #cbd5e1;
      font-size: 12px;
      line-height: 1.35;
    }
    .fighter-status strong {
      color: #67e8f9;
    }
    .fighter-mission-grid {
      box-sizing: border-box;
      display: grid;
      grid-template-columns: repeat(2, minmax(190px, 1fr));
      gap: 10px;
      width: min(660px, 100%);
      min-width: 0;
      max-width: 100%;
    }
    .fighter-mission-grid[data-role-count="3"] {
      grid-template-columns: repeat(3, minmax(180px, 1fr));
    }
    .fighter-mission-button {
      box-sizing: border-box;
      min-width: 0;
      min-height: 112px;
      padding: 14px;
      border: 1px solid #475569;
      border-radius: 10px;
      background: linear-gradient(145deg, #172033, #111827);
      color: #f8fafc;
      cursor: pointer;
      font-family: inherit;
      text-align: left;
      transition:
        border-color 120ms ease,
        background-color 120ms ease,
        transform 120ms ease;
    }
    .fighter-mission-button:hover:not([aria-disabled="true"]) {
      border-color: #67e8f9;
      transform: translateY(-1px);
    }
    .fighter-mission-button:focus-visible,
    .fighter-mission-back:focus-visible {
      outline: 3px solid #67e8f9;
      outline-offset: 3px;
    }
    .fighter-mission-button[aria-disabled="true"] {
      cursor: not-allowed;
      opacity: 0.58;
    }
    .fighter-mission-name {
      display: block;
      margin-bottom: 6px;
      color: #fbbf24;
      font-size: 15px;
      font-weight: 700;
    }
    .fighter-mission-description {
      display: block;
      color: #cbd5e1;
      font-size: 12px;
      line-height: 1.4;
    }
    .fighter-mission-disabled-reason {
      display: block;
      margin-top: 8px;
      color: #fca5a5;
      font-size: 11px;
      font-weight: 700;
      line-height: 1.35;
    }
    .fighter-mission-back {
      margin-top: 12px;
      padding: 8px 18px;
      border: 1px solid #475569;
      border-radius: 8px;
      background: #1e293b;
      color: #e2e8f0;
      cursor: pointer;
      font-family: inherit;
    }
    .build-count {
      font-weight: bold;
      font-size: 14px;
    }
    .build-menu.airport-launch-shell {
      top: 50%;
      right: clamp(14px, 2vw, 28px);
      left: auto;
      width: min(408px, calc(100vw - 28px));
      max-width: none;
      max-height: calc(100vh - 28px);
      padding: 0;
      transform: translateY(-50%);
      overflow: hidden auto;
      align-items: stretch;
      border: 1px solid #31485d;
      border-radius: 14px;
      background:
        linear-gradient(180deg, rgba(24, 39, 53, 0.98), rgba(9, 18, 27, 0.99)),
        #0b141d;
      box-shadow:
        0 24px 60px rgba(0, 0, 0, 0.58),
        0 0 0 1px rgba(111, 211, 231, 0.06) inset;
      color: #f2f6f8;
    }
    .airport-launch {
      box-sizing: border-box;
      width: 100%;
      padding: 18px;
    }
    .airport-launch button,
    .airport-launch input {
      font: inherit;
    }
    .airport-launch-header {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 4px 12px;
      align-items: start;
      padding-bottom: 14px;
      border-bottom: 1px solid #26394a;
    }
    .airport-launch-overline {
      margin: 0;
      color: #6fd3e7;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.16em;
      text-transform: uppercase;
    }
    .airport-launch-header h2 {
      margin: 2px 0 0;
      color: #f7fafb;
      font-size: 24px;
      font-weight: 780;
      letter-spacing: -0.025em;
      line-height: 1.1;
    }
    .airport-launch-close {
      grid-column: 2;
      grid-row: 1 / span 2;
      width: 36px;
      height: 36px;
      padding: 0;
      border: 1px solid #3a5267;
      border-radius: 8px;
      background: #142432;
      color: #b8c6cf;
      cursor: pointer;
      font-size: 20px;
      line-height: 1;
    }
    .airport-readiness {
      grid-column: 1 / -1;
      display: flex;
      align-items: center;
      gap: 7px;
      margin-top: 9px;
      color: #b8c6cf;
      font-size: 12px;
    }
    .airport-readiness::before {
      content: "";
      width: 7px;
      height: 7px;
      flex: 0 0 7px;
      border-radius: 50%;
      background: #ec9f45;
      box-shadow: 0 0 0 3px rgba(236, 159, 69, 0.12);
    }
    .airport-readiness[data-state="ready"]::before {
      background: #55d6a7;
      box-shadow: 0 0 0 3px rgba(85, 214, 167, 0.12);
    }
    .airport-launch-section {
      margin-top: 16px;
    }
    .airport-section-label {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: baseline;
      margin: 0 0 8px;
      color: #dbe5ea;
      font-size: 12px;
      font-weight: 750;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .airport-section-heading {
      display: inline-flex;
      align-items: center;
      gap: 7px;
    }
    .airport-step-badge {
      display: inline-grid;
      width: 19px;
      height: 19px;
      place-items: center;
      border-radius: 3px;
      background: #1598c0;
      color: #061018;
      font-size: 11px;
      font-weight: 900;
    }
    .airport-section-label small {
      color: #738a9c;
      font-size: 11px;
      font-weight: 650;
      letter-spacing: 0;
      text-transform: none;
    }
    .airport-aircraft-grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 6px;
    }
    .airport-aircraft-card {
      display: grid;
      grid-template-columns: 15px 112px minmax(0, 1fr);
      grid-template-rows: auto auto;
      gap: 2px 9px;
      align-items: center;
      min-width: 0;
      min-height: 70px;
      padding: 7px 10px;
      border: 1px solid #31485d;
      border-radius: 10px;
      background: #111f2b;
      color: #dbe5ea;
      cursor: pointer;
      text-align: left;
      transition:
        border-color 140ms ease,
        background-color 140ms ease,
        transform 140ms ease;
    }
    .airport-aircraft-card::before {
      content: "";
      grid-column: 1;
      grid-row: 1 / span 2;
      width: 10px;
      height: 10px;
      border: 1px solid #71899a;
      border-radius: 50%;
      box-shadow: 0 0 0 2px #111f2b inset;
    }
    .airport-aircraft-card:hover:not(:disabled) {
      border-color: #63839b;
      transform: translateY(-1px);
    }
    .airport-aircraft-card[aria-pressed="true"] {
      border-color: #6fd3e7;
      background: #123344;
      box-shadow: 0 0 0 1px rgba(111, 211, 231, 0.18) inset;
    }
    .airport-aircraft-card[aria-pressed="true"]::before {
      border-color: #71e5f5;
      background: #28bde6;
      box-shadow: 0 0 0 2px #123344 inset;
    }
    .aircraft-image {
      grid-column: 2;
      grid-row: 1 / span 2;
      display: block;
      width: 100%;
      height: 52px;
      overflow: hidden;
      border-radius: 6px;
      background: radial-gradient(ellipse at 50% 40%, #1d3548 0%, #0d1a25 100%);
    }
    .aircraft-image img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: contain;
      object-position: center;
    }
    .airport-aircraft-name {
      grid-column: 3;
      grid-row: 1;
      align-self: end;
      display: block;
      color: #f4f7f8;
      font-size: 13px;
      font-weight: 800;
      line-height: 1.15;
    }
    .airport-aircraft-role {
      grid-column: 3;
      grid-row: 2;
      align-self: start;
      display: block;
      margin-top: 1px;
      color: #8fa2af;
      font-size: 11px;
      line-height: 1.25;
    }
    .airport-quantity-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
    }
    .airport-quantity-button {
      min-height: 42px;
      border: 1px solid #3a5267;
      border-radius: 8px;
      background: #142432;
      color: #e6edf0;
      cursor: pointer;
      font-weight: 800;
    }
    .airport-quantity-button[aria-pressed="true"] {
      border-color: #6fd3e7;
      background: #17485d;
      color: #f6fcfd;
    }
    .airport-aircraft-card:disabled,
    .airport-quantity-button:disabled,
    .airport-target-button:disabled,
    .airport-launch-button:disabled {
      cursor: not-allowed;
      opacity: 0.42;
    }
    .airport-custom-quantity {
      box-sizing: border-box;
      width: 100%;
      height: 43px;
      margin-top: 8px;
      padding: 0 12px;
      border: 1px solid #6fd3e7;
      border-radius: 8px;
      background: #09131c;
      color: #f4f7f8;
      font-size: 16px;
      font-weight: 800;
      text-align: center;
    }
    .airport-capacity-line {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      margin-top: 8px;
      color: #8297a5;
      font-size: 11px;
    }
    .airport-capacity-line strong {
      color: #b9c9d2;
      font-weight: 700;
    }
    .airport-target-button {
      box-sizing: border-box;
      display: grid;
      grid-template-columns: auto 1fr auto;
      gap: 10px;
      align-items: center;
      width: 100%;
      min-height: 52px;
      padding: 9px 11px;
      border: 1px solid #3a5267;
      border-radius: 9px;
      background: #0e1b26;
      color: #e9f0f3;
      cursor: crosshair;
      text-align: left;
    }
    .airport-target-button[data-targeting="true"] {
      border-color: #ec9f45;
      background: #322719;
    }
    .airport-target-reticle {
      width: 24px;
      color: #ec9f45;
      font-size: 21px;
      text-align: center;
    }
    .airport-target-copy strong,
    .airport-target-copy span {
      display: block;
    }
    .airport-target-copy strong {
      font-size: 12px;
    }
    .airport-target-copy span {
      margin-top: 3px;
      color: #8fa2af;
      font-size: 11px;
    }
    .airport-target-change {
      color: #6fd3e7;
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
    }
    .airport-target-error {
      margin: 7px 0 0;
      color: #f3a6a6;
      font-size: 11px;
      line-height: 1.35;
    }
    .airport-keyboard-targets {
      margin-top: 8px;
      padding: 9px;
      border: 1px solid #31485d;
      border-radius: 9px;
      background: #09131c;
    }
    .airport-keyboard-targets p {
      margin: 0 0 7px;
      color: #9fb0ba;
      font-size: 11px;
      line-height: 1.35;
    }
    .airport-keyboard-target-list {
      display: grid;
      gap: 6px;
    }
    .airport-keyboard-target {
      min-height: 40px;
      padding: 7px 9px;
      border: 1px solid #3a5267;
      border-radius: 7px;
      background: #142432;
      color: #e9f0f3;
      cursor: pointer;
      text-align: left;
    }
    .airport-keyboard-target:hover,
    .airport-keyboard-target:focus-visible {
      border-color: #6fd3e7;
      outline: none;
    }
    .airport-launch-actions {
      display: grid;
      grid-template-columns: 0.72fr 1.28fr;
      gap: 9px;
      margin-top: 18px;
    }
    .airport-cancel-button,
    .airport-launch-button {
      min-height: 46px;
      border-radius: 9px;
      cursor: pointer;
      font-weight: 800;
    }
    .airport-cancel-button {
      border: 1px solid #3a5267;
      background: #142432;
      color: #c4d0d7;
    }
    .airport-launch-button {
      border: 1px solid #f0ae59;
      background: linear-gradient(180deg, #eaa14a, #c97a29);
      color: #171008;
      box-shadow: 0 7px 18px rgba(206, 125, 41, 0.2);
    }
    .airport-launch-button:not(:disabled):hover {
      filter: brightness(1.08);
    }
    .airport-launch :is(button, input):focus-visible {
      outline: 3px solid #8be6f4;
      outline-offset: 2px;
    }
    .quantity-dialog {
      box-sizing: border-box;
      width: min(430px, 100%);
      min-width: 0;
      max-width: 100%;
      color: #f8fafc;
    }
    .quantity-dialog:focus {
      outline: none;
    }
    .quantity-header {
      margin-bottom: 14px;
      text-align: center;
    }
    .quantity-header h2 {
      margin: 0 0 5px;
      color: #f8fafc;
      font-size: 20px;
    }
    .quantity-header p {
      margin: 0;
      color: #cbd5e1;
      font-size: 13px;
      line-height: 1.4;
    }
    .quantity-header .quantity-placement-note {
      margin-top: 5px;
      color: #a5f3fc;
      font-weight: 700;
    }
    .quantity-limit {
      margin-top: 9px;
      padding: 8px 10px;
      border: 1px solid #334155;
      border-radius: 8px;
      background: #0f172a;
      color: #a5f3fc;
      font-size: 12px;
      font-weight: 700;
    }
    .quantity-controls {
      box-sizing: border-box;
      display: grid;
      grid-template-columns: 44px minmax(0, 1fr) 44px;
      gap: 8px;
      align-items: stretch;
      width: 100%;
      min-width: 0;
    }
    .quantity-step,
    .quantity-preset,
    .quantity-action {
      min-height: 44px;
      border: 1px solid #475569;
      border-radius: 8px;
      color: #f8fafc;
      cursor: pointer;
      font-family: inherit;
      font-weight: 700;
    }
    .quantity-step {
      background: #1e293b;
      font-size: 20px;
    }
    .quantity-input {
      box-sizing: border-box;
      width: 100%;
      min-width: 0;
      border: 1px solid #64748b;
      border-radius: 8px;
      background: #0f172a;
      color: #f8fafc;
      font-family: inherit;
      font-size: 20px;
      font-weight: 800;
      text-align: center;
    }
    .quantity-input:focus-visible,
    .quantity-step:focus-visible,
    .quantity-preset:focus-visible,
    .quantity-action:focus-visible {
      outline: 3px solid #67e8f9;
      outline-offset: 2px;
    }
    .strike-target-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 6px;
      margin-top: 10px;
    }
    .strike-target {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      min-width: 0;
      padding: 7px 9px;
      font-size: 12px;
      text-align: left;
    }
    .strike-target > span:first-child {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .strike-target-count {
      flex: none;
      min-width: 20px;
      padding: 1px 6px;
      border-radius: 999px;
      background: rgba(103, 232, 249, 0.16);
      color: #a5f3fc;
      font-size: 11px;
      font-weight: 700;
      text-align: center;
    }
    .strike-target:disabled .strike-target-count {
      background: rgba(148, 163, 184, 0.16);
      color: #94a3b8;
    }
    .strike-jet-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-top: 10px;
      color: #cbd5e1;
      font-size: 12px;
    }
    .strike-jet-toolbar > div {
      display: flex;
      gap: 6px;
    }
    .strike-jet-toolbar .quantity-preset {
      padding: 5px 10px;
      font-size: 12px;
    }
    .strike-jet-list {
      display: grid;
      gap: 6px;
      max-height: 232px;
      margin-top: 8px;
      padding-right: 2px;
      overflow-y: auto;
    }
    .strike-jet {
      display: grid;
      grid-template-columns: 18px minmax(0, 1fr);
      gap: 2px 10px;
      align-items: center;
      padding: 7px 10px;
      text-align: left;
    }
    .strike-jet-check {
      grid-row: 1 / span 2;
      width: 16px;
      height: 16px;
      border: 1px solid #64748b;
      border-radius: 4px;
      color: transparent;
      font-size: 11px;
      line-height: 14px;
      text-align: center;
    }
    .strike-jet[aria-pressed="true"] .strike-jet-check {
      border-color: #22d3ee;
      background: #22d3ee;
      color: #082f49;
    }
    .strike-jet-name {
      color: #f1f5f9;
      font-size: 12.5px;
      font-weight: 700;
    }
    .strike-jet-meta {
      color: #94a3b8;
      font-size: 11px;
    }
    .air-defense-grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 6px;
      margin-top: 4px;
    }
    .air-defense-card {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 2px 10px;
      align-items: center;
      min-width: 0;
      padding: 8px 10px;
      border: 1px solid #31485d;
      border-radius: 10px;
      background: #111f2b;
      color: #dbe5ea;
      cursor: pointer;
      text-align: left;
      transition:
        border-color 140ms ease,
        background-color 140ms ease;
    }
    .air-defense-card:hover:not([aria-disabled="true"]) {
      border-color: #63839b;
      background: #14283a;
    }
    .air-defense-card[aria-disabled="true"] {
      cursor: not-allowed;
      opacity: 0.55;
    }
    .air-defense-name {
      color: #f4f7f8;
      font-size: 13px;
      font-weight: 800;
      line-height: 1.15;
    }
    .air-defense-origin {
      color: #8ea3b3;
      font-size: 11px;
      font-weight: 650;
      white-space: nowrap;
    }
    .air-defense-role,
    .air-defense-stats,
    .air-defense-price {
      grid-column: 1 / span 2;
      display: block;
      font-size: 11.5px;
      line-height: 1.3;
    }
    .air-defense-role {
      color: #c6d3db;
    }
    .air-defense-stats {
      color: #8ea3b3;
    }
    .air-defense-price {
      color: #ffd66b;
      font-weight: 750;
    }
    .air-defense-badge {
      display: inline-block;
      margin-left: 6px;
      padding: 0 6px;
      border-radius: 999px;
      background: #123344;
      color: #6fd3e7;
      font-size: 11px;
      font-weight: 750;
      vertical-align: middle;
    }
    .patrol-aircraft-grid {
      margin-top: 4px;
    }
    .patrol-aircraft-grid .airport-aircraft-card {
      grid-template-columns: 112px minmax(0, 1fr);
    }
    .patrol-aircraft-grid .airport-aircraft-card::before {
      display: none;
    }
    .patrol-aircraft-grid .aircraft-image {
      grid-column: 1;
    }
    .patrol-aircraft-grid .airport-aircraft-name,
    .patrol-aircraft-grid .airport-aircraft-role {
      grid-column: 2;
    }
    .airport-aircraft-card[aria-disabled="true"] {
      cursor: not-allowed;
      opacity: 0.55;
    }
    .aircraft-stats {
      display: block;
      margin-top: 3px;
      color: #b7c6d0;
      font-size: 10.5px;
      letter-spacing: 0.02em;
    }
    .quantity-presets {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 7px;
      margin-top: 10px;
    }
    .quantity-preset {
      background: #172033;
      font-size: 13px;
    }
    .quantity-preset[aria-pressed="true"] {
      border-color: #67e8f9;
      background: #164e63;
    }
    .quantity-step:disabled,
    .quantity-preset:disabled,
    .quantity-action:disabled {
      cursor: not-allowed;
      opacity: 0.42;
    }
    .quantity-disabled-reason {
      min-height: 34px;
      margin: 8px 0 0;
      color: #fca5a5;
      font-size: 11px;
      line-height: 1.35;
      text-align: center;
    }
    .quantity-summary {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 8px;
      margin-top: 12px;
      padding: 10px 12px;
      border: 1px solid #334155;
      border-radius: 8px;
      background: #111827;
      color: #cbd5e1;
      font-size: 12px;
    }
    .quantity-summary strong {
      color: #fbbf24;
    }
    .quantity-actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 9px;
      margin-top: 14px;
    }
    .quantity-action.cancel {
      background: #1e293b;
    }
    .quantity-action.confirm {
      border-color: #0891b2;
      background: #0e7490;
    }
    .quantity-action:hover {
      filter: brightness(1.12);
    }

    @media (max-width: 768px) {
      .build-menu {
        padding: 10px;
        max-height: 80vh;
        width: 80vw;
      }
      .build-button {
        width: 140px;
        min-height: 140px;
        margin: 4px;
        padding: 6px;
        gap: 5px;
      }
      .build-icon {
        font-size: 28px;
      }
      .build-name {
        font-size: 12px;
        margin-bottom: 3px;
      }
      .build-cost {
        font-size: 11px;
      }
      .build-count {
        font-weight: bold;
        font-size: 11px;
      }
      .build-count-chip {
        padding: 1px 5px;
      }
      .fighter-mission-grid[data-role-count="3"] {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .build-menu.airport-launch-shell {
        top: auto;
        right: 0;
        bottom: 0;
        left: 0;
        width: 100vw;
        max-height: min(78vh, 690px);
        padding: 0;
        transform: none;
        border-right: 0;
        border-bottom: 0;
        border-left: 0;
        border-radius: 16px 16px 0 0;
      }
      .airport-launch {
        padding: 15px 15px calc(15px + env(safe-area-inset-bottom));
      }
    }

    @media (max-width: 480px) {
      .build-menu {
        padding: 8px;
        max-height: 70vh;
      }
      .build-menu.airport-launch-shell {
        width: 100vw;
        max-height: 82vh;
        padding: 0;
      }
      .airport-launch-header h2 {
        font-size: 21px;
      }
      .airport-aircraft-card {
        grid-template-columns: 14px 96px minmax(0, 1fr);
        min-height: 64px;
        padding: 6px 8px;
      }
      .aircraft-image {
        height: 45px;
      }
      .airport-launch-section {
        margin-top: 13px;
      }
      .build-button {
        width: calc(50% - 6px);
        min-height: 140px;
        margin: 3px;
        padding: 4px;
        border-width: 1px;
      }
      .build-icon {
        font-size: 24px;
      }
      .build-name {
        font-size: 12px;
        margin-bottom: 2px;
      }
      .build-cost {
        font-size: 11px;
      }
      .build-count {
        font-weight: bold;
        font-size: 11px;
      }
      .build-count-chip {
        padding: 0 3px;
      }
      .build-button img {
        width: 24px;
        height: 24px;
      }
      .build-cost img {
        width: 10px;
        height: 10px;
      }
      .fighter-mission-grid,
      .fighter-mission-grid[data-role-count="3"] {
        grid-template-columns: 1fr;
      }
      .quantity-presets {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .airport-aircraft-card {
        transition: none;
      }
      .airport-aircraft-card:hover:not(:disabled) {
        transform: none;
      }
    }
  `;

  @state()
  private _hidden = true;

  public canBuildOrUpgrade(item: BuildItemDisplay): boolean {
    if (this.game?.myPlayer() === null || this.playerBuildables === null) {
      return false;
    }
    const unit = this.playerBuildables.find((u) => u.type === item.unitType);
    return unit ? unit.canBuild !== false || unit.canUpgrade !== false : false;
  }

  public cost(item: BuildItemDisplay): Gold {
    for (const bu of this.playerBuildables ?? []) {
      if (bu.type === item.unitType) {
        return bu.cost;
      }
    }
    return 0n;
  }

  public count(item: BuildItemDisplay): string {
    return this.countDisplay(item).text;
  }

  private countDisplay(item: BuildItemDisplay) {
    const player = this.game?.myPlayer();
    if (!player) {
      return { text: "?" };
    }
    return unitCountDisplay(player, item.unitType, this.game.config());
  }

  public sendBuildOrUpgrade(
    buildableUnit: BuildableUnit,
    tile: TileRef,
    airDefenseSystem?: AirDefenseSystem,
  ): void {
    if (buildableUnit.canUpgrade !== false) {
      const playerGold = this.game.myPlayer()?.gold() ?? 0n;
      this.requestQuantity({
        kind: "upgrade",
        itemName: this.buildableName(buildableUnit.type),
        max: maxBulkAmount(buildableUnit, playerGold),
        totalCost: (amount) => bulkCost(buildableUnit, amount),
        onConfirm: (amount) =>
          this.eventBus.emit(
            new SendUpgradeStructureIntentEvent(
              buildableUnit.canUpgrade as number,
              buildableUnit.type,
              amount,
            ),
          ),
      });
    } else if (buildableUnit.canBuild !== false) {
      if (buildableUnit.type === UnitType.FighterJet) {
        this.fighterMissionPicker = true;
        this.requestUpdate();
        return;
      }
      // The Airport profile asks for the range class and the system before a
      // SAM Launcher is placed; the choice then rides on the placement queue.
      if (
        buildableUnit.type === UnitType.SAMLauncher &&
        airDefenseSystem === undefined &&
        this.airportOperationsEnabled()
      ) {
        this.openAirDefensePicker(buildableUnit, tile);
        return;
      }
      const rocketDirectionUp =
        buildableUnit.type === UnitType.AtomBomb ||
        buildableUnit.type === UnitType.HydrogenBomb
          ? this.uiState.rocketDirectionUp
          : undefined;

      const isTubeLaunched =
        buildableUnit.type === UnitType.AtomBomb ||
        buildableUnit.type === UnitType.HydrogenBomb;
      const player = this.game.myPlayer();
      const affordable = maxBulkAmount(buildableUnit, player?.gold() ?? 0n);
      const isStructure = Structures.has(buildableUnit.type);
      const isSiloLaunched =
        isTubeLaunched || buildableUnit.type === UnitType.MIRV;
      // Ordinary structures are queued as separate, authoritative amount-one
      // placements. Every repeatable command is bounded only by gold, physical
      // readiness (ready silos) and the universal per-command ceiling.
      const max = Math.min(
        MAX_COMMAND_AMOUNT,
        isSiloLaunched
          ? Math.min(affordable, player?.readyMissileCount() ?? 0)
          : isStructure
            ? maxFreshConstructionAmount(
                buildableUnit,
                player?.gold() ?? 0n,
                MAX_COMMAND_AMOUNT,
              )
            : affordable,
      );
      const placementUIState = this.uiState;
      const chooserRevision = isStructure
        ? beginStructurePlacementRequest(placementUIState)
        : isSiloLaunched
          ? beginRocketTargetSelectionRequest(placementUIState)
          : undefined;
      this.requestQuantity({
        kind: isStructure ? "construction" : "launch",
        itemName:
          airDefenseSystem === undefined
            ? this.buildableName(buildableUnit.type)
            : translateText(
                `build_menu.air_defense.system.${airDefenseSystem}.name`,
              ),
        max,
        separatePlacement: isStructure,
        separateTargets: isSiloLaunched,
        totalCost: isStructure
          ? undefined
          : (amount) => bulkCost(buildableUnit, amount),
        onCancel:
          chooserRevision === undefined
            ? undefined
            : () => {
                if (isStructure) {
                  clearStructurePlacementQueueIfCurrent(
                    placementUIState,
                    chooserRevision,
                  );
                } else {
                  clearRocketTargetSelectionQueueIfCurrent(
                    placementUIState,
                    chooserRevision,
                  );
                }
              },
        onConfirm: (amount) => {
          if (isStructure) {
            if (this.uiState !== placementUIState) {
              clearStructurePlacementQueueIfCurrent(
                placementUIState,
                chooserRevision as number,
              );
              return;
            }
            const generation = startStructurePlacementQueue(
              placementUIState,
              buildableUnit.type,
              amount,
              chooserRevision as number,
              airDefenseSystem,
            );
            if (generation === false) return;
            // A direct menu click may have resolved to a nearby tile. Arm the
            // queue, but require a visible ghost click before placing there.
            if (buildableUnit.canBuild === tile) {
              this.eventBus.emit(
                new RequestStructurePlacementEvent(
                  buildableUnit.type,
                  tile,
                  generation,
                ),
              );
            }
            return;
          }
          if (isSiloLaunched && amount > 1) {
            const generation = startRocketTargetSelectionQueue(
              placementUIState,
              buildableUnit.type,
              amount,
              rocketDirectionUp ?? true,
              chooserRevision as number,
            );
            if (generation === false) return;
            recordRocketTargetSelection(
              placementUIState,
              generation,
              buildableUnit.type,
              tile,
            );
            return;
          }
          this.eventBus.emit(
            new BuildUnitIntentEvent(
              buildableUnit.type,
              tile,
              rocketDirectionUp,
              amount,
            ),
          );
        },
      });
    }
  }

  /**
   * Opens the shared command quantity surface. Controllers which cannot call
   * BuildMenu directly may emit RequestCommandQuantityEvent with the same
   * request. No intent is emitted until the native confirm button is used.
   */
  public requestQuantity(request: CommandQuantityRequest): void {
    const previousRequest = this.quantityRequest;
    if (previousRequest === null) {
      this.quantityReturnScreen = this._hidden
        ? "hidden"
        : this.fighterMissionPicker
          ? "fighter"
          : "build";
    }
    const max = normalizedQuantityMaximum(request.max);
    this.quantityRequest = { ...request, max };
    this.quantityStrikeTargets = new Set([StrikeTargetClass.Tile]);
    if (request.jets !== undefined) {
      // A jet picker starts with every eligible jet chosen.
      this.quantitySelectedJets = new Set(request.jets.map((jet) => jet.id));
      this.quantityValue = Math.min(max, this.quantitySelectedJets.size);
    } else {
      this.quantitySelectedJets = new Set();
      const initial = Number.isFinite(request.initial) ? request.initial! : 1;
      this.quantityValue =
        max > 0 ? Math.min(max, Math.max(1, Math.floor(initial))) : 0;
    }
    this._hidden = false;
    previousRequest?.onCancel?.();
    this.requestUpdate();
    void this.updateComplete.then(() => {
      const input = this.shadowRoot?.querySelector<HTMLElement>(
        request.jets === undefined ? ".quantity-input" : "[data-strike-jet]",
      );
      input?.focus();
      if (input instanceof HTMLInputElement) input.select();
    });
  }

  private selectedStrikeJetIds(): number[] {
    const jets = this.quantityRequest?.jets;
    if (jets === undefined) return [];
    return jets
      .filter((jet) => this.quantitySelectedJets.has(jet.id))
      .map((jet) => jet.id);
  }

  private toggleStrikeJet(id: number): void {
    const jets = this.quantityRequest?.jets;
    if (jets === undefined || !jets.some((jet) => jet.id === id)) return;
    if (this.quantitySelectedJets.has(id)) {
      this.quantitySelectedJets.delete(id);
    } else {
      this.quantitySelectedJets.add(id);
    }
    this.quantityValue = this.selectedStrikeJetIds().length;
    this.requestUpdate();
  }

  private selectStrikeJets(all: boolean): void {
    const jets = this.quantityRequest?.jets;
    if (jets === undefined) return;
    this.quantitySelectedJets = all
      ? new Set(jets.map((jet) => jet.id))
      : new Set();
    this.quantityValue = this.quantitySelectedJets.size;
    this.requestUpdate();
  }

  private buildableName(type: PlayerBuildableUnitType): string {
    const item = flattenedBuildTable.find(
      (candidate) => candidate.unitType === type,
    );
    return item?.key ? translateText(item.key) : type;
  }

  private setQuantity(value: number): void {
    const max = this.quantityRequest?.max ?? 0;
    this.quantityValue =
      max < 1 || !Number.isFinite(value)
        ? 0
        : Math.min(max, Math.max(1, Math.floor(value)));
  }

  /**
   * Plan chips toggle. Structure classes combine freely; "This tile" and
   * "All structures" each stand alone (All already covers every class), and
   * clearing the last class falls back to the tile.
   */
  private toggleStrikeTarget(strikeTarget: StrikeTargetClass): void {
    const choice = this.quantityRequest?.strikeTargets?.find(
      (candidate) => candidate.id === strikeTarget,
    );
    if (
      choice === undefined ||
      (choice.id !== StrikeTargetClass.Tile && choice.count < 1)
    ) {
      return;
    }
    const chosen = this.quantityStrikeTargets;
    let next: Set<StrikeTargetClass>;
    if (
      strikeTarget === StrikeTargetClass.Tile ||
      strikeTarget === StrikeTargetClass.AllStructures
    ) {
      next = chosen.has(strikeTarget)
        ? new Set([StrikeTargetClass.Tile])
        : new Set([strikeTarget]);
    } else {
      next = new Set(
        [...chosen].filter(
          (id) =>
            id !== StrikeTargetClass.Tile &&
            id !== StrikeTargetClass.AllStructures,
        ),
      );
      if (next.has(strikeTarget)) {
        next.delete(strikeTarget);
      } else {
        next.add(strikeTarget);
      }
      if (next.size === 0) next.add(StrikeTargetClass.Tile);
    }
    this.quantityStrikeTargets = next;
    this.requestUpdate();
  }

  /** The chosen plans in the canonical order the simulation uses. */
  private chosenStrikeTargets(): StrikeTargetClass[] {
    return normalizeStrikeClasses([...this.quantityStrikeTargets]);
  }

  private cancelQuantity(): void {
    const request = this.quantityRequest;
    const returnScreen = this.quantityReturnScreen;
    this.quantityRequest = null;
    this.quantityValue = 1;
    this.quantityReturnScreen = "hidden";
    this.fighterMissionPicker = returnScreen === "fighter";
    this._hidden = returnScreen === "hidden";
    request?.onCancel?.();
    this.requestUpdate();
  }

  private confirmQuantity(): void {
    const request = this.quantityRequest;
    if (
      request === null ||
      request.max < 1 ||
      this.quantityValue < 1 ||
      this.quantityValue > request.max
    ) {
      return;
    }
    const fighterIds =
      request.jets === undefined ? undefined : this.selectedStrikeJetIds();
    const amount =
      fighterIds === undefined ? this.quantityValue : fighterIds.length;
    if (amount < 1) return;
    const strikeTargets = this.chosenStrikeTargets();
    this.quantityRequest = null;
    this.quantityValue = 1;
    this.quantitySelectedJets = new Set();
    this.quantityReturnScreen = "hidden";
    this._hidden = true;
    this.fighterMissionPicker = false;
    this.patrolModelOrder = null;
    this.airDefensePicker = null;
    this.requestUpdate();
    // Only strike requests learn the chosen plan and jets; every other
    // caller keeps its one-argument contract.
    if (fighterIds !== undefined) {
      request.onConfirm(amount, strikeTargets, fighterIds);
    } else if (request.strikeTargets === undefined) {
      request.onConfirm(amount);
    } else {
      request.onConfirm(amount, strikeTargets);
    }
  }

  /**
   * Under the title: the tile note, the one-plan note, or for several plans
   * the equal split of the chosen jets ("Air defense 23 · Missile silos 23").
   */
  private strikePlanNote(
    strikeTargets: readonly StrikeTargetChoice[] | undefined,
    chosen: readonly StrikeTargetClass[],
    jets: number,
  ): string {
    const live = chosen
      .map((id) => strikeTargets?.find((choice) => choice.id === id))
      .filter(
        (choice): choice is StrikeTargetChoice =>
          choice !== undefined &&
          choice.id !== StrikeTargetClass.Tile &&
          choice.count > 0,
      );
    if (live.length === 0) {
      return translateText("build_menu.quantity.shared_fighter_target");
    }
    if (live.length === 1) {
      return translateText("build_menu.quantity.strike_plan_note", {
        count: live[0].count,
        target: translateText(
          `build_menu.quantity.strike_target.${live[0].id}`,
        ),
      });
    }
    const shares = evenStrikeShares(jets, live.length);
    return translateText("build_menu.quantity.strike_plan_split", {
      split: live
        .map(
          (choice, index) =>
            `${translateText(`build_menu.quantity.strike_target.${choice.id}`)} ${shares[index]}`,
        )
        .join(" · "),
    });
  }

  private strikeJetName(jet: StrikeJetChoice): string {
    return translateText("build_menu.quantity.jet_name", {
      airframe: translateText(
        `build_menu.airport_launch.aircraft.${jet.aircraftType ?? AircraftType.F16}.name`,
      ),
      id: jet.id,
    });
  }

  private renderStrikeJetPicker(jets: readonly StrikeJetChoice[]) {
    const selected = this.quantityValue;
    return html`
      <div class="strike-jet-toolbar">
        <span aria-live="polite" data-strike-jets-selected=${selected}>
          ${translateText("build_menu.quantity.jets_selected", {
            selected,
            total: jets.length,
          })}
        </span>
        <div>
          <button
            type="button"
            class="quantity-preset"
            data-strike-jets="all"
            @click=${() => this.selectStrikeJets(true)}
          >
            ${translateText("build_menu.quantity.jets_all")}
          </button>
          <button
            type="button"
            class="quantity-preset"
            data-strike-jets="none"
            @click=${() => this.selectStrikeJets(false)}
          >
            ${translateText("build_menu.quantity.jets_none")}
          </button>
        </div>
      </div>
      <div
        class="strike-jet-list"
        role="group"
        aria-label=${translateText("build_menu.quantity.jets_label")}
      >
        ${jets.map(
          (jet) => html`
            <button
              type="button"
              class="quantity-preset strike-jet"
              data-strike-jet=${jet.id}
              data-strike-jet-airframe=${jet.aircraftType ?? AircraftType.F16}
              aria-pressed=${this.quantitySelectedJets.has(jet.id)
                ? "true"
                : "false"}
              @click=${() => this.toggleStrikeJet(jet.id)}
            >
              <span class="strike-jet-check" aria-hidden="true">✓</span>
              <span class="strike-jet-name">${this.strikeJetName(jet)}</span>
              <span class="strike-jet-meta">
                ${translateText("build_menu.quantity.jet_distance", {
                  tiles: jet.distance,
                })}
                ·
                ${translateText("build_menu.quantity.jet_hull", {
                  health: jet.health,
                  max: jet.maxHealth,
                })}
              </span>
            </button>
          `,
        )}
      </div>
    `;
  }

  private quantityKeyDown(event: KeyboardEvent): void {
    // Shadow DOM retargets composed events at the host. Contain every key so
    // window-level game hotkeys cannot interpret number/arrow/Enter input as
    // map movement or another ghost confirmation.
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      this.cancelQuantity();
      return;
    }
    if (event.key !== "Enter") return;
    if (event.target instanceof HTMLInputElement) {
      this.setQuantity(event.target.valueAsNumber);
    }
    event.preventDefault();
    this.confirmQuantity();
  }

  private quantityKeyUp(event: KeyboardEvent): void {
    event.stopPropagation();
  }

  private renderQuantityDialog(request: CommandQuantityRequest) {
    const maximum = request.max;
    const unavailableReasonId = "quantity-unavailable-reason";
    const totalCost =
      maximum > 0 && request.totalCost
        ? request.totalCost(this.quantityValue)
        : null;
    const quickAmounts =
      request.kind === "construction"
        ? CONSTRUCTION_QUANTITY_PRESETS
        : request.kind === "fighter"
          ? this.airportOperationsEnabled()
            ? AIRPORT_FIGHTER_QUANTITY_PRESETS
            : FIGHTER_QUANTITY_PRESETS
          : REPEATABLE_QUANTITY_PRESETS;
    const presets: Array<{ id: string; label: string; amount: number }> = [
      ...quickAmounts.map((amount) => ({
        id: amount.toString(),
        label: translateText("build_menu.quantity.preset", { amount }),
        amount,
      })),
    ];
    const showMaximum =
      maximum > 0 &&
      (request.kind === "fighter" ||
        !quickAmounts.some((amount) => amount === maximum));
    if (showMaximum) {
      presets.push({
        id: "max",
        label: translateText("build_menu.quantity.maximum", {
          amount: maximum,
        }),
        amount: maximum,
      });
    }
    const hasUnavailablePreset = presets.some(
      ({ amount }) => amount < 1 || amount > maximum,
    );
    const strikeTargets = request.strikeTargets;
    const chosenStrikeTargets = this.chosenStrikeTargets();
    return html`
      <section
        class="quantity-dialog"
        data-quantity-kind=${request.kind}
        role="dialog"
        aria-modal="true"
        aria-labelledby="quantity-dialog-title"
        aria-describedby="quantity-dialog-description"
        @keydown=${this.quantityKeyDown}
        @keyup=${this.quantityKeyUp}
      >
        <header class="quantity-header">
          <h2 id="quantity-dialog-title">
            ${translateText("build_menu.quantity.title")}
          </h2>
          <p id="quantity-dialog-description">
            ${translateText("build_menu.quantity.description", {
              item: request.itemName,
            })}
          </p>
          ${request.separatePlacement
            ? html`<p class="quantity-placement-note">
                ${translateText("build_menu.quantity.separate_tiles")}
              </p>`
            : request.separateTargets
              ? html`<p class="quantity-placement-note">
                  ${translateText(
                    "build_menu.quantity.separate_rocket_targets",
                  )}
                </p>`
              : request.sharedTarget
                ? html`<p class="quantity-placement-note" data-strike-plan-note>
                    ${this.strikePlanNote(
                      strikeTargets,
                      chosenStrikeTargets,
                      request.jets === undefined
                        ? this.quantityValue
                        : this.selectedStrikeJetIds().length,
                    )}
                  </p>`
                : null}
          <div class="quantity-limit" data-quantity-maximum=${maximum}>
            ${request.jets !== undefined
              ? translateText("build_menu.quantity.jets_label")
              : request.uniquePlacement && maximum === 1
                ? translateText("build_menu.quantity.unique_cap")
                : translateText("build_menu.quantity.max_label", {
                    amount: maximum,
                  })}
          </div>
        </header>
        ${strikeTargets === undefined
          ? null
          : html`<div
              class="strike-target-grid"
              role="group"
              data-strike-target-selected=${chosenStrikeTargets.join(",")}
              aria-label=${translateText(
                "build_menu.quantity.strike_target_label",
              )}
            >
              ${strikeTargets.map((choice) => {
                const disabled =
                  choice.id !== StrikeTargetClass.Tile && choice.count < 1;
                return html`
                  <button
                    type="button"
                    class="quantity-preset strike-target"
                    data-strike-target=${choice.id}
                    aria-pressed=${chosenStrikeTargets.includes(choice.id)
                      ? "true"
                      : "false"}
                    title=${disabled
                      ? translateText("build_menu.quantity.strike_target_empty")
                      : ""}
                    ?disabled=${disabled}
                    @click=${() => this.toggleStrikeTarget(choice.id)}
                  >
                    <span
                      >${translateText(
                        `build_menu.quantity.strike_target.${choice.id}`,
                      )}</span
                    >
                    ${choice.id === StrikeTargetClass.Tile
                      ? null
                      : html`<span class="strike-target-count"
                          >${choice.count}</span
                        >`}
                  </button>
                `;
              })}
            </div>`}
        ${request.jets !== undefined
          ? this.renderStrikeJetPicker(request.jets)
          : html`<div class="quantity-controls">
                <button
                  type="button"
                  class="quantity-step"
                  aria-label=${translateText("build_menu.quantity.decrease")}
                  ?disabled=${this.quantityValue <= 1 || maximum < 1}
                  @click=${() => this.setQuantity(this.quantityValue - 1)}
                >
                  −
                </button>
                <input
                  class="quantity-input"
                  type="number"
                  inputmode="numeric"
                  min="1"
                  max=${Math.max(1, maximum)}
                  .value=${this.quantityValue.toString()}
                  aria-label=${translateText("build_menu.quantity.field_label")}
                  ?disabled=${maximum < 1}
                  @input=${(event: InputEvent) => {
                    const input = event.currentTarget as HTMLInputElement;
                    if (Number.isFinite(input.valueAsNumber)) {
                      this.setQuantity(input.valueAsNumber);
                    }
                  }}
                />
                <button
                  type="button"
                  class="quantity-step"
                  aria-label=${translateText("build_menu.quantity.increase")}
                  ?disabled=${this.quantityValue >= maximum || maximum < 1}
                  @click=${() => this.setQuantity(this.quantityValue + 1)}
                >
                  +
                </button>
              </div>
              <div
                class="quantity-presets"
                aria-label=${translateText("build_menu.quantity.presets_label")}
              >
                ${presets.map(({ id, label, amount }) => {
                  const disabled = amount < 1 || amount > maximum;
                  return html`
                    <button
                      type="button"
                      class="quantity-preset"
                      data-quantity-preset=${id}
                      aria-pressed=${this.quantityValue === amount
                        ? "true"
                        : "false"}
                      aria-describedby=${disabled ? unavailableReasonId : null}
                      title=${disabled
                        ? translateText(
                            "build_menu.quantity.unavailable_choice",
                            {
                              amount: maximum,
                            },
                          )
                        : ""}
                      ?disabled=${disabled}
                      @click=${() => this.setQuantity(amount)}
                    >
                      ${label}
                    </button>
                  `;
                })}
              </div>
              <p
                id=${unavailableReasonId}
                class="quantity-disabled-reason"
                aria-live="polite"
              >
                ${hasUnavailablePreset
                  ? translateText("build_menu.quantity.unavailable_choice", {
                      amount: maximum,
                    })
                  : ""}
              </p>`}
        ${request.jets !== undefined
          ? html`<p class="quantity-disabled-reason" aria-live="polite">
              ${this.quantityValue < 1
                ? translateText("build_menu.quantity.jets_none_selected")
                : ""}
            </p>`
          : null}
        ${totalCost === null || request.jets !== undefined
          ? null
          : html`<div class="quantity-summary" aria-live="polite">
              <span>${translateText("build_menu.quantity.total")}</span>
              <strong translate="no"
                >${renderNumber(totalCost)}
                ${translateText("player_panel.gold")}</strong
              >
            </div>`}
        <div class="quantity-actions">
          <button
            type="button"
            class="quantity-action cancel"
            @click=${this.cancelQuantity}
          >
            ${translateText("build_menu.quantity.cancel")}
          </button>
          <button
            type="button"
            class="quantity-action confirm"
            ?disabled=${maximum < 1 ||
            (request.jets !== undefined && this.quantityValue < 1)}
            @click=${this.confirmQuantity}
          >
            ${translateText(
              request.jets === undefined
                ? "build_menu.quantity.confirm"
                : "build_menu.quantity.confirm_jets",
              { amount: this.quantityValue },
            )}
          </button>
        </div>
      </section>
    `;
  }

  private renderAircraftSilhouette(aircraftType: AircraftType) {
    return html`<span class="aircraft-image ${aircraftType}" aria-hidden="true">
      <img src=${aircraftArtUrl(aircraftType)} alt="" />
    </span>`;
  }

  private airportLaunchMaximum(): number {
    const draft = this.airportLaunchDraft;
    const player = this.game?.myPlayer();
    if (
      draft === null ||
      !player ||
      this.fighterMissionStatus().state !== "ready"
    ) {
      return 0;
    }
    const slotCount = this.readyFighterAirports().reduce(
      (total, airport) => total + this.availableAirportSlots(airport),
      0,
    );
    const sortieCost = aircraftSortieCost(
      draft.fighterBuildable.cost,
      draft.aircraftType,
    );
    const goldCount =
      sortieCost === 0n ? slotCount : Number(player.gold() / sortieCost);
    return Math.min(
      MAX_COMMAND_AMOUNT,
      MAX_FIGHTER_MISSION_AMOUNT,
      slotCount,
      goldCount,
    );
  }

  private setAirportAircraft(aircraftType: AircraftType): void {
    if (this.airportLaunchDraft === null) return;
    this.airportLaunchDraft = {
      ...this.airportLaunchDraft,
      aircraftType,
    };
  }

  private setAirportQuantity(amount: number): void {
    const draft = this.airportLaunchDraft;
    if (draft === null) return;
    const maximum = this.airportLaunchMaximum();
    if (!Number.isInteger(amount) || amount < 1 || amount > maximum) return;
    this.airportLaunchDraft = {
      ...draft,
      amount,
      customQuantity: false,
      customQuantityValue: amount.toString(),
    };
  }

  private setAirportCustomQuantity(rawValue: string): void {
    const draft = this.airportLaunchDraft;
    if (draft === null) return;
    this.airportLaunchDraft = {
      ...draft,
      amount: Number(rawValue),
      customQuantity: true,
      customQuantityValue: rawValue,
    };
  }

  private enableAirportCustomQuantity(): void {
    const draft = this.airportLaunchDraft;
    if (draft === null || this.airportLaunchMaximum() < 1) return;
    this.airportLaunchDraft = {
      ...draft,
      customQuantity: true,
      customQuantityValue: draft.amount.toString(),
    };
    void this.updateComplete.then(() => {
      const input = this.shadowRoot?.querySelector<HTMLInputElement>(
        ".airport-custom-quantity",
      );
      input?.focus();
      input?.select();
    });
  }

  private async loadAirportKeyboardTargets(): Promise<void> {
    const requestId = ++this.airportKeyboardTargetRequestId;
    this.airportKeyboardTargets = [];
    this.airportKeyboardTargetsLoading = true;
    const players = this.game.players?.() ?? [];
    const candidates = await Promise.all(
      players
        .filter((player) => player.isAlive() && this.isHostileOwner(player))
        .sort((a, b) => a.id().localeCompare(b.id()))
        .map(async (player): Promise<AirportKeyboardTarget | null> => {
          try {
            const { borderTiles } = await player.borderTiles();
            const tile = [...borderTiles]
              .sort((a, b) => a - b)
              .find((candidate) => this.airportTargetError(candidate) === null);
            return tile === undefined
              ? null
              : { label: player.displayName(), tile };
          } catch {
            return null;
          }
        }),
    );
    if (
      requestId !== this.airportKeyboardTargetRequestId ||
      this.airportLaunchDraft?.choosingTarget !== true
    ) {
      return;
    }
    this.airportKeyboardTargets = candidates.filter(
      (candidate): candidate is AirportKeyboardTarget => candidate !== null,
    );
    this.airportKeyboardTargetsLoading = false;
  }

  private beginAirportTargetSelection(): void {
    const draft = this.airportLaunchDraft;
    const maximum = this.airportLaunchMaximum();
    if (
      draft === null ||
      maximum < 1 ||
      !Number.isInteger(draft.amount) ||
      (draft.customQuantity &&
        !CUSTOM_AIRCRAFT_QUANTITY_PATTERN.test(draft.customQuantityValue)) ||
      draft.amount < 1 ||
      draft.amount > maximum
    ) {
      return;
    }
    this.airportLaunchDraft = {
      ...draft,
      choosingTarget: true,
      targetErrorKey: null,
    };
    if (this.uiState !== undefined) {
      this.uiState.airportTargetSelectionActive = true;
    }
    void this.loadAirportKeyboardTargets();
  }

  private airportTargetError(tile: TileRef): string | null {
    if (
      !this.game.isValidRef(tile) ||
      !this.game.isLand(tile) ||
      this.game.isImpassable(tile)
    ) {
      return "build_menu.airport_launch.target_invalid_land";
    }
    const owner = this.game.owner(tile);
    if (!owner.isPlayer() || !this.isHostileOwner(owner)) {
      return "build_menu.airport_launch.target_invalid_owner";
    }
    return null;
  }

  public chooseAirportTarget(tile: TileRef): boolean {
    const draft = this.airportLaunchDraft;
    if (draft === null || !draft.choosingTarget) return false;
    const targetErrorKey = this.airportTargetError(tile);
    this.airportLaunchDraft = {
      ...draft,
      choosingTarget: false,
      targetTile: targetErrorKey === null ? tile : null,
      targetErrorKey,
    };
    if (this.uiState !== undefined) {
      this.uiState.airportTargetSelectionActive = false;
    }
    this.airportKeyboardTargetRequestId++;
    this.airportKeyboardTargets = [];
    this.airportKeyboardTargetsLoading = false;
    this._hidden = false;
    this.requestUpdate();
    if (targetErrorKey === null) {
      void this.updateComplete.then(() => {
        this.shadowRoot
          ?.querySelector<HTMLButtonElement>("[data-airport-launch]")
          ?.focus();
      });
    }
    return targetErrorKey === null;
  }

  private airportTargetLabel(tile: TileRef): string {
    return translateText("build_menu.airport_launch.target_coordinates", {
      x: this.game.x(tile),
      y: this.game.y(tile),
    });
  }

  private cancelAirportLaunch(): void {
    if (this.uiState !== undefined) {
      this.uiState.airportTargetSelectionActive = false;
    }
    this.airportKeyboardTargetRequestId++;
    this.airportKeyboardTargets = [];
    this.airportKeyboardTargetsLoading = false;
    this.airportLaunchDraft = null;
    this._hidden = true;
    this.requestUpdate();
  }

  private confirmAirportLaunch(): void {
    const draft = this.airportLaunchDraft;
    const maximum = this.airportLaunchMaximum();
    if (
      draft === null ||
      draft.targetTile === null ||
      draft.choosingTarget ||
      this.fighterMissionStatus().state !== "ready" ||
      !Number.isInteger(draft.amount) ||
      (draft.customQuantity &&
        !CUSTOM_AIRCRAFT_QUANTITY_PATTERN.test(draft.customQuantityValue)) ||
      draft.amount < 1 ||
      draft.amount > maximum
    ) {
      return;
    }
    const targetErrorKey = this.airportTargetError(draft.targetTile);
    if (targetErrorKey !== null) {
      this.airportLaunchDraft = {
        ...draft,
        targetTile: null,
        targetErrorKey,
      };
      this.requestUpdate();
      return;
    }
    const order: AirMissionOrder = {
      mission: AirMissionType.PrecisionStrike,
      targetTile: draft.targetTile,
      aircraftType: draft.aircraftType,
    };
    const amount = draft.amount;
    this.cancelAirportLaunch();
    this.eventBus.emit(new LaunchAirMissionIntentEvent(order, amount));
  }

  private renderAirportLaunch() {
    const draft = this.airportLaunchDraft;
    if (draft === null) return null;
    const status = this.fighterMissionStatus();
    const maximum = this.airportLaunchMaximum();
    const amountIsValid =
      Number.isInteger(draft.amount) &&
      (!draft.customQuantity ||
        CUSTOM_AIRCRAFT_QUANTITY_PATTERN.test(draft.customQuantityValue)) &&
      draft.amount >= 1 &&
      draft.amount <= maximum;
    const currentTargetErrorKey =
      draft.targetTile === null
        ? null
        : this.airportTargetError(draft.targetTile);
    const targetIsValid =
      draft.targetTile !== null && currentTargetErrorKey === null;
    const visibleTargetErrorKey = currentTargetErrorKey ?? draft.targetErrorKey;
    const totalCost =
      aircraftSortieCost(draft.fighterBuildable.cost, draft.aircraftType) *
      BigInt(amountIsValid ? draft.amount : 0);
    const targetDescription = draft.choosingTarget
      ? translateText("build_menu.airport_launch.target_choosing")
      : draft.targetTile === null
        ? translateText("build_menu.airport_launch.target_empty")
        : this.airportTargetLabel(draft.targetTile);
    return html`
      <section
        class="airport-launch"
        data-airport-launcher
        data-airport-id=${draft.airportId}
        data-aircraft-selected=${draft.aircraftType}
        data-targeting=${draft.choosingTarget ? "true" : "false"}
        role="dialog"
        aria-modal="false"
        aria-labelledby="airport-launch-title"
        @keydown=${(event: KeyboardEvent) => {
          event.stopPropagation();
          if (event.key === "Escape") {
            event.preventDefault();
            this.cancelAirportLaunch();
          }
        }}
        @keyup=${(event: KeyboardEvent) => event.stopPropagation()}
      >
        <header class="airport-launch-header">
          <p class="airport-launch-overline">
            ${translateText("build_menu.airport_launch.overline", {
              id: draft.airportId,
            })}
          </p>
          <h2 id="airport-launch-title">
            ${translateText("build_menu.airport_launch.title")}
          </h2>
          <button
            type="button"
            class="airport-launch-close"
            aria-label=${translateText("build_menu.airport_launch.close")}
            @click=${this.cancelAirportLaunch}
          >
            ×
          </button>
          <div
            class="airport-readiness"
            data-state=${status.state}
            role="status"
            aria-live="polite"
          >
            ${this.fighterStatusText(status.state)} ·
            ${translateText("build_menu.airport_launch.capacity", {
              slots: this.airportCapacityText(),
            })}
          </div>
        </header>

        <div class="airport-launch-section">
          <p class="airport-section-label">
            <span class="airport-section-heading">
              <span class="airport-step-badge">1</span>
              ${translateText("build_menu.airport_launch.aircraft_label")}
            </span>
            <small
              >${translateText(
                "build_menu.airport_launch.aircraft_hint",
              )}</small
            >
          </p>
          <div class="airport-aircraft-grid">
            ${AIRPORT_AIRCRAFT.map(
              (aircraftType) => html`
                <button
                  type="button"
                  class="airport-aircraft-card"
                  data-aircraft-type=${aircraftType}
                  aria-pressed=${draft.aircraftType === aircraftType
                    ? "true"
                    : "false"}
                  @click=${() => this.setAirportAircraft(aircraftType)}
                >
                  ${this.renderAircraftSilhouette(aircraftType)}
                  <span class="airport-aircraft-name">
                    ${translateText(
                      `build_menu.airport_launch.aircraft.${aircraftType}.name`,
                    )}
                  </span>
                  <span class="airport-aircraft-role">
                    ${translateText(
                      `build_menu.airport_launch.aircraft.${aircraftType}.role`,
                    )}
                    <small class="aircraft-stats"
                      >${this.aircraftStatsText(aircraftType)}</small
                    >
                  </span>
                </button>
              `,
            )}
          </div>
        </div>

        <div class="airport-launch-section">
          <p class="airport-section-label">
            <span class="airport-section-heading">
              <span class="airport-step-badge">2</span>
              ${translateText("build_menu.airport_launch.quantity_label")}
            </span>
            <small
              >${translateText("build_menu.airport_launch.max", {
                amount: maximum,
              })}</small
            >
          </p>
          <div
            class="airport-quantity-grid"
            aria-label=${translateText(
              "build_menu.airport_launch.quantity_label",
            )}
          >
            ${AIRPORT_FIGHTER_QUANTITY_PRESETS.map(
              (amount) => html`
                <button
                  type="button"
                  class="airport-quantity-button"
                  data-airport-quantity=${amount}
                  aria-pressed=${!draft.customQuantity &&
                  draft.amount === amount
                    ? "true"
                    : "false"}
                  ?disabled=${amount > maximum}
                  @click=${() => this.setAirportQuantity(amount)}
                >
                  ${amount}
                </button>
              `,
            )}
            <button
              type="button"
              class="airport-quantity-button"
              data-airport-quantity="custom"
              aria-pressed=${draft.customQuantity ? "true" : "false"}
              ?disabled=${maximum < 1}
              @click=${this.enableAirportCustomQuantity}
            >
              X
            </button>
          </div>
          ${draft.customQuantity
            ? html`<input
                class="airport-custom-quantity"
                data-airport-custom-quantity
                type="number"
                inputmode="numeric"
                min="1"
                max=${Math.max(1, maximum)}
                .value=${draft.customQuantityValue}
                aria-invalid=${amountIsValid ? "false" : "true"}
                aria-describedby=${amountIsValid
                  ? null
                  : "airport-custom-quantity-error"}
                aria-label=${translateText(
                  "build_menu.airport_launch.custom_quantity",
                )}
                @input=${(event: InputEvent) => {
                  const input = event.currentTarget as HTMLInputElement;
                  this.setAirportCustomQuantity(input.value);
                }}
              />`
            : null}
          ${draft.customQuantity && !amountIsValid
            ? html`<p
                id="airport-custom-quantity-error"
                class="airport-target-error"
                role="alert"
              >
                ${translateText(
                  "build_menu.airport_launch.custom_quantity_invalid",
                  { amount: maximum },
                )}
              </p>`
            : null}
          <div class="airport-capacity-line">
            <span
              >${translateText("build_menu.airport_launch.total_cost")}</span
            >
            <strong translate="no"
              >${renderNumber(totalCost)}
              ${translateText("player_panel.gold")}</strong
            >
          </div>
        </div>

        <div class="airport-launch-section">
          <p class="airport-section-label">
            <span class="airport-section-heading">
              <span class="airport-step-badge">3</span>
              ${translateText("build_menu.airport_launch.target_label")}
            </span>
          </p>
          <button
            type="button"
            class="airport-target-button"
            data-airport-target
            data-targeting=${draft.choosingTarget ? "true" : "false"}
            ?disabled=${status.state !== "ready" || !amountIsValid}
            @click=${this.beginAirportTargetSelection}
          >
            <span class="airport-target-reticle" aria-hidden="true">⌖</span>
            <span class="airport-target-copy">
              <strong
                >${translateText(
                  draft.targetTile === null
                    ? "build_menu.airport_launch.choose_target"
                    : "build_menu.airport_launch.target_selected",
                )}</strong
              >
              <span>${targetDescription}</span>
            </span>
            <span class="airport-target-change">
              ${translateText(
                draft.targetTile === null
                  ? "build_menu.airport_launch.select"
                  : "build_menu.airport_launch.change",
              )}
            </span>
          </button>
          ${draft.choosingTarget
            ? html`<div
                class="airport-keyboard-targets"
                aria-live="polite"
                data-airport-keyboard-targets
              >
                <p>
                  ${translateText(
                    this.airportKeyboardTargetsLoading
                      ? "build_menu.airport_launch.target_keyboard_loading"
                      : this.airportKeyboardTargets.length === 0
                        ? "build_menu.airport_launch.target_keyboard_empty"
                        : "build_menu.airport_launch.target_keyboard_hint",
                  )}
                </p>
                <div class="airport-keyboard-target-list">
                  ${this.airportKeyboardTargets.map(
                    (target) =>
                      html`<button
                        type="button"
                        class="airport-keyboard-target"
                        data-airport-keyboard-target=${target.tile}
                        @click=${() => this.chooseAirportTarget(target.tile)}
                      >
                        ${target.label} ·
                        ${this.airportTargetLabel(target.tile)}
                      </button>`,
                  )}
                </div>
              </div>`
            : null}
          ${visibleTargetErrorKey === null
            ? null
            : html`<p class="airport-target-error" role="alert">
                ${translateText(visibleTargetErrorKey)}
              </p>`}
        </div>

        <div class="airport-launch-actions">
          <button
            type="button"
            class="airport-cancel-button"
            @click=${this.cancelAirportLaunch}
          >
            ${translateText("build_menu.airport_launch.cancel")}
          </button>
          <button
            type="button"
            class="airport-launch-button"
            data-airport-launch
            ?disabled=${status.state !== "ready" ||
            !amountIsValid ||
            !targetIsValid ||
            draft.choosingTarget}
            @click=${this.confirmAirportLaunch}
          >
            ${translateText("build_menu.airport_launch.launch", {
              amount: draft.amount,
            })}
          </button>
        </div>
      </section>
    `;
  }

  render() {
    return html`
      <div
        data-local-matte=${ClientEnv.isLocalOnly() ? "hud" : null}
        data-ui-audit-root=${ClientEnv.isLocalOnly() ? "hud" : null}
        class="build-menu ${this.airportLaunchDraft !== null
          ? "airport-launch-shell"
          : ""} ${this._hidden ? "hidden" : ""}"
        @contextmenu=${(e: MouseEvent) => e.preventDefault()}
      >
        ${this.airportLaunchDraft !== null
          ? this.renderAirportLaunch()
          : this.quantityRequest
            ? this.renderQuantityDialog(this.quantityRequest)
            : this.airDefensePicker !== null
              ? this.renderAirDefensePicker(this.airDefensePicker)
              : this.fighterMissionPicker
                ? this.patrolModelOrder !== null
                  ? this.renderPatrolModelPicker(this.patrolModelOrder)
                  : this.renderFighterMissionPicker()
                : this.filteredBuildTable.map((row, categoryIndex) => {
                    const visibleItems = row.filter((item) =>
                      this.playerBuildables?.some(
                        (buildable) => buildable.type === item.unitType,
                      ),
                    );
                    if (visibleItems.length === 0) return null;
                    const category = buildCategoryMeta[categoryIndex];
                    const headingId = `build-category-${category.id}`;
                    return html`
                      <section
                        class="build-category"
                        data-build-category=${category.id}
                        aria-labelledby=${headingId}
                      >
                        <h2 id=${headingId} class="build-category-title">
                          ${translateText(category.titleKey)}
                        </h2>
                        <div class="build-row">
                          ${visibleItems.map((item) => {
                            const buildableUnit = this.playerBuildables?.find(
                              (bu) => bu.type === item.unitType,
                            );
                            if (buildableUnit === undefined) {
                              return html``;
                            }
                            const enabled =
                              buildableUnit.canBuild !== false ||
                              buildableUnit.canUpgrade !== false;
                            const count = this.countDisplay(item);
                            const upgradeDetails = depthStructureUpgradeDetails(
                              this.game,
                              buildableUnit,
                            );
                            const fixedNote = depthFixedStructureNote(
                              this.game,
                              item.unitType,
                            );
                            const maximumNote =
                              upgradeDetails === null
                                ? depthMaximumStructureNote(
                                    this.game,
                                    item.unitType,
                                    this.clickedTile,
                                  )
                                : null;
                            const disabledReason = !enabled
                              ? this.buildDisabledReason(
                                  item,
                                  buildableUnit,
                                  maximumNote,
                                )
                              : "";
                            const disabledReasonId = `build-disabled-reason-${item.unitType
                              .toLowerCase()
                              .replace(/\s+/g, "-")}`;
                            return html`
                              <button
                                class="build-button"
                                @click=${() => {
                                  if (enabled) {
                                    this.sendBuildOrUpgrade(
                                      buildableUnit,
                                      this.clickedTile,
                                    );
                                  }
                                }}
                                aria-disabled=${enabled ? "false" : "true"}
                                aria-describedby=${enabled
                                  ? null
                                  : disabledReasonId}
                                title=${disabledReason}
                              >
                                <img
                                  src=${item.icon}
                                  alt="${item.unitType}"
                                  width="40"
                                  height="40"
                                />
                                <span class="build-name"
                                  >${item.key && translateText(item.key)}</span
                                >
                                <span class="build-description"
                                  >${item.description &&
                                  translateText(
                                    item.unitType === UnitType.FighterJet &&
                                      this.airportOperationsEnabled()
                                      ? "build_menu.desc.fighter_jet_airport_operations"
                                      : item.unitType === UnitType.FighterJet &&
                                          this.game
                                            .config()
                                            .airSuperiorityV1Enabled?.() ===
                                            true
                                        ? "build_menu.desc.fighter_jet_air_superiority"
                                        : item.description,
                                  )}</span
                                >
                                ${item.unitType === UnitType.Airport &&
                                this.airportOperationsEnabled()
                                  ? html`<span
                                      class="airport-capacity"
                                      data-airport-capacity
                                      data-airport-slots=${this.airportCapacityText()}
                                      aria-label=${translateText(
                                        "build_menu.airport_capacity",
                                        {
                                          slots: this.airportCapacityText(),
                                        },
                                      )}
                                      >${translateText(
                                        "build_menu.airport_capacity",
                                        {
                                          slots: this.airportCapacityText(),
                                        },
                                      )}</span
                                    >`
                                  : null}
                                ${maximumNote
                                  ? null
                                  : html`<span
                                      class="build-cost"
                                      translate="no"
                                    >
                                      ${renderNumber(
                                        this.game && this.game.myPlayer()
                                          ? this.cost(item)
                                          : 0,
                                      )}
                                      <img
                                        src=${goldCoinIcon}
                                        alt="gold"
                                        width="12"
                                        height="12"
                                        class="align-middle"
                                      />
                                    </span>`}
                                ${upgradeDetails
                                  ? html`<span
                                      class="depth-upgrade"
                                      data-depth-upgrade="${item.unitType}"
                                      data-current-level=${upgradeDetails.currentLevel}
                                      data-next-level=${upgradeDetails.nextLevel}
                                      data-next-price=${upgradeDetails.cost.toString()}
                                    >
                                      <span
                                        class="depth-upgrade-effect"
                                        data-depth-upgrade-effect
                                        >${upgradeDetails.effect}</span
                                      >
                                    </span>`
                                  : fixedNote
                                    ? html`<span
                                        class="depth-upgrade"
                                        data-depth-fixed-level="${item.unitType}"
                                        >${fixedNote}</span
                                      >`
                                    : maximumNote
                                      ? html`<span
                                          id=${disabledReasonId}
                                          class="depth-upgrade"
                                          data-depth-maximum-level="${item.unitType}"
                                          >${maximumNote}</span
                                        >`
                                      : null}
                                ${!enabled && maximumNote === null
                                  ? html`<span
                                      id=${disabledReasonId}
                                      class="build-disabled-reason"
                                      >${disabledReason}</span
                                    >`
                                  : null}
                                ${item.countable
                                  ? html`<div
                                      class="build-count-chip"
                                      data-physical-count=${count.physicalCount ??
                                      null}
                                      data-aggregate-levels=${count.aggregateLevels ??
                                      null}
                                      title=${count.accessibleLabel ?? ""}
                                      aria-label=${count.accessibleLabel ??
                                      null}
                                    >
                                      <span class="build-count"
                                        >${count.text}</span
                                      >
                                    </div>`
                                  : ""}
                              </button>
                            `;
                          })}
                        </div>
                      </section>
                    `;
                  })}
      </div>
    `;
  }

  private renderFighterMissionPicker() {
    const status = this.fighterMissionStatus();
    const roles = this.fighterCommandRoles();
    return html`
      <div class="fighter-mission-header">
        <h2>${translateText("build_menu.air_mission.title")}</h2>
        <p>
          ${translateText(
            this.game.config().airSuperiorityV1Enabled?.() === true
              ? "build_menu.air_mission.air_superiority_instructions"
              : "build_menu.air_mission.instructions",
          )}
        </p>
        <div
          class="fighter-status"
          role="status"
          aria-live="polite"
          data-fighter-status=${status.state}
          data-active-sorties=${status.activeSorties}
          data-sortie-cap=${status.sortieCap}
        >
          <span>${translateText("build_menu.air_mission.status_label")}</span>
          <strong>${this.fighterStatusText(status.state)}</strong>
          <span
            >${translateText("build_menu.air_mission.status_sorties", {
              active: status.activeSorties,
              max: status.sortieCap,
            })}</span
          >
        </div>
      </div>
      <div class="fighter-mission-grid" data-role-count=${roles.length}>
        ${roles.map((role) => {
          const isReady = status.state === "ready";
          const order = isReady ? this.airMissionOrder(role) : null;
          const disabledReason =
            order === null
              ? isReady
                ? this.airMissionDisabledReason(role)
                : this.fighterStatusText(status.state)
              : "";
          const disabledReasonId = `air-mission-disabled-${role}`;
          return html`
            <button
              type="button"
              class="fighter-mission-button"
              data-fighter-role=${role}
              aria-disabled=${order === null ? "true" : "false"}
              aria-describedby=${order === null ? disabledReasonId : null}
              @click=${() => order && this.chooseFighterRole(order)}
              title=${order === null
                ? disabledReason
                : translateText(
                    role === "air_superiority_patrol" &&
                      this.airportOperationsEnabled()
                      ? "build_menu.air_mission.air_superiority_patrol_airport_desc"
                      : `build_menu.air_mission.${role}_desc`,
                  )}
            >
              <span class="fighter-mission-name">
                ${translateText(`build_menu.air_mission.${role}`)}
              </span>
              <span class="fighter-mission-description">
                ${translateText(
                  role === "air_superiority_patrol" &&
                    this.airportOperationsEnabled()
                    ? "build_menu.air_mission.air_superiority_patrol_airport_desc"
                    : `build_menu.air_mission.${role}_desc`,
                )}
              </span>
              ${order === null
                ? html`<span
                    id=${disabledReasonId}
                    class="fighter-mission-disabled-reason"
                    >${disabledReason}</span
                  >`
                : null}
            </button>
          `;
        })}
      </div>
      <button
        type="button"
        class="fighter-mission-back"
        @click=${() => {
          this.fighterMissionPicker = false;
          this.requestUpdate();
        }}
      >
        ${translateText("build_menu.air_mission.back")}
      </button>
    `;
  }

  private fighterCommandRoles(): readonly FighterCommandRole[] {
    if (this.game.config().airSuperiorityV1Enabled?.() === true) {
      return ["air_superiority_patrol"];
    }
    return this.game.config().combinedArmsV2Enabled?.() === true
      ? FIGHTER_COMMAND_ROLES
      : FIGHTER_COMMAND_ROLES.slice(0, 2);
  }

  /**
   * The Airport profile asks for the airframe after the patrol role; every
   * other role goes straight to quantity.
   */
  private chooseFighterRole(order: AirMissionOrder): void {
    if (
      order.mission === AirMissionType.CombatAirPatrol &&
      this.airportOperationsEnabled()
    ) {
      this.patrolModelOrder = order;
      this.requestUpdate();
      void this.updateComplete.then(() => {
        this.shadowRoot
          ?.querySelector<HTMLButtonElement>("[data-patrol-aircraft]")
          ?.focus();
      });
      return;
    }
    this.requestFighterQuantity(order);
  }

  private requestFighterQuantity(
    order: AirMissionOrder,
    aircraftType?: PatrolAircraftType,
  ): void {
    const fighterBuildable = this.playerBuildables?.find(
      (buildable) => buildable.type === UnitType.FighterJet,
    );
    if (fighterBuildable === undefined) return;
    const unitCost = aircraftSortieCost(fighterBuildable.cost, aircraftType);
    const launchOrder: AirMissionOrder =
      aircraftType === undefined ||
      order.mission !== AirMissionType.CombatAirPatrol
        ? order
        : { ...order, aircraftType };
    this.requestQuantity({
      kind: "fighter",
      itemName:
        aircraftType === undefined
          ? translateText("unit_type.fighter_jet")
          : translateText(
              `build_menu.airport_launch.aircraft.${aircraftType}.name`,
            ),
      max: this.fighterQuantityMaximum(unitCost),
      sharedTarget: true,
      totalCost: (amount) => unitCost * BigInt(amount),
      onConfirm: (amount) => this.launchAirMission(launchOrder, amount),
    });
  }

  private aircraftStatsText(aircraftType: AircraftType): string {
    const profile = aircraftProfile(aircraftType);
    return translateText("build_menu.airport_launch.aircraft_stats", {
      speed: profile.speed,
      health: profile.health,
      cost: profile.costMultiplier,
    });
  }

  private openAirDefensePicker(buildable: BuildableUnit, tile: TileRef): void {
    // The radial menu and shortcuts call in while the panel is hidden; the
    // picker must show itself exactly like the quantity dialog does.
    this.airDefensePicker = {
      buildable,
      tile,
      range: null,
      returnScreen: this._hidden ? "hidden" : "build",
    };
    this._hidden = false;
    this.requestUpdate();
    void this.updateComplete.then(() => {
      this.shadowRoot
        ?.querySelector<HTMLButtonElement>("[data-air-defense-range]")
        ?.focus();
    });
  }

  private chooseAirDefenseRange(range: AirDefenseRange): void {
    if (this.airDefensePicker === null) return;
    this.airDefensePicker = { ...this.airDefensePicker, range };
    this.requestUpdate();
    void this.updateComplete.then(() => {
      this.shadowRoot
        ?.querySelector<HTMLButtonElement>("[data-air-defense-system]")
        ?.focus();
    });
  }

  private airDefensePrice(
    buildable: BuildableUnit,
    system: AirDefenseSystem,
  ): Gold {
    return airDefenseCost(buildable.cost, system);
  }

  private canAffordAirDefense(
    buildable: BuildableUnit,
    system: AirDefenseSystem,
  ): boolean {
    const gold = this.game?.myPlayer()?.gold() ?? 0n;
    return gold >= this.airDefensePrice(buildable, system);
  }

  /** Re-enters the ordinary construction flow with the system's price. */
  private chooseAirDefenseSystem(system: AirDefenseSystem): void {
    const picker = this.airDefensePicker;
    if (
      picker === null ||
      !this.canAffordAirDefense(picker.buildable, system)
    ) {
      return;
    }
    const priced: BuildableUnit = {
      ...picker.buildable,
      cost: airDefenseCost(picker.buildable.cost, system),
      freshBuildCosts: picker.buildable.freshBuildCosts?.map((cost) =>
        airDefenseCost(cost, system),
      ),
    };
    this.airDefensePicker = null;
    // Let the quantity dialog record the same return screen the picker had,
    // so cancelling it leads back to the map or the build table accordingly.
    this._hidden = picker.returnScreen === "hidden";
    this.sendBuildOrUpgrade(priced, picker.tile, system);
  }

  private airDefenseBack(): void {
    const picker = this.airDefensePicker;
    if (picker === null) return;
    if (picker.range !== null) {
      this.airDefensePicker = { ...picker, range: null };
    } else {
      this.airDefensePicker = null;
      if (picker.returnScreen === "hidden") this._hidden = true;
    }
    this.requestUpdate();
  }

  private airDefenseStatsText(system: AirDefenseSystem): string {
    const profile = airDefenseProfile(system);
    return translateText("build_menu.air_defense.stats", {
      radius: profile.radius,
      reload: profile.reloadTicks / 10,
      hit: profile.jetDamage,
    });
  }

  private airDefenseWarheadsText(system: AirDefenseSystem): string {
    const warheads = airDefenseProfile(system).warheads.length;
    return translateText(
      `build_menu.air_defense.warheads.${
        warheads >= 3 ? "all" : warheads === 2 ? "atom_hydrogen" : "atom"
      }`,
    );
  }

  private renderAirDefensePicker(picker: AirDefensePickerState) {
    const ranges = [AirDefenseRange.Short, AirDefenseRange.Long] as const;
    return html`
      <div class="fighter-mission-header">
        <h2>${translateText("build_menu.air_defense.title")}</h2>
        <p>
          ${picker.range === null
            ? translateText("build_menu.air_defense.range_hint")
            : translateText("build_menu.air_defense.system_hint", {
                range: translateText(
                  `build_menu.air_defense.range.${picker.range}.name`,
                ),
              })}
        </p>
      </div>
      ${picker.range === null
        ? html`
            <div
              class="air-defense-grid"
              role="group"
              aria-label=${translateText("build_menu.air_defense.title")}
            >
              ${ranges.map(
                (range) => html`
                  <button
                    type="button"
                    class="air-defense-card"
                    data-air-defense-range=${range}
                    @click=${() => this.chooseAirDefenseRange(range)}
                  >
                    <span class="air-defense-name"
                      >${translateText(
                        `build_menu.air_defense.range.${range}.name`,
                      )}</span
                    >
                    <span class="air-defense-origin"
                      >${airDefenseSystemsForRange(range)
                        .map((system) =>
                          translateText(
                            `build_menu.air_defense.system.${system}.name`,
                          ),
                        )
                        .join(" · ")}</span
                    >
                    <span class="air-defense-role"
                      >${translateText(
                        `build_menu.air_defense.range.${range}.desc`,
                      )}</span
                    >
                  </button>
                `,
              )}
            </div>
          `
        : html`
            <div
              class="air-defense-grid"
              role="group"
              aria-label=${translateText(
                `build_menu.air_defense.range.${picker.range}.name`,
              )}
            >
              ${airDefenseSystemsForRange(picker.range).map((system) => {
                const affordable = this.canAffordAirDefense(
                  picker.buildable,
                  system,
                );
                return html`
                  <button
                    type="button"
                    class="air-defense-card"
                    data-air-defense-system=${system}
                    aria-disabled=${affordable ? "false" : "true"}
                    title=${affordable
                      ? ""
                      : translateText("build_menu.air_defense.unaffordable")}
                    @click=${() => this.chooseAirDefenseSystem(system)}
                  >
                    <span class="air-defense-name"
                      >${translateText(
                        `build_menu.air_defense.system.${system}.name`,
                      )}${airDefenseProfile(system).countersStealth
                        ? html`<span class="air-defense-badge"
                            >${translateText(
                              "build_menu.air_defense.stealth",
                            )}</span
                          >`
                        : nothing}</span
                    >
                    <span class="air-defense-origin"
                      >${translateText(
                        `build_menu.air_defense.system.${system}.origin`,
                      )}</span
                    >
                    <span class="air-defense-role"
                      >${translateText(
                        `build_menu.air_defense.system.${system}.role`,
                      )}</span
                    >
                    <span class="air-defense-stats"
                      >${this.airDefenseStatsText(system)} ·
                      ${this.airDefenseWarheadsText(system)}</span
                    >
                    <span class="air-defense-price"
                      >${translateText("build_menu.air_defense.price", {
                        price: renderNumber(
                          this.airDefensePrice(picker.buildable, system),
                        ),
                      })}</span
                    >
                  </button>
                `;
              })}
            </div>
          `}
      <button
        type="button"
        class="fighter-mission-back"
        data-air-defense-back
        @click=${() => this.airDefenseBack()}
      >
        ${translateText("build_menu.air_defense.back")}
      </button>
    `;
  }

  private renderPatrolModelPicker(order: PatrolModelOrder) {
    const status = this.fighterMissionStatus();
    const ready = status.state === "ready";
    return html`
      <div class="fighter-mission-header">
        <h2>
          ${translateText("build_menu.air_mission.air_superiority_patrol")}
        </h2>
        <p>${translateText("build_menu.air_mission.patrol_aircraft_hint")}</p>
        <div
          class="fighter-status"
          role="status"
          aria-live="polite"
          data-fighter-status=${status.state}
        >
          <span
            >${translateText(
              "build_menu.air_mission.patrol_aircraft_label",
            )}</span
          >
          <strong>${this.fighterStatusText(status.state)}</strong>
        </div>
      </div>
      <div
        class="airport-aircraft-grid patrol-aircraft-grid"
        role="group"
        aria-label=${translateText(
          "build_menu.air_mission.patrol_aircraft_label",
        )}
      >
        ${PATROL_AIRCRAFT_TYPES.map(
          (aircraftType) => html`
            <button
              type="button"
              class="airport-aircraft-card"
              data-patrol-aircraft=${aircraftType}
              aria-disabled=${ready ? "false" : "true"}
              title=${ready ? "" : this.fighterStatusText(status.state)}
              @click=${() =>
                ready && this.requestFighterQuantity(order, aircraftType)}
            >
              ${this.renderAircraftSilhouette(aircraftType)}
              <span class="airport-aircraft-name">
                ${translateText(
                  `build_menu.airport_launch.aircraft.${aircraftType}.name`,
                )}
              </span>
              <span class="airport-aircraft-role">
                ${translateText(
                  `build_menu.air_mission.patrol_aircraft.${aircraftType}`,
                )}
                <small class="aircraft-stats"
                  >${this.aircraftStatsText(aircraftType)}</small
                >
              </span>
            </button>
          `,
        )}
      </div>
      <button
        type="button"
        class="fighter-mission-back"
        @click=${() => {
          this.patrolModelOrder = null;
          this.requestUpdate();
        }}
      >
        ${translateText("build_menu.air_mission.back")}
      </button>
    `;
  }

  private fighterQuantityMaximum(unitCost: Gold): number {
    const player = this.game?.myPlayer();
    if (!player || this.fighterMissionStatus().state !== "ready") return 0;

    if (this.airportOperationsEnabled()) {
      const slotCount = this.readyFighterAirports().reduce(
        (total, airport) => total + this.availableAirportSlots(airport),
        0,
      );
      const goldCount =
        unitCost === 0n ? slotCount : Number(player.gold() / unitCost);
      return Math.min(
        MAX_COMMAND_AMOUNT,
        MAX_FIGHTER_MISSION_AMOUNT,
        slotCount,
        goldCount,
      );
    }

    const config = this.game.config();
    const activeSorties = player
      .units(UnitType.FighterJet)
      .filter((fighter) => fighter.markedForDeletion() === false).length;
    const capSlots = Math.max(0, config.fighterMaxActive() - activeSorties);
    const goldSlots =
      unitCost === 0n
        ? 2
        : player.gold() >= unitCost * 2n
          ? 2
          : player.gold() >= unitCost
            ? 1
            : 0;
    return Math.min(
      LEGACY_MAX_FIGHTER_MISSION_AMOUNT,
      capSlots,
      goldSlots,
      this.readyFighterFactories().length,
    );
  }

  private readyFighterFactories() {
    const player = this.game?.myPlayer();
    if (!player) return [];
    const now = this.game.ticks();
    const cooldown = this.game.config().fighterLaunchCooldown();
    return player.units(UnitType.Factory).filter((factory) => {
      const queue = factory.missileTimerQueue();
      return (
        factory.isActive() &&
        !factory.isUnderConstruction() &&
        factory.markedForDeletion() === false &&
        (queue.length === 0 || now - queue[0] >= cooldown)
      );
    });
  }

  private airportOperationsEnabled(): boolean {
    return this.game?.config().airportOperationsV1Enabled?.() === true;
  }

  private operationalFighterAirports() {
    const player = this.game?.myPlayer();
    if (!player) return [];
    return player
      .units(UnitType.Airport)
      .filter(
        (airport) =>
          airport.isActive() &&
          !airport.isUnderConstruction() &&
          airport.markedForDeletion() === false,
      );
  }

  private attributedAirportJetCount(airportId: number): number {
    return (this.game?.units?.(UnitType.FighterJet) ?? []).filter((fighter) => {
      const state = fighter.aircraftState();
      return (
        fighter.isActive() &&
        fighter.markedForDeletion() === false &&
        state.homeFactoryId === airportId
      );
    }).length;
  }

  private airportCapacityText(): string {
    const player = this.game?.myPlayer();
    if (!player) return "—";
    const airports = player
      .units(UnitType.Airport)
      .filter(
        (airport) =>
          airport.isActive() && airport.markedForDeletion() === false,
      )
      .sort((a, b) => a.id() - b.id());
    if (airports.length === 0) return "—";
    return airports
      .map(
        (airport) =>
          `${this.attributedAirportJetCount(airport.id())}/${AIRPORT_FIGHTER_CAPACITY}`,
      )
      .join(" · ");
  }

  private availableAirportSlots(airport: UnitView): number {
    const activeSlots =
      AIRPORT_FIGHTER_CAPACITY - this.attributedAirportJetCount(airport.id());
    const now = this.game.ticks();
    const cooldown = this.game.config().fighterLaunchCooldown();
    const rearming = airport
      .missileTimerQueue()
      .filter((launchedAt) => now - launchedAt < cooldown).length;
    return Math.max(
      0,
      Math.min(activeSlots, AIRPORT_FIGHTER_CAPACITY - rearming),
    );
  }

  private readyFighterAirports() {
    return this.operationalFighterAirports().filter(
      (airport) => this.availableAirportSlots(airport) > 0,
    );
  }

  private fighterMissionStatus(): {
    state: FighterReadinessState;
    activeSorties: number;
    sortieCap: number;
  } {
    const player = this.game?.myPlayer();
    if (!player || this.clickedTile === undefined) {
      return { state: "unavailable", activeSorties: 0, sortieCap: 0 };
    }

    const config = this.game.config();
    const activeSorties = player
      .units(UnitType.FighterJet)
      .filter((fighter) => fighter.markedForDeletion() === false).length;
    const airportProfile = this.airportOperationsEnabled();
    const airports = airportProfile ? this.operationalFighterAirports() : [];
    const sortieCap = airportProfile
      ? airports.length * AIRPORT_FIGHTER_CAPACITY
      : config.fighterMaxActive();
    const fighterBuildable = this.playerBuildables?.find(
      (buildable) => buildable.type === UnitType.FighterJet,
    );
    if (
      airportProfile &&
      (config.isUnitDisabled?.(UnitType.FighterJet) === true ||
        config.isUnitDisabled?.(UnitType.Airport) === true)
    ) {
      return { state: "unavailable", activeSorties, sortieCap };
    }
    if (fighterBuildable === undefined) {
      return { state: "unavailable", activeSorties, sortieCap };
    }
    if (player.gold() < fighterBuildable.cost) {
      return { state: "insufficient_gold", activeSorties, sortieCap };
    }
    if (this.game.isSpawnImmunityActive()) {
      return { state: "spawn_immunity", activeSorties, sortieCap };
    }
    if (!airportProfile && activeSorties >= sortieCap) {
      return { state: "sortie_cap", activeSorties, sortieCap };
    }

    if (airportProfile) {
      if (airports.length === 0) {
        const hasAirport = player
          .units(UnitType.Airport)
          .some(
            (airport) =>
              airport.isActive() && airport.markedForDeletion() === false,
          );
        return {
          state: hasAirport ? "airport_building" : "airport_required",
          activeSorties,
          sortieCap,
        };
      }
      const activeCapacity = airports.reduce(
        (total, airport) =>
          total +
          Math.max(
            0,
            AIRPORT_FIGHTER_CAPACITY -
              this.attributedAirportJetCount(airport.id()),
          ),
        0,
      );
      if (activeCapacity === 0) {
        return { state: "airport_full", activeSorties, sortieCap };
      }
      return {
        state:
          this.readyFighterAirports().length > 0 ? "ready" : "airport_cooldown",
        activeSorties,
        sortieCap,
      };
    }

    const factories = player
      .units(UnitType.Factory)
      .filter(
        (factory) =>
          factory.isActive() &&
          !factory.isUnderConstruction() &&
          factory.markedForDeletion() === false,
      );
    if (factories.length === 0) {
      return { state: "factory_required", activeSorties, sortieCap };
    }

    const now = this.game.ticks();
    const cooldown = config.fighterLaunchCooldown();
    const ready = factories.some((factory) => {
      const queue = factory.missileTimerQueue();
      return queue.length === 0 || now - queue[0] >= cooldown;
    });
    return {
      state: ready ? "ready" : "factory_cooldown",
      activeSorties,
      sortieCap,
    };
  }

  public buildDisabledReason(
    item: BuildItemDisplay,
    buildableUnit: BuildableUnit,
    maximumNote: string | null,
  ): string {
    if (maximumNote !== null) return maximumNote;

    const player = this.game?.myPlayer();
    if (!player) return translateText("build_menu.unavailable");
    if (
      this.airportOperationsEnabled() &&
      (item.unitType === UnitType.Airport ||
        item.unitType === UnitType.FighterJet) &&
      this.game.config().isUnitDisabled?.(item.unitType) === true
    ) {
      return this.fighterStatusText("unavailable");
    }
    if (player.gold() < buildableUnit.cost) {
      if (
        this.airportOperationsEnabled() &&
        item.unitType === UnitType.FighterJet
      ) {
        return this.fighterStatusText("insufficient_gold");
      }
      return translateText("build_menu.not_enough_money");
    }
    if (item.unitType !== UnitType.FighterJet) {
      return translateText("build_menu.unavailable_here");
    }

    if (this.game.isSpawnImmunityActive()) {
      if (this.airportOperationsEnabled()) {
        return this.fighterStatusText("spawn_immunity");
      }
      return translateText("build_menu.fighter.spawn_immunity");
    }
    if (this.airportOperationsEnabled()) {
      const state = this.fighterMissionStatus().state;
      if (state !== "ready") {
        return this.fighterStatusText(state);
      }
      return translateText("build_menu.fighter.unavailable");
    }
    const config = this.game.config();
    const activeSorties = player
      .units(UnitType.FighterJet)
      .filter((fighter) => fighter.markedForDeletion() === false).length;
    if (activeSorties >= config.fighterMaxActive()) {
      return translateText("build_menu.fighter.sortie_cap");
    }

    const factories = player
      .units(UnitType.Factory)
      .filter(
        (factory) =>
          factory.isActive() &&
          !factory.isUnderConstruction() &&
          factory.markedForDeletion() === false,
      );
    if (factories.length === 0) {
      return translateText("build_menu.fighter.factory_required");
    }

    const now = this.game.ticks();
    const cooldown = config.fighterLaunchCooldown();
    if (
      factories.every((factory) => {
        const queue = factory.missileTimerQueue();
        return queue.length > 0 && now - queue[0] < cooldown;
      })
    ) {
      return translateText("build_menu.fighter.factory_cooldown");
    }
    return translateText("build_menu.fighter.unavailable");
  }

  private fighterStatusText(state: FighterReadinessState): string {
    return translateText(
      this.airportOperationsEnabled()
        ? `build_menu.airport_status.${state}`
        : `build_menu.air_mission.status.${state}`,
    );
  }

  private airMissionDisabledReason(role: FighterCommandRole): string {
    return translateText(
      role === "tactical_strike"
        ? "build_menu.air_mission.tactical_target_required"
        : role === "combat_air_patrol" || role === "air_superiority_patrol"
          ? "build_menu.air_mission.combat_air_patrol_target_required"
          : "build_menu.air_mission.target_required",
    );
  }

  private airMissionOrder(role: FighterCommandRole): AirMissionOrder | null {
    const player = this.game?.myPlayer();
    if (!player || this.clickedTile === undefined) return null;

    if (role === "combat_air_patrol" || role === "air_superiority_patrol") {
      return this.game.config().combinedArmsV2Enabled?.() === true
        ? {
            mission: AirMissionType.CombatAirPatrol,
            targetTile: this.clickedTile,
          }
        : null;
    }

    if (role === "air_defense") {
      const clickedHostileFighter = this.game
        .units(UnitType.FighterJet)
        .filter((unit) => unit.tile() === this.clickedTile)
        .sort((a, b) => a.id() - b.id())
        .find(
          (unit) =>
            unit.isActive() &&
            unit.targetable() &&
            this.isHostileOwner(unit.owner()),
        );
      return clickedHostileFighter
        ? {
            mission: AirMissionType.Intercept,
            targetUnitId: clickedHostileFighter.id(),
          }
        : { mission: AirMissionType.Intercept, targetTile: this.clickedTile };
    }

    const ships = this.game
      .units(UnitType.Warship, UnitType.TransportShip)
      .filter((unit) => unit.tile() === this.clickedTile)
      .sort((a, b) => a.id() - b.id());
    const target = ships.find((unit) => {
      if (!unit.isActive() || !unit.targetable()) return false;
      return this.isHostileOwner(unit.owner());
    });
    if (target) {
      return {
        mission: AirMissionType.NavalStrike,
        targetUnitId: target.id(),
      };
    }

    if (
      !this.game.isLand(this.clickedTile) ||
      this.game.isImpassable(this.clickedTile)
    ) {
      return null;
    }
    const owner = this.game.owner(this.clickedTile);
    if (!owner.isPlayer() || !this.isHostileOwner(owner)) return null;
    return {
      mission: AirMissionType.PrecisionStrike,
      targetTile: this.clickedTile,
    };
  }

  private isHostileOwner(owner: ReturnType<GameView["owner"]>): boolean {
    const player = this.game.myPlayer();
    if (!player || !owner.isPlayer() || owner === player) return false;
    const connectedFriendly =
      !owner.isDisconnected() &&
      (player.isFriendly(owner) || owner.isFriendly(player));
    return (
      !connectedFriendly &&
      !(
        owner.type() === PlayerType.Nation &&
        this.game.isNationSpawnImmunityActive()
      )
    );
  }

  private launchAirMission(order: AirMissionOrder, amount: number): void {
    this.eventBus.emit(new LaunchAirMissionIntentEvent(order, amount));
    this.hideMenu();
  }

  hideMenu() {
    const onCancel = this.quantityRequest?.onCancel;
    this.buildablesRequestId++;
    this._hidden = true;
    this.fighterMissionPicker = false;
    this.patrolModelOrder = null;
    this.airDefensePicker = null;
    this.airportLaunchDraft = null;
    this.airportKeyboardTargetRequestId++;
    this.airportKeyboardTargets = [];
    this.airportKeyboardTargetsLoading = false;
    if (this.uiState !== undefined) {
      this.uiState.airportTargetSelectionActive = false;
    }
    this.quantityRequest = null;
    this.quantityValue = 1;
    this.quantityReturnScreen = "hidden";
    onCancel?.();
    this.requestUpdate();
  }

  showMenu(clickedTile: TileRef) {
    const previousRequest = this.quantityRequest;
    this.buildablesRequestId++;
    this.clickedTile = clickedTile;
    this.fighterMissionPicker = false;
    this.patrolModelOrder = null;
    this.airDefensePicker = null;
    this.airportLaunchDraft = null;
    this.airportKeyboardTargetRequestId++;
    this.airportKeyboardTargets = [];
    this.airportKeyboardTargetsLoading = false;
    if (this.uiState !== undefined) {
      this.uiState.airportTargetSelectionActive = false;
    }
    this.quantityRequest = null;
    this.quantityReturnScreen = "hidden";
    this.playerBuildables = null;
    this._hidden = false;
    previousRequest?.onCancel?.();
    this.refresh();
  }

  showFighterMissions(clickedTile: TileRef, fighterBuildable?: BuildableUnit) {
    const previousRequest = this.quantityRequest;
    this.buildablesRequestId++;
    this.clickedTile = clickedTile;
    this.fighterMissionPicker = true;
    this.patrolModelOrder = null;
    this.airportLaunchDraft = null;
    this.airportKeyboardTargetRequestId++;
    this.airportKeyboardTargets = [];
    this.airportKeyboardTargetsLoading = false;
    if (this.uiState !== undefined) {
      this.uiState.airportTargetSelectionActive = false;
    }
    this.quantityRequest = null;
    this.quantityReturnScreen = "hidden";
    this.playerBuildables =
      fighterBuildable === undefined ? null : [fighterBuildable];
    this._hidden = false;
    previousRequest?.onCancel?.();
    this.refresh();
  }

  showAirportLaunch(
    airportId: number,
    airportTile: TileRef,
    fighterBuildable: BuildableUnit,
  ): void {
    const previousRequest = this.quantityRequest;
    this.buildablesRequestId++;
    this.clickedTile = airportTile;
    this.fighterMissionPicker = false;
    this.patrolModelOrder = null;
    this.airDefensePicker = null;
    this.quantityRequest = null;
    this.quantityReturnScreen = "hidden";
    this.playerBuildables = [fighterBuildable];
    this.airportKeyboardTargetRequestId++;
    this.airportKeyboardTargets = [];
    this.airportKeyboardTargetsLoading = false;
    this.airportLaunchDraft = {
      airportId,
      airportTile,
      fighterBuildable,
      aircraftType: AircraftType.F16,
      amount: 1,
      customQuantity: false,
      customQuantityValue: "1",
      targetTile: null,
      choosingTarget: false,
      targetErrorKey: null,
    };
    if (this.uiState !== undefined) {
      this.uiState.airportTargetSelectionActive = false;
    }
    this._hidden = false;
    previousRequest?.onCancel?.();
    void this.updateComplete.then(() => {
      this.shadowRoot
        ?.querySelector<HTMLButtonElement>("[data-aircraft-type]")
        ?.focus();
    });
  }

  private refresh() {
    const requestId = this.buildablesRequestId;
    const requestedTile = this.clickedTile;
    this.game
      .myPlayer()
      ?.buildables(requestedTile, BuildMenus.types)
      .then((buildables) => {
        if (
          requestId !== this.buildablesRequestId ||
          requestedTile !== this.clickedTile
        ) {
          return;
        }
        this.playerBuildables = buildables;
        this.requestUpdate();
      });

    // remove disabled buildings from the buildtable
    this.filteredBuildTable = this.getBuildableUnits();
  }

  private getBuildableUnits(): BuildItemDisplay[][] {
    return buildTable.map((row) =>
      row.filter(
        (item) =>
          !this.game?.config()?.isUnitDisabled(item.unitType) ||
          (this.airportOperationsEnabled() &&
            (item.unitType === UnitType.Airport ||
              item.unitType === UnitType.FighterJet)),
      ),
    );
  }

  get isVisible() {
    return !this._hidden;
  }

  get isChoosingAirportTarget() {
    return this.airportLaunchDraft?.choosingTarget === true;
  }
}
