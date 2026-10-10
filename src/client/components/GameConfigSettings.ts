import {
  LitElement,
  SVGTemplateResult,
  TemplateResult,
  html,
  nothing,
  svg,
} from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  DOOMSDAY_CLOCK_SPEEDS,
  DoomsdayClockSpeed,
} from "../../core/game/DoomsdayClock";
import {
  Difficulty,
  Duos,
  GameMapType,
  GameMode,
  HumansVsNations,
  Quads,
  Trios,
  UnitType,
} from "../../core/game/Game";
import { TeamCountConfig } from "../../core/Schemas";
import { translateText } from "../Utils";
import "./Difficulties";
import "./FluentSlider";
import "./map/MapPicker";

let gameConfigSettingsInstance = 0;

const ACTIVE_CARD =
  "bg-malibu-blue/20 border-malibu-blue/50 shadow-[var(--shadow-malibu-blue)]";
const INACTIVE_CARD =
  "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20";

const DISABLED_CARD =
  "w-full rounded-xl border transition-all duration-200 opacity-30 grayscale cursor-not-allowed bg-white/5 border-white/5";

function cardClass(active: boolean, extra = ""): string {
  return `w-full rounded-xl border cursor-pointer transition-all duration-200 active:scale-95 ${extra} ${active ? ACTIVE_CARD : INACTIVE_CARD}`;
}

const CARD_LABEL_CLASS =
  "text-xs uppercase font-bold tracking-wider leading-tight break-words hyphens-auto";
const CARD_DESCRIPTION_CLASS =
  "text-[11px] font-normal normal-case tracking-normal leading-4 text-center text-white/65";

const DIFFICULTY_OPTIONS = Object.entries(Difficulty).filter(([key]) =>
  isNaN(Number(key)),
) as Array<[string, Difficulty]>;
const TEAM_COUNT_OPTIONS: TeamCountConfig[] = [
  2,
  3,
  4,
  5,
  6,
  7,
  Quads,
  Trios,
  Duos,
  HumansVsNations,
];

const LOCAL_MAP_DESCRIPTION_KEYS: Partial<Record<GameMapType, string>> = {
  [GameMapType.AfricaMiddleEast]: "game_settings.map_africa_middle_east_desc",
  [GameMapType.AsiaPacific]: "game_settings.map_asia_pacific_desc",
  [GameMapType.EuropeMediterranean]:
    "game_settings.map_europe_mediterranean_desc",
  [GameMapType.NaturalEarthWorld]: "game_settings.map_natural_earth_desc",
  [GameMapType.NaturalEarthSouthAmerica]:
    "game_settings.map_south_america_desc",
  [GameMapType.NorthAmericaCaribbean]:
    "game_settings.map_north_america_caribbean_desc",
  [GameMapType.TheBox]: "game_settings.map_the_box_desc",
};

const DIFFICULTY_DESCRIPTION_KEYS: Record<Difficulty, string> = {
  [Difficulty.Easy]: "game_settings.difficulty_easy_desc",
  [Difficulty.Medium]: "game_settings.difficulty_medium_desc",
  [Difficulty.Hard]: "game_settings.difficulty_hard_desc",
  [Difficulty.Impossible]: "game_settings.difficulty_impossible_desc",
};

const MODE_DESCRIPTION_KEYS: Record<GameMode, string> = {
  [GameMode.FFA]: "game_settings.mode_ffa_desc",
  [GameMode.Team]: "game_settings.mode_teams_desc",
};

function stateTextClass(active: boolean): string {
  return active ? "text-white" : "text-white/60";
}

interface TextCardButtonConfig {
  label: string;
  description?: string;
  active: boolean;
  onClick: () => void;
  cardExtraClass: string;
  labelId: string;
  descriptionId: string;
  localMatte?: boolean;
  settingKind?: string;
}

function renderTextCardButton({
  label,
  description,
  active,
  onClick,
  cardExtraClass,
  labelId,
  descriptionId,
  localMatte = false,
  settingKind,
}: TextCardButtonConfig): TemplateResult {
  return html`
    <button
      type="button"
      data-local-matte=${localMatte ? "subpanel" : nothing}
      data-setting-option=${settingKind ?? nothing}
      aria-pressed=${active}
      aria-labelledby=${labelId}
      aria-describedby=${description ? descriptionId : nothing}
      class="${cardClass(active, cardExtraClass)} ${description
        ? "min-h-24 flex flex-col items-center justify-center gap-1"
        : "flex items-center justify-center"}"
      @click=${onClick}
    >
      <span id=${labelId} class="${CARD_LABEL_CLASS} ${stateTextClass(active)}">
        ${label}
      </span>
      ${description
        ? html`<span id=${descriptionId} class=${CARD_DESCRIPTION_CLASS}>
            ${description}
          </span>`
        : nothing}
    </button>
  `;
}

