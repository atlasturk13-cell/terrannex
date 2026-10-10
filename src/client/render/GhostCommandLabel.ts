import { translateText } from "../Utils";
import type { GhostPreviewData } from "./types";

/** Short status line rendered above the ghost's next-placement cost. */
export function ghostCommandTopText(
  data: GhostPreviewData | null,
): string | undefined {
  if (data?.remainingTargetSelections && data.remainingTargetSelections > 0) {
    return translateText("build_menu.quantity.rocket_targets_left", {
      amount: data.remainingTargetSelections.toString(),
    });
  }
  if (data?.remainingPlacements && data.remainingPlacements > 0) {
    return translateText("build_menu.quantity.placements_left", {
      amount: data.remainingPlacements.toString(),
    });
  }
  if (data?.multiplier && data.multiplier > 1) {
    return translateText("build_menu.upgrade_amount", {
      amount: data.multiplier.toString(),
    });
  }
  return undefined;
}
