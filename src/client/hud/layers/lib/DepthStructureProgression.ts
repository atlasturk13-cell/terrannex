import type { BuildableUnit, Gold } from "../../../../core/game/Game";
import {
  DEPTH_STRUCTURE_MAX_LEVEL,
  DepthProgressionStructures,
  UnitType,
} from "../../../../core/game/Game";
import type { TileRef } from "../../../../core/game/GameMap";
import { translateText } from "../../../Utils";
import type { GameView, UnitView } from "../../../view";

export interface DepthStructureUpgradeDetails {
  readonly currentLevel: number;
  readonly nextLevel: number;
  readonly cost: Gold;
  readonly effect: string;
  readonly summary: string;
}

function exactDecimal(value: number): string {
  return Number.isInteger(value)
    ? value.toString()
    : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function effectText(
  game: GameView,
  type: UnitType,
  nextLevel: number,
  unit: UnitView,
): string {
  switch (type) {
    case UnitType.Port:
      return translateText("depth_progression.effect_port");
    case UnitType.City:
      return translateText("depth_progression.effect_city", {
        // Troops are shown divided by ten everywhere in the HUD.
        capacity: game.config().cityTroopIncrease() / 10,
      });
    case UnitType.Barracks:
      return translateText("depth_progression.effect_barracks", {
        population: game.config().barracksPopulationIncrease() / 10,
        rate: exactDecimal(
          (game.config().barracksTroopRateMultiplier(1) -
            game.config().barracksTroopRateMultiplier(0)) *
            100,
        ),
      });
    case UnitType.Factory:
      return translateText("depth_progression.effect_factory");
    case UnitType.MissileSilo:
      return translateText("depth_progression.effect_missile_silo");
    case UnitType.SAMLauncher:
      return translateText("depth_progression.effect_sam_launcher", {
        range: exactDecimal(
          game.config().airDefenseRadius(unit.airDefenseSystem(), nextLevel),
        ),
      });
    default:
      return "";
  }
}

export function depthStructureUpgradeDetails(
  game: GameView,
  buildable: BuildableUnit,
): DepthStructureUpgradeDetails | null {
  if (
    game.config().depthProgressionEnabled?.() !== true ||
    buildable.canUpgrade === false ||
    !DepthProgressionStructures.has(buildable.type)
  ) {
    return null;
  }
  const unit = game.unit(buildable.canUpgrade);
  if (unit === undefined || unit.level() >= DEPTH_STRUCTURE_MAX_LEVEL) {
    return null;
  }
  const currentLevel = unit.level();
  const nextLevel = currentLevel + 1;
  return {
    currentLevel,
    nextLevel,
    cost: buildable.cost,
    effect: effectText(game, buildable.type, nextLevel, unit),
    summary: translateText("depth_progression.structure_upgrade", {
      current_level: currentLevel,
      next_level: nextLevel,
      price: buildable.cost.toString(),
    }),
  };
}

export function depthFixedStructureNote(
  game: GameView,
  type: UnitType,
): string | null {
  return game.config().depthProgressionEnabled?.() === true &&
    type === UnitType.DefensePost
    ? translateText("depth_progression.fixed_level")
    : null;
}

export function depthMaximumStructureNote(
  game: GameView,
  type: UnitType,
  tile: TileRef | undefined,
): string | null {
  if (
    tile === undefined ||
    game.config().depthProgressionEnabled?.() !== true ||
    !DepthProgressionStructures.has(type)
  ) {
    return null;
  }
  const player = game.myPlayer();
  if (player === null) return null;
  const capped = game
    .nearbyUnits(tile, game.config().structureMinDist(), type)
    .some(
      ({ unit }) =>
        unit.owner().id() === player.id() &&
        unit.isActive() &&
        !unit.markedForDeletion() &&
        !unit.isUnderConstruction() &&
        unit.level() >= DEPTH_STRUCTURE_MAX_LEVEL,
    );
  return capped ? translateText("depth_progression.maximum_level") : null;
}