function renderSection(
  iconSvg: SVGTemplateResult,
  colorClass: string,
  bgClass: string,
  titleKey: string,
  content: TemplateResult | TemplateResult[],
  sectionClass = "space-y-6",
  headerAction?: TemplateResult,
  localMatte = false,
): TemplateResult {
  return html`
    <section
      class=${sectionClass}
      data-local-matte=${localMatte ? "subpanel" : nothing}
    >
      ${renderSectionHeader(
        iconSvg,
        colorClass,
        bgClass,
        titleKey,
        headerAction,
      )}
      ${content}
    </section>
  `;
}

const unitOptions: {
  type: UnitType;
  translationKey: string;
  descriptionKey: string;
}[] = [
  {
    type: UnitType.City,
    translationKey: "unit_type.city",
    descriptionKey: "game_settings.unit_city_desc",
  },
  {
    type: UnitType.Barracks,
    translationKey: "unit_type.barracks",
    descriptionKey: "game_settings.unit_barracks_desc",
  },
  {
    type: UnitType.DefensePost,
    translationKey: "unit_type.defense_post",
    descriptionKey: "game_settings.unit_defense_post_desc",
  },
  {
    type: UnitType.Port,
    translationKey: "unit_type.port",
    descriptionKey: "game_settings.unit_port_desc",
  },
  {
    type: UnitType.Warship,
    translationKey: "unit_type.warship",
    descriptionKey: "game_settings.unit_warship_desc",
  },
  {
    type: UnitType.FighterJet,
    translationKey: "unit_type.fighter_jet",
    descriptionKey: "game_settings.unit_fighter_jet_desc",
  },
  {
    type: UnitType.Airport,
    translationKey: "unit_type.airport",
    descriptionKey: "game_settings.unit_airport_desc",
  },
  {
    type: UnitType.TransportShip,
    translationKey: "unit_type.boat",
    descriptionKey: "game_settings.unit_boat_desc",
  },
  {
    type: UnitType.MissileSilo,
    translationKey: "unit_type.missile_silo",
    descriptionKey: "game_settings.unit_missile_silo_desc",
  },
  {
    type: UnitType.SAMLauncher,
    translationKey: "unit_type.sam_launcher",
    descriptionKey: "game_settings.unit_sam_launcher_desc",
  },
  {
    type: UnitType.AtomBomb,
    translationKey: "unit_type.atom_bomb",
    descriptionKey: "game_settings.unit_atom_bomb_desc",
  },
  {
    type: UnitType.HydrogenBomb,
    translationKey: "unit_type.hydrogen_bomb",
    descriptionKey: "game_settings.unit_hydrogen_bomb_desc",
  },
  {
    type: UnitType.MIRV,
    translationKey: "unit_type.mirv",
    descriptionKey: "game_settings.unit_mirv_desc",
  },
  {
    type: UnitType.Factory,
    translationKey: "unit_type.factory",
    descriptionKey: "game_settings.unit_factory_desc",
  },
];

const MAP_ICON = svg`<path
  d="M21.731 2.269a2.625 2.625 0 00-3.712 0l-1.157 1.157 3.712 3.712 1.157-1.157a2.625 2.625 0 000-3.712zM19.513 8.199l-3.712-3.712-12.15 12.15a5.25 5.25 0 00-1.32 2.214l-.8 2.685a.75.75 0 00.933.933l2.685-.8a5.25 5.25 0 002.214-1.32L19.513 8.2z"
/>`;

const DIFFICULTY_ICON = svg`<path
  fill-rule="evenodd"
  d="M12.97 3.97a.75.75 0 011.06 0l7.5 7.5a.75.75 0 010 1.06l-7.5 7.5a.75.75 0 11-1.06-1.06l6.22-6.22H3a.75.75 0 010-1.5h16.19l-6.22-6.22a.75.75 0 010-1.06z"
  clip-rule="evenodd"
/>`;

