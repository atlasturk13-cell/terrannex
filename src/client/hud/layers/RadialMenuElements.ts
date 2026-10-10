import { assetUrl } from "../../../core/AssetUrls";
import { Config } from "../../../core/configuration/Config";
import { aircraftProfile } from "../../../core/game/AircraftProfiles";
import {
  AirMissionType,
  AirPatrolCommandOrder,
  AllPlayers,
  BuildableAttacks,
  DepthProgressionStructures,
  LEGACY_MAX_FIGHTER_MISSION_AMOUNT,
  MAX_COMMAND_AMOUNT,
  MAX_FIGHTER_MISSION_AMOUNT,
  PlayerActions,
  PlayerBuildableUnitType,
  PlayerType,
  STRIKE_TARGET_CLASS_UNITS,
  StrikeTargetClass,
  Structures,
  UnitType,
} from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { normalizeStrikeClasses } from "../../../core/game/StrikePlan";
import { Emoji, findClosestBy, flattenedEmojiTable } from "../../../core/Util";
import { UIState } from "../../UIState";
import { renderNumber, translateText } from "../../Utils";
import { GameView, PlayerView } from "../../view";
import { BuildItemDisplay, BuildMenu, flattenedBuildTable } from "./BuildMenu";
import { ChatIntegration } from "./ChatIntegration";
import { EmojiTable } from "./EmojiTable";
import {
  depthFixedStructureNote,
  depthMaximumStructureNote,
  depthStructureUpgradeDetails,
} from "./lib/DepthStructureProgression";
import { PlayerActionHandler } from "./PlayerActionHandler";
import { PlayerPanel } from "./PlayerPanel";
import { TooltipItem } from "./RadialMenu";

import { EventBus } from "../../../core/EventBus";
import type {
  StrikeJetChoice,
  StrikeTargetChoice,
} from "../../CommandQuantity";
import { SendCommandAirPatrolIntentEvent } from "../../Transport";
const allianceIcon = assetUrl("images/AllianceIconWhite.svg");
const boatIcon = assetUrl("images/BoatIconWhite.svg");
const buildIcon = assetUrl("images/BuildIconWhite.svg");
const chatIcon = assetUrl("images/ChatIconWhite.svg");
const donateGoldIcon = assetUrl("images/DonateGoldIconWhite.svg");
const donateTroopIcon = assetUrl("images/DonateTroopIconWhite.svg");
const emojiIcon = assetUrl("images/EmojiIconWhite.svg");
const infoIcon = assetUrl("images/InfoIcon.svg");
const swordIcon = assetUrl("images/SwordIconWhite.svg");
const targetIcon = assetUrl("images/TargetIconWhite.svg");
const traitorIcon = assetUrl("images/TraitorIconWhite.svg");
const xIcon = assetUrl("images/XIcon.svg");
const fighterJetIcon = assetUrl("sprites/fighterJet.png");

export interface MenuElementParams {
  myPlayer: PlayerView;
  selected: PlayerView | null;
  tile: TileRef;
  playerActions: PlayerActions;
  game: GameView;
  buildMenu: BuildMenu;
  emojiTable: EmojiTable;
  playerActionHandler: PlayerActionHandler;
  playerPanel: PlayerPanel;
  chatIntegration: ChatIntegration;
  eventBus: EventBus;
  uiState?: UIState;
  closeMenu: () => void;
}

export interface MenuElement {
  id: string;
  name: string;
  displayed?: boolean | ((params: MenuElementParams) => boolean);
  color?: string | ((params: MenuElementParams) => string);
  icon?: string;
  text?: string;
  fontSize?: string;
  tooltipItems?: TooltipItem[];
  /** Tooltip rows resolved against the latest game snapshot. */
  tooltipItemsFor?: (params: MenuElementParams) => TooltipItem[];
  tooltipKeys?: TooltipKey[];

  cooldown?: (params: MenuElementParams) => number;
  disabled: (params: MenuElementParams) => boolean;
  action?: (params: MenuElementParams) => void; // For leaf items that perform actions
  subMenu?: (params: MenuElementParams) => MenuElement[]; // For non-leaf items that open submenus

  renderType?: string;

  timerFraction?: (params: MenuElementParams) => number; // 0..1, for arc timer overlay
  /** Short text rendered beside a disabled radial control. */
  disabledReason?: (params: MenuElementParams) => string;
}

export interface TooltipKey {
  key: string;
  className: string;
  params?: Record<string, string | number>;
}

export interface CenterButtonElement {
  disabled: (params: MenuElementParams) => boolean;
  action: (params: MenuElementParams) => void;
}

