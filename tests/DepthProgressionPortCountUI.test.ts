import { render } from "lit";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BuildMenu,
  flattenedBuildTable,
} from "../src/client/hud/layers/BuildMenu";
import { PlayerInfoOverlay } from "../src/client/hud/layers/PlayerInfoOverlay";
import { PlayerStats } from "../src/client/hud/layers/PlayerStats";
import { TeamStats } from "../src/client/hud/layers/TeamStats";
import { UnitDisplay } from "../src/client/hud/layers/UnitDisplay";
import { columnById } from "../src/client/hud/layers/lib/StatsColumns";
import { unitCountDisplay } from "../src/client/hud/layers/lib/UnitCountDisplay";
import type { GameView, PlayerView } from "../src/client/view";
import { EventBus } from "../src/core/EventBus";
import { UnitType } from "../src/core/game/Game";
import { UserSettings } from "../src/core/game/UserSettings";

function portPlayer(
  id = "player",
  team = "Blue",
  totalPortLevels = 5,
): PlayerView {
  return {
    id: () => id,
    name: () => id,
    displayName: () => id,
    clanTag: () => null,
    team: () => team,
    isAlive: () => true,
    isOnSameTeam: () => false,
    isFriendly: () => false,
    isAlliedWith: () => false,
    alliances: () => [],
    getTraitorRemainingTicks: () => 0,
    type: () => "Human",
    cosmetics: {},
    outgoingAttacks: () => [],
    troops: () => 0,
    gold: () => 0n,
    units: () => [],
    buildables: async () => [],
    totalUnitLevels: (type: UnitType) =>
      type === UnitType.Port ? totalPortLevels : 0,
    completedUnitCount: (type: UnitType) => (type === UnitType.Port ? 1 : 0),
  } as unknown as PlayerView;
}

function gameView(players: PlayerView[], depthProgression: boolean): GameView {
  return {
    myPlayer: () => players[0] ?? null,
    playerViews: () => players,
    inSpawnPhase: () => false,
    config: () => ({
      depthProgressionEnabled: () => depthProgression,
      effectivePortLevels: () => 5,
      isUnitDisabled: () => false,
      maxTroops: () => 1_000,
    }),
    numLandTiles: () => 100,
    numTilesWithFallout: () => 0,
  } as unknown as GameView;
}

function expectDepthCount(
  element: Element | null,
  physical: number,
  levels: number,
) {
  expect(element).not.toBeNull();
  expect(element?.textContent?.trim()).toBe(`${physical}× · Σ${levels}`);
  expect(element?.getAttribute("data-physical-count")).toBe(String(physical));
  expect(element?.getAttribute("data-aggregate-levels")).toBe(String(levels));
  expect(element?.getAttribute("title")).toBe(
    "depth_progression.completed_port_count",
  );
  expect(element?.getAttribute("aria-label")).toBe(
    "depth_progression.completed_port_count",
  );
}