const MODE_ICON = svg`<path
  d="M11.25 4.533A9.707 9.707 0 006 3a9.735 9.735 0 00-3.25.555.75.75 0 00-.5.707v14.25a.75.75 0 001 .707A8.237 8.237 0 016 18.75c1.995 0 3.823.707 5.25 1.886V4.533zM12.75 20.636A8.214 8.214 0 0118 18.75c.966 0 1.89.166 2.75.47a.75.75 0 001-.708V4.262a.75.75 0 00-.5-.707A9.735 9.735 0 0018 3a9.707 9.707 0 00-5.25 1.533v16.103z"
/>`;

const OPTIONS_ICON = svg`<path
  fill-rule="evenodd"
  d="M11.078 2.25c-.917 0-1.699.663-1.85 1.567L9.05 4.889c-.02.12-.115.26-.297.348a7.493 7.493 0 00-.986.57c-.166.115-.334.126-.45.083L6.3 5.508a1.875 1.875 0 00-2.282.819l-.922 1.597a1.875 1.875 0 00.432 2.385l.84.692c.095.078.17.229.154.43a7.598 7.598 0 000 1.139c.015.2-.059.352-.153.43l-.841.692a1.875 1.875 0 00-.432 2.385l.922 1.597a1.875 1.875 0 002.282.818l1.019-.382c.115-.043.283-.031.45.082.312.214.641.405.985.57.182.088.277.228.297.35l.178 1.071c.151.904.933 1.567 1.85 1.567h1.844c.916 0 1.699-.663 1.85-1.567l.178-1.072c.02-.12.114-.26.297-.349.344-.165.673-.356.985-.57.167-.114.335-.125.45-.082l1.02.382a1.875 1.875 0 002.28-.819l.922-1.597a1.875 1.875 0 00-.432-2.385l-.84-.692c-.095-.078-.17-.229-.154-.43a7.614 7.614 0 000-1.139c-.016-.2.059-.352.153-.43l.84-.692c.708-.582.891-1.59.433-2.385l-.922-1.597a1.875 1.875 0 00-2.282-.818l-1.02.382c-.114.043-.282.031-.449-.083a7.49 7.49 0 00-.985-.57c-.183-.087-.277-.227-.297-.348l-.179-1.072a1.875 1.875 0 00-1.85-1.567h-1.843zM12 15.75a3.75 3.75 0 100-7.5 3.75 3.75 0 000 7.5z"
  clip-rule="evenodd"
/>`;

const HOST_CHEATS_ICON = svg`<path
  fill-rule="evenodd"
  d="M10.788 3.21c.448-1.077 1.976-1.077 2.424 0l2.082 5.006 5.404.434c1.164.093 1.636 1.545.749 2.305l-4.117 3.527 1.257 5.273c.271 1.136-.964 2.033-1.96 1.425L12 18.354 7.373 21.18c-.996.608-2.231-.29-1.96-1.425l1.257-5.273-4.117-3.527c-.887-.76-.415-2.212.749-2.305l5.404-.434 2.082-5.005Z"
  clip-rule="evenodd"
/>`;

const ENABLES_ICON = svg`<path
  fill-rule="evenodd"
  d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25zm0 8.625a1.125 1.125 0 100 2.25 1.125 1.125 0 000-2.25zM15.375 12a1.125 1.125 0 112.25 0 1.125 1.125 0 01-2.25 0zM7.5 10.875a1.125 1.125 0 100 2.25 1.125 1.125 0 000-2.25z"
  clip-rule="evenodd"
/>`;

function renderSectionHeader(
  iconSvg: SVGTemplateResult,
  colorClass: string,
  bgClass: string,
  titleKey: string,
  headerAction?: TemplateResult,
): TemplateResult {
  return html`
    <div
      class="flex flex-wrap items-center gap-3 pb-2 border-b border-white/10"
    >
      <div
        class="w-8 h-8 rounded-lg flex items-center justify-center ${bgClass} ${colorClass}"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="currentColor"
          class="w-5 h-5"
        >
          ${iconSvg}
        </svg>
      </div>
      <h3
        class="min-w-0 flex-1 text-lg font-bold text-white uppercase tracking-wider"
      >
        ${translateText(titleKey)}
      </h3>
      ${headerAction
        ? html`<div class="w-full sm:ml-auto sm:w-auto">${headerAction}</div>`
        : null}
    </div>
  `;
}

export interface ToggleOptionConfig {
  labelKey: string;
  descriptionKey?: string;
  checked: boolean;
  hidden?: boolean;
  // When set, this toggle's card expands to a pace dropdown while it is checked.
  doomsdayClockSpeed?: DoomsdayClockSpeed;
}