export const COLORS = {
  build: "#e6c74a",
  building: "#1e3a5f",
  boat: "#2a82c9",
  disabled: "#94a3b8",
  ally: "#4ade80",
  breakAlly: "#dc2626",
  breakAllyNoDebuff: "#d97706",
  delete: "#ef4444",
  info: "#475569",
  target: "#ef4444",
  attack: "#ef4444",
  infoDetails: "#7f8c8d",
  infoEmoji: "#fbbf24",
  trade: "#0891b2",
  embargo: "#7c3aed",
  tooltip: {
    cost: "#f59e0b",
    count: "#94a3b8",
  },
  chat: {
    default: "#6366f1",
    help: "#22c55e",
    attack: "#ef4444",
    defend: "#3b82f6",
    greet: "#f97316",
    misc: "#a855f7",
    warnings: "#fbbf24",
  },
};

export enum Slot {
  Info = "info",
  Boat = "boat",
  Build = "build",
  Attack = "attack",
  Ally = "ally",
  Back = "back",
  Delete = "delete",
}

function isFriendlyTarget(params: MenuElementParams): boolean {
  const selectedPlayer = params.selected;
  if (selectedPlayer === null) return false;
  const isFriendly = (selectedPlayer as PlayerView).isFriendly;
  if (typeof isFriendly !== "function") return false;
  return isFriendly.call(selectedPlayer, params.myPlayer);
}

function isDisconnectedTarget(params: MenuElementParams): boolean {
  const selectedPlayer = params.selected;
  if (selectedPlayer === null) return false;
  const isDisconnected = (selectedPlayer as PlayerView).isDisconnected;
  if (typeof isDisconnected !== "function") return false;
  return isDisconnected.call(selectedPlayer);
}

function isAirborneJetAttackEnabled(params: MenuElementParams): boolean {
  const config = params.game.config?.();
  return (
    config?.airportOperationsV1Enabled?.() === true ||
    (config?.combinedArmsV2Enabled?.() === true &&
      config?.airSuperiorityV1Enabled?.() !== true)
  );
}

function isAirportOperationsEnabled(params: MenuElementParams): boolean {
  return params.game.config?.().airportOperationsV1Enabled?.() === true;
}

function isHostileAirPatrolOwner(
  params: MenuElementParams,
  owner: PlayerView,
  treatDisconnectedFriendly: boolean,
): boolean {
  if (owner.id() === params.myPlayer.id()) return false;
  const hasFriendlyRelation =
    params.myPlayer.isFriendly(owner) || owner.isFriendly(params.myPlayer);
  const friendly =
    hasFriendlyRelation &&
    (treatDisconnectedFriendly || !owner.isDisconnected());
  return (
    !friendly &&
    !(
      owner.type() === PlayerType.Human && params.game.isSpawnImmunityActive()
    ) &&
    !(
      owner.type() === PlayerType.Nation &&
      params.game.isNationSpawnImmunityActive()
    )
  );
}

function eligibleAirPatrolJets(params: MenuElementParams) {
  return params.myPlayer.units(UnitType.FighterJet).filter((fighter) => {
    const state = fighter.aircraftState();
    return (
      fighter.isActive() &&
      fighter.markedForDeletion() === false &&
      state.mission === AirMissionType.CombatAirPatrol &&
      state.phase !== "returning"
    );
  });
}

function eligibleAirPatrolCount(params: MenuElementParams): number {
  return eligibleAirPatrolJets(params).length;
}

/**
 * Airport-profile Jet Attack picker rows: every eligible airborne patrol jet
 * with its airframe, distance to the strike point and hull, nearest first
 * (then by ID, matching the authoritative departure order).
 */
function strikeJetChoices(
  params: MenuElementParams,
  target: AirPatrolCommandOrder,
): StrikeJetChoice[] | undefined {
  if (
    target.mission !== AirMissionType.PrecisionStrike ||
    !isAirportOperationsEnabled(params)
  ) {
    return undefined;
  }
  return eligibleAirPatrolJets(params)
    .map((jet) => {
      const aircraftType = jet.aircraftState().aircraftType;
      return {
        id: jet.id(),
        aircraftType,
        distance: params.game.manhattanDist(jet.tile(), target.targetTile),
        health: jet.health(),
        maxHealth: aircraftProfile(aircraftType).health,
      };
    })
    .sort((a, b) => a.distance - b.distance || a.id - b.id);
}

