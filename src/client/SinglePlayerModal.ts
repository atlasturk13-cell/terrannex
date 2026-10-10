import { html, nothing, TemplateResult } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { translateText } from "../client/Utils";
import { UserMeResponse } from "../core/ApiSchemas";
import { assetUrl } from "../core/AssetUrls";
import { DoomsdayClockSpeed } from "../core/game/DoomsdayClock";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  maps,
  MatchTempo,
  UnitType,
  VictoryCondition,
} from "../core/game/Game";
import { isLocalProvenanceSafeMap } from "../core/game/LocalProvenanceSafeMaps";
import {
  CAMERA_SENSITIVITY_VALUES,
  LOCAL_GAME_SPEED_VALUES,
  UserSettings,
} from "../core/game/UserSettings";
import { GameConfig, TeamCountConfig } from "../core/Schemas";
import { accountClient } from "./accounts/AccountClient";
import { hasLinkedAccount } from "./Api";
import { ClientEnv } from "./ClientEnv";
import "./components/baseComponents/Button";
import "./components/baseComponents/Modal";
import { BaseModal, ModalConfig } from "./components/BaseModal";
import "./components/GameConfigSettings";
import type { GameConfigSettingsData } from "./components/GameConfigSettings";
import { MEDAL_ORDER, medalIcon } from "./components/map/Medals";
import "./components/ToggleInputCard";
import { modalHeader } from "./components/ui/ModalHeader";
import { getPlayerCosmetics } from "./Cosmetics";
import { crazyGamesSDK } from "./CrazyGamesSDK";
import { JoinLobbyEvent } from "./Main";
import {
  createSinglePlayerSession,
  LOCAL_ALLOWED_MAPS,
} from "./SinglePlayerSession";
import { UsernameInput } from "./UsernameInput";
import {
  getBotsForCompactMap,
  getNationsForCompactMap,
  getRandomMapType,
  getUpdatedDisabledUnits,
  parseBoundedFloatFromInput,
  parseBoundedIntegerFromInput,
  preventDisallowedKeys,
  sliderToNationsConfig,
  toOptionalNumber,
} from "./utilities/GameConfigHelpers";

import { terrainMapFileLoader } from "./TerrainMapFileLoader";

const DEFAULT_OPTIONS = {
  selectedMap: GameMapType.World,
  selectedDifficulty: Difficulty.Easy,
  bots: 400,
  infiniteGold: false,
  infiniteTroops: false,
  compactMap: false,
  maxTimer: false,
  maxTimerValue: undefined as number | undefined,
  instantBuild: false,
  randomSpawn: false,
  useRandomMap: false,
  gameMode: GameMode.FFA,
  teamCount: 2 as TeamCountConfig,
  goldMultiplier: false,
  goldMultiplierValue: undefined as number | undefined,
  startingGold: false,
  startingGoldValue: undefined as number | undefined,
  disabledUnits: [] as UnitType[],
  customAlliances: false,
  customAllianceMinutes: undefined as number | undefined,
  waterNukes: false,
  doomsdayClock: false,
  doomsdayClockSpeed: "normal" as DoomsdayClockSpeed,
} as const;

const LOCAL_DEFAULT_OPTIONS = {
  selectedMap: GameMapType.NaturalEarthWorld,
  selectedDifficulty: Difficulty.Medium,
  bots: 4,
  nations: 8,
  matchTempo: MatchTempo.Medium,
  victoryCondition: VictoryCondition.Territory,
  playerColor: "#38bdf8",
} as const;

const PLAYER_COLOR_CHOICES = [
  { nameKey: "local.color_cyan", color: "#38bdf8" },
  { nameKey: "local.color_green", color: "#22c55e" },
  { nameKey: "local.color_orange", color: "#f97316" },
  { nameKey: "local.color_purple", color: "#a855f7" },
  { nameKey: "local.color_rose", color: "#f43f5e" },
] as const;

const TEMPO_COPY_KEYS: Record<MatchTempo, { label: string; help: string }> = {
  [MatchTempo.Slow]: {
    label: "local.tempo_slow",
    help: "local.tempo_slow_help",
  },
  [MatchTempo.Medium]: {
    label: "local.tempo_medium",
    help: "local.tempo_medium_help",
  },
  [MatchTempo.Fast]: {
    label: "local.tempo_fast",
    help: "local.tempo_fast_help",
  },
};

const VICTORY_COPY_KEYS: Record<
  VictoryCondition,
  { label: string; help: string }
> = {
  [VictoryCondition.Territory]: {
    label: "local.victory_territory",
    help: "local.victory_territory_help",
  },
  [VictoryCondition.Elimination]: {
    label: "local.victory_elimination",
    help: "local.victory_elimination_help",
  },
};

// A map earns achievements only if it has nations to conquer — the same rule
// MapDisplay uses to decide whether to draw medals. Maps without nations (e.g.
// Baikal Nuke Wars) must be excluded from the medal totals. The complete set is
// cached for the page session and concurrent callers share the in-flight
// promise so we never fetch the manifests twice. A load that hits any fetch
// error resolves to null (not a partial set) and clears the shared promise, so
// a transient failure retries on the next call rather than locking in an
// undercount for the whole session.
let eligibleMapsCache: Set<GameMapType> | null = null;
let eligibleMapsPromise: Promise<Set<GameMapType> | null> | null = null;

async function loadAchievementEligibleMaps(): Promise<Set<GameMapType> | null> {
  if (eligibleMapsCache) return eligibleMapsCache;
  eligibleMapsPromise ??= (async () => {
    const eligible = new Set<GameMapType>();
    let hadFailure = false;
    await Promise.all(
      maps
        .filter(
          (map) =>
            !ClientEnv.isLocalOnly() || isLocalProvenanceSafeMap(map.type),
        )
        .map(async (m) => {
          try {
            const manifest = await terrainMapFileLoader
              .getMapData(m.type)
              .manifest();
            if (manifest.nations.length > 0) {
              eligible.add(m.type);
            }
          } catch {
            // A missing manifest would undercount the total; remember the failure
            // so we don't cache this incomplete set below.
            hadFailure = true;
          }
        }),
    );
    if (hadFailure) {
      eligibleMapsPromise = null; // allow a later call to retry
      return null;
    }
    eligibleMapsCache = eligible;
    return eligible;
  })();
  return eligibleMapsPromise;
}

@customElement("single-player-modal")
export class SinglePlayerModal extends BaseModal {
  protected routerName = "single-player";

  protected modalConfig(): ModalConfig {
    return ClientEnv.isLocalOnly() ? { localMatte: "setup" } : {};
  }