export interface GameConfigSettingsData {
  map: {
    selected: GameMapType;
    useRandom: boolean;
    randomMapDivider?: boolean;
    allowedMaps?: readonly GameMapType[];
    hideRandomMap?: boolean;
    showMedals?: boolean;
    mapWins?: Map<GameMapType, Set<Difficulty>>;
  };
  difficulty: {
    selected: Difficulty;
    disabled: boolean;
  };
  gameMode: {
    selected: GameMode;
  };
  teamCount: {
    selected: TeamCountConfig;
  };
  options: {
    titleKey: string;
    bots: {
      value: number;
      labelKey: string;
      descriptionKey?: string;
      disabledKey: string;
    };
    nations?: {
      value: number;
      defaultValue?: number;
      labelKey: string;
      descriptionKey?: string;
      disabledKey: string;
      hidden?: boolean;
    };
    toggles: ToggleOptionConfig[];
    inputCards: TemplateResult[];
  };
  hostCheats?: {
    titleKey: string;
    visible: boolean;
    toggles: ToggleOptionConfig[];
    inputCards: TemplateResult[];
  };
  unitTypes: {
    titleKey: string;
    disabledUnits: UnitType[];
  };
}

@customElement("game-config-settings")
export class GameConfigSettings extends LitElement {
  @property({ attribute: false }) settings?: GameConfigSettingsData;
  @property({ attribute: false }) sectionGapClass = "space-y-6";
  @property({ type: Boolean, attribute: false }) localMatte = false;
  /**
   * Which part to render: the match basics (map, difficulty, mode, teams),
   * the advanced rules (options, units), or both (default).
   */
  @property({ attribute: false }) sections: "all" | "core" | "advanced" = "all";
  @state() private mapSearchQuery = "";
  private readonly accessibilityId = `game-config-settings-${++gameConfigSettingsInstance}`;

  createRenderRoot() {
    return this;
  }

  private optionId(scope: string, key: string, part: "label" | "description") {
    const safeKey = key.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    return `${this.accessibilityId}-${scope}-${safeKey}-${part}`;
  }

  private emit<T>(name: string, detail: T) {
    this.dispatchEvent(
      new CustomEvent(name, {
        detail,
        bubbles: true,
        composed: true,
      }),
    );
  }

  private handleMapSearchInput = (event: Event) => {
    const input = event.target as HTMLInputElement;
    this.mapSearchQuery = input.value;
  };

  private clearMapSearch = () => {
    this.mapSearchQuery = "";
  };

  private handleSelectMap = (map: GameMapType) => {
    this.emit("map-selected", { map });
  };

  private handleSelectRandom = () => {
    this.emit("random-map-selected", {});
  };

  private handleDifficultySelect = (difficulty: Difficulty) => {
    this.emit("difficulty-selected", { difficulty });
  };

  private handleDoomsdayClockSpeedChange = (e: Event) => {
    const speed = (e.target as HTMLSelectElement).value as DoomsdayClockSpeed;
    this.emit("doomsday-clock-speed-selected", { speed });
  };

  private handleGameModeSelect = (mode: GameMode) => {
    this.emit("game-mode-selected", { mode });
  };

  private handleTeamCountSelect = (count: TeamCountConfig) => {
    this.emit("team-count-selected", { count });
  };

  private handleOptionToggle = (toggle: ToggleOptionConfig) => {
    this.emit("option-toggle-changed", {
      labelKey: toggle.labelKey,
      checked: !toggle.checked,
    });
  };

  private handleBotsChanged = (event: Event) => {
    const customEvent = event as CustomEvent<{ value: number }>;
    this.emit("bots-changed", customEvent.detail);
  };

  private handleNationsChanged = (event: Event) => {
    const customEvent = event as CustomEvent<{ value: number }>;
    this.emit("nations-changed", customEvent.detail);
  };

  private handleHostCheatToggle = (toggle: ToggleOptionConfig) => {
    this.emit("host-cheat-toggle-changed", {
      labelKey: toggle.labelKey,
      checked: !toggle.checked,
    });
  };

  private handleUnitToggle = (unit: UnitType, checked: boolean) => {
    this.emit("unit-toggle-changed", { unit, checked });
  };

