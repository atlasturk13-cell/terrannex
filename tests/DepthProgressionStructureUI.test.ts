import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BuildMenu,
  flattenedBuildTable,
} from "../src/client/hud/layers/BuildMenu";
import {
  depthFixedStructureNote,
  depthMaximumStructureNote,
  depthStructureUpgradeDetails,
} from "../src/client/hud/layers/lib/DepthStructureProgression";
import { columnById } from "../src/client/hud/layers/lib/StatsColumns";
import { unitCountDisplay } from "../src/client/hud/layers/lib/UnitCountDisplay";
import { UnitDisplay } from "../src/client/hud/layers/UnitDisplay";
import { SendUpgradeStructureIntentEvent } from "../src/client/Transport";
import { UIState } from "../src/client/UIState";
import { translateText } from "../src/client/Utils";
import type { GameView, PlayerView, UnitView } from "../src/client/view";
import { EventBus } from "../src/core/EventBus";
import {
  BuildableUnit,
  DepthProgressionStructures,
  UnitType,
} from "../src/core/game/Game";
import type { TileRef } from "../src/core/game/GameMap";
import { UserSettings } from "../src/core/game/UserSettings";

const STRUCTURES = DepthProgressionStructures.types;

function completedUnit(level = 3): UnitView {
  return {
    isUnderConstruction: () => false,
    level: () => level,
    airDefenseSystem: () => undefined,
  } as unknown as UnitView;
}

function depthPlayer(level = 3): PlayerView {
  const unit = completedUnit(level);
  return {
    buildables: async () => [],
    completedUnitCount: (type: UnitType) =>
      STRUCTURES.includes(type as (typeof STRUCTURES)[number]) ? 1 : 0,
    gold: () => 1_000_000n,
    id: () => 1,
    isAlive: () => true,
    totalUnitLevels: (type: UnitType) =>
      STRUCTURES.includes(type as (typeof STRUCTURES)[number]) ? level : 0,
    units: (type?: UnitType) =>
      type !== undefined &&
      STRUCTURES.includes(type as (typeof STRUCTURES)[number])
        ? [unit]
        : [],
  } as unknown as PlayerView;
}

function depthGame(player: PlayerView, level = 3): GameView {
  return {
    config: () => ({
      barracksPopulationIncrease: () => 50_000,
      barracksTroopRateMultiplier: (levels: number) =>
        Math.min(4, 1 + 0.25 * Math.max(0, levels)),
      cityTroopIncrease: () => 250_000,
      depthProgressionEnabled: () => true,
      effectivePortLevels: () => level,
      isUnitDisabled: () => false,
      maxTroops: () => 1_000_000,
      samRange: (nextLevel: number) => nextLevel * 12.5,
      airDefenseRadius: (_system: unknown, nextLevel: number) =>
        nextLevel * 12.5,
      structureMinDist: () => 4,
    }),
    inSpawnPhase: () => false,
    myPlayer: () => player,
    unit: () => completedUnit(level),
  } as unknown as GameView;
}

function installTranslations() {
  const selector = document.createElement("lang-selector") as HTMLElement & {
    currentLang: string;
    translations: Record<string, string>;
    defaultTranslations: Record<string, string>;
  };
  selector.currentLang = "en";
  selector.defaultTranslations = {};
  selector.translations = {
    "depth_progression.completed_port_count":
      "{physical_count} completed physical Ports; {aggregate_levels} aggregate effective levels",
    "depth_progression.completed_structure_count":
      "{physical_count} completed physical structures; {aggregate_levels} aggregate levels",
    "depth_progression.effect_barracks":
      "+{population, number} population, +{rate}% troop training speed",
    "depth_progression.effect_city": "+{capacity, number} population",
    "depth_progression.effect_factory": "+1 train-spawn attempt",
    "depth_progression.effect_missile_silo": "+1 missile tube",
    "depth_progression.effect_port":
      "+1 trade attempt, +1 berth, +5 HP/tick repair pool",
    "depth_progression.effect_sam_launcher":
      "+1 interceptor slot; range {range}",
    "depth_progression.fixed_level": "Fixed L1 · no upgrade",
    "depth_progression.maximum_level": "L5 maximum · no upgrade",
    "depth_progression.structure_upgrade":
      "L{current_level} → L{next_level} · next price {price} gold",
  };
  document.body.append(selector);
  (translateText as unknown as { langSelector: Element | null }).langSelector =
    null;
}