function resolveAirPatrolCommandTarget(
  params: MenuElementParams,
): AirPatrolCommandOrder | null {
  // The Airport profile exposes one contextual command: airborne patrol jets
  // may bomb hostile land. Forged fighter/ship retasks remain server-rejected.
  if (isAirportOperationsEnabled(params)) {
    if (
      !params.game.isLand(params.tile) ||
      params.game.isImpassable(params.tile)
    ) {
      return null;
    }
    const owner = params.game.owner(params.tile);
    if (!owner.isPlayer() || !isHostileAirPatrolOwner(params, owner, false)) {
      return null;
    }
    return {
      mission: AirMissionType.PrecisionStrike,
      targetTile: params.tile,
    };
  }

  const hostileFighter = params.game
    .units(UnitType.FighterJet)
    .filter(
      (unit) =>
        unit.tile() === params.tile &&
        unit.isActive() &&
        unit.targetable() &&
        unit.aircraftState().phase !== "returning" &&
        isHostileAirPatrolOwner(params, unit.owner(), true),
    )
    .sort((a, b) => a.id() - b.id())[0];
  if (hostileFighter !== undefined) {
    return {
      mission: AirMissionType.Intercept,
      targetUnitId: hostileFighter.id(),
    };
  }

  const hostileMilitaryShip = params.game
    .units(UnitType.Warship, UnitType.TransportShip)
    .filter(
      (unit) =>
        unit.tile() === params.tile &&
        unit.isActive() &&
        unit.targetable() &&
        (unit.type() !== UnitType.TransportShip || unit.troops() > 0) &&
        isHostileAirPatrolOwner(params, unit.owner(), true),
    )
    .sort((a, b) => a.id() - b.id())[0];
  if (hostileMilitaryShip !== undefined) {
    return {
      mission: AirMissionType.NavalStrike,
      targetUnitId: hostileMilitaryShip.id(),
    };
  }

  if (
    !params.game.isLand(params.tile) ||
    params.game.isImpassable(params.tile)
  ) {
    return null;
  }
  const owner = params.game.owner(params.tile);
  if (!owner.isPlayer() || !isHostileAirPatrolOwner(params, owner, false)) {
    return null;
  }
  return {
    mission: AirMissionType.PrecisionStrike,
    targetTile: params.tile,
  };
}

/**
 * Airport-profile Jet Attack plans with the victim's live structure counts:
 * the clicked tile, or a whole class of the clicked tile owner's structures.
 */
function strikeTargetChoices(
  params: MenuElementParams,
  target: AirPatrolCommandOrder,
): StrikeTargetChoice[] | undefined {
  if (
    target.mission !== AirMissionType.PrecisionStrike ||
    !isAirportOperationsEnabled(params)
  ) {
    return undefined;
  }
  const victim = params.game.owner(target.targetTile);
  if (!victim.isPlayer()) return undefined;
  return Object.values(StrikeTargetClass).map((id) => ({
    id,
    count:
      id === StrikeTargetClass.Tile
        ? 1
        : params.game
            .units(...STRIKE_TARGET_CLASS_UNITS[id])
            .filter(
              (unit) =>
                unit.isActive() &&
                unit.markedForDeletion() === false &&
                unit.owner().id() === victim.id(),
            ).length,
  }));
}

/**
 * Wire fields for the chosen strike plans: nothing for the clicked tile, the
 * single `targetClass` for one plan, `targetClasses` for several.
 */
function strikePlanFields(
  strikeTargets: readonly StrikeTargetClass[] | undefined,
): { targetClass?: StrikeTargetClass; targetClasses?: StrikeTargetClass[] } {
  const classes = normalizeStrikeClasses(strikeTargets);
  if (classes.length === 1) {
    return classes[0] === StrikeTargetClass.Tile
      ? {}
      : { targetClass: classes[0] };
  }
  return { targetClasses: classes };
}