  private renderOptionToggle(toggle: ToggleOptionConfig): TemplateResult {
    if (toggle.hidden) return html``;

    if (toggle.doomsdayClockSpeed !== undefined) {
      return this.renderDoomsdayClockToggle(toggle);
    }

    const labelId = this.optionId("rule", toggle.labelKey, "label");
    const descriptionId = this.optionId("rule", toggle.labelKey, "description");
    return renderTextCardButton({
      label: translateText(toggle.labelKey),
      description: toggle.descriptionKey
        ? translateText(toggle.descriptionKey)
        : undefined,
      active: toggle.checked,
      onClick: () => this.handleOptionToggle(toggle),
      cardExtraClass: "p-4 text-center",
      labelId,
      descriptionId,
      localMatte: this.localMatte,
      settingKind: toggle.descriptionKey ? "rule" : undefined,
    });
  }

  // Keep the toggle and speed selector as separate keyboard controls.
  private renderDoomsdayClockToggle(
    toggle: ToggleOptionConfig,
  ): TemplateResult {
    const selected = toggle.doomsdayClockSpeed;
    const labelId = this.optionId("rule", toggle.labelKey, "label");
    const descriptionId = this.optionId("rule", toggle.labelKey, "description");
    const speedLabelId = `${this.accessibilityId}-doomsday-speed-label`;
    const speedDescriptionId = `${this.accessibilityId}-doomsday-speed-description`;
    return html`
      <div
        data-local-matte=${this.localMatte ? "subpanel" : nothing}
        class="${cardClass(
          toggle.checked,
          toggle.descriptionKey
            ? "min-h-24 flex flex-col items-center justify-center text-center cursor-default"
            : "flex flex-col items-center justify-center text-center cursor-default",
        )}"
      >
        <button
          type="button"
          data-setting-option=${toggle.descriptionKey ? "rule" : nothing}
          aria-pressed=${toggle.checked}
          aria-labelledby=${labelId}
          aria-describedby=${toggle.descriptionKey ? descriptionId : nothing}
          class="flex w-full flex-1 flex-col items-center justify-center gap-1 ${toggle.descriptionKey
            ? "p-3"
            : "p-4"}"
          @click=${() => this.handleOptionToggle(toggle)}
        >
          <span
            id=${labelId}
            class="${CARD_LABEL_CLASS} ${stateTextClass(toggle.checked)}"
          >
            ${translateText(toggle.labelKey)}
          </span>
          ${toggle.descriptionKey
            ? html`<span id=${descriptionId} class=${CARD_DESCRIPTION_CLASS}>
                ${translateText(toggle.descriptionKey)}
              </span>`
            : nothing}
        </button>
        ${toggle.checked
          ? html`
              <div class="flex w-full flex-col items-center gap-1 px-3 pb-3">
                <span
                  id=${speedLabelId}
                  class="text-[11px] font-bold uppercase tracking-wider text-white/80"
                >
                  ${translateText("game_settings.doomsday_clock_speed")}
                </span>
                <select
                  data-setting-secondary="doomsday-speed"
                  aria-labelledby=${speedLabelId}
                  aria-describedby=${toggle.descriptionKey
                    ? speedDescriptionId
                    : nothing}
                  class="max-w-full bg-white/10 border border-white/20 rounded-lg px-2 py-1 text-white text-xs"
                  @change=${this.handleDoomsdayClockSpeedChange}
                >
                  ${DOOMSDAY_CLOCK_SPEEDS.map(
                    (speed) => html`
                      <option value=${speed} ?selected=${selected === speed}>
                        ${translateText(`doomsday_clock_speed.${speed}`)}
                      </option>
                    `,
                  )}
                </select>
                ${toggle.descriptionKey
                  ? html`<span
                      id=${speedDescriptionId}
                      class=${CARD_DESCRIPTION_CLASS}
                    >
                      ${translateText(
                        "game_settings.doomsday_clock_speed_desc",
                      )}
                    </span>`
                  : nothing}
              </div>
            `
          : nothing}
      </div>
    `;
  }