describe("depth structure progression UI", () => {
  beforeEach(() => {
    localStorage.clear();
    (
      UserSettings as unknown as { cache: Map<string, string | null> }
    ).cache.clear();
    installTranslations();
  });

  afterEach(() => {
    document.body.replaceChildren();
    (
      translateText as unknown as { langSelector: Element | null }
    ).langSelector = null;
  });

  it("separates physical completed structures from aggregate levels everywhere", async () => {
    const player = depthPlayer();
    const game = depthGame(player);
    const columnIds = [
      "ports",
      "cities",
      "factories",
      "silos",
      "sams",
      "barracks",
    ] as const;

    for (const [index, type] of STRUCTURES.entries()) {
      expect(unitCountDisplay(player, type, game.config())).toMatchObject({
        aggregateLevels: 3,
        physicalCount: 1,
        text: "1× · Σ3",
      });
      const column = columnById(columnIds[index]);
      expect(column.value?.(player, game)).toBe(1);
      expect(column.detail?.(player, game)).toBe(3);
    }

    const display = new UnitDisplay();
    display.game = game;
    display.eventBus = new EventBus();
    display.uiState = {
      attackRatio: 0.2,
      ghostStructure: null,
      rocketDirectionUp: true,
      upgradeMultiplier: 1,
    };
    display.init();
    document.body.append(display);
    display.tick();
    await display.updateComplete;
    expect(
      display.querySelectorAll(
        '[data-physical-count="1"][data-aggregate-levels="3"]',
      ),
    ).toHaveLength(6);
  });

  it("invalidates a queued placement immediately on hotbar type switch", async () => {
    const display = new UnitDisplay();
    display.game = depthGame(depthPlayer());
    display.eventBus = new EventBus();
    display.uiState = {
      attackRatio: 0.2,
      ghostStructure: UnitType.City,
      rocketDirectionUp: true,
      structurePlacementQueue: {
        confirmedTiles: [],
        generation: 4,
        remaining: 2,
        unitType: UnitType.City,
      },
      structurePlacementRevision: 4,
      upgradeMultiplier: 1,
    };
    Object.assign(display, {
      playerBuildables: [
        {
          canBuild: 12,
          canUpgrade: false,
          cost: 100n,
          ghostRailPaths: [],
          overlappingRailroads: [],
          type: UnitType.Factory,
        },
      ],
    });
    display.init();
    document.body.append(display);
    await display.updateComplete;

    display
      .querySelector<HTMLElement>('img[alt="factory"]')
      ?.closest<HTMLElement>(".cursor-pointer")
      ?.click();

    expect(display.uiState.ghostStructure).toBe(UnitType.Factory);
    expect(display.uiState.structurePlacementQueue).toBeUndefined();
    expect(display.uiState.structurePlacementRevision).toBe(5);
  });

  it("shows exact next-level price and the real effect for all six structures", () => {
    const game = depthGame(depthPlayer());
    const expectedEffects = new Map<UnitType, string>([
      [UnitType.Port, "+1 trade attempt, +1 berth, +5 HP/tick repair pool"],
      [UnitType.City, "+25,000 population"],
      [UnitType.Factory, "+1 train-spawn attempt"],
      [UnitType.MissileSilo, "+1 missile tube"],
      [UnitType.SAMLauncher, "+1 interceptor slot; range 50"],
      [UnitType.Barracks, "+5,000 population, +25% troop training speed"],
    ]);

    for (const type of STRUCTURES) {
      const details = depthStructureUpgradeDetails(game, {
        canBuild: false,
        canUpgrade: 77,
        cost: 450n,
        ghostRailPaths: [],
        overlappingRailroads: [],
        type,
      });
      expect(details).toMatchObject({
        cost: 450n,
        currentLevel: 3,
        effect: expectedEffects.get(type),
        nextLevel: 4,
        summary: "L3 → L4 · next price 450 gold",
      });
    }
  });

  it("renders an exact x1 upgrade and an honest fixed-L1 DefensePost", async () => {
    const player = depthPlayer();
    const game = depthGame(player);
    const eventBus = new EventBus();
    const emitted = vi.fn();
    eventBus.on(SendUpgradeStructureIntentEvent, emitted);
    const city: BuildableUnit = {
      canBuild: false,
      canUpgrade: 77,
      cost: 450n,
      ghostRailPaths: [],
      overlappingRailroads: [],
      type: UnitType.City,
      upgradeCosts: [450n, 1_150n],
    };
    const menu = new BuildMenu();
    menu.game = game;
    menu.eventBus = eventBus;
    menu.uiState = {
      attackRatio: 0.2,
      ghostStructure: null,
      rocketDirectionUp: true,
      upgradeMultiplier: 5,
    } as UIState;
    menu.playerBuildables = [city];
    document.body.append(menu);
    await menu.updateComplete;

    const upgrade = menu.shadowRoot?.querySelector(
      `[data-depth-upgrade="${UnitType.City}"]`,
    );
    expect(upgrade?.getAttribute("data-current-level")).toBe("3");
    expect(upgrade?.getAttribute("data-next-level")).toBe("4");
    expect(upgrade?.getAttribute("data-next-price")).toBe("450");
    expect(upgrade?.textContent).toContain("+25,000 population");
    menu.sendBuildOrUpgrade(city, 1 as never);
    expect(emitted).not.toHaveBeenCalled();
    await menu.updateComplete;
    expect(
      menu.shadowRoot
        ?.querySelector("[data-quantity-maximum]")
        ?.getAttribute("data-quantity-maximum"),
    ).toBe("2");
    menu.shadowRoot
      ?.querySelector<HTMLButtonElement>(".quantity-action.confirm")
      ?.click();
    expect(emitted).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1, unitType: UnitType.City }),
    );

    menu.playerBuildables = [
      {
        canBuild: 1 as TileRef,
        canUpgrade: false,
        cost: 10n,
        ghostRailPaths: [],
        overlappingRailroads: [],
        type: UnitType.DefensePost,
      },
    ];
    menu.requestUpdate();
    await menu.updateComplete;
    expect(
      menu.shadowRoot?.querySelector(
        `[data-depth-fixed-level="${UnitType.DefensePost}"]`,
      )?.textContent,
    ).toContain("Fixed L1 · no upgrade");
    expect(menu.shadowRoot?.querySelector("[data-depth-upgrade]")).toBeNull();
    expect(depthFixedStructureNote(game, UnitType.DefensePost)).toBe(
      "Fixed L1 · no upgrade",
    );
  });

  it("does not advertise an upgrade for an admitted structure already at L5", () => {
    const player = depthPlayer(5);
    const game = depthGame(player, 5);
    (game as unknown as { nearbyUnits: GameView["nearbyUnits"] }).nearbyUnits =
      () => [
        {
          distSquared: 0,
          unit: {
            isActive: () => true,
            isUnderConstruction: () => false,
            level: () => 5,
            airDefenseSystem: () => undefined,
            markedForDeletion: () => false,
            owner: () => player,
          } as unknown as UnitView,
        },
      ];
    expect(
      depthStructureUpgradeDetails(game, {
        canBuild: false,
        canUpgrade: 77,
        cost: 1_000n,
        ghostRailPaths: [],
        overlappingRailroads: [],
        type: UnitType.Port,
      }),
    ).toBeNull();
    expect(depthMaximumStructureNote(game, UnitType.Port, 1 as TileRef)).toBe(
      "L5 maximum · no upgrade",
    );
    expect(
      flattenedBuildTable.some(
        (item) => item.unitType === UnitType.DefensePost,
      ),
    ).toBe(true);
  });
});
