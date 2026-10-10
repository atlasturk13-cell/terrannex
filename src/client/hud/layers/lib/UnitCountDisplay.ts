import type { Config } from "../../../../core/configuration/Config";
import {
  DEPTH_STRUCTURE_MAX_LEVEL,
  DepthProgressionStructures,
  UnitType,
} from "../../../../core/game/Game";
import { renderNumber, translateText } from "../../../Utils";
import type { PlayerView } from "../../../view";

export interface UnitCountDisplay {
  readonly text: string;
  readonly physicalCount?: number;
  readonly aggregateLevels?: number;
  readonly accessibleLabel?: string;
}

export function formatUnitCountDisplay(
  value: number,
  aggregateLevels?: number,
): UnitCountDisplay {
  if (aggregateLevels === undefined) {
    return { text: renderNumber(value) };
  }

  const accessibleLabel = translateText(
    "depth_progression.completed_port_count",
    {
      physical_count: value,
      aggregate_levels: aggregateLevels,
    },
  );
  return {
    text: `${renderNumber(value)}× · Σ${renderNumber(aggregateLevels)}`,
    physicalCount: value,
    aggregateLevels,
    accessibleLabel,
  };
}

export function unitCountDisplay(
  player: PlayerView,
  type: UnitType,
  config: Pick<Config, "depthProgressionEnabled" | "effectivePortLevels">,
): UnitCountDisplay {
  const aggregateLevels = player.totalUnitLevels(type);
  if (
    config.depthProgressionEnabled?.() !== true ||
    !DepthProgressionStructures.has(type)
  ) {
    return formatUnitCountDisplay(aggregateLevels);
  }
  const effectiveLevels =
    type === UnitType.Port
      ? config.effectivePortLevels(player)
      : player
          .units(type)
          .filter((unit) => !unit.isUnderConstruction())
          .reduce(
            (sum, unit) =>
              sum +
              Math.max(
                0,
                Math.min(DEPTH_STRUCTURE_MAX_LEVEL, Math.floor(unit.level())),
              ),
            0,
          );
  if (type !== UnitType.Port) {
    const physicalCount = player.completedUnitCount(type);
    return {
      ...formatUnitCountDisplay(physicalCount, effectiveLevels),
      accessibleLabel: translateText(
        "depth_progression.completed_structure_count",
        {
          aggregate_levels: effectiveLevels,
          physical_count: physicalCount,
        },
      ),
    };
  }
  return formatUnitCountDisplay(
    player.completedUnitCount(type),
    effectiveLevels,
  );
}