  @state() private selectedMap: GameMapType = ClientEnv.isLocalOnly()
    ? LOCAL_DEFAULT_OPTIONS.selectedMap
    : DEFAULT_OPTIONS.selectedMap;
  @state() private selectedDifficulty: Difficulty = ClientEnv.isLocalOnly()
    ? LOCAL_DEFAULT_OPTIONS.selectedDifficulty
    : DEFAULT_OPTIONS.selectedDifficulty;
  @state() private nations: number = ClientEnv.isLocalOnly()
    ? LOCAL_DEFAULT_OPTIONS.nations
    : 0;
  @state() private defaultNationCount: number = 0;
  @state() private bots: number = ClientEnv.isLocalOnly()
    ? LOCAL_DEFAULT_OPTIONS.bots
    : DEFAULT_OPTIONS.bots;
  @state() private infiniteGold: boolean = DEFAULT_OPTIONS.infiniteGold;
  @state() private infiniteTroops: boolean = DEFAULT_OPTIONS.infiniteTroops;
  @state() private compactMap: boolean = DEFAULT_OPTIONS.compactMap;
  @state() private maxTimer: boolean = DEFAULT_OPTIONS.maxTimer;
  @state() private maxTimerValue: number | undefined =
    DEFAULT_OPTIONS.maxTimerValue;
  @state() private instantBuild: boolean = DEFAULT_OPTIONS.instantBuild;
  @state() private randomSpawn: boolean = DEFAULT_OPTIONS.randomSpawn;
  @state() private useRandomMap: boolean = DEFAULT_OPTIONS.useRandomMap;
  @state() private gameMode: GameMode = DEFAULT_OPTIONS.gameMode;
  @state() private teamCount: TeamCountConfig = DEFAULT_OPTIONS.teamCount;
  @state() private showAchievements: boolean = false;
  @state() private mapWins: Map<GameMapType, Set<Difficulty>> = new Map();
  // Maps that support achievements (have nations). null until loaded — the
  // medal overview shows a placeholder total meanwhile.
  @state() private eligibleMaps: Set<GameMapType> | null = null;
  @state() private userMeResponse: UserMeResponse | false = false;
  @state() private goldMultiplier: boolean = DEFAULT_OPTIONS.goldMultiplier;
  @state() private goldMultiplierValue: number | undefined =
    DEFAULT_OPTIONS.goldMultiplierValue;
  @state() private startingGold: boolean = DEFAULT_OPTIONS.startingGold;
  @state() private startingGoldValue: number | undefined =
    DEFAULT_OPTIONS.startingGoldValue;

  @state() private disabledUnits: UnitType[] = [
    ...DEFAULT_OPTIONS.disabledUnits,
  ];
  @state() private customAlliances: boolean = DEFAULT_OPTIONS.customAlliances;
  @state() private customAllianceMinutes: number | undefined =
    DEFAULT_OPTIONS.customAllianceMinutes;
  @state() private waterNukes: boolean = DEFAULT_OPTIONS.waterNukes;
  @state() private doomsdayClock: boolean = DEFAULT_OPTIONS.doomsdayClock;
  @state() private doomsdayClockSpeed: DoomsdayClockSpeed =
    DEFAULT_OPTIONS.doomsdayClockSpeed;
  // Explicitly selected and carried into each localhost session. New local
  // setup starts opt in; non-local setup never serializes this field.
  @state() private depthProgression: boolean = ClientEnv.isLocalOnly();
  @state() private matchTempo: MatchTempo = LOCAL_DEFAULT_OPTIONS.matchTempo;
  @state() private victoryCondition: VictoryCondition =
    LOCAL_DEFAULT_OPTIONS.victoryCondition;
  @state() private playerColor: string = LOCAL_DEFAULT_OPTIONS.playerColor;

  private mapLoader = terrainMapFileLoader;
  private readonly localUserSettings = new UserSettings();

  @query('username-input[data-local-commander="true"]')
  private localCommanderInput?: UsernameInput;