function createAirborneJetsAttackElement(
  params: MenuElementParams,
): MenuElement {
  const key = isAirportOperationsEnabled(params)
    ? "jet_attack"
    : "airborne_attack";
  const tooltipItems = (current: MenuElementParams): TooltipItem[] => {
    const target = resolveAirPatrolCommandTarget(current);
    const eligibleCount = eligibleAirPatrolCount(current);
    const disabledReason =
      eligibleCount < 1
        ? `build_menu.air_mission.${key}_no_patrols`
        : target === null
          ? `build_menu.air_mission.${key}_target_required`
          : null;
    return [
      {
        text: translateText(`build_menu.air_mission.${key}`),
        className: "title",
      },
      {
        text: translateText(`build_menu.air_mission.${key}_desc`),
        className: "description",
      },
      ...(disabledReason === null
        ? []
        : [
            {
              text: translateText(disabledReason),
              className: "description",
            },
          ]),
    ];
  };
  return {
    id: "attack_airborne_fighter_jets",
    name: `build_menu.air_mission.${key}`,
    icon: fighterJetIcon,
    color: COLORS.attack,
    disabled: (current) =>
      eligibleAirPatrolCount(current) < 1 ||
      resolveAirPatrolCommandTarget(current) === null,
    disabledReason: (current) =>
      translateText(
        eligibleAirPatrolCount(current) < 1
          ? `build_menu.air_mission.${key}_no_patrols`
          : `build_menu.air_mission.${key}_target_required`,
      ),
    get tooltipItems(): TooltipItem[] {
      return tooltipItems(params);
    },
    tooltipItemsFor: tooltipItems,
    action: (current) => {
      const currentTarget = resolveAirPatrolCommandTarget(current);
      const max = Math.min(
        MAX_COMMAND_AMOUNT,
        isAirportOperationsEnabled(current)
          ? MAX_FIGHTER_MISSION_AMOUNT
          : LEGACY_MAX_FIGHTER_MISSION_AMOUNT,
        eligibleAirPatrolCount(current),
      );
      if (currentTarget === null || max < 1) return;

      current.closeMenu();
      const jets = strikeJetChoices(current, currentTarget);
      current.buildMenu.requestQuantity({
        kind: "fighter",
        itemName: translateText(`build_menu.air_mission.${key}_quantity_item`),
        max: jets === undefined ? max : Math.min(max, jets.length),
        sharedTarget: true,
        strikeTargets: strikeTargetChoices(current, currentTarget),
        jets,
        totalCost: () => 0n,
        onConfirm: (amount, strikeTargets, fighterIds) =>
          current.eventBus.emit(
            new SendCommandAirPatrolIntentEvent(
              currentTarget.mission !== AirMissionType.PrecisionStrike
                ? currentTarget
                : {
                    ...currentTarget,
                    ...strikePlanFields(strikeTargets),
                    ...(fighterIds === undefined || fighterIds.length === 0
                      ? {}
                      : { fighterIds }),
                  },
              amount,
            ),
          ),
      });
    },
  };
}