  private renderUnitTypeOptions(disabledUnits: UnitType[]): TemplateResult[] {
    return unitOptions.map(({ type, translationKey, descriptionKey }) => {
      const isEnabled = !disabledUnits.includes(type);
      const labelId = this.optionId("unit", translationKey, "label");
      const descriptionId = this.optionId(
        "unit",
        translationKey,
        "description",
      );
      return html`
        <button
          type="button"
          data-local-matte=${this.localMatte ? "subpanel" : nothing}
          data-setting-option=${this.localMatte ? "unit" : nothing}
          class="${cardClass(
            isEnabled,
            this.localMatte
              ? "min-h-24 p-3 text-center flex flex-col items-center justify-center gap-1"
              : "p-4 text-center",
          )}"
          aria-pressed=${isEnabled}
          aria-labelledby=${labelId}
          aria-describedby=${this.localMatte ? descriptionId : nothing}
          @click=${() => this.handleUnitToggle(type, isEnabled)}
        >
          <span
            id=${labelId}
            class="${CARD_LABEL_CLASS} ${stateTextClass(isEnabled)}"
          >
            ${translateText(translationKey)}
          </span>
          ${this.localMatte
            ? html`<span id=${descriptionId} class=${CARD_DESCRIPTION_CLASS}>
                ${translateText(descriptionKey)}
              </span>`
            : nothing}
        </button>
      `;
    });
  }

  private renderMapSearchInput(): TemplateResult {
    return html`<div class="relative w-full sm:w-48">
      <input
        type="text"
        aria-label=${translateText("map_component.search_maps")}
        placeholder="${translateText("map_component.search_maps")}"
        .value=${this.mapSearchQuery}
        @input=${this.handleMapSearchInput}
        class="w-full px-3 py-1.5 pl-8 pr-7 rounded-lg text-sm bg-transparent border border-white/10 text-white placeholder-white/40 focus:outline-none focus:border-malibu-blue/50 transition-all"
      />
      <svg
        class="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path
          fill-rule="evenodd"
          d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z"
          clip-rule="evenodd"
        />
      </svg>
      ${this.mapSearchQuery
        ? html`<button
            type="button"
            aria-label=${translateText("map_component.clear_search")}
            @click=${this.clearMapSearch}
            class="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-full text-white/40 hover:text-white hover:bg-white/10 transition-all"
          >
            <svg
              class="w-3 h-3"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"
              />
            </svg>
          </button>`
        : null}
    </div>`;
  }