  @state() private localGoToPlayer = this.localUserSettings.goToPlayer();
  /** Local setup: the advanced rules panel is collapsed until asked for. */
  @state() private showAdvanced = false;
  @state() private localPanSensitivity =
    this.localUserSettings.cameraPanSensitivity();
  @state() private localZoomSensitivity =
    this.localUserSettings.cameraZoomSensitivity();
  @state() private localGameSpeed = this.localUserSettings.localGameSpeed();

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener(
      "userMeResponse",
      this.handleUserMeResponse as EventListener,
    );
    void this.loadNationCount();
  }

  disconnectedCallback() {
    document.removeEventListener(
      "userMeResponse",
      this.handleUserMeResponse as EventListener,
    );
    super.disconnectedCallback();
  }

  private toggleAchievements = () => {
    this.showAchievements = !this.showAchievements;
    if (this.showAchievements) void this.ensureEligibleMaps();
  };

  private async ensureEligibleMaps() {
    if (this.eligibleMaps) return;
    const eligible = await loadAchievementEligibleMaps();
    // Leave eligibleMaps null on a failed/incomplete load so the overview keeps
    // its placeholder total and the next toggle retries.
    if (eligible) this.eligibleMaps = eligible;
  }

  // Medals earned per difficulty, counted only on achievement-eligible maps.
  private medalCounts(): Record<Difficulty, number> {
    const counts: Record<Difficulty, number> = {
      [Difficulty.Easy]: 0,
      [Difficulty.Medium]: 0,
      [Difficulty.Hard]: 0,
      [Difficulty.Impossible]: 0,
    };
    // Until eligibility is loaded, count nothing — otherwise the overview would
    // briefly include wins on non-eligible maps before the manifests resolve.
    if (!this.eligibleMaps) return counts;
    for (const [map, difficulties] of this.mapWins) {
      if (!this.eligibleMaps.has(map)) continue;
      for (const difficulty of difficulties) counts[difficulty]++;
    }
    return counts;
  }

  private handleUserMeResponse = (
    event: CustomEvent<UserMeResponse | false>,
  ) => {
    this.userMeResponse = event.detail;
    this.applyAchievements(event.detail);
  };

  private renderNotLoggedInBanner(): TemplateResult {
    if (crazyGamesSDK.isOnCrazyGames()) {
      return html``;
    }
    return html`<button
      class="px-3 py-2 text-xs font-bold uppercase tracking-wider transition-colors duration-200 rounded-lg bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 whitespace-nowrap shrink-0 cursor-pointer hover:bg-yellow-500/30"
      @click=${() => {
        this.close();
        window.showPage?.("page-account");
      }}
    >
      ${translateText("single_modal.sign_in_for_achievements")}
    </button>`;
  }

  private applyAchievements(userMe: UserMeResponse | false) {
    if (!userMe) {
      this.mapWins = new Map();
      return;
    }

    const completions = userMe.player.achievements.singleplayerMap;

    const winsMap = new Map<GameMapType, Set<Difficulty>>();
    for (const entry of completions) {
      const { mapName, difficulty } = entry ?? {};
      const isValidMap =
        typeof mapName === "string" &&
        Object.values(GameMapType).includes(mapName as GameMapType);
      const isValidDifficulty =
        typeof difficulty === "string" &&
        Object.values(Difficulty).includes(difficulty as Difficulty);
      if (!isValidMap || !isValidDifficulty) continue;

      const map = mapName as GameMapType;
      const set = winsMap.get(map) ?? new Set<Difficulty>();
      set.add(difficulty as Difficulty);
      winsMap.set(map, set);
    }

    this.mapWins = winsMap;
  }

  protected renderHeaderSlot() {
    if (ClientEnv.isLocalOnly()) {
      return html`<div
        data-local-matte="setup"
        data-ui-audit-root="setup"
        class="flex min-h-16 items-center gap-3 border-b border-white/10 px-4 py-3 lg:px-6"
      >
        <button
          type="button"
          class="nav-menu-item inline-flex h-10 shrink-0 items-center gap-2 rounded-lg border border-white/10 px-3 text-xs font-semibold uppercase tracking-wider text-white/70 hover:border-cyan-300/40 hover:text-cyan-200"
          data-page="page-main-menu"
          data-setup-back
        >
          ← ${translateText("main_menu.back")}
        </button>
        <div>
          <div
            class="text-[10px] font-bold uppercase tracking-[0.22em] text-cyan-300"
          >
            ${translateText("local.command_console")}
          </div>
          <h1 class="text-xl font-bold text-white lg:text-2xl">
            ${translateText("local.match_setup")}
          </h1>
        </div>
      </div>`;
    }

    return modalHeader({
      title: translateText("main.solo") || "Solo",
      onBack: () => this.close(),
      ariaLabel: translateText("common.back"),
      rightContent: hasLinkedAccount(this.userMeResponse)
        ? html`<button
              @click=${this.toggleAchievements}
              class="flex items-center gap-2 px-3 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-all shrink-0 ${this
                .showAchievements
                ? "bg-yellow-500/10 border-yellow-500/30 text-yellow-400"
                : "text-white/60"}"
            >
              <img
                src=${assetUrl("images/MedalIconWhite.svg")}
                class="w-4 h-4 opacity-80 shrink-0"
                style="${this.showAchievements ? "" : "filter: grayscale(1);"}"
              />
              <span
                class="text-xs font-bold uppercase tracking-wider whitespace-nowrap"
                >${translateText("single_modal.toggle_achievements")}</span
              >
            </button>
            ${this.showAchievements ? this.renderMedalOverview() : null}`
        : this.renderNotLoggedInBanner(),
    });
  }

  // Compact summary that expands under the header while achievements are on:
  // each colored medal with how many maps you've earned it on, plus the shared
  // "out of N maps" total (N = achievement-eligible maps).
  private renderMedalOverview(): TemplateResult {
    const counts = this.medalCounts();
    const total = this.eligibleMaps?.size ?? null;
    return html`<div class="basis-full w-full">
      <div
        class="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5 rounded-xl border border-yellow-500/20 bg-yellow-500/5"
      >
        <span
          class="text-[11px] font-bold uppercase tracking-wider text-yellow-400/80 shrink-0"
        >
          ${translateText("single_modal.medals_earned")}
        </span>
        <div class="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          ${MEDAL_ORDER.map((difficulty) =>
            this.renderMedalStat(difficulty, counts[difficulty]),
          )}
        </div>
        <span
          class="ml-auto text-[11px] font-semibold uppercase tracking-wider text-white/40 shrink-0"
        >
          ${translateText("single_modal.medals_of_maps", {
            total: total ?? "…",
          })}
        </span>
      </div>
    </div>`;
  }

  private renderMedalStat(
    difficulty: Difficulty,
    count: number,
  ): TemplateResult {
    return html`<div
      class="flex items-center gap-1.5"
      title=${translateText(`difficulty.${difficulty.toLowerCase()}`)}
    >
      ${medalIcon(difficulty, "w-4 h-4")}
      <span class="text-xs font-medium text-white/50 hidden sm:inline"
        >${translateText(`difficulty.${difficulty.toLowerCase()}`)}</span
      >
      <span class="text-sm font-bold text-white tabular-nums">${count}</span>
    </div>`;
  }

  private renderPreferenceChoices<T extends string | number>(
    name: string,
    values: readonly T[],
    selected: T,
    format: (value: T) => string | TemplateResult,
    onSelect: (value: T) => void,
    descriptionId?: string,
  ): TemplateResult {
    return html`<div
      class="grid gap-2 ${values.length === 2
        ? "grid-cols-2"
        : values.length === 3
          ? "grid-cols-3"
          : "grid-cols-4"}"
      role="group"
      aria-label=${name}
      aria-describedby=${descriptionId ?? nothing}
    >
      ${values.map(
        (value) =>
          html`<button
            data-local-matte="subpanel"
            type="button"
            class="min-h-10 rounded-lg border px-2 py-2 text-sm font-bold transition-colors ${selected ===
            value
              ? "border-cyan-300 bg-cyan-400/20 text-white"
              : "border-white/15 bg-zinc-900 text-white/70 hover:border-white/30 hover:text-white"}"
            aria-pressed=${selected === value}
            @click=${() => onSelect(value)}
          >
            ${format(value)}
          </button>`,
      )}
    </div>`;
  }

  /** The essentials shown up front: who you are and which color you play. */
  private renderLocalCommandSetup(): TemplateResult {
    return html`<section
      data-local-command-setup
      data-local-matte="subpanel"
      class="mb-6 grid min-w-0 gap-5 rounded-2xl border border-[#385060] bg-[#111e29] p-4 shadow-[0_18px_50px_rgba(0,0,0,0.3)] lg:grid-cols-2 lg:gap-8 lg:p-6"
    >
      <div class="min-w-0 space-y-3">
        <div>
          <h2 class="text-sm font-bold uppercase tracking-wider text-white">
            ${translateText("local.commander")}
          </h2>
          <p
            id="local-commander-description"
            class="mt-1 text-xs leading-5 text-white/65"
          >
            ${translateText("local.commander_help")}
          </p>
        </div>
        <username-input
          data-local-commander="true"
          class="block min-h-12"
        ></username-input>
      </div>
      <div class="space-y-2" data-player-color>
        <div>
          <div
            id="local-player-color-label"
            class="text-xs font-bold uppercase tracking-wider text-white"
          >
            ${translateText("local.players_colors")}
          </div>
          <div
            id="local-player-color-description"
            class="mt-1 text-xs text-white/65"
          >
            ${translateText("local.players_colors_help")}
          </div>
        </div>
        <div
          class="grid grid-cols-2 gap-2 sm:grid-cols-3"
          role="group"
          aria-labelledby="local-player-color-label"
          aria-describedby="local-player-color-description"
        >
          ${PLAYER_COLOR_CHOICES.map(
            ({ nameKey, color }) =>
              html`<button
                data-local-matte="subpanel"
                data-player-color-choice=${color}
                type="button"
                class="flex min-h-11 items-center gap-2 rounded-lg border px-2 py-2 text-xs font-bold transition-colors ${this
                  .playerColor === color
                  ? "border-cyan-300 bg-cyan-400/20 text-white"
                  : "border-white/15 bg-zinc-900 text-white/70 hover:border-white/30 hover:text-white"}"
                aria-label=${translateText(nameKey)}
                aria-pressed=${this.playerColor === color}
                @click=${() => (this.playerColor = color)}
              >
                <span
                  class="h-5 w-5 shrink-0 rounded-full border border-white/40"
                  style="background-color: ${color}"
                  aria-hidden="true"
                ></span>
                <span>${translateText(nameKey)}</span>
              </button>`,
          )}
        </div>
      </div>
    </section>`;
  }

  /** Match rules and camera preferences, inside "Advanced options". */
  private renderLocalAdvancedRules(): TemplateResult {
    return html`<div
      data-local-advanced-rules
      data-local-matte="subpanel"
      class="grid min-w-0 gap-4 rounded-2xl border border-[#385060] bg-[#111e29] p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:p-6"
    >
      <div class="min-w-0 space-y-3">
        <button
          data-local-matte="subpanel"
          type="button"
          role="switch"
          data-camera-follow
          aria-checked=${this.localGoToPlayer}
          aria-describedby="local-camera-follow-description"
          class="flex min-h-12 w-full items-center justify-between gap-4 rounded-lg border border-white/15 bg-zinc-900 px-3 py-2 text-left"
          @click=${() => this.setLocalGoToPlayer(!this.localGoToPlayer)}
        >
          <span>
            <span class="block text-sm font-bold text-white"
              >${translateText("local.camera_follow")}</span
            >
            <span
              id="local-camera-follow-description"
              class="block text-xs text-white/65"
              >${translateText("local.camera_follow_help")}</span
            >
          </span>
          <span
            class="rounded-full px-3 py-1 text-xs font-bold ${this
              .localGoToPlayer
              ? "bg-emerald-500 text-black"
              : "bg-zinc-700 text-white"}"
            >${this.localGoToPlayer
              ? translateText("common.enabled")
              : translateText("common.disabled")}</span
          >
        </button>
        <button
          data-local-matte="subpanel"
          data-depth-progression
          type="button"
          role="switch"
          aria-checked=${this.depthProgression}
          aria-labelledby="local-depth-progression-label"
          aria-describedby="local-depth-progression-description"
          data-setting-option="progression"
          class="flex min-h-12 w-full items-center justify-between gap-4 rounded-lg border border-white/15 bg-zinc-900 px-3 py-2 text-left"
          @click=${() => (this.depthProgression = !this.depthProgression)}
        >
          <span>
            <span
              id="local-depth-progression-label"
              class="block text-sm font-bold text-white"
              >${translateText("local.depth_progression")}</span
            >
            <span
              id="local-depth-progression-description"
              class="block text-xs text-white/65"
              >${translateText("local.depth_progression_help")}</span
            >
          </span>
          <span
            class="rounded-full px-3 py-1 text-xs font-bold ${this
              .depthProgression
              ? "bg-emerald-500 text-black"
              : "bg-zinc-700 text-white"}"
            >${this.depthProgression
              ? translateText("common.enabled")
              : translateText("common.disabled")}</span
          >
        </button>
      </div>
      <div
        class="grid min-w-0 grid-cols-1 gap-x-4 divide-y divide-[#385060] sm:grid-cols-2 sm:divide-y-0"
        data-local-match-rules
      >
        <div class="order-6 space-y-2 py-4" data-camera-pan>
          <div>
            <div class="text-xs font-bold uppercase tracking-wider text-white">
              ${translateText("local.camera_pan")}
            </div>
            <div
              id="local-camera-pan-description"
              class="mt-1 text-xs text-white/65"
            >
              ${translateText("local.camera_pan_help")}
            </div>
          </div>
          ${this.renderPreferenceChoices(
            translateText("local.camera_pan"),
            CAMERA_SENSITIVITY_VALUES,
            this.localPanSensitivity,
            (value) => `${Math.round(value * 100)}%`,
            (value) => this.setLocalPanSensitivity(value),
            "local-camera-pan-description",
          )}
        </div>
        <div class="order-7 space-y-2 py-4" data-camera-zoom>
          <div>
            <div class="text-xs font-bold uppercase tracking-wider text-white">
              ${translateText("local.camera_zoom")}
            </div>
            <div
              id="local-camera-zoom-description"
              class="mt-1 text-xs text-white/65"
            >
              ${translateText("local.camera_zoom_help")}
            </div>
          </div>
          ${this.renderPreferenceChoices(
            translateText("local.camera_zoom"),
            CAMERA_SENSITIVITY_VALUES,
            this.localZoomSensitivity,
            (value) => `${Math.round(value * 100)}%`,
            (value) => this.setLocalZoomSensitivity(value),
            "local-camera-zoom-description",
          )}
        </div>
        <div
          class="order-2 space-y-2 py-4 sm:col-span-2 lg:col-span-1"
          data-game-speed
        >
          <div>
            <div class="text-xs font-bold uppercase tracking-wider text-white">
              ${translateText("local.game_speed")}
            </div>
            <div
              id="local-game-speed-description"
              class="mt-1 text-xs text-white/65"
            >
              ${translateText("local.game_speed_help")}
            </div>
          </div>
          ${this.renderPreferenceChoices(
            translateText("local.game_speed"),
            LOCAL_GAME_SPEED_VALUES,
            this.localGameSpeed,
            (value) => `×${1 / value}`,
            (value) => this.setLocalGameSpeed(value),
            "local-game-speed-description",
          )}
        </div>
        <div
          class="order-3 space-y-2 py-4 sm:col-span-2 lg:col-span-1"
          data-match-tempo
        >
          <div>
            <div class="text-xs font-bold uppercase tracking-wider text-white">
              ${translateText("local.match_tempo")}
            </div>
            <div
              id="local-match-tempo-description"
              class="mt-1 text-xs text-white/65"
            >
              ${translateText("local.match_tempo_help")}
            </div>
          </div>
          ${this.renderPreferenceChoices(
            translateText("local.match_tempo"),
            Object.values(MatchTempo),
            this.matchTempo,
            (value) =>
              html`<span class="block"
                  >${translateText(TEMPO_COPY_KEYS[value].label)}</span
                >
                <span class="block text-[10px] font-medium text-white/55"
                  >${translateText(TEMPO_COPY_KEYS[value].help)}</span
                >`,
            (value) => (this.matchTempo = value),
            "local-match-tempo-description",
          )}
        </div>
        <div
          class="order-4 space-y-2 py-4 sm:col-span-2 lg:col-span-1"
          data-victory-condition
        >
          <div>
            <div class="text-xs font-bold uppercase tracking-wider text-white">
              ${translateText("local.victory")}
            </div>
            <div
              id="local-victory-description"
              class="mt-1 text-xs text-white/65"
            >
              ${translateText("local.victory_help")}
            </div>
          </div>
          ${this.renderPreferenceChoices(
            translateText("local.victory"),
            Object.values(VictoryCondition),
            this.victoryCondition,
            (value) =>
              html`<span class="block"
                  >${translateText(VICTORY_COPY_KEYS[value].label)}</span
                >
                <span class="block text-[10px] font-medium text-white/55"
                  >${translateText(VICTORY_COPY_KEYS[value].help)}</span
                >`,
            (value) => (this.victoryCondition = value),
            "local-victory-description",
          )}
        </div>
        <div
          class="order-5 space-y-2 py-4 sm:col-span-2 lg:col-span-1"
          data-starting-funds
        >
          <div class="flex items-start justify-between gap-3">
            <div>
              <div
                id="local-starting-funds-label"
                class="text-xs font-bold uppercase tracking-wider text-white"
              >
                ${translateText("local.starting_funds")}
              </div>
              <div
                id="local-starting-funds-description"
                class="mt-1 text-xs text-white/65"
              >
                ${translateText("game_settings.starting_gold_desc")}
              </div>
            </div>
            <button
              data-local-matte="subpanel"
              data-setting-option="numeric"
              type="button"
              role="switch"
              aria-checked=${this.startingGold}
              aria-labelledby="local-starting-funds-label"
              aria-describedby="local-starting-funds-description"
              class="min-h-10 shrink-0 rounded-md border px-3 text-xs font-bold ${this
                .startingGold
                ? "border-[#31c8f2] bg-[#31c8f2] text-[#0b141d]"
                : "border-[#385060] bg-[#172631] text-white/75"}"
              @click=${() =>
                this.handleStartingGoldToggle(
                  !this.startingGold,
                  this.startingGold ? undefined : 5,
                )}
            >
              ${this.startingGold
                ? translateText("common.enabled")
                : translateText("common.disabled")}
            </button>
          </div>
          <div class="grid grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] gap-2">
            <button
              type="button"
              class="min-h-11 rounded-md border border-[#385060] bg-[#172631] text-lg font-bold text-white disabled:cursor-not-allowed disabled:opacity-35"
              aria-label=${translateText("local.decrease_starting_funds")}
              ?disabled=${!this.startingGold}
              @click=${() => this.adjustStartingGold(-1)}
            >
              −
            </button>
            <label
              class="flex min-w-0 items-center rounded-md border border-[#385060] bg-[#172631] px-3 focus-within:border-[#31c8f2]"
            >
              <span class="text-sm font-bold text-white/55">$</span>
              <input
                data-setting-input
                id="starting-gold-value"
                class="min-h-11 min-w-0 flex-1 bg-transparent px-2 text-center text-sm font-bold text-white outline-none disabled:cursor-not-allowed disabled:opacity-40"
                type="number"
                min="0.1"
                max="1000"
                step="any"
                .value=${String(this.startingGoldValue ?? "")}
                placeholder="5"
                ?disabled=${!this.startingGold}
                aria-label=${translateText("local.starting_funds")}
                aria-labelledby="local-starting-funds-label"
                aria-describedby="local-starting-funds-description"
                @change=${this.handleStartingGoldValueChanges}
                @keydown=${this.handleStartingGoldValueKeyDown}
              />
              <span class="text-xs font-bold text-white/55">M</span>
            </label>
            <button
              type="button"
              class="min-h-11 rounded-md border border-[#385060] bg-[#172631] text-lg font-bold text-white disabled:cursor-not-allowed disabled:opacity-35"
              aria-label=${translateText("local.increase_starting_funds")}
              ?disabled=${!this.startingGold}
              @click=${() => this.adjustStartingGold(1)}
            >
              +
            </button>
          </div>
        </div>
      </div>
    </div>`;
  }

  private renderAdvancedToggle(): TemplateResult {
    return html`<button
      type="button"
      data-setup-advanced-toggle
      aria-expanded=${this.showAdvanced}
      aria-controls="setup-advanced-panel"
      class="flex w-full items-center justify-between gap-4 rounded-2xl border border-white/10 bg-zinc-950/70 px-5 py-4 text-left transition hover:border-cyan-300/40"
      @click=${() => (this.showAdvanced = !this.showAdvanced)}
    >
      <span>
        <span
          class="block text-sm font-black uppercase tracking-[0.16em] text-white"
          >${translateText("local.advanced_options")}</span
        >
        <span class="mt-0.5 block text-xs text-white/55"
          >${translateText("local.advanced_options_help")}</span
        >
      </span>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        stroke-width="2"
        stroke="currentColor"
        class="h-5 w-5 shrink-0 text-cyan-200 transition-transform ${this
          .showAdvanced
          ? "rotate-180"
          : ""}"
        aria-hidden="true"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="m19.5 8.25-7.5 7.5-7.5-7.5"
        />
      </svg>
    </button>`;
  }

  private renderConfigSettings(
    settings: GameConfigSettingsData,
    sections: "all" | "core" | "advanced",
  ): TemplateResult {
    return html`<game-config-settings
      class="block"
      data-config-sections=${sections}
      .localMatte=${ClientEnv.isLocalOnly()}
      .sectionGapClass=${"space-y-6"}
      .sections=${sections}
      .settings=${settings}
      @map-selected=${this.handleConfigMapSelected}
      @random-map-selected=${this.handleConfigRandomMapSelected}
      @difficulty-selected=${this.handleConfigDifficultySelected}
      @doomsday-clock-speed-selected=${this
        .handleConfigDoomsdayClockSpeedSelected}
      @game-mode-selected=${this.handleConfigGameModeSelected}
      @team-count-selected=${this.handleConfigTeamCountSelected}
      @bots-changed=${this.handleBotsChange}
      @nations-changed=${this.handleNationsChange}
      @option-toggle-changed=${this.handleConfigOptionToggleChanged}
      @unit-toggle-changed=${this.handleConfigUnitToggleChanged}
    ></game-config-settings>`;
  }

  protected renderBody() {
    const localOnly = ClientEnv.isLocalOnly();

    const inputCards = [
      html`<toggle-input-card
        .localMatte=${localOnly}
        .labelKey=${"game_settings.max_timer"}
        .descriptionKey=${localOnly ? "game_settings.max_timer_desc" : ""}
        .checked=${this.maxTimer}
        .inputId=${"end-timer-value"}
        .inputMin=${1}
        .inputMax=${120}
        .inputValue=${this.maxTimerValue}
        .inputAriaLabel=${translateText("game_settings.max_timer")}
        .inputPlaceholder=${translateText("game_settings.mins_placeholder")}
        .defaultInputValue=${30}
        .minValidOnEnable=${1}
        .onToggle=${this.handleMaxTimerToggle}
        .onInput=${this.handleMaxTimerValueChanges}
        .onKeyDown=${this.handleMaxTimerValueKeyDown}
      ></toggle-input-card>`,
      html`<toggle-input-card
        .localMatte=${localOnly}
        .labelKey=${"game_settings.gold_multiplier"}
        .descriptionKey=${localOnly ? "game_settings.gold_multiplier_desc" : ""}
        .checked=${this.goldMultiplier}
        .inputId=${"gold-multiplier-value"}
        .inputMin=${0.1}
        .inputMax=${1000}
        .inputStep=${"any"}
        .inputValue=${this.goldMultiplierValue}
        .inputAriaLabel=${translateText("game_settings.gold_multiplier")}
        .inputPlaceholder=${"2.0x"}
        .defaultInputValue=${2}
        .minValidOnEnable=${0.1}
        .onToggle=${this.handleGoldMultiplierToggle}
        .onChange=${this.handleGoldMultiplierValueChanges}
        .onKeyDown=${this.handleGoldMultiplierValueKeyDown}
      ></toggle-input-card>`,
      localOnly
        ? html``
        : html`<toggle-input-card
            .localMatte=${false}
            .labelKey=${"game_settings.starting_gold"}
            .descriptionKey=${""}
            .checked=${this.startingGold}
            .inputId=${"starting-gold-value"}
            .inputMin=${0.1}
            .inputMax=${1000}
            .inputStep=${"any"}
            .inputValue=${this.startingGoldValue}
            .inputAriaLabel=${translateText("game_settings.starting_gold")}
            .inputPlaceholder=${"5"}
            .defaultInputValue=${5}
            .minValidOnEnable=${0.1}
            .onToggle=${this.handleStartingGoldToggle}
            .onChange=${this.handleStartingGoldValueChanges}
            .onKeyDown=${this.handleStartingGoldValueKeyDown}
          ></toggle-input-card>`,
      html`<toggle-input-card
        .localMatte=${localOnly}
        .labelKey=${"game_settings.custom_alliances"}
        .descriptionKey=${localOnly
          ? "game_settings.custom_alliances_desc"
          : ""}
        .checked=${this.customAlliances}
        .inputMin=${0}
        .inputMax=${15}
        .inputStep=${1}
        .inputValue=${this.customAllianceMinutes}
        .inputAriaLabel=${translateText("game_settings.custom_alliances")}
        .inputPlaceholder=${translateText("game_settings.mins_placeholder")}
        .defaultInputValue=${0}
        .minValidOnEnable=${0}
        .zeroLabel=${`(${translateText("public_game_modifier.disable_alliances")})`}
        .onToggle=${this.handleCustomAlliancesToggle}
        .onInput=${this.handleCustomAllianceMinutesInput}
        .onKeyDown=${this.handleCustomAllianceMinutesKeyDown}
      ></toggle-input-card>`,
    ];

    const configSettings: GameConfigSettingsData = {
      map: {
        selected: this.selectedMap,
        useRandom: this.useRandomMap,
        allowedMaps: localOnly ? LOCAL_ALLOWED_MAPS : undefined,
        hideRandomMap: localOnly,
        showMedals: this.showAchievements,
        mapWins: this.mapWins,
      },
      difficulty: {
        selected: this.selectedDifficulty,
        disabled: this.nations === 0,
      },
      gameMode: {
        selected: this.gameMode,
      },
      teamCount: {
        selected: this.teamCount,
      },
      options: {
        titleKey: "game_settings.options",
        bots: {
          value: this.bots,
          labelKey: "game_settings.bots",
          descriptionKey: localOnly ? "game_settings.bots_desc" : undefined,
          disabledKey: "common.disabled",
        },
        nations: {
          value: this.nations,
          defaultValue: this.defaultNationCount,
          labelKey: "game_settings.nations",
          descriptionKey: localOnly ? "game_settings.nations_desc" : undefined,
          disabledKey: "common.disabled",
        },
        toggles: [
          {
            labelKey: "game_settings.instant_build",
            descriptionKey: localOnly
              ? "game_settings.instant_build_desc"
              : undefined,
            checked: this.instantBuild,
          },
          {
            labelKey: "game_settings.random_spawn",
            descriptionKey: localOnly
              ? "game_settings.random_spawn_desc"
              : undefined,
            checked: this.randomSpawn,
          },
          {
            labelKey: "game_settings.infinite_gold",
            descriptionKey: localOnly
              ? "game_settings.infinite_gold_desc"
              : undefined,
            checked: this.infiniteGold,
          },
          {
            labelKey: "game_settings.infinite_troops",
            descriptionKey: localOnly
              ? "game_settings.infinite_troops_desc"
              : undefined,
            checked: this.infiniteTroops,
          },
          {
            labelKey: "game_settings.compact_map",
            descriptionKey: localOnly
              ? "game_settings.compact_map_desc"
              : undefined,
            checked: this.compactMap,
          },
          {
            labelKey: "game_settings.water_nukes",
            descriptionKey: localOnly
              ? "game_settings.water_nukes_desc"
              : undefined,
            checked: this.waterNukes,
          },
          {
            labelKey: "game_settings.doomsday_clock",
            descriptionKey: localOnly
              ? "game_settings.doomsday_clock_desc"
              : undefined,
            checked: this.doomsdayClock,
            doomsdayClockSpeed: this.doomsdayClockSpeed,
          },
        ],
        inputCards,
      },
      unitTypes: {
        titleKey: "game_settings.disable_units",
        disabledUnits: this.disabledUnits,
      },
    };

    return html`
      <div
        class="flex flex-col h-full"
        data-ui-audit-root=${localOnly ? "setup" : nothing}
      >
        <div
          class="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-6 pt-4 pb-6 mr-1 mx-auto w-full max-w-5xl"
        >
          ${localOnly ? this.renderLocalCommandSetup() : null}
          ${this.renderConfigSettings(
            configSettings,
            localOnly ? "core" : "all",
          )}
          ${localOnly
            ? html`<section data-setup-advanced class="mt-6 space-y-4">
                ${this.renderAdvancedToggle()}
                <div
                  id="setup-advanced-panel"
                  class="space-y-6 ${this.showAdvanced ? "" : "hidden"}"
                >
                  ${this.renderLocalAdvancedRules()}
                  ${this.renderConfigSettings(configSettings, "advanced")}
                </div>
              </section>`
            : null}
        </div>

        <!-- Footer Action -->
        <div
          data-local-matte=${localOnly ? "setup" : nothing}
          class="p-6 border-t border-white/10 bg-black/20 shrink-0"
        >
          ${hasLinkedAccount(this.userMeResponse) && this.hasOptionsChanged()
            ? html`<div
                class="mb-4 px-4 py-3 rounded-xl bg-yellow-500/20 border border-yellow-500/30 text-yellow-400 text-xs font-bold uppercase tracking-wider text-center"
              >
                ${translateText("single_modal.options_changed_no_achievements")}
              </div>`
            : null}
          <o-button
            ?localMatte=${localOnly}
            data-local-start-action=${localOnly ? "true" : nothing}
            variant=${localOnly ? "warning" : "primary"}
            width="block"
            size="lg"
            translationKey=${localOnly
              ? "local.start_battle"
              : "game_settings.start"}
            @click=${this.startGame}
          ></o-button>
        </div>
      </div>
    `;
  }

  // Check if any options other than map and difficulty have been changed from defaults
  private hasOptionsChanged(): boolean {
    return (
      this.nations !== this.defaultNationCount ||
      this.bots !== DEFAULT_OPTIONS.bots ||
      this.infiniteGold !== DEFAULT_OPTIONS.infiniteGold ||
      this.infiniteTroops !== DEFAULT_OPTIONS.infiniteTroops ||
      this.compactMap !== DEFAULT_OPTIONS.compactMap ||
      this.maxTimer !== DEFAULT_OPTIONS.maxTimer ||
      this.instantBuild !== DEFAULT_OPTIONS.instantBuild ||
      this.randomSpawn !== DEFAULT_OPTIONS.randomSpawn ||
      this.gameMode !== DEFAULT_OPTIONS.gameMode ||
      this.goldMultiplier !== DEFAULT_OPTIONS.goldMultiplier ||
      this.startingGold !== DEFAULT_OPTIONS.startingGold ||
      this.customAlliances !== DEFAULT_OPTIONS.customAlliances ||
      this.customAllianceMinutes !== DEFAULT_OPTIONS.customAllianceMinutes ||
      this.waterNukes !== DEFAULT_OPTIONS.waterNukes ||
      this.doomsdayClock !== DEFAULT_OPTIONS.doomsdayClock ||
      // Pace only matters when the mode is on (startGame drops it when off).
      (this.doomsdayClock &&
        this.doomsdayClockSpeed !== DEFAULT_OPTIONS.doomsdayClockSpeed) ||
      this.disabledUnits.length > 0
    );
  }

  protected onClose(): void {
    // Reset all transient form state to ensure clean slate
    this.selectedMap = ClientEnv.isLocalOnly()
      ? LOCAL_DEFAULT_OPTIONS.selectedMap
      : DEFAULT_OPTIONS.selectedMap;
    this.selectedDifficulty = ClientEnv.isLocalOnly()
      ? LOCAL_DEFAULT_OPTIONS.selectedDifficulty
      : DEFAULT_OPTIONS.selectedDifficulty;
    this.gameMode = DEFAULT_OPTIONS.gameMode;
    this.useRandomMap = DEFAULT_OPTIONS.useRandomMap;
    this.bots = ClientEnv.isLocalOnly()
      ? LOCAL_DEFAULT_OPTIONS.bots
      : DEFAULT_OPTIONS.bots;
    this.nations = ClientEnv.isLocalOnly() ? LOCAL_DEFAULT_OPTIONS.nations : 0;
    this.defaultNationCount = 0;
    this.infiniteGold = DEFAULT_OPTIONS.infiniteGold;
    this.infiniteTroops = DEFAULT_OPTIONS.infiniteTroops;
    this.compactMap = DEFAULT_OPTIONS.compactMap;
    this.maxTimer = DEFAULT_OPTIONS.maxTimer;
    this.maxTimerValue = DEFAULT_OPTIONS.maxTimerValue;
    this.instantBuild = DEFAULT_OPTIONS.instantBuild;
    this.randomSpawn = DEFAULT_OPTIONS.randomSpawn;
    this.teamCount = DEFAULT_OPTIONS.teamCount;
    this.disabledUnits = [...DEFAULT_OPTIONS.disabledUnits];
    this.goldMultiplier = DEFAULT_OPTIONS.goldMultiplier;
    this.goldMultiplierValue = DEFAULT_OPTIONS.goldMultiplierValue;
    this.startingGold = DEFAULT_OPTIONS.startingGold;
    this.startingGoldValue = DEFAULT_OPTIONS.startingGoldValue;
    this.customAlliances = DEFAULT_OPTIONS.customAlliances;
    this.customAllianceMinutes = DEFAULT_OPTIONS.customAllianceMinutes;
    this.waterNukes = DEFAULT_OPTIONS.waterNukes;
    this.doomsdayClock = DEFAULT_OPTIONS.doomsdayClock;
    this.doomsdayClockSpeed = DEFAULT_OPTIONS.doomsdayClockSpeed;
    this.depthProgression = ClientEnv.isLocalOnly();
    this.matchTempo = LOCAL_DEFAULT_OPTIONS.matchTempo;
    this.victoryCondition = LOCAL_DEFAULT_OPTIONS.victoryCondition;
    this.playerColor = LOCAL_DEFAULT_OPTIONS.playerColor;
  }

  protected onOpen(): void {
    if (ClientEnv.isLocalOnly()) {
      this.localGoToPlayer = this.localUserSettings.goToPlayer();
      this.localPanSensitivity = this.localUserSettings.cameraPanSensitivity();
      this.localZoomSensitivity =
        this.localUserSettings.cameraZoomSensitivity();
      this.localGameSpeed = this.localUserSettings.localGameSpeed();
    }
    void this.loadNationCount();
  }

  private handleSelectRandomMap() {
    if (ClientEnv.isLocalOnly()) return;
    this.useRandomMap = true;
    this.selectedMap = getRandomMapType();
    void this.loadNationCount();
  }

  private handleConfigRandomMapSelected = () => {
    this.handleSelectRandomMap();
  };

  private handleMapSelection(value: GameMapType) {
    if (
      ClientEnv.isLocalOnly() &&
      !(LOCAL_ALLOWED_MAPS as readonly GameMapType[]).includes(value)
    ) {
      return;
    }
    this.selectedMap = value;
    this.useRandomMap = false;
    void this.loadNationCount();
  }

  private handleConfigMapSelected = (e: Event) => {
    const customEvent = e as CustomEvent<{ map: GameMapType }>;
    this.handleMapSelection(customEvent.detail.map);
  };

  private handleDifficultySelection(value: Difficulty) {
    this.selectedDifficulty = value;
  }

  private handleConfigDifficultySelected = (e: Event) => {
    const customEvent = e as CustomEvent<{ difficulty: Difficulty }>;
    this.handleDifficultySelection(customEvent.detail.difficulty);
  };

  private handleConfigDoomsdayClockSpeedSelected = (e: Event) => {
    const customEvent = e as CustomEvent<{ speed: DoomsdayClockSpeed }>;
    this.doomsdayClockSpeed = customEvent.detail.speed;
  };

  private handleConfigGameModeSelected = (e: Event) => {
    const customEvent = e as CustomEvent<{ mode: GameMode }>;
    this.handleGameModeSelection(customEvent.detail.mode);
  };

  private handleConfigTeamCountSelected = (e: Event) => {
    const customEvent = e as CustomEvent<{ count: TeamCountConfig }>;
    this.handleTeamCountSelection(customEvent.detail.count);
  };

  private handleCompactMapChange(val: boolean) {
    this.compactMap = val;
    this.bots = getBotsForCompactMap(this.bots, val);
    this.nations = getNationsForCompactMap(
      this.nations,
      this.defaultNationCount,
      val,
    );
  }

  private handleConfigOptionToggleChanged = (e: Event) => {
    const customEvent = e as CustomEvent<{
      labelKey: string;
      checked: boolean;
    }>;
    const { labelKey, checked } = customEvent.detail;

    switch (labelKey) {
      case "game_settings.instant_build":
        this.instantBuild = checked;
        break;
      case "game_settings.random_spawn":
        this.randomSpawn = checked;
        break;
      case "game_settings.infinite_gold":
        this.infiniteGold = checked;
        break;
      case "game_settings.infinite_troops":
        this.infiniteTroops = checked;
        break;
      case "game_settings.compact_map":
        this.handleCompactMapChange(checked);
        break;
      case "game_settings.water_nukes":
        this.waterNukes = checked;
        break;
      case "game_settings.doomsday_clock":
        this.doomsdayClock = checked;
        break;
      default:
        break;
    }
  };

  private handleConfigUnitToggleChanged = (e: Event) => {
    const customEvent = e as CustomEvent<{ unit: UnitType; checked: boolean }>;
    const { unit, checked } = customEvent.detail;
    this.disabledUnits = getUpdatedDisabledUnits(
      this.disabledUnits,
      unit,
      checked,
    );
  };

  private handleBotsChange = (e: Event) => {
    const customEvent = e as CustomEvent<{ value: number }>;
    const value = customEvent.detail.value;
    if (isNaN(value) || value < 0 || value > 400) {
      return;
    }
    this.bots = value;
  };

  private handleNationsChange = (e: Event) => {
    const customEvent = e as CustomEvent<{ value: number }>;
    const value = customEvent.detail.value;
    if (isNaN(value) || value < 0 || value > 400) {
      return;
    }
    this.nations = value;
  };

  private handleMaxTimerToggle = (
    checked: boolean,
    value: number | string | undefined,
  ) => {
    this.maxTimer = checked;
    this.maxTimerValue = toOptionalNumber(value);
  };

  private handleGoldMultiplierToggle = (
    checked: boolean,
    value: number | string | undefined,
  ) => {
    this.goldMultiplier = checked;
    this.goldMultiplierValue = toOptionalNumber(value);
  };

  private handleStartingGoldToggle = (
    checked: boolean,
    value: number | string | undefined,
  ) => {
    this.startingGold = checked;
    this.startingGoldValue = toOptionalNumber(value);
  };

  private handleCustomAlliancesToggle = (
    checked: boolean,
    value: number | string | undefined,
  ) => {
    this.customAlliances = checked;
    this.customAllianceMinutes = toOptionalNumber(value);
  };

  private handleCustomAllianceMinutesKeyDown = (e: KeyboardEvent) => {
    preventDisallowedKeys(e, ["-", "+", "e"]);
  };

  private handleCustomAllianceMinutesInput = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const value = parseBoundedIntegerFromInput(input, { min: 0, max: 15 });
    if (value === undefined) {
      return;
    }
    this.customAllianceMinutes = value;
  };

  private handleMaxTimerValueKeyDown = (e: KeyboardEvent) => {
    preventDisallowedKeys(e, ["-", "+", "e"]);
  };

  private getEndTimerInput(): HTMLInputElement | null {
    return (
      (this.renderRoot.querySelector(
        "#end-timer-value",
      ) as HTMLInputElement | null) ??
      (this.querySelector("#end-timer-value") as HTMLInputElement | null)
    );
  }

  private handleMaxTimerValueChanges = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const value = parseBoundedIntegerFromInput(input, {
      min: 1,
      max: 120,
      stripPattern: /[e+-]/gi,
    });

    this.maxTimerValue = value;
  };

  private handleGoldMultiplierValueKeyDown = (e: KeyboardEvent) => {
    preventDisallowedKeys(e, ["+", "-", "e", "E"]);
  };

  private handleGoldMultiplierValueChanges = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const value = parseBoundedFloatFromInput(input, { min: 0.1, max: 1000 });

    if (value === undefined) {
      this.goldMultiplierValue = undefined;
      input.value = "";
    } else {
      this.goldMultiplierValue = value;
    }
  };

  private handleStartingGoldValueKeyDown = (e: KeyboardEvent) => {
    preventDisallowedKeys(e, ["-", "+", "e", "E"]);
  };

  private handleStartingGoldValueChanges = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const value = parseBoundedFloatFromInput(input, {
      min: 0.1,
      max: 1000,
    });

    if (value === undefined) {
      this.startingGoldValue = undefined;
      input.value = "";
    } else {
      this.startingGoldValue = value;
    }
  };

  private adjustStartingGold(deltaMillions: number) {
    const current = this.startingGoldValue ?? 5;
    this.startingGoldValue = Math.max(
      0.1,
      Math.min(1000, Math.round((current + deltaMillions) * 10) / 10),
    );
  }

  private handleGameModeSelection(value: GameMode) {
    this.gameMode = value;
  }

  private handleTeamCountSelection(value: TeamCountConfig) {
    this.teamCount = value;
  }

  private setLocalGoToPlayer(value: boolean) {
    this.localGoToPlayer = value;
    this.localUserSettings.setGoToPlayer(value);
  }

  private setLocalPanSensitivity(value: number) {
    this.localUserSettings.setCameraPanSensitivity(value);
    this.localPanSensitivity = this.localUserSettings.cameraPanSensitivity();
  }

  private setLocalZoomSensitivity(value: number) {
    this.localUserSettings.setCameraZoomSensitivity(value);
    this.localZoomSensitivity = this.localUserSettings.cameraZoomSensitivity();
  }

  private setLocalGameSpeed(value: number) {
    this.localUserSettings.setLocalGameSpeed(value);
    this.localGameSpeed = this.localUserSettings.localGameSpeed();
  }

  private async startGame() {
    // Validate and clamp maxTimer setting before starting
    let finalMaxTimerValue: number | undefined = undefined;
    if (this.maxTimer) {
      if (!this.maxTimerValue || this.maxTimerValue <= 0) {
        console.error("Max timer is enabled but no valid value is set");
        alert(
          translateText("single_modal.max_timer_invalid") ||
            "Please enter a valid max timer value (1-120 minutes)",
        );
        // Focus the input
        const input = this.getEndTimerInput();
        if (input) {
          input.focus();
          input.select();
        }
        return;
      }
      // Clamp value to valid range
      finalMaxTimerValue = Math.max(1, Math.min(120, this.maxTimerValue));
    }

    console.log(
      `Starting single player game with map: ${GameMapType[this.selectedMap as keyof typeof GameMapType]}${this.useRandomMap ? " (Randomly selected)" : ""}`,
    );
    const localOnly = ClientEnv.isLocalOnly();
    const accountLevel = accountClient.current()?.level ?? 0;
    // A signed-in player flies their account country's flag here too (the
    // server applies it in multiplayer).
    const accountCountry = accountClient.current()?.country ?? null;

    const usernameInput = localOnly
      ? this.localCommanderInput
      : (document.querySelector("username-input") as UsernameInput | null);

    if (!usernameInput) {
      console.error("Commander name input not found");
      return;
    }

    // Wait for the one-shot Steam name-seed to settle before reading
    // getUsername(), so a fast single-player start uses the Steam persona
    // rather than the interim generated anon name. Always resolves.
    await usernameInput?.whenSeeded();

    if (!usernameInput.canPlay()) {
      usernameInput.querySelector("input")?.focus();
      return;
    }

    if (!localOnly) {
      await crazyGamesSDK.requestMidgameAd();
    }

    const config: GameConfig = {
      gameMap: this.selectedMap,
      gameMapSize: this.compactMap ? GameMapSize.Compact : GameMapSize.Normal,
      gameType: GameType.Singleplayer,
      gameMode: this.gameMode,
      playerTeams: this.teamCount,
      difficulty: this.selectedDifficulty,
      maxTimerValue: finalMaxTimerValue,
      bots: this.bots,
      infiniteGold: this.infiniteGold,
      donateGold: this.gameMode === GameMode.Team,
      donateTroops: this.gameMode === GameMode.Team,
      infiniteTroops: this.infiniteTroops,
      instantBuild: this.instantBuild,
      randomSpawn: this.randomSpawn,
      disabledUnits: this.disabledUnits
        .map((u) => Object.values(UnitType).find((ut) => ut === u))
        .filter((ut): ut is UnitType => ut !== undefined),
      nations: localOnly
        ? this.nations === 0
          ? "disabled"
          : this.nations
        : sliderToNationsConfig(this.nations, this.defaultNationCount),
      ...(this.goldMultiplier && this.goldMultiplierValue
        ? { goldMultiplier: this.goldMultiplierValue }
        : {}),
      ...(this.startingGold && this.startingGoldValue !== undefined
        ? {
            startingGold: Math.round(this.startingGoldValue * 1_000_000),
          }
        : {}),
      ...(this.customAlliances
        ? { customAllianceDuration: this.customAllianceMinutes ?? 0 }
        : {}),
      ...(this.waterNukes ? { waterNukes: true } : {}),
      ...(this.doomsdayClock
        ? {
            doomsdayClock: {
              enabled: true,
              speed: this.doomsdayClockSpeed,
            },
          }
        : {}),
      ...(localOnly
        ? {
            combinedArmsV1: true,
            combinedArmsV2: true,
            airSuperiorityV1: true,
            airportOperationsV1: true,
            depthProgression: this.depthProgression,
            matchTempo: this.matchTempo,
            victoryCondition: this.victoryCondition,
          }
        : {}),
    };
    const session = createSinglePlayerSession(config, localOnly);

    this.dispatchEvent(
      new CustomEvent("join-lobby", {
        detail: {
          gameID: session.gameID,
          gameStartInfo: {
            gameID: session.gameID,
            players: [
              {
                clientID: session.clientID,
                username: usernameInput.getUsername(),
                clanTag: usernameInput.getClanTag() ?? null,
                cosmetics: localOnly
                  ? {
                      color: { color: this.playerColor },
                      ...(accountCountry !== null
                        ? { flag: `/flags/${accountCountry}.svg` }
                        : {}),
                    }
                  : await getPlayerCosmetics(),
                // Signed-in players keep their head start in single player.
                ...(accountLevel > 0 ? { progressionLevel: accountLevel } : {}),
              },
            ],
            config: session.config,
            lobbyCreatedAt: Date.now(), // ms; server should be authoritative in MP
          },
          source: "singleplayer",
        } satisfies JoinLobbyEvent,
        bubbles: true,
        composed: true,
      }),
    );
    this.close(localOnly ? { skipNavigation: true } : undefined);
  }

  private async loadNationCount() {
    const currentMap = this.selectedMap;
    try {
      const mapData = this.mapLoader.getMapData(currentMap);
      const manifest = await mapData.manifest();
      // Only update if the map hasn't changed
      if (this.selectedMap === currentMap) {
        this.defaultNationCount = manifest.nations.length;
        if (!ClientEnv.isLocalOnly()) {
          this.nations = this.compactMap
            ? Math.max(0, Math.floor(manifest.nations.length * 0.25))
            : manifest.nations.length;
        }
      }
    } catch (error) {
      console.warn("Failed to load nation count", error);
      // Leave existing values unchanged so the UI stays consistent
    }
  }
}