describe("depth progression Port count UI", () => {
  beforeEach(() => {
    localStorage.clear();
    (
      UserSettings as unknown as { cache: Map<string, string | null> }
    ).cache.clear();
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it("formats one physical L5 Port separately and preserves legacy text", () => {
    const player = portPlayer();
    expect(
      unitCountDisplay(
        player,
        UnitType.Port,
        gameView([player], true).config(),
      ),
    ).toEqual({
      text: "1× · Σ5",
      physicalCount: 1,
      aggregateLevels: 5,
      accessibleLabel: "depth_progression.completed_port_count",
    });
    expect(
      unitCountDisplay(
        player,
        UnitType.Port,
        gameView([player], false).config(),
      ),
    ).toEqual({
      text: "5",
    });

    const historicalL10 = portPlayer("historical", "Blue", 10);
    expect(
      unitCountDisplay(
        historicalL10,
        UnitType.Port,
        gameView([historicalL10], true).config(),
      ).text,
    ).toBe("1× · Σ5");
    expect(
      unitCountDisplay(
        historicalL10,
        UnitType.Port,
        gameView([historicalL10], false).config(),
      ).text,
    ).toBe("10");
  });

  it("renders distinct Port values in UnitDisplay and PlayerInfoOverlay", async () => {
    const player = portPlayer();
    const game = gameView([player], true);
    const unitDisplay = new UnitDisplay();
    unitDisplay.game = game;
    unitDisplay.eventBus = new EventBus();
    unitDisplay.uiState = {
      attackRatio: 0.2,
      ghostStructure: null,
      rocketDirectionUp: true,
      upgradeMultiplier: 1,
    };
    unitDisplay.init();
    document.body.append(unitDisplay);
    unitDisplay.tick();
    await unitDisplay.updateComplete;
    expectDepthCount(
      unitDisplay.querySelector('[data-physical-count="1"]'),
      1,
      5,
    );

    const overlay = new PlayerInfoOverlay();
    overlay.game = game;
    const target = document.createElement("div");
    document.body.append(target);
    const template = (
      overlay as unknown as {
        displayUnitCount(
          player: PlayerView,
          type: UnitType,
          icon: string,
        ): unknown;
      }
    ).displayUnitCount(player, UnitType.Port, "port.svg");
    render(template as Parameters<typeof render>[0], target);
    const depthPort = target.querySelector('[data-physical-count="1"]');
    expectDepthCount(depthPort, 1, 5);
    expect(depthPort?.classList).toContain("w-16");
    expect(depthPort?.classList).toContain("lg:w-20");

    overlay.game = gameView([player], false);
    const legacyTemplate = (
      overlay as unknown as {
        displayUnitCount(
          player: PlayerView,
          type: UnitType,
          icon: string,
        ): unknown;
      }
    ).displayUnitCount(player, UnitType.Port, "port.svg");
    render(legacyTemplate as Parameters<typeof render>[0], target);
    expect(target.firstElementChild?.textContent?.trim()).toBe("5");
    expect(target.firstElementChild?.classList).toContain("w-9");
    expect(target.firstElementChild?.classList).not.toContain("w-16");
    expect(target.firstElementChild?.hasAttribute("data-physical-count")).toBe(
      false,
    );
  });

  it("renders the BuildMenu chip without treating levels as Ports", async () => {
    const player = portPlayer();
    const game = gameView([player], true);
    const menu = new BuildMenu();
    menu.game = game;
    menu.playerBuildables = [
      {
        type: UnitType.Port,
        cost: 0n,
        canBuild: 0,
        canUpgrade: false,
        overlappingRailroads: [],
        ghostRailPaths: [],
      },
    ];
    document.body.append(menu);
    await menu.updateComplete;

    const portItem = flattenedBuildTable.find(
      (item) => item.unitType === UnitType.Port,
    )!;
    expect(menu.count(portItem)).toBe("1× · Σ5");
    expectDepthCount(
      menu.shadowRoot?.querySelector(
        '.build-count-chip[data-physical-count="1"]',
      ) ?? null,
      1,
      5,
    );

    menu.game = gameView([player], false);
    expect(menu.count(portItem)).toBe("5");
  });

  it("keeps StatsColumns sortable by physical count and carries levels as detail", () => {
    const player = portPlayer();
    const game = gameView([player], true);
    const ports = columnById("ports");

    expect(ports.value?.(player, game)).toBe(1);
    expect(ports.detail?.(player, game)).toBe(5);
    expect(
      ports.cell({ position: 1, name: "player", value: 1, detail: 5 }, game),
    ).toBe("1× · Σ5");

    const legacyGame = gameView([player], false);
    expect(ports.value?.(player, legacyGame)).toBe(5);
    expect(ports.detail?.(player, legacyGame)).toBeUndefined();
  });

  it("renders player and team stats with physical numeric totals and separate level totals", async () => {
    new UserSettings().setStatsColumns("player", ["ports"]);
    new UserSettings().setStatsColumns("team", ["ports"]);
    const players = [portPlayer("one"), portPlayer("two")];
    const game = gameView(players, true);

    const playerStats = new PlayerStats();
    playerStats.game = game;
    playerStats.visible = true;
    document.body.append(playerStats);
    playerStats.refresh();
    await playerStats.updateComplete;
    expectDepthCount(
      playerStats.querySelector(
        '.stats-table-row [data-physical-count="1"][data-aggregate-levels="5"]',
      ),
      1,
      5,
    );

    const teamStats = new TeamStats();
    teamStats.game = game;
    teamStats.visible = true;
    document.body.append(teamStats);
    teamStats.refresh();
    await teamStats.updateComplete;
    expectDepthCount(
      teamStats.querySelector(
        '.stats-table-row [data-physical-count="2"][data-aggregate-levels="10"]',
      ),
      2,
      10,
    );
  });
});