  render() {
    if (!this.settings) return nothing;
    const settings = this.settings;

    return html`
      <div
        class=${this.sectionGapClass}
        data-ui-audit-root=${this.localMatte ? "setup" : nothing}
      >
        ${this.sections !== "advanced"
          ? html`
              ${renderSection(
                MAP_ICON,
                "text-aquarius",
                "bg-malibu-blue/20",
                "map.map",
                html`<map-picker
                  .selectedMap=${settings.map.selected}
                  .useRandomMap=${settings.map.useRandom}
                  .randomMapDivider=${settings.map.randomMapDivider ?? false}
                  .allowedMaps=${settings.map.allowedMaps}
                  .hideRandomMap=${settings.map.hideRandomMap ?? false}
                  .showMedals=${settings.map.showMedals ?? false}
                  .mapWins=${settings.map.mapWins ?? new Map()}
                  .descriptionKeys=${this.localMatte
                    ? LOCAL_MAP_DESCRIPTION_KEYS
                    : undefined}
                  .onSelectMap=${this.handleSelectMap}
                  .onSelectRandom=${this.handleSelectRandom}
                  .searchQuery=${this.mapSearchQuery}
                  .localMatte=${this.localMatte}
                ></map-picker>`,
                undefined,
                this.renderMapSearchInput(),
                this.localMatte,
              )}
              ${renderSection(
                DIFFICULTY_ICON,
                "text-green-400",
                "bg-green-500/20",
                "difficulty.difficulty",
                html`
                  <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                    ${DIFFICULTY_OPTIONS.map(([key, value]) => {
                      const isSelected = settings.difficulty.selected === value;
                      const isDisabled = settings.difficulty.disabled;
                      const labelId = this.optionId(
                        "difficulty",
                        String(value),
                        "label",
                      );
                      const descriptionId = this.optionId(
                        "difficulty",
                        String(value),
                        "description",
                      );
                      return html`
                        <button
                          type="button"
                          data-local-matte=${this.localMatte && !isDisabled
                            ? "subpanel"
                            : nothing}
                          data-setting-option=${this.localMatte
                            ? "difficulty"
                            : nothing}
                          aria-pressed=${isSelected}
                          aria-labelledby=${labelId}
                          aria-describedby=${this.localMatte
                            ? descriptionId
                            : nothing}
                          ?disabled=${isDisabled}
                          @click=${() =>
                            !isDisabled &&
                            this.handleDifficultySelect(value as Difficulty)}
                          class="${isDisabled
                            ? `${DISABLED_CARD} ${
                                this.localMatte
                                  ? "min-h-32 flex flex-col items-center justify-center p-4 gap-2"
                                  : "flex flex-col items-center p-4 gap-3"
                              }`
                            : cardClass(
                                isSelected,
                                this.localMatte
                                  ? "min-h-32 flex flex-col items-center justify-center p-4 gap-2"
                                  : "flex flex-col items-center p-4 gap-3",
                              )}"
                        >
                          <difficulty-display
                            .difficultyKey=${key}
                            class="transform scale-125 origin-center ${isDisabled
                              ? "pointer-events-none"
                              : ""}"
                          ></difficulty-display>
                          <span
                            id=${labelId}
                            class="${CARD_LABEL_CLASS} text-center mt-1 text-white"
                          >
                            ${translateText(`difficulty.${key.toLowerCase()}`)}
                          </span>
                          ${this.localMatte
                            ? html`<span
                                id=${descriptionId}
                                class=${CARD_DESCRIPTION_CLASS}
                              >
                                ${translateText(
                                  DIFFICULTY_DESCRIPTION_KEYS[value],
                                )}
                              </span>`
                            : nothing}
                        </button>
                      `;
                    })}
                  </div>
                `,
                undefined,
                undefined,
                this.localMatte,
              )}
              ${renderSection(
                MODE_ICON,
                "text-purple-400",
                "bg-purple-500/20",
                "host_modal.mode",
                html`
                  <div class="grid grid-cols-2 gap-4">
                    ${[GameMode.FFA, GameMode.Team].map((mode) => {
                      const isSelected = settings.gameMode.selected === mode;
                      const labelId = this.optionId("mode", mode, "label");
                      const descriptionId = this.optionId(
                        "mode",
                        mode,
                        "description",
                      );
                      return html`
                        <button
                          type="button"
                          data-local-matte=${this.localMatte
                            ? "subpanel"
                            : nothing}
                          data-setting-option=${this.localMatte
                            ? "mode"
                            : nothing}
                          aria-pressed=${isSelected}
                          aria-labelledby=${labelId}
                          aria-describedby=${this.localMatte
                            ? descriptionId
                            : nothing}
                          class="${cardClass(
                            isSelected,
                            this.localMatte
                              ? "min-h-28 px-3 py-5 text-center flex flex-col items-center justify-center gap-1"
                              : "py-6 text-center",
                          )}"
                          @click=${() => this.handleGameModeSelect(mode)}
                        >
                          <span
                            id=${labelId}
                            class="text-sm font-bold text-white uppercase tracking-widest"
                          >
                            ${mode === GameMode.FFA
                              ? translateText("game_mode.ffa")
                              : translateText("game_mode.teams")}
                          </span>
                          ${this.localMatte
                            ? html`<span
                                id=${descriptionId}
                                class=${CARD_DESCRIPTION_CLASS}
                              >
                                ${translateText(MODE_DESCRIPTION_KEYS[mode])}
                              </span>`
                            : nothing}
                        </button>
                      `;
                    })}
                  </div>
                `,
                undefined,
                undefined,
                this.localMatte,
              )}
              ${settings.gameMode.selected === GameMode.FFA
                ? nothing
                : html`
                    <section class="space-y-6">
                      <div class="mb-4 pl-2">
                        <div
                          class="text-xs font-bold text-white/40 uppercase tracking-widest"
                        >
                          ${translateText("host_modal.team_count")}
                        </div>
                        ${this.localMatte
                          ? html`<div
                              id=${`${this.accessibilityId}-team-count-description`}
                              class="mt-1 text-xs leading-4 text-white/65"
                            >
                              ${translateText("game_settings.team_count_desc")}
                            </div>`
                          : nothing}
                      </div>
                      <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
                        ${TEAM_COUNT_OPTIONS.map((o) => {
                          const isSelected = settings.teamCount.selected === o;
                          const labelId = this.optionId(
                            "team",
                            String(o),
                            "label",
                          );
                          return html`
                            <button
                              type="button"
                              data-local-matte=${this.localMatte
                                ? "subpanel"
                                : nothing}
                              data-setting-option=${this.localMatte
                                ? "team"
                                : nothing}
                              aria-pressed=${isSelected}
                              aria-labelledby=${labelId}
                              aria-describedby=${this.localMatte
                                ? `${this.accessibilityId}-team-count-description`
                                : nothing}
                              class="${cardClass(
                                isSelected,
                                "min-h-16 px-3 py-3 text-center",
                              )}"
                              @click=${() => this.handleTeamCountSelect(o)}
                            >
                              <span
                                id=${labelId}
                                class="${CARD_LABEL_CLASS} text-white"
                              >
                                ${typeof o === "string"
                                  ? o === HumansVsNations
                                    ? translateText("public_lobby.teams_hvn")
                                    : translateText(`host_modal.teams_${o}`)
                                  : translateText("public_lobby.teams", {
                                      num: o,
                                    })}
                              </span>
                            </button>
                          `;
                        })}
                      </div>
                    </section>
                  `}
            `
          : nothing}
        ${this.sections !== "core"
          ? html`
              ${renderSection(
                OPTIONS_ICON,
                "text-orange-400",
                "bg-orange-500/20",
                settings.options.titleKey,
                html`
                  <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <div
                      data-local-matte=${this.localMatte ? "subpanel" : nothing}
                      class="col-span-2 rounded-xl p-4 flex flex-col justify-center border transition-all duration-200 ${settings
                        .options.bots.value > 0
                        ? ACTIVE_CARD
                        : INACTIVE_CARD}"
                    >
                      <fluent-slider
                        min="0"
                        max="400"
                        step="1"
                        .value=${settings.options.bots.value}
                        labelKey=${settings.options.bots.labelKey}
                        descriptionKey=${settings.options.bots.descriptionKey ??
                        ""}
                        disabledKey=${settings.options.bots.disabledKey}
                        @value-changed=${this.handleBotsChanged}
                      ></fluent-slider>
                    </div>

                    ${settings.options.nations &&
                    !settings.options.nations.hidden
                      ? html`<div
                          data-local-matte=${this.localMatte
                            ? "subpanel"
                            : nothing}
                          class="col-span-2 rounded-xl p-4 flex flex-col justify-center border transition-all duration-200 ${settings
                            .options.nations.value > 0
                            ? ACTIVE_CARD
                            : INACTIVE_CARD}"
                        >
                          <fluent-slider
                            min="0"
                            max="400"
                            step="1"
                            .value=${settings.options.nations.value}
                            .defaultValue=${settings.options.nations
                              .defaultValue}
                            defaultLabelKey="common.map_default"
                            labelKey=${settings.options.nations.labelKey}
                            descriptionKey=${settings.options.nations
                              .descriptionKey ?? ""}
                            disabledKey=${settings.options.nations.disabledKey}
                            @value-changed=${this.handleNationsChanged}
                          ></fluent-slider>
                        </div>`
                      : nothing}
                    ${settings.options.toggles.map((toggle) =>
                      this.renderOptionToggle(toggle),
                    )}
                    ${settings.options.inputCards}
                  </div>
                `,
                undefined,
                undefined,
                this.localMatte,
              )}
              ${settings.hostCheats?.visible
                ? renderSection(
                    HOST_CHEATS_ICON,
                    "text-yellow-400",
                    "bg-yellow-500/20",
                    settings.hostCheats.titleKey,
                    html`
                      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        ${settings.hostCheats.toggles.map((toggle) =>
                          renderTextCardButton({
                            label: translateText(toggle.labelKey),
                            description: toggle.descriptionKey
                              ? translateText(toggle.descriptionKey)
                              : undefined,
                            active: toggle.checked,
                            onClick: () => this.handleHostCheatToggle(toggle),
                            cardExtraClass: "p-4 text-center",
                            labelId: this.optionId(
                              "host-cheat",
                              toggle.labelKey,
                              "label",
                            ),
                            descriptionId: this.optionId(
                              "host-cheat",
                              toggle.labelKey,
                              "description",
                            ),
                            localMatte: this.localMatte,
                          }),
                        )}
                        ${settings.hostCheats.inputCards}
                      </div>
                    `,
                    undefined,
                    undefined,
                    this.localMatte,
                  )
                : nothing}
              ${renderSection(
                ENABLES_ICON,
                "text-teal-400",
                "bg-teal-500/20",
                settings.unitTypes.titleKey,
                html`
                  <div
                    class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4"
                  >
                    ${this.renderUnitTypeOptions(
                      settings.unitTypes.disabledUnits,
                    )}
                  </div>
                `,
                "space-y-6 pb-6",
                undefined,
                this.localMatte,
              )}
            `
          : nothing}
      </div>
    `;
  }
}
