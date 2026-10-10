import fs from "fs";
import path from "path";
import { BuildMenu } from "../../src/client/hud/layers/BuildMenu";
import type { GameView, PlayerView } from "../../src/client/view";
import { BuildableUnit, UnitType } from "../../src/core/game/Game";

const buildable = (type: BuildableUnit["type"]): BuildableUnit => ({
  type,
  canBuild: 1,
  canUpgrade: false,
  cost: 1n,
  ghostRailPaths: [],
  overlappingRailroads: [],
});

function gameStub(): GameView {
  const player = {
    completedUnitCount: () => 0,
    totalUnitLevels: () => 0,
    units: () => [],
  } as unknown as PlayerView;
  return {
    config: () => ({
      depthProgressionEnabled: () => false,
      effectivePortLevels: () => 0,
    }),
    myPlayer: () => player,
  } as unknown as GameView;
}

describe("BuildMenu command categories", () => {
  afterEach(() => document.body.replaceChildren());

  it("renders the four deterministic command branches with headings", async () => {
    const menu = new BuildMenu();
    menu.game = gameStub();
    menu.playerBuildables = [
      buildable(UnitType.City),
      buildable(UnitType.Warship),
      buildable(UnitType.FighterJet),
      buildable(UnitType.AtomBomb),
    ];
    Object.assign(menu, { _hidden: false, clickedTile: 1 });
    document.body.append(menu);
    await menu.updateComplete;

    const categories = [
      ...(menu.shadowRoot?.querySelectorAll<HTMLElement>(
        "[data-build-category]",
      ) ?? []),
    ];
    expect(
      categories.map((category) => category.dataset.buildCategory),
    ).toEqual(["land", "naval", "air", "strategic"]);
    expect(
      categories.every(
        (category) =>
          category.querySelector(".build-category-title")?.textContent?.trim()
            .length,
      ),
    ).toBe(true);
    expect(
      menu.shadowRoot
        ?.querySelector(".build-menu")
        ?.classList.contains("hidden"),
    ).toBe(false);
  });

  it("does not render category headings whose items are absent", async () => {
    const menu = new BuildMenu();
    menu.game = gameStub();
    menu.playerBuildables = [buildable(UnitType.AtomBomb)];
    Object.assign(menu, { _hidden: false, clickedTile: 1 });
    document.body.append(menu);
    await menu.updateComplete;

    expect(
      [
        ...(menu.shadowRoot?.querySelectorAll<HTMLElement>(
          "[data-build-category]",
        ) ?? []),
      ].map((category) => category.dataset.buildCategory),
    ).toEqual(["strategic"]);
  });

  it("ships explicit English and Turkish labels for every branch", () => {
    const root = path.resolve(__dirname, "../..");
    const en = JSON.parse(
      fs.readFileSync(path.join(root, "resources/lang/en.json"), "utf8"),
    );
    const tr = JSON.parse(
      fs.readFileSync(path.join(root, "resources/lang/tr.json"), "utf8"),
    );
    expect(en.build_menu.category).toEqual({
      air: "Air",
      land: "Land",
      naval: "Naval",
      strategic: "Strategic",
    });
    expect(tr.build_menu.category).toEqual({
      air: "Hava",
      land: "Kara",
      naval: "Deniz",
      strategic: "Stratejik",
    });
  });
});