function createGroundAttackElement(): MenuElement {
  const canAttack = (params: MenuElementParams): boolean => {
    if (
      params.game.inSpawnPhase() ||
      !params.game.isLand(params.tile) ||
      !params.playerActions.canAttack
    ) {
      return false;
    }
    const owner = params.game.owner(params.tile);
    return owner.isPlayer() && isHostileAirPatrolOwner(params, owner, false);
  };
  return {
    id: "attack_ground",
    name: "user_setting.ground_attack",
    icon: swordIcon,
    color: COLORS.attack,
    disabled: (params) => !canAttack(params),
    disabledReason: () =>
      translateText("build_menu.air_mission.jet_attack_target_required"),
    tooltipKeys: [
      { key: "user_setting.ground_attack", className: "title" },
      { key: "user_setting.ground_attack_desc", className: "description" },
    ],
    action: (params) => {
      if (!canAttack(params)) return;
      params.playerActionHandler.handleAttack(
        params.myPlayer,
        params.selected?.id() ?? null,
      );
      params.closeMenu();
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const infoChatElement: MenuElement = {
  id: "info_chat",
  name: "chat",
  disabled: () => false,
  color: COLORS.chat.default,
  icon: chatIcon,
  subMenu: (params: MenuElementParams) =>
    params.chatIntegration
      .createQuickChatMenu(params.selected!)
      .map((item) => ({
        ...item,
        action: item.action
          ? (_params: MenuElementParams) => item.action!(params)
          : undefined,
      })),
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const allyTargetElement: MenuElement = {
  id: "ally_target",
  name: "target",
  disabled: (params: MenuElementParams): boolean => {
    if (params.selected === null) return true;
    return !params.playerActions.interaction?.canTarget;
  },
  color: COLORS.target,
  icon: targetIcon,
  action: (params: MenuElementParams) => {
    params.playerActionHandler.handleTargetPlayer(params.selected!.id());
    params.closeMenu();
  },
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const allyTradeElement: MenuElement = {
  id: "ally_trade",
  name: "trade",
  disabled: (params: MenuElementParams) =>
    !!params.playerActions?.interaction?.canEmbargo,
  displayed: (params: MenuElementParams) =>
    !params.playerActions?.interaction?.canEmbargo,
  color: COLORS.trade,
  text: translateText("player_panel.start_trade"),
  action: (params: MenuElementParams) => {
    params.playerActionHandler.handleEmbargo(params.selected!, "stop");
    params.closeMenu();
  },
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const allyEmbargoElement: MenuElement = {
  id: "ally_embargo",
  name: "embargo",
  disabled: (params: MenuElementParams) =>
    !params.playerActions?.interaction?.canEmbargo,
  displayed: (params: MenuElementParams) =>
    !!params.playerActions?.interaction?.canEmbargo,
  color: COLORS.embargo,
  text: translateText("player_panel.stop_trade"),
  action: (params: MenuElementParams) => {
    params.playerActionHandler.handleEmbargo(params.selected!, "start");
    params.closeMenu();
  },
};

const allyRequestElement: MenuElement = {
  id: "ally_request",
  name: "request",
  disabled: (params: MenuElementParams) =>
    !params.playerActions?.interaction?.canSendAllianceRequest,
  displayed: (params: MenuElementParams) =>
    !params.playerActions?.interaction?.canBreakAlliance,
  color: COLORS.ally,
  icon: allianceIcon,
  action: (params: MenuElementParams) => {
    params.playerActionHandler.handleAllianceRequest(
      params.myPlayer,
      params.selected!,
    );
    params.closeMenu();
  },
};

const allyExtendElement: MenuElement = {
  id: "ally_extend",
  name: "extend",
  displayed: (params: MenuElementParams) =>
    !!params.playerActions?.interaction?.allianceInfo?.inExtensionWindow,
  disabled: (params: MenuElementParams) =>
    !params.playerActions?.interaction?.allianceInfo?.canExtend,
  color: COLORS.ally,
  icon: allianceIcon,
  action: (params: MenuElementParams) => {
    if (!params.playerActions?.interaction?.allianceInfo?.canExtend) return;
    params.playerActionHandler.handleExtendAlliance(params.selected!);
    params.closeMenu();
  },
  timerFraction: (params: MenuElementParams): number => {
    const interaction = params.playerActions?.interaction;
    if (!interaction?.allianceInfo) return 1;
    const remaining = Math.max(
      0,
      interaction.allianceInfo.expiresAt - params.game.ticks(),
    );
    const extensionWindow = Math.max(
      1,
      params.game.config().allianceExtensionPromptOffset(),
    );
    return Math.max(0, Math.min(1, remaining / extensionWindow));
  },
  renderType: "allyExtend",
};

const allyBreakElement: MenuElement = {
  id: "ally_break",
  name: "break",
  disabled: (params: MenuElementParams) =>
    !params.playerActions?.interaction?.canBreakAlliance,
  displayed: (params: MenuElementParams) =>
    !!params.playerActions?.interaction?.canBreakAlliance,
  color: (params: MenuElementParams) =>
    params.selected?.isTraitor() || params.selected?.isDisconnected()
      ? COLORS.breakAllyNoDebuff
      : COLORS.breakAlly,
  icon: traitorIcon,
  action: (params: MenuElementParams) => {
    params.playerActionHandler.handleBreakAlliance(
      params.myPlayer,
      params.selected!,
    );
    params.closeMenu();
  },
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const allyDonateGoldElement: MenuElement = {
  id: "ally_donate_gold",
  name: "donate gold",
  disabled: (params: MenuElementParams) =>
    !params.playerActions?.interaction?.canDonateGold,
  color: COLORS.ally,
  icon: donateGoldIcon,
  action: (params: MenuElementParams) => {
    params.playerActionHandler.handleDonateGold(params.selected!);
    params.closeMenu();
  },
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const allyDonateTroopsElement: MenuElement = {
  id: "ally_donate_troops",
  name: "donate troops",
  disabled: (params: MenuElementParams) =>
    !params.playerActions?.interaction?.canDonateTroops,
  color: COLORS.ally,
  icon: donateTroopIcon,
  action: (params: MenuElementParams) => {
    params.playerActionHandler.handleDonateTroops(params.selected!);
    params.closeMenu();
  },
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const infoPlayerElement: MenuElement = {
  id: "info_player",
  name: "player",
  disabled: () => false,
  color: COLORS.info,
  icon: infoIcon,
  action: (params: MenuElementParams) => {
    params.playerPanel.show(params.playerActions, params.tile);
  },
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const infoEmojiElement: MenuElement = {
  id: "info_emoji",
  name: "emoji",
  disabled: () => false,
  color: COLORS.infoEmoji,
  icon: emojiIcon,
  subMenu: (params: MenuElementParams) => {
    const emojiElements: MenuElement[] = [
      {
        id: "emoji_more",
        name: "more",
        disabled: () => false,
        color: COLORS.infoEmoji,
        icon: emojiIcon,
        action: (params: MenuElementParams) => {
          params.emojiTable.showTable((emoji) => {
            const targetPlayer =
              params.selected === params.game.myPlayer()
                ? AllPlayers
                : params.selected;
            params.playerActionHandler.handleEmoji(
              targetPlayer!,
              flattenedEmojiTable.indexOf(emoji as Emoji),
            );
            params.emojiTable.hideTable();
          });
        },
      },
    ];

    const emojiCount = 8;
    for (let i = 0; i < emojiCount; i++) {
      emojiElements.push({
        id: `emoji_${i}`,
        name: flattenedEmojiTable[i],
        text: flattenedEmojiTable[i],
        disabled: () => false,
        fontSize: "25px",
        action: (params: MenuElementParams) => {
          const targetPlayer =
            params.selected === params.game.myPlayer()
              ? AllPlayers
              : params.selected;
          params.playerActionHandler.handleEmoji(targetPlayer!, i);
          params.closeMenu();
        },
      });
    }

    return emojiElements;
  },
};

export const infoMenuElement: MenuElement = {
  id: Slot.Info,
  name: "info",
  disabled: (params: MenuElementParams) =>
    !params.selected || params.game.inSpawnPhase(),
  icon: infoIcon,
  color: COLORS.info,
  action: (params: MenuElementParams) => {
    params.playerPanel.show(params.playerActions, params.tile);
  },
};

function getAllEnabledUnits(
  myPlayer: boolean,
  config: Config,
): Set<PlayerBuildableUnitType> {
  const units: Set<PlayerBuildableUnitType> =
    new Set<PlayerBuildableUnitType>();

  const addIfEnabled = (unitType: PlayerBuildableUnitType) => {
    if (!config.isUnitDisabled(unitType)) {
      units.add(unitType);
    }
  };

  if (myPlayer) {
    Structures.types.forEach(addIfEnabled);
  } else {
    BuildableAttacks.types.forEach(addIfEnabled);
  }

  // Airport-profile controls stay visible when a host disables them so the
  // player gets a concrete reason instead of a silently missing action.
  if (config.airportOperationsV1Enabled?.() === true) {
    units.add(myPlayer ? UnitType.Airport : UnitType.FighterJet);
  }

  return units;
}

function createMenuElements(
  params: MenuElementParams,
  filterType: "attack" | "build",
  elementIdPrefix: string,
): MenuElement[] {
  const unitTypes: Set<PlayerBuildableUnitType> = getAllEnabledUnits(
    params.selected === params.myPlayer,
    params.game.config(),
  );

  return flattenedBuildTable
    .filter(
      (item) =>
        unitTypes.has(item.unitType) &&
        (filterType === "attack"
          ? BuildableAttacks.has(item.unitType)
          : !BuildableAttacks.has(item.unitType)),
    )
    .map((item: BuildItemDisplay) => {
      const canUseItem = (current: MenuElementParams): boolean => {
        if (item.unitType !== UnitType.FighterJet) {
          return current.buildMenu.canBuildOrUpgrade(item);
        }
        const fighter = current.playerActions.buildableUnits.find(
          (buildable) => buildable.type === UnitType.FighterJet,
        );
        return fighter !== undefined && fighter.canBuild !== false;
      };
      const tooltipItemsFor = (current: MenuElementParams): TooltipItem[] => {
        const contextualBuildable = current.playerActions.buildableUnits.find(
          (buildable) => buildable.type === item.unitType,
        );
        const upgradeDetails = contextualBuildable
          ? depthStructureUpgradeDetails(current.game, contextualBuildable)
          : null;
        const fixedNote = depthFixedStructureNote(current.game, item.unitType);
        const maximumNote =
          contextualBuildable !== undefined && upgradeDetails === null
            ? depthMaximumStructureNote(
                current.game,
                item.unitType,
                current.tile,
              )
            : null;
        const countText = item.countable ? current.buildMenu.count(item) : null;
        const depthCount =
          current.game.config().depthProgressionEnabled?.() === true &&
          DepthProgressionStructures.has(item.unitType);
        return [
          { text: translateText(item.key ?? ""), className: "title" },
          {
            text: translateText(item.description ?? ""),
            className: "description",
          },
          maximumNote
            ? null
            : {
                text: `${renderNumber(
                  contextualBuildable?.cost ?? current.buildMenu.cost(item),
                )} ${translateText("player_panel.gold")}`,
                className: "cost",
              },
          upgradeDetails
            ? { text: upgradeDetails.summary, className: "description" }
            : null,
          upgradeDetails
            ? { text: upgradeDetails.effect, className: "description" }
            : null,
          fixedNote ? { text: fixedNote, className: "description" } : null,
          maximumNote ? { text: maximumNote, className: "description" } : null,
          countText !== null
            ? {
                text: depthCount ? countText : `${countText}x`,
                className: "count",
              }
            : null,
        ].filter(
          (tooltipItem): tooltipItem is TooltipItem => tooltipItem !== null,
        );
      };
      return {
        id: `${elementIdPrefix}_${item.unitType}`,
        name: item.key
          ? item.key.replace("unit_type.", "")
          : item.unitType.toString(),
        disabled: (p: MenuElementParams) => !canUseItem(p),
        disabledReason: (current: MenuElementParams) => {
          const buildable = current.playerActions.buildableUnits.find(
            (candidate) => candidate.type === item.unitType,
          );
          if (buildable === undefined) {
            return translateText("build_menu.airport_status.unavailable");
          }
          const upgrade = depthStructureUpgradeDetails(current.game, buildable);
          const maximum =
            upgrade === null
              ? depthMaximumStructureNote(
                  current.game,
                  item.unitType,
                  current.tile,
                )
              : null;
          return current.buildMenu.buildDisabledReason(
            item,
            buildable,
            maximum,
          );
        },
        color: (p: MenuElementParams) =>
          canUseItem(p)
            ? filterType === "attack"
              ? COLORS.attack
              : COLORS.building
            : COLORS.building,
        icon: item.icon,
        tooltipItems: tooltipItemsFor(params),
        tooltipItemsFor,
        // Quantity is a shared, accessible Lit dialog rather than a nested
        // radial submenu. Returning no children makes this item a leaf and
        // routes every command through BuildMenu below.
        subMenu: () => [],
        action: (params: MenuElementParams) => {
          const buildableUnit = params.playerActions.buildableUnits.find(
            (bu) => bu.type === item.unitType,
          );
          if (buildableUnit === undefined) {
            return;
          }
          if (item.unitType === UnitType.FighterJet) {
            if (buildableUnit.canBuild === false) return;
            // Close the radial surface first so it cannot immediately hide the
            // quantity dialog opened by BuildMenu. Pass the contextual worker
            // snapshot so the picker never guesses a missing fighter price.
            params.closeMenu();
            params.buildMenu.showFighterMissions(params.tile, buildableUnit);
            return;
          }
          if (!params.buildMenu.canBuildOrUpgrade(item)) return;

          // Close the radial surface first so it cannot immediately hide the
          // quantity dialog opened by BuildMenu.
          params.closeMenu();
          params.buildMenu.sendBuildOrUpgrade(buildableUnit, params.tile);
        },
      };
    });
}

export const attackMenuElement: MenuElement = {
  id: Slot.Attack,
  name: "radial_attack",
  disabled: (params: MenuElementParams) => params.game.inSpawnPhase(),
  icon: swordIcon,
  color: COLORS.attack,

  subMenu: (params: MenuElementParams) => {
    if (params === undefined) return [];
    const items = createMenuElements(params, "attack", "attack");
    if (!isAirborneJetAttackEnabled(params)) return items;
    return isAirportOperationsEnabled(params)
      ? [
          createAirborneJetsAttackElement(params),
          createGroundAttackElement(),
          ...items,
        ]
      : [createAirborneJetsAttackElement(params), ...items];
  },
};

const donateGoldRadialElement: MenuElement = {
  id: Slot.Attack,
  name: "radial_donate_gold",
  disabled: (params: MenuElementParams) =>
    params.game.inSpawnPhase() ||
    !params.playerActions?.interaction?.canDonateGold,
  icon: donateGoldIcon,
  color: "#f59e0b",
  action: (params: MenuElementParams) => {
    if (!params.selected) return;
    params.playerPanel.openSendGoldModal(
      params.playerActions,
      params.tile,
      params.selected,
    );
  },
};

export const deleteUnitElement: MenuElement = {
  id: Slot.Delete,
  name: "delete",
  cooldown: (params: MenuElementParams) => params.myPlayer.deleteUnitCooldown(),
  disabled: (params: MenuElementParams) => {
    const tileOwner = params.game.owner(params.tile);
    const isLand = params.game.isLand(params.tile);

    if (!tileOwner.isPlayer() || tileOwner.id() !== params.myPlayer.id()) {
      return true;
    }

    if (!isLand) {
      return true;
    }

    if (params.game.inSpawnPhase()) {
      return true;
    }

    if (params.myPlayer.deleteUnitCooldown() > 0) {
      return true;
    }

    const DELETE_SELECTION_RADIUS = 5;
    const myUnits = params.myPlayer
      .units()
      .filter(
        (unit) =>
          !unit.isUnderConstruction() &&
          unit.markedForDeletion() === false &&
          Structures.has(unit.type()) &&
          params.game.manhattanDist(unit.tile(), params.tile) <=
            DELETE_SELECTION_RADIUS,
      );

    return myUnits.length === 0;
  },
  icon: xIcon,
  color: COLORS.delete,
  tooltipKeys: [
    {
      key: "radial_menu.delete_unit_title",
      className: "title",
    },
    {
      key: "radial_menu.delete_unit_description",
      className: "description",
    },
  ],
  action: (params: MenuElementParams) => {
    const DELETE_SELECTION_RADIUS = 5;
    const myUnits = params.myPlayer
      .units()
      .filter(
        (unit) =>
          !unit.isUnderConstruction() &&
          unit.markedForDeletion() === false &&
          Structures.has(unit.type()) &&
          params.game.manhattanDist(unit.tile(), params.tile) <=
            DELETE_SELECTION_RADIUS,
      );

    const closestUnit = findClosestBy(myUnits, (unit) =>
      params.game.manhattanDist(unit.tile(), params.tile),
    );
    if (closestUnit) {
      params.playerActionHandler.handleDeleteUnit(closestUnit.id());
    }

    params.closeMenu();
  },
};

export const buildMenuElement: MenuElement = {
  id: Slot.Build,
  name: "build",
  disabled: (params: MenuElementParams) => params.game.inSpawnPhase(),
  icon: buildIcon,
  color: COLORS.build,

  subMenu: (params: MenuElementParams) => {
    if (params === undefined) return [];
    return createMenuElements(params, "build", "build");
  },
};

export const boatMenuElement: MenuElement = {
  id: Slot.Boat,
  name: "boat",
  disabled: (params: MenuElementParams) =>
    !params.playerActions.buildableUnits.some(
      (unit) => unit.type === UnitType.TransportShip && unit.canBuild,
    ),
  icon: boatIcon,
  color: COLORS.boat,

  action: async (params: MenuElementParams) => {
    params.playerActionHandler.handleBoatAttack(params.myPlayer, params.tile);

    params.closeMenu();
  },
};

export const centerButtonElement: CenterButtonElement = {
  disabled: (params: MenuElementParams): boolean => {
    const tileOwner = params.game.owner(params.tile);
    const isLand = params.game.isLand(params.tile);
    if (!isLand) {
      return true;
    }
    if (params.game.inSpawnPhase()) {
      if (params.game.config().isRandomSpawn()) {
        return true;
      }
      if (tileOwner.isPlayer()) {
        return true;
      }
      return false;
    }

    if (isFriendlyTarget(params) && !isDisconnectedTarget(params)) {
      return !params.playerActions.interaction?.canDonateTroops;
    }

    return !params.playerActions.canAttack;
  },
  action: (params: MenuElementParams) => {
    if (params.game.inSpawnPhase()) {
      params.playerActionHandler.handleSpawn(params.tile);
    } else {
      if (isFriendlyTarget(params) && !isDisconnectedTarget(params)) {
        const selectedPlayer = params.selected as PlayerView;
        const ratio = params.uiState?.attackRatio ?? 1;
        const troopsToDonate = Math.floor(ratio * params.myPlayer.troops());
        if (troopsToDonate > 0) {
          params.playerActionHandler.handleDonateTroops(
            selectedPlayer,
            troopsToDonate,
          );
        }
      } else {
        params.playerActionHandler.handleAttack(
          params.myPlayer,
          params.selected?.id() ?? null,
        );
      }
    }
    params.closeMenu();
  },
};

export const rootMenuElement: MenuElement = {
  id: "root",
  name: "root",
  disabled: () => false,
  icon: infoIcon,
  color: COLORS.info,
  subMenu: (params: MenuElementParams) => {
    const isAllied = params.selected?.isAlliedWith(params.myPlayer);
    const isDisconnected = isDisconnectedTarget(params);

    const tileOwner = params.game.owner(params.tile);
    const isOwnTerritory =
      tileOwner.isPlayer() &&
      (tileOwner as PlayerView).id() === params.myPlayer.id();

    const inExtensionWindow =
      params.playerActions.interaction?.allianceInfo?.inExtensionWindow;

    // After game-over, nukes can target teammates (nukeSpawn allows it).
    // Show the attack submenu so mobile users can access nukes in the aftergame.
    const hasBuildableAttacks =
      params.playerActions.buildableUnits?.some(
        (bu) => BuildableAttacks.has(bu.type) && bu.canBuild !== false,
      ) ?? false;

    const hasEnabledAirPatrolCommand =
      isAirborneJetAttackEnabled(params) &&
      eligibleAirPatrolCount(params) > 0 &&
      resolveAirPatrolCommandTarget(params) !== null;
    const showDonateInsteadOfAttack =
      isFriendlyTarget(params) &&
      !isDisconnected &&
      !hasBuildableAttacks &&
      !hasEnabledAirPatrolCommand;
    const hasAirPatrolUnitTargetOnOwnTerritory =
      isOwnTerritory &&
      isAirborneJetAttackEnabled(params) &&
      resolveAirPatrolCommandTarget(params) !== null;

    const menuItems: (MenuElement | null)[] = [
      infoMenuElement,
      ...(isOwnTerritory
        ? [
            deleteUnitElement,
            allyRequestElement,
            buildMenuElement,
            hasAirPatrolUnitTargetOnOwnTerritory ? attackMenuElement : null,
          ]
        : [
            isAllied && !isDisconnected ? allyBreakElement : boatMenuElement,
            inExtensionWindow ? allyExtendElement : allyRequestElement,
            showDonateInsteadOfAttack
              ? donateGoldRadialElement
              : attackMenuElement,
          ]),
    ];

    return menuItems.filter((item): item is MenuElement => item !== null);
  },
};
