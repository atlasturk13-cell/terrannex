import { afterEach, describe, expect, it } from "vitest";
import { BuildMenu } from "../../src/client/hud/layers/BuildMenu";
import { LaunchAirMissionIntentEvent } from "../../src/client/Transport";
import type { GameView } from "../../src/client/view";
import { EventBus } from "../../src/core/EventBus";
import {
  AircraftType,
  AirMissionType,
  BuildableUnit,
  PATROL_AIRCRAFT_TYPES,
  UnitType,
} from "../../src/core/game/Game";

function fighterBuildable(cost = 100n): BuildableUnit {
  return {
    canBuild: 1,
    canUpgrade: false,
    cost,
    ghostRailPaths: [],
    overlappingRailroads: [],
    type: UnitType.FighterJet,
  };
}

function airportMenu(gold = 10_000n) {
  const airport = {
    id: () => 41,
    isActive: () => true,
    isUnderConstruction: () => false,
    markedForDeletion: () => false,
    missileTimerQueue: () => [],
    tile: () => 1,
  };
  const player = {
    completedUnitCount: () => 0,
    gold: () => gold,
    isFriendly: () => false,
    totalUnitLevels: () => 0,
    units: (type: UnitType) => (type === UnitType.Airport ? [airport] : []),
  };
  const eventBus = new EventBus();
  const emitted: LaunchAirMissionIntentEvent[] = [];
  eventBus.on(LaunchAirMissionIntentEvent, (event) => emitted.push(event));
  const menu = new BuildMenu();
  menu.game = {
    config: () => ({
      airportOperationsV1Enabled: () => true,
      airSuperiorityV1Enabled: () => true,
      combinedArmsV2Enabled: () => true,
      depthProgressionEnabled: () => false,
      effectivePortLevels: () => 0,
      fighterLaunchCooldown: () => 100,
      fighterMaxActive: () => 2,
    }),
    isSpawnImmunityActive: () => false,
    myPlayer: () => player,
    ticks: () => 200,
    units: () => [],
  } as unknown as GameView;
  menu.eventBus = eventBus;
  menu.playerBuildables = [fighterBuildable()];
  Object.assign(menu, {
    _hidden: false,
    clickedTile: 23,
    fighterMissionPicker: true,
  });
  document.body.append(menu);
  return { menu, emitted };
}

afterEach(() => document.body.replaceChildren());

