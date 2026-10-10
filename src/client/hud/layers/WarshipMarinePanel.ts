import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import {
  UnitType,
  WARSHIP_MARINE_CAPACITY,
  WARSHIP_MARINE_DOCK_RADIUS,
  WARSHIP_MARINE_LEVEL_SIZE,
  warshipBoardingLevel,
} from "../../../core/game/Game";
import { ClientEnv } from "../../ClientEnv";
import { Controller } from "../../Controller";
import { UnitSelectionEvent } from "../../InputHandler";
import { SetWarshipCargoIntentEvent } from "../../Transport";
import { translateText } from "../../Utils";
import { GameView, UnitView } from "../../view";

type CargoControl = { disabled: boolean; reason: string };

export function warshipCargoControl(
  game: GameView,
  warship: UnitView,
  targetCargo: number,
): CargoControl {
  const player = game.myPlayer();
  if (
    player === null ||
    warship.owner().id() !== player.id() ||
    !warship.isActive() ||
    warship.markedForDeletion() !== false ||
    warship.isUnderConstruction()
  ) {
    return {
      disabled: true,
      reason: translateText("depth_progression.marine_unavailable"),
    };
  }
  if (warship.isInCombat()) {
    return {
      disabled: true,
      reason: translateText("depth_progression.marine_in_combat"),
    };
  }
  const docked = game
    .nearbyUnits(warship.tile(), WARSHIP_MARINE_DOCK_RADIUS, UnitType.Port)
    .some(
      ({ unit: port }) =>
        port.isActive() &&
        port.markedForDeletion() === false &&
        !port.isUnderConstruction() &&
        (port.owner().id() === player.id() ||
          port.owner().isFriendly(player)) &&
        game.euclideanDistSquared(warship.tile(), port.tile()) <=
          WARSHIP_MARINE_DOCK_RADIUS ** 2,
    );
  if (!docked) {
    return {
      disabled: true,
      reason: translateText("depth_progression.marine_dock_required"),
    };
  }
  const delta = targetCargo - warship.troops();
  if (delta > player.troops()) {
    return {
      disabled: true,
      reason: translateText("depth_progression.marine_insufficient"),
    };
  }
  if (delta === 0) {
    return {
      disabled: true,
      reason: translateText("depth_progression.marine_current"),
    };
  }
  return { disabled: false, reason: "" };
}

@customElement("warship-marine-panel")
export class WarshipMarinePanel extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;

  @state()
  private selectedUnitId: number | null = null;

  createRenderRoot() {
    return this;
  }

  init() {
    this.eventBus.on(UnitSelectionEvent, (event) => {
      const unit = event.isSelected ? event.unit : null;
      const myPlayer = this.game.myPlayer();
      this.selectedUnitId =
        unit?.type() === UnitType.Warship &&
        myPlayer !== null &&
        unit.owner().id() === myPlayer.id()
          ? unit.id()
          : null;
      this.requestUpdate();
    });
  }

  tick() {
    if (this.selectedUnitId !== null) this.requestUpdate();
  }

  private selectedWarship(): UnitView | null {
    if (
      !this.game ||
      this.game.config().depthProgressionEnabled?.() !== true ||
      this.selectedUnitId === null
    ) {
      return null;
    }
    const unit = this.game.unit(this.selectedUnitId);
    return unit?.type() === UnitType.Warship && unit.isActive() ? unit : null;
  }

  private setCargo(warship: UnitView, targetCargo: number) {
    this.eventBus.emit(
      new SetWarshipCargoIntentEvent(warship.id(), targetCargo),
    );
  }

  render() {
    const warship = this.selectedWarship();
    if (warship === null) return nothing;
    const cargo = Math.min(WARSHIP_MARINE_CAPACITY, warship.troops());
    const level = warshipBoardingLevel(cargo);
    const targets = [
      0,
      WARSHIP_MARINE_LEVEL_SIZE,
      WARSHIP_MARINE_LEVEL_SIZE * 2,
      WARSHIP_MARINE_LEVEL_SIZE * 3,
      WARSHIP_MARINE_LEVEL_SIZE * 4,
      WARSHIP_MARINE_CAPACITY,
    ];

    return html`<section
      data-local-matte=${ClientEnv.isLocalOnly() ? "hud" : nothing}
      data-ui-audit-root=${ClientEnv.isLocalOnly() ? "hud" : nothing}
      data-warship-marine-panel
      class="border-t border-slate-600 bg-slate-900 text-slate-100 px-2 py-1.5"
    >
      <div
        class="flex items-center justify-between gap-2 text-xs font-semibold"
      >
        <span>${translateText("depth_progression.marine_title")}</span>
        <span translate="no"
          >${cargo.toLocaleString()} /
          ${WARSHIP_MARINE_CAPACITY.toLocaleString()} ·
          ${level === 0
            ? translateText("depth_progression.marine_unloaded")
            : translateText("depth_progression.marine_boarding", {
                level,
              })}
          · V${warship.veterancy()}</span
        >
      </div>
      <div class="mt-1 grid grid-cols-3 sm:grid-cols-6 gap-1">
        ${targets.map((target, index) => {
          const control = warshipCargoControl(this.game, warship, target);
          const reasonId = `warship-cargo-reason-${target}`;
          const label =
            index === 0
              ? translateText("depth_progression.marine_unload")
              : translateText("depth_progression.marine_level", {
                  level: index,
                  target: target.toLocaleString(),
                });
          return html`<button
            class="min-h-10 rounded border px-2 py-1 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 ${control.disabled
              ? "cursor-not-allowed border-slate-700 bg-slate-800 text-slate-400"
              : "border-slate-500 bg-slate-700 hover:border-slate-300 hover:bg-slate-600"}"
            data-cargo-target=${target}
            data-disabled-reason=${control.reason || nothing}
            title=${control.reason || nothing}
            aria-label=${label}
            aria-describedby=${control.disabled ? reasonId : nothing}
            aria-disabled=${control.disabled ? "true" : "false"}
            @click=${() => {
              if (!control.disabled) this.setCargo(warship, target);
            }}
          >
            ${label}
            ${control.reason
              ? html`<span
                  id=${reasonId}
                  class="mt-0.5 block text-[11px] font-normal leading-tight text-slate-300"
                  >${control.reason}</span
                >`
              : nothing}
          </button>`;
        })}
      </div>
    </section>`;
  }
}
