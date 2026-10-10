import fs from "fs";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { annotationAt } from "../../src/client/hud/layers/annotation/AnnotationResolver";
import {
  BuildMenu,
  buildTable,
  flattenedBuildTable,
} from "../../src/client/hud/layers/BuildMenu";
import { columnById } from "../../src/client/hud/layers/lib/StatsColumns";
import type { GameView } from "../../src/client/view";
import { EventBus } from "../../src/core/EventBus";
import {
  StrikeTargetClass,
  Structures,
  UnitType,
} from "../../src/core/game/Game";

type Locale = Record<string, unknown>;

function english(): Locale {
  return JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "resources/lang/en.json"), "utf8"),
  ) as Locale;
}

function lookup(locale: Locale, key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>(
      (node, part) =>
        node !== null && typeof node === "object"
          ? (node as Locale)[part]
          : undefined,
      locale,
    );
}

afterEach(() => document.body.replaceChildren());

describe("Barracks build entry", () => {
  it("sits in the land row right after City with its own icon and copy", () => {
    const land = buildTable[0].map((item) => item.unitType);
    expect(land.indexOf(UnitType.Barracks)).toBe(
      land.indexOf(UnitType.City) + 1,
    );

    const entry = flattenedBuildTable.find(
      (item) => item.unitType === UnitType.Barracks,
    );
    expect(entry).toMatchObject({
      countable: true,
      description: "build_menu.desc.barracks",
      key: "unit_type.barracks",
    });
    expect(entry?.icon).toContain("BarracksIconWhite");
  });

  it("gives every structure one build-table entry", () => {
    for (const type of Structures.types) {
      expect(
        flattenedBuildTable.filter((item) => item.unitType === type),
      ).toHaveLength(1);
    }
  });

  it("has English copy for every Barracks key and population wording for City", () => {
    const en = english();
    expect(lookup(en, "unit_type.barracks")).toBe("Barracks");
    expect(lookup(en, "build_menu.quantity.strike_target.barracks")).toBe(
      "Barracks",
    );
    expect(lookup(en, "player_stats_table.unit.brck")).toBe("Barracks");
    for (const key of [
      "build_menu.desc.barracks",
      "depth_progression.effect_barracks",
      "game_settings.unit_barracks_desc",
      "help_modal.build_barracks_desc",
      "leaderboard.barracks",
      "user_setting.build_barracks",
      "user_setting.build_barracks_desc",
    ]) {
      expect(typeof lookup(en, key), key).toBe("string");
    }
    for (const key of [
      "build_menu.desc.city",
      "depth_progression.effect_city",
      "game_settings.unit_city_desc",
      "help_modal.build_city_desc",
    ]) {
      const text = lookup(en, key) as string;
      expect(text, key).toMatch(/population/);
      expect(text, key).not.toMatch(
        /troop limit|max population|troop capacity/i,
      );
    }
  });

  it("offers a Barracks leaderboard column counted like the other structures", () => {
    const column = columnById("barracks");
    expect(column.labelKey).toBe("leaderboard.barracks");
    expect(column.headerVisual).toMatchObject({ kind: "icon" });
  });
});

describe("Barracks hover name", () => {
  it("names a Barracks by its type", () => {
    const W = 100;
    const ref = (x: number, y: number) => y * W + x;
    const barracks = {
      id: () => 12,
      type: () => UnitType.Barracks,
      tile: () => ref(30, 30),
      isActive: () => true,
      aircraftState: () => ({}),
    };
    const game = {
      isValidCoord: (x: number, y: number) =>
        x >= 0 && y >= 0 && x < W && y < W,
      ref,
      owner: () => ({ isPlayer: () => false }),
      isLand: () => true,
      isOcean: () => false,
      nearbyUnits: (_tile: number, _range: number, types: UnitType[]) =>
        types.includes(UnitType.Barracks)
          ? [{ unit: barracks, distSquared: 1 }]
          : [],
    };
    expect(annotationAt(game, 31, 30)).toEqual({
      kind: "unit",
      label: { key: "unit_type.barracks" },
      tile: ref(30, 30),
      unitId: 12,
    });
  });
});

describe("Barracks strike plan chip", () => {
  it("labels the Barracks plan with its own key and has English for every plan", async () => {
    const en = english();
    for (const id of Object.values(StrikeTargetClass)) {
      expect(
        typeof lookup(en, `build_menu.quantity.strike_target.${id}`),
        id,
      ).toBe("string");
    }

    const menu = new BuildMenu();
    menu.game = {
      config: () => ({
        airportOperationsV1Enabled: () => true,
        airSuperiorityV1Enabled: () => true,
        combinedArmsV2Enabled: () => true,
        depthProgressionEnabled: () => false,
        effectivePortLevels: () => 0,
      }),
      isSpawnImmunityActive: () => false,
      myPlayer: () => ({ gold: () => 0n }),
      ticks: () => 1,
    } as unknown as GameView;
    menu.eventBus = new EventBus();
    document.body.append(menu);
    menu.requestQuantity({
      kind: "fighter",
      itemName: "Jet Attack",
      max: 5,
      sharedTarget: true,
      strikeTargets: [
        { id: StrikeTargetClass.Tile, count: 1 },
        { id: StrikeTargetClass.Barracks, count: 2 },
      ],
      totalCost: () => 0n,
      onConfirm: () => {},
    });
    await menu.updateComplete;

    const chip = menu.shadowRoot?.querySelector<HTMLButtonElement>(
      '[data-strike-target="barracks"]',
    );
    expect(chip).not.toBeNull();
    expect(chip?.disabled).toBe(false);
    expect(chip?.textContent).toContain(
      "build_menu.quantity.strike_target.barracks",
    );
    expect(chip?.textContent).toContain("2");
  });
});