describe("Air Superiority Patrol airframe step", () => {
  it("asks for one of the eight airframes after the patrol role and launches the chosen one", async () => {
    const { menu, emitted } = airportMenu();
    await menu.updateComplete;

    menu.shadowRoot
      ?.querySelector<HTMLButtonElement>(
        '[data-fighter-role="air_superiority_patrol"]',
      )
      ?.click();
    await menu.updateComplete;

    const cards = [
      ...(menu.shadowRoot?.querySelectorAll<HTMLElement>(
        "[data-patrol-aircraft]",
      ) ?? []),
    ];
    expect(cards.map((card) => card.dataset.patrolAircraft)).toEqual([
      ...PATROL_AIRCRAFT_TYPES,
    ]);
    expect(menu.shadowRoot?.querySelector(".quantity-dialog")).toBeNull();
    expect(menu.shadowRoot?.querySelector("[data-aircraft-type]")).toBeNull();
    expect(menu.shadowRoot?.textContent).toContain(
      "build_menu.air_mission.patrol_aircraft_hint",
    );
    const card = (type: AircraftType) =>
      cards.find((candidate) => candidate.dataset.patrolAircraft === type)!;
    expect(card(AircraftType.F35).textContent).toContain(
      "build_menu.airport_launch.aircraft.f35.name",
    );
    expect(card(AircraftType.F35).textContent).toContain(
      "build_menu.air_mission.patrol_aircraft.f35",
    );
    expect(card(AircraftType.B2).textContent).toContain(
      "build_menu.airport_launch.aircraft.b2.name",
    );
    expect(card(AircraftType.B2).textContent).toContain(
      "build_menu.airport_launch.aircraft_stats",
    );
    expect(card(AircraftType.KAAN).textContent).toContain(
      "build_menu.airport_launch.aircraft.kaan.name",
    );
    expect(cards.map((card) => card.getAttribute("aria-disabled"))).toEqual(
      Array<string>(PATROL_AIRCRAFT_TYPES.length).fill("false"),
    );

    card(AircraftType.B2).click();
    await menu.updateComplete;
    const dialog =
      menu.shadowRoot?.querySelector<HTMLElement>(".quantity-dialog");
    expect(dialog?.dataset.quantityKind).toBe("fighter");
    // 10,000 gold buys 20 B-2 sorties at five times the fighter price.
    expect(
      menu.shadowRoot?.querySelector<HTMLElement>(".quantity-limit")?.dataset
        .quantityMaximum,
    ).toBe("20");
    expect(
      menu.shadowRoot?.querySelector(".quantity-summary")?.textContent,
    ).toContain("500");

    menu.shadowRoot
      ?.querySelector<HTMLButtonElement>('[data-quantity-preset="2"]')
      ?.click();
    await menu.updateComplete;
    expect(
      menu.shadowRoot?.querySelector(".quantity-summary")?.textContent,
    ).toContain("1.00K");
    menu.shadowRoot
      ?.querySelector<HTMLButtonElement>(".quantity-action.confirm")
      ?.click();

    expect(emitted).toHaveLength(1);
    expect(emitted[0].amount).toBe(2);
    expect(emitted[0].order).toEqual({
      mission: AirMissionType.CombatAirPatrol,
      targetTile: 23,
      aircraftType: AircraftType.B2,
    });
    expect(menu.isVisible).toBe(false);
  });

  it("returns to the roles from the airframe step and prices the F-16 at base cost", async () => {
    const { menu, emitted } = airportMenu();
    await menu.updateComplete;
    menu.shadowRoot
      ?.querySelector<HTMLButtonElement>(".fighter-mission-button")
      ?.click();
    await menu.updateComplete;
    expect(
      menu.shadowRoot?.querySelectorAll("[data-patrol-aircraft]"),
    ).toHaveLength(PATROL_AIRCRAFT_TYPES.length);

    menu.shadowRoot
      ?.querySelector<HTMLButtonElement>(".fighter-mission-back")
      ?.click();
    await menu.updateComplete;
    expect(menu.shadowRoot?.querySelector("[data-patrol-aircraft]")).toBeNull();
    expect(
      menu.shadowRoot?.querySelector(
        '[data-fighter-role="air_superiority_patrol"]',
      ),
    ).not.toBeNull();

    menu.shadowRoot
      ?.querySelector<HTMLButtonElement>(".fighter-mission-button")
      ?.click();
    await menu.updateComplete;
    menu.shadowRoot
      ?.querySelector<HTMLButtonElement>('[data-patrol-aircraft="f16"]')
      ?.click();
    await menu.updateComplete;
    expect(
      menu.shadowRoot?.querySelector<HTMLElement>(".quantity-limit")?.dataset
        .quantityMaximum,
    ).toBe("100");
    menu.shadowRoot
      ?.querySelector<HTMLButtonElement>(".quantity-action.confirm")
      ?.click();
    expect(emitted[0].order).toEqual({
      mission: AirMissionType.CombatAirPatrol,
      targetTile: 23,
      aircraftType: AircraftType.F16,
    });
  });

  it("keeps the airframe cards visible but inert while the Airport is not ready", async () => {
    const { menu } = airportMenu(10n);
    await menu.updateComplete;
    menu.shadowRoot
      ?.querySelector<HTMLButtonElement>(".fighter-mission-button")
      ?.click();
    await menu.updateComplete;
    // Roles are inert without gold, so the airframe step never opens.
    expect(menu.shadowRoot?.querySelector("[data-patrol-aircraft]")).toBeNull();

    Object.assign(menu, {
      patrolModelOrder: {
        mission: AirMissionType.CombatAirPatrol,
        targetTile: 23,
      },
    });
    menu.requestUpdate();
    await menu.updateComplete;
    const cards = [
      ...(menu.shadowRoot?.querySelectorAll<HTMLElement>(
        "[data-patrol-aircraft]",
      ) ?? []),
    ];
    expect(cards).toHaveLength(PATROL_AIRCRAFT_TYPES.length);
    expect(cards.map((card) => card.getAttribute("aria-disabled"))).toEqual(
      Array<string>(PATROL_AIRCRAFT_TYPES.length).fill("true"),
    );
    cards[2].click();
    await menu.updateComplete;
    expect(menu.shadowRoot?.querySelector(".quantity-dialog")).toBeNull();
  });
});
