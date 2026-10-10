import { vi, type Mock } from "vitest";
import {
  attackMenuElement,
  buildMenuElement,
  COLORS,
  MenuElementParams,
  rootMenuElement,
  Slot,
} from "../../../src/client/hud/layers/RadialMenuElements";
import { SendCommandAirPatrolIntentEvent } from "../../../src/client/Transport";
import { GameView, PlayerView } from "../../../src/client/view";
import {
  AirMissionType,
  PlayerType,
  StrikeTargetClass,
  UnitType,
} from "../../../src/core/game/Game";
import { TileRef } from "../../../src/core/game/GameMap";

vi.mock("../../../src/client/Utils", () => ({
  translateText: vi.fn((key: string) =>
    key === "depth_progression.maximum_level" ? "L5 maximum · no upgrade" : key,
  ),
  renderNumber: vi.fn((num: number) => num.toString()),
}));

vi.mock("../../../src/client/hud/layers/BuildMenu", async () => {
  const { UnitType } = await vi.importActual<
    typeof import("../../../src/core/game/Game")
  >("../../../src/core/game/Game");
  return {
    flattenedBuildTable: [
      {
        unitType: UnitType.City,
        key: "unit_type.city",
        description: "unit_type.city_desc",
        icon: "city-icon",
        countable: true,
      },
      {
        unitType: UnitType.Factory,
        key: "unit_type.factory",
        description: "unit_type.factory_desc",
        icon: "factory-icon",
        countable: true,
      },
      {
        unitType: UnitType.AtomBomb,
        key: "unit_type.atom_bomb",
        description: "unit_type.atom_bomb_desc",
        icon: "atom-bomb-icon",
        countable: false,
      },
      {
        unitType: UnitType.Warship,
        key: "unit_type.warship",
        description: "unit_type.warship_desc",
        icon: "warship-icon",
        countable: true,
      },
      {
        unitType: UnitType.FighterJet,
        key: "unit_type.fighter_jet",
        description: "unit_type.fighter_jet_desc",
        icon: "fighter-jet-icon",
        countable: true,
      },
      {
        unitType: UnitType.HydrogenBomb,
        key: "unit_type.hydrogen_bomb",
        description: "unit_type.hydrogen_bomb_desc",
        icon: "hydrogen-bomb-icon",
        countable: false,
      },
      {
        unitType: UnitType.MIRV,
        key: "unit_type.mirv",
        description: "unit_type.mirv_desc",
        icon: "mirv-icon",
        countable: false,
      },
    ],
  };
});

vi.mock("nanoid", () => ({
  customAlphabet: vi.fn(() => vi.fn(() => "mock-id")),
}));

vi.mock("dompurify", () => ({
  __esModule: true,
  default: {
    sanitize: vi.fn((str: string) => str),
  },
}));

describe("RadialMenuElements", () => {
  let mockParams: MenuElementParams;
  let mockPlayer: PlayerView;
  let mockGame: GameView;
  let mockBuildMenu: any;
  let mockPlayerActions: any;
  let mockTile: TileRef;

  beforeEach(() => {
    mockPlayer = {
      id: () => 1,
      isAlliedWith: vi.fn(() => false),
      isPlayer: vi.fn(() => true),
      isTraitor: vi.fn(() => false),
      isDisconnected: vi.fn(() => false),
    } as unknown as PlayerView;

    mockGame = {
      inSpawnPhase: vi.fn(() => false),
      isSpawnImmunityActive: vi.fn(() => false),
      owner: vi.fn(() => mockPlayer),
      isLand: vi.fn(() => true),
      config: vi.fn(() => ({
        theme: () => ({
          territoryColor: () => ({
            lighten: () => ({ alpha: () => ({ toRgbString: () => "#fff" }) }),
          }),
        }),
        isUnitDisabled: vi.fn(() => false),
      })),
    } as unknown as GameView;

    mockBuildMenu = {
      canBuildOrUpgrade: vi.fn(() => true),
      cost: vi.fn(() => 100),
      count: vi.fn(() => 5),
      sendBuildOrUpgrade: vi.fn(),
      showFighterMissions: vi.fn(),
      requestQuantity: vi.fn(),
    };

    mockPlayerActions = {
      buildableUnits: [
        { type: UnitType.City, canBuild: true, canUpgrade: false, cost: 100n },
        {
          type: UnitType.Factory,
          canBuild: true,
          canUpgrade: false,
          cost: 100n,
        },
        {
          type: UnitType.AtomBomb,
          canBuild: true,
          canUpgrade: false,
          cost: 100n,
        },
        {
          type: UnitType.Warship,
          canBuild: true,
          canUpgrade: false,
          cost: 100n,
        },
        {
          type: UnitType.FighterJet,
          canBuild: true,
          canUpgrade: false,
          cost: 100n,
        },
        {
          type: UnitType.HydrogenBomb,
          canBuild: true,
          canUpgrade: false,
          cost: 100n,
        },
        { type: UnitType.MIRV, canBuild: true, canUpgrade: false, cost: 100n },
        {
          type: UnitType.TransportShip,
          canBuild: true,
          canUpgrade: false,
          cost: 100n,
        },
      ],
      canAttack: true,
      interaction: {
        canSendAllianceRequest: true,
        canBreakAlliance: false,
        canDonateTroops: true,
        canDonateGold: true,
      },
    };

    mockTile = {} as TileRef;

    mockParams = {
      myPlayer: mockPlayer,
      selected: mockPlayer,
      tile: mockTile,
      playerActions: mockPlayerActions,
      game: mockGame,
      buildMenu: mockBuildMenu,
      emojiTable: {} as any,
      playerActionHandler: {} as any,
      playerPanel: {} as any,
      chatIntegration: {} as any,
      eventBus: { emit: vi.fn() } as any,
      closeMenu: vi.fn(),
    };
  });

  describe("attackMenuElement", () => {
    it("should have correct basic properties", () => {
      expect(attackMenuElement.id).toBe(Slot.Attack);
      expect(attackMenuElement.name).toBe("radial_attack");
      expect(attackMenuElement.icon).toBeDefined();
      expect(attackMenuElement.color).toBe(COLORS.attack);
    });

    it("should be disabled during spawn phase", () => {
      mockGame.inSpawnPhase = vi.fn(() => true);
      expect(attackMenuElement.disabled(mockParams)).toBe(true);
    });

    it("should be enabled when not in spawn phase", () => {
      mockGame.inSpawnPhase = vi.fn(() => false);
      expect(attackMenuElement.disabled(mockParams)).toBe(false);
    });

    it("should return attack submenu with attack units only", () => {
      const enemyPlayer = {
        id: () => 2,
        isPlayer: vi.fn(() => true),
      } as unknown as PlayerView;
      mockParams.selected = enemyPlayer;

      const subMenu = attackMenuElement.subMenu!(mockParams);

      expect(subMenu).toBeDefined();
      expect(subMenu.length).toBeGreaterThan(0);

      const attackUnitTypes = [
        UnitType.AtomBomb,
        UnitType.MIRV,
        UnitType.HydrogenBomb,
        UnitType.Warship,
        UnitType.FighterJet,
      ];
      const returnedUnitTypes = subMenu.map((item) => {
        const unitTypeStr = item.id.replace("attack_", "");
        return Object.values(UnitType).find(
          (type) => type.toString() === unitTypeStr,
        );
      });

      returnedUnitTypes.forEach((unitType) => {
        expect(attackUnitTypes).toContain(unitType);
      });
    });

    it("should not include construction units in attack menu", () => {
      const enemyPlayer = {
        id: () => 2,
        isPlayer: vi.fn(() => true),
      } as unknown as PlayerView;
      mockParams.selected = enemyPlayer;

      const subMenu = attackMenuElement.subMenu!(mockParams);

      const constructionUnitTypes = [UnitType.City, UnitType.Factory];
      const returnedUnitTypes = subMenu.map((item) => {
        const unitTypeStr = item.id.replace("attack_", "");
        return Object.values(UnitType).find(
          (type) => type.toString() === unitTypeStr,
        );
      });

      constructionUnitTypes.forEach((unitType) => {
        expect(returnedUnitTypes).not.toContain(unitType);
      });
    });

    it("should handle undefined params in submenu", () => {
      const subMenu = attackMenuElement.subMenu!(undefined as any);
      expect(subMenu).toEqual([]);
    });

    it("keeps the airborne CAP command hidden outside V2", () => {
      const subMenu = attackMenuElement.subMenu!(mockParams);
      expect(
        subMenu.find((item) => item.id === "attack_airborne_fighter_jets"),
      ).toBeUndefined();
    });

    it("hides manual airborne retasking in the one-purpose air-superiority profile", () => {
      mockGame.config = vi.fn(() => ({
        airSuperiorityV1Enabled: () => true,
        combinedArmsV2Enabled: () => true,
        isUnitDisabled: () => false,
      })) as unknown as GameView["config"];

      const subMenu = attackMenuElement.subMenu!(mockParams);

      expect(
        subMenu.find((item) => item.id === "attack_airborne_fighter_jets"),
      ).toBeUndefined();
    });

    it("places Jet Attack first in the Airport profile and targets hostile land only", () => {
      const enemy = {
        id: () => 2,
        isDisconnected: () => false,
        isFriendly: () => false,
        isPlayer: () => true,
        type: () => "Human",
      } as unknown as PlayerView;
      mockParams.playerActionHandler.handleAttack = vi.fn();
      const patrol = {
        aircraftState: () => ({
          mission: AirMissionType.CombatAirPatrol,
          phase: "patrolling",
        }),
        health: () => 300,
        id: () => 71,
        isActive: () => true,
        markedForDeletion: () => false,
        tile: () => 5,
      };
      Object.assign(mockPlayer, {
        isFriendly: () => false,
        units: (type: UnitType) =>
          type === UnitType.FighterJet ? [patrol] : [],
      });
      mockParams.selected = enemy;
      mockGame.config = vi.fn(() => ({
        airportOperationsV1Enabled: () => true,
        airSuperiorityV1Enabled: () => true,
        combinedArmsV2Enabled: () => true,
        isUnitDisabled: () => false,
      })) as unknown as GameView["config"];
      mockGame.isImpassable = vi.fn(() => false);
      mockGame.isLand = vi.fn(() => true);
      mockGame.isNationSpawnImmunityActive = vi.fn(() => false);
      mockGame.manhattanDist = vi.fn(() => 12);
      mockGame.owner = vi.fn(() => enemy);
      mockGame.units = vi.fn(() => []);

      const subMenu = attackMenuElement.subMenu!(mockParams);
      expect(subMenu[0].id).toBe("attack_airborne_fighter_jets");
      expect(subMenu[1].id).toBe("attack_ground");
      expect(subMenu[0].name).toBe("build_menu.air_mission.jet_attack");
      expect(subMenu[0].disabled(mockParams)).toBe(false);

      subMenu[0].action!(mockParams);
      const request = mockBuildMenu.requestQuantity.mock.calls[0][0];
      expect(request.max).toBe(1);
      request.onConfirm(1);
      expect(mockParams.eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 1,
          order: {
            mission: AirMissionType.PrecisionStrike,
            targetTile: mockTile,
          },
        }),
      );

      subMenu[1].action!(mockParams);
      expect(mockParams.playerActionHandler.handleAttack).toHaveBeenCalledWith(
        mockPlayer,
        2,
      );
    });

    it("offers strike plans with the victim's structure counts in the Airport profile", () => {
      const enemy = {
        id: () => 2,
        isDisconnected: () => false,
        isFriendly: () => false,
        isPlayer: () => true,
        type: () => "Human",
      } as unknown as PlayerView;
      const bystander = { id: () => 3 } as unknown as PlayerView;
      const patrol = {
        aircraftState: () => ({
          mission: AirMissionType.CombatAirPatrol,
          phase: "patrolling",
        }),
        health: () => 300,
        id: () => 71,
        isActive: () => true,
        markedForDeletion: () => false,
        tile: () => 5,
      };
      const structure = (
        type: UnitType,
        owner: PlayerView,
        active = true,
        deletion: number | false = false,
      ) => ({
        isActive: () => active,
        markedForDeletion: () => deletion,
        owner: () => owner,
        type: () => type,
      });
      const structures = [
        structure(UnitType.Factory, enemy),
        structure(UnitType.Factory, enemy),
        structure(UnitType.Factory, bystander),
        structure(UnitType.Factory, enemy, false),
        structure(UnitType.SAMLauncher, enemy),
        structure(UnitType.City, enemy, true, 12),
        structure(UnitType.Barracks, enemy),
      ];
      Object.assign(mockPlayer, {
        isFriendly: () => false,
        units: (type: UnitType) =>
          type === UnitType.FighterJet ? [patrol] : [],
      });
      mockParams.selected = enemy;
      mockGame.config = vi.fn(() => ({
        airportOperationsV1Enabled: () => true,
        airSuperiorityV1Enabled: () => true,
        combinedArmsV2Enabled: () => true,
        isUnitDisabled: () => false,
      })) as unknown as GameView["config"];
      mockGame.isImpassable = vi.fn(() => false);
      mockGame.isLand = vi.fn(() => true);
      mockGame.isNationSpawnImmunityActive = vi.fn(() => false);
      mockGame.manhattanDist = vi.fn(() => 12);
      mockGame.owner = vi.fn(() => enemy);
      mockGame.units = vi.fn((...types: UnitType[]) =>
        structures.filter((unit) => types.includes(unit.type())),
      ) as unknown as GameView["units"];

      const jetAttack = attackMenuElement.subMenu!(mockParams).find(
        (item) => item.id === "attack_airborne_fighter_jets",
      )!;
      jetAttack.action!(mockParams);
      const request = mockBuildMenu.requestQuantity.mock.calls[0][0];
      expect(request.strikeTargets).toEqual([
        { id: StrikeTargetClass.Tile, count: 1 },
        { id: StrikeTargetClass.Factories, count: 2 },
        { id: StrikeTargetClass.AirDefense, count: 1 },
        { id: StrikeTargetClass.DefensePosts, count: 0 },
        { id: StrikeTargetClass.MissileSilos, count: 0 },
        { id: StrikeTargetClass.Cities, count: 0 },
        { id: StrikeTargetClass.Ports, count: 0 },
        { id: StrikeTargetClass.Airports, count: 0 },
        { id: StrikeTargetClass.Barracks, count: 1 },
        { id: StrikeTargetClass.AllStructures, count: 4 },
      ]);

      request.onConfirm(1, [StrikeTargetClass.Factories]);
      expect(mockParams.eventBus.emit).toHaveBeenLastCalledWith(
        expect.objectContaining({
          amount: 1,
          order: {
            mission: AirMissionType.PrecisionStrike,
            targetTile: mockTile,
            targetClass: StrikeTargetClass.Factories,
          },
        }),
      );
      request.onConfirm(1, [StrikeTargetClass.Tile]);
      expect(mockParams.eventBus.emit).toHaveBeenLastCalledWith(
        expect.objectContaining({
          order: {
            mission: AirMissionType.PrecisionStrike,
            targetTile: mockTile,
          },
        }),
      );
      // Several plans travel as targetClasses in the canonical order.
      request.onConfirm(4, [
        StrikeTargetClass.MissileSilos,
        StrikeTargetClass.AirDefense,
      ]);
      expect(mockParams.eventBus.emit).toHaveBeenLastCalledWith(
        expect.objectContaining({
          amount: 4,
          order: {
            mission: AirMissionType.PrecisionStrike,
            targetTile: mockTile,
            targetClasses: [
              StrikeTargetClass.AirDefense,
              StrikeTargetClass.MissileSilos,
            ],
          },
        }),
      );
    });

    it("lists the airborne jets for the picker and sends the chosen IDs", () => {
      const enemy = {
        id: () => 2,
        isDisconnected: () => false,
        isFriendly: () => false,
        isPlayer: () => true,
        type: () => "Human",
      } as unknown as PlayerView;
      const jet = (
        id: number,
        tile: number,
        health: number,
        aircraftType?: string,
        phase = "patrolling",
      ) => ({
        aircraftState: () => ({
          mission: AirMissionType.CombatAirPatrol,
          phase,
          ...(aircraftType === undefined ? {} : { aircraftType }),
        }),
        health: () => health,
        id: () => id,
        isActive: () => true,
        markedForDeletion: () => false,
        tile: () => tile,
      });
      const jets = [
        jet(71, 40, 300),
        jet(72, 10, 600, "b2"),
        jet(73, 10, 900, "b2"),
        jet(74, 3, 300, undefined, "returning"),
      ];
      Object.assign(mockPlayer, {
        isFriendly: () => false,
        units: (type: UnitType) => (type === UnitType.FighterJet ? jets : []),
      });
      mockParams.selected = enemy;
      mockGame.config = vi.fn(() => ({
        airportOperationsV1Enabled: () => true,
        airSuperiorityV1Enabled: () => true,
        combinedArmsV2Enabled: () => true,
        isUnitDisabled: () => false,
      })) as unknown as GameView["config"];
      mockGame.isImpassable = vi.fn(() => false);
      mockGame.isLand = vi.fn(() => true);
      mockGame.isNationSpawnImmunityActive = vi.fn(() => false);
      mockGame.manhattanDist = vi.fn((a: number) => a);
      mockGame.owner = vi.fn(() => enemy);
      mockGame.units = vi.fn(() => []);

      const jetAttack = attackMenuElement.subMenu!(mockParams).find(
        (item) => item.id === "attack_airborne_fighter_jets",
      )!;
      expect(jetAttack.disabled(mockParams)).toBe(false);
      jetAttack.action!(mockParams);
      const request = mockBuildMenu.requestQuantity.mock.calls[0][0];
      expect(request.max).toBe(3);
      expect(request.jets).toEqual([
        {
          id: 72,
          aircraftType: "b2",
          distance: 10,
          health: 600,
          maxHealth: 1500,
        },
        {
          id: 73,
          aircraftType: "b2",
          distance: 10,
          health: 900,
          maxHealth: 1500,
        },
        {
          id: 71,
          aircraftType: undefined,
          distance: 40,
          health: 300,
          maxHealth: 300,
        },
      ]);

      request.onConfirm(2, [StrikeTargetClass.Tile], [73, 71]);
      expect(mockParams.eventBus.emit).toHaveBeenLastCalledWith(
        expect.objectContaining({
          amount: 2,
          order: {
            mission: AirMissionType.PrecisionStrike,
            targetTile: mockTile,
            fighterIds: [73, 71],
          },
        }),
      );
      request.onConfirm(1, [StrikeTargetClass.Factories], [72]);
      expect(mockParams.eventBus.emit).toHaveBeenLastCalledWith(
        expect.objectContaining({
          amount: 1,
          order: {
            mission: AirMissionType.PrecisionStrike,
            targetTile: mockTile,
            targetClass: StrikeTargetClass.Factories,
            fighterIds: [72],
          },
        }),
      );
    });

    it("keeps Jet Attack visible with simple reasons when it cannot fire", () => {
      const enemy = {
        id: () => 2,
        isDisconnected: () => false,
        isFriendly: () => false,
        isPlayer: () => true,
        type: () => "Human",
      } as unknown as PlayerView;
      Object.assign(mockPlayer, {
        isFriendly: () => false,
        units: () => [],
      });
      mockParams.selected = enemy;
      mockGame.config = vi.fn(() => ({
        airportOperationsV1Enabled: () => true,
        airSuperiorityV1Enabled: () => true,
        combinedArmsV2Enabled: () => true,
        isUnitDisabled: () => false,
      })) as unknown as GameView["config"];
      mockGame.isImpassable = vi.fn(() => false);
      mockGame.isLand = vi.fn(() => true);
      mockGame.isNationSpawnImmunityActive = vi.fn(() => false);
      mockGame.manhattanDist = vi.fn(() => 12);
      mockGame.owner = vi.fn(() => enemy);
      mockGame.units = vi.fn(() => []);

      const jetAttack = attackMenuElement.subMenu!(mockParams)[0];
      expect(jetAttack.id).toBe("attack_airborne_fighter_jets");
      expect(jetAttack.disabled(mockParams)).toBe(true);
      expect(jetAttack.disabledReason?.(mockParams)).toContain(
        "jet_attack_no_patrols",
      );
      expect(
        jetAttack.tooltipItems?.[jetAttack.tooltipItems.length - 1]?.text,
      ).toContain("jet_attack_no_patrols");

      Object.assign(mockPlayer, {
        units: () => [
          {
            aircraftState: () => ({
              mission: AirMissionType.CombatAirPatrol,
              phase: "patrolling",
            }),
            isActive: () => true,
            markedForDeletion: () => false,
          },
        ],
      });
      mockGame.isLand = vi.fn(() => false);
      expect(jetAttack.disabled(mockParams)).toBe(true);
      expect(jetAttack.disabledReason?.(mockParams)).toContain(
        "jet_attack_target_required",
      );
      expect(
        jetAttack.tooltipItems?.[jetAttack.tooltipItems.length - 1]?.text,
      ).toContain("jet_attack_target_required");
    });

    it("opens zero-cost quantity for active CAP jets and prioritizes a hostile fighter", () => {
      const capJets = [1, 2, 3].map((id) => ({
        aircraftState: () => ({
          mission: AirMissionType.CombatAirPatrol,
          phase: id === 1 ? "patrolling" : id === 2 ? "engaging" : "outbound",
        }),
        isActive: () => true,
        markedForDeletion: () => false,
      }));
      const enemy = {
        id: () => 2,
        isDisconnected: () => false,
        isFriendly: () => false,
        type: () => "Human",
      } as unknown as PlayerView;
      const hostileFighter = {
        aircraftState: () => ({ phase: "engaging" }),
        id: () => 90,
        isActive: () => true,
        owner: () => enemy,
        targetable: () => true,
        tile: () => mockTile,
      };
      const hostileWarship = {
        id: () => 12,
        isActive: () => true,
        owner: () => enemy,
        targetable: () => true,
        tile: () => mockTile,
        troops: () => 0,
        type: () => UnitType.Warship,
      };
      Object.assign(mockPlayer, {
        isFriendly: () => false,
        units: (type: UnitType) =>
          type === UnitType.FighterJet ? capJets : [],
      });
      mockGame.config = vi.fn(() => ({
        combinedArmsV2Enabled: () => true,
        isUnitDisabled: () => false,
      })) as unknown as GameView["config"];
      mockGame.isImpassable = vi.fn(() => false);
      mockGame.isNationSpawnImmunityActive = vi.fn(() => false);
      mockGame.units = vi.fn((...types: UnitType[]) =>
        types.includes(UnitType.FighterJet)
          ? [hostileFighter]
          : types.includes(UnitType.Warship)
            ? [hostileWarship]
            : [],
      ) as unknown as GameView["units"];

      const element = attackMenuElement.subMenu!(mockParams).find(
        (item) => item.id === "attack_airborne_fighter_jets",
      )!;
      expect(element).toBeDefined();
      expect(element.disabled(mockParams)).toBe(false);

      element.action!(mockParams);

      expect(mockParams.closeMenu).toHaveBeenCalledOnce();
      expect(mockBuildMenu.requestQuantity).toHaveBeenCalledOnce();
      expect(mockParams.eventBus.emit).not.toHaveBeenCalled();
      const request = mockBuildMenu.requestQuantity.mock.calls[0][0];
      expect(request).toEqual(
        expect.objectContaining({
          kind: "fighter",
          max: 2,
        }),
      );
      expect(request.totalCost(2)).toBe(0n);

      request.onConfirm(2);

      expect(mockParams.eventBus.emit).toHaveBeenCalledOnce();
      const emitted = (mockParams.eventBus.emit as Mock).mock.calls[0][0];
      expect(emitted).toBeInstanceOf(SendCommandAirPatrolIntentEvent);
      expect(emitted).toEqual(
        expect.objectContaining({
          amount: 2,
          order: {
            mission: AirMissionType.Intercept,
            targetUnitId: 90,
          },
        }),
      );
    });

    it("shows the V2 airborne leaf disabled without an eligible CAP jet", () => {
      Object.assign(mockPlayer, {
        isFriendly: () => false,
        units: () => [],
      });
      mockGame.config = vi.fn(() => ({
        combinedArmsV2Enabled: () => true,
        isUnitDisabled: () => false,
      })) as unknown as GameView["config"];
      mockGame.isImpassable = vi.fn(() => false);
      mockGame.isNationSpawnImmunityActive = vi.fn(() => false);
      mockGame.units = vi.fn(() => []) as unknown as GameView["units"];
      mockGame.owner = vi.fn(() => ({
        id: () => 2,
        isDisconnected: () => false,
        isFriendly: () => false,
        isPlayer: () => true,
        type: () => "Human",
      })) as unknown as GameView["owner"];

      const element = attackMenuElement.subMenu!(mockParams).find(
        (item) => item.id === "attack_airborne_fighter_jets",
      )!;
      expect(element).toBeDefined();
      expect(element.disabled(mockParams)).toBe(true);
      expect(element.tooltipItems?.map((item) => item.text)).toContain(
        "build_menu.air_mission.airborne_attack_no_patrols",
      );

      element.action!(mockParams);

      expect(mockParams.closeMenu).not.toHaveBeenCalled();
      expect(mockBuildMenu.requestQuantity).not.toHaveBeenCalled();
      expect(mockParams.eventBus.emit).not.toHaveBeenCalled();
    });

    it("falls back from a military ship to hostile passable land", () => {
      const capJet = {
        aircraftState: () => ({
          mission: AirMissionType.CombatAirPatrol,
          phase: "outbound",
        }),
        isActive: () => true,
        markedForDeletion: () => false,
      };
      const enemy = {
        id: () => 2,
        isDisconnected: () => false,
        isFriendly: () => false,
        isPlayer: () => true,
        type: () => "Human",
      } as unknown as PlayerView;
      const transportShip = {
        id: () => 44,
        isActive: () => true,
        owner: () => enemy,
        targetable: () => true,
        tile: () => mockTile,
        troops: () => 1_000,
        type: () => UnitType.TransportShip,
      };
      Object.assign(mockPlayer, {
        isFriendly: () => false,
        units: (type: UnitType) =>
          type === UnitType.FighterJet ? [capJet] : [],
      });
      mockGame.config = vi.fn(() => ({
        combinedArmsV2Enabled: () => true,
        isUnitDisabled: () => false,
      })) as unknown as GameView["config"];
      mockGame.isImpassable = vi.fn(() => false);
      mockGame.isNationSpawnImmunityActive = vi.fn(() => false);
      mockGame.owner = vi.fn(() => enemy) as unknown as GameView["owner"];
      mockGame.units = vi.fn((...types: UnitType[]) =>
        types.includes(UnitType.TransportShip) ? [transportShip] : [],
      ) as unknown as GameView["units"];

      attackMenuElement.subMenu!(mockParams).find(
        (item) => item.id === "attack_airborne_fighter_jets",
      )!.action!(mockParams);
      let request = mockBuildMenu.requestQuantity.mock.calls[0][0];
      request.onConfirm(1);
      expect(mockParams.eventBus.emit).toHaveBeenLastCalledWith(
        expect.objectContaining({
          order: {
            mission: AirMissionType.NavalStrike,
            targetUnitId: 44,
          },
        }),
      );

      mockBuildMenu.requestQuantity.mockClear();
      (mockParams.eventBus.emit as Mock).mockClear();
      mockGame.units = vi.fn(() => []) as unknown as GameView["units"];
      attackMenuElement.subMenu!(mockParams).find(
        (item) => item.id === "attack_airborne_fighter_jets",
      )!.action!(mockParams);
      request = mockBuildMenu.requestQuantity.mock.calls[0][0];
      request.onConfirm(1);
      expect(mockParams.eventBus.emit).toHaveBeenLastCalledWith(
        expect.objectContaining({
          order: {
            mission: AirMissionType.PrecisionStrike,
            targetTile: mockTile,
          },
        }),
      );
    });

    it("does not treat an empty Transport Ship as a military target", () => {
      const enemy = {
        id: () => 2,
        isDisconnected: () => false,
        isFriendly: () => false,
        type: () => "Human",
      } as unknown as PlayerView;
      Object.assign(mockPlayer, {
        isFriendly: () => false,
        units: () => [
          {
            aircraftState: () => ({
              mission: AirMissionType.CombatAirPatrol,
              phase: "patrolling",
            }),
            isActive: () => true,
            markedForDeletion: () => false,
          },
        ],
      });
      mockGame.config = vi.fn(() => ({
        combinedArmsV2Enabled: () => true,
        isUnitDisabled: () => false,
      })) as unknown as GameView["config"];
      mockGame.isLand = vi.fn(() => false);
      mockGame.isImpassable = vi.fn(() => false);
      mockGame.isNationSpawnImmunityActive = vi.fn(() => false);
      mockGame.units = vi.fn((...types: UnitType[]) =>
        types.includes(UnitType.TransportShip)
          ? [
              {
                id: () => 55,
                isActive: () => true,
                owner: () => enemy,
                targetable: () => true,
                tile: () => mockTile,
                troops: () => 0,
                type: () => UnitType.TransportShip,
              },
            ]
          : [],
      ) as unknown as GameView["units"];

      const element = attackMenuElement.subMenu!(mockParams).find(
        (item) => item.id === "attack_airborne_fighter_jets",
      )!;
      expect(element.disabled(mockParams)).toBe(true);
      expect(element.tooltipItems?.map((item) => item.text)).toContain(
        "build_menu.air_mission.airborne_attack_target_required",
      );
      element.action!(mockParams);
      expect(mockBuildMenu.requestQuantity).not.toHaveBeenCalled();
    });

    it("exposes the red attack branch for a hostile fighter over own territory", () => {
      const enemy = {
        id: () => 2,
        isDisconnected: () => false,
        isFriendly: () => false,
        type: () => "Human",
      } as unknown as PlayerView;
      Object.assign(mockPlayer, {
        isFriendly: () => false,
        units: () => [],
      });
      mockGame.config = vi.fn(() => ({
        combinedArmsV2Enabled: () => true,
        isUnitDisabled: () => false,
      })) as unknown as GameView["config"];
      mockGame.isImpassable = vi.fn(() => false);
      mockGame.isNationSpawnImmunityActive = vi.fn(() => false);
      mockGame.units = vi.fn((...types: UnitType[]) =>
        types.includes(UnitType.FighterJet)
          ? [
              {
                aircraftState: () => ({ phase: "engaging" }),
                id: () => 71,
                isActive: () => true,
                owner: () => enemy,
                targetable: () => true,
                tile: () => mockTile,
              },
            ]
          : [],
      ) as unknown as GameView["units"];

      const attack = rootMenuElement.subMenu!(mockParams).find(
        (item) => item.id === Slot.Attack,
      );
      expect(attack).toBeDefined();
      expect(
        attack?.subMenu!(mockParams).find(
          (item) => item.id === "attack_airborne_fighter_jets",
        ),
      ).toEqual(expect.objectContaining({ name: expect.any(String) }));
    });

    it("keeps airborne fighter and military-ship attacks reachable over allied territory", () => {
      const ally = {
        id: () => 2,
        isAlliedWith: () => true,
        isDisconnected: () => false,
        isFriendly: () => true,
        isPlayer: () => true,
        type: () => PlayerType.Human,
      } as unknown as PlayerView;
      const enemy = {
        id: () => 3,
        isDisconnected: () => false,
        isFriendly: () => false,
        type: () => PlayerType.Human,
      } as unknown as PlayerView;
      const capJet = {
        aircraftState: () => ({
          mission: AirMissionType.CombatAirPatrol,
          phase: "patrolling",
        }),
        isActive: () => true,
        markedForDeletion: () => false,
      };
      const hostileFighter = {
        aircraftState: () => ({ phase: "engaging" }),
        id: () => 91,
        isActive: () => true,
        owner: () => enemy,
        targetable: () => true,
        tile: () => mockTile,
      };
      const loadedTransport = {
        id: () => 92,
        isActive: () => true,
        owner: () => enemy,
        targetable: () => true,
        tile: () => mockTile,
        troops: () => 1_000,
        type: () => UnitType.TransportShip,
      };
      Object.assign(mockPlayer, {
        isFriendly: (player: PlayerView) => player.id() === ally.id(),
        units: (type: UnitType) =>
          type === UnitType.FighterJet ? [capJet] : [],
      });
      mockParams.selected = ally;
      mockPlayerActions.buildableUnits = [];
      mockGame.config = vi.fn(() => ({
        combinedArmsV2Enabled: () => true,
        isUnitDisabled: () => false,
      })) as unknown as GameView["config"];
      mockGame.isImpassable = vi.fn(() => false);
      mockGame.isNationSpawnImmunityActive = vi.fn(() => false);
      mockGame.owner = vi.fn(() => ally) as unknown as GameView["owner"];

      mockGame.units = vi.fn((...types: UnitType[]) =>
        types.includes(UnitType.FighterJet) ? [hostileFighter] : [],
      ) as unknown as GameView["units"];
      let rootAttack = rootMenuElement.subMenu!(mockParams).find(
        (item) => item.id === Slot.Attack,
      );
      expect(rootAttack?.name).toBe("radial_attack");
      expect(
        rootAttack?.subMenu!(mockParams)
          .find((item) => item.id === "attack_airborne_fighter_jets")
          ?.disabled(mockParams),
      ).toBe(false);

      mockGame.units = vi.fn((...types: UnitType[]) =>
        types.includes(UnitType.TransportShip) ? [loadedTransport] : [],
      ) as unknown as GameView["units"];
      rootAttack = rootMenuElement.subMenu!(mockParams).find(
        (item) => item.id === Slot.Attack,
      );
      expect(rootAttack?.name).toBe("radial_attack");
      expect(
        rootAttack?.subMenu!(mockParams)
          .find((item) => item.id === "attack_airborne_fighter_jets")
          ?.disabled(mockParams),
      ).toBe(false);

      mockGame.units = vi.fn(() => []) as unknown as GameView["units"];
      expect(
        rootMenuElement.subMenu!(mockParams).find(
          (item) => item.id === Slot.Attack,
        )?.name,
      ).toBe("radial_donate_gold");
    });

    it("rejects a disconnected allied unit like authoritative unit targeting", () => {
      const disconnectedAlly = {
        id: () => 2,
        isDisconnected: () => true,
        isFriendly: () => true,
        type: () => "Human",
      } as unknown as PlayerView;
      Object.assign(mockPlayer, {
        isFriendly: () => true,
        units: () => [
          {
            aircraftState: () => ({
              mission: AirMissionType.CombatAirPatrol,
              phase: "patrolling",
            }),
            isActive: () => true,
            markedForDeletion: () => false,
          },
        ],
      });
      mockGame.config = vi.fn(() => ({
        combinedArmsV2Enabled: () => true,
        isUnitDisabled: () => false,
      })) as unknown as GameView["config"];
      mockGame.isLand = vi.fn(() => false);
      mockGame.isImpassable = vi.fn(() => false);
      mockGame.isNationSpawnImmunityActive = vi.fn(() => false);
      mockGame.units = vi.fn((...types: UnitType[]) =>
        types.includes(UnitType.FighterJet)
          ? [
              {
                aircraftState: () => ({ phase: "engaging" }),
                id: () => 81,
                isActive: () => true,
                owner: () => disconnectedAlly,
                targetable: () => true,
                tile: () => mockTile,
              },
            ]
          : [],
      ) as unknown as GameView["units"];

      const element = attackMenuElement.subMenu!(mockParams).find(
        (item) => item.id === "attack_airborne_fighter_jets",
      )!;
      expect(element.disabled(mockParams)).toBe(true);
      element.action!(mockParams);
      expect(mockBuildMenu.requestQuantity).not.toHaveBeenCalled();
    });

    it("rejects a human target while global spawn immunity is active", () => {
      const immuneEnemy = {
        id: () => 2,
        isDisconnected: () => false,
        isFriendly: () => false,
        type: () => PlayerType.Human,
      } as unknown as PlayerView;
      Object.assign(mockPlayer, {
        isFriendly: () => false,
        units: () => [
          {
            aircraftState: () => ({
              mission: AirMissionType.CombatAirPatrol,
              phase: "patrolling",
            }),
            isActive: () => true,
            markedForDeletion: () => false,
          },
        ],
      });
      mockGame.config = vi.fn(() => ({
        combinedArmsV2Enabled: () => true,
        isUnitDisabled: () => false,
      })) as unknown as GameView["config"];
      mockGame.isLand = vi.fn(() => false);
      mockGame.isImpassable = vi.fn(() => false);
      mockGame.isNationSpawnImmunityActive = vi.fn(() => false);
      mockGame.isSpawnImmunityActive = vi.fn(() => true);
      mockGame.units = vi.fn((...types: UnitType[]) =>
        types.includes(UnitType.FighterJet)
          ? [
              {
                aircraftState: () => ({ phase: "engaging" }),
                id: () => 82,
                isActive: () => true,
                owner: () => immuneEnemy,
                targetable: () => true,
                tile: () => mockTile,
              },
            ]
          : [],
      ) as unknown as GameView["units"];

      const element = attackMenuElement.subMenu!(mockParams).find(
        (item) => item.id === "attack_airborne_fighter_jets",
      )!;
      expect(element.disabled(mockParams)).toBe(true);
      element.action!(mockParams);
      expect(mockBuildMenu.requestQuantity).not.toHaveBeenCalled();
    });
  });

  describe("buildMenuElement", () => {
    it("should have correct basic properties", () => {
      expect(buildMenuElement.id).toBe(Slot.Build);
      expect(buildMenuElement.name).toBe("build");
      expect(buildMenuElement.icon).toBeDefined();
      expect(buildMenuElement.color).toBe(COLORS.build);
    });

    it("should be disabled during spawn phase", () => {
      mockGame.inSpawnPhase = vi.fn(() => true);
      expect(buildMenuElement.disabled(mockParams)).toBe(true);
    });

    it("should be enabled when not in spawn phase", () => {
      mockGame.inSpawnPhase = vi.fn(() => false);
      expect(buildMenuElement.disabled(mockParams)).toBe(false);
    });

    it("should return build submenu with construction units only", () => {
      const subMenu = buildMenuElement.subMenu!(mockParams);

      expect(subMenu).toBeDefined();
      expect(subMenu.length).toBeGreaterThan(0);

      const constructionUnitTypes = [UnitType.City, UnitType.Factory];
      const returnedUnitTypes = subMenu.map((item) => {
        const unitTypeStr = item.id.replace("build_", "");
        return Object.values(UnitType).find(
          (type) => type.toString() === unitTypeStr,
        );
      });

      returnedUnitTypes.forEach((unitType) => {
        expect(constructionUnitTypes).toContain(unitType);
      });
    });

    it("should not include attack units in build menu", () => {
      const subMenu = buildMenuElement.subMenu!(mockParams);

      const attackUnitTypes = [
        UnitType.AtomBomb,
        UnitType.MIRV,
        UnitType.HydrogenBomb,
        UnitType.Warship,
        UnitType.FighterJet,
      ];
      const returnedUnitTypes = subMenu.map((item) => {
        const unitTypeStr = item.id.replace("build_", "");
        return Object.values(UnitType).find(
          (type) => type.toString() === unitTypeStr,
        );
      });

      attackUnitTypes.forEach((unitType) => {
        expect(returnedUnitTypes).not.toContain(unitType);
      });
    });

    it("should handle undefined params in submenu", () => {
      const subMenu = buildMenuElement.subMenu!(undefined as any);
      expect(subMenu).toEqual([]);
    });
  });

  describe("rootMenuElement", () => {
    it("should have correct basic properties", () => {
      expect(rootMenuElement.id).toBe("root");
      expect(rootMenuElement.name).toBe("root");
      expect(rootMenuElement.disabled(mockParams)).toBe(false);
    });

    it("should show build and delete menu on own territory", () => {
      const subMenu = rootMenuElement.subMenu!(mockParams);
      const buildMenu = subMenu.find((item) => item.id === Slot.Build);
      const attackMenu = subMenu.find((item) => item.id === Slot.Attack);
      const deleteMenu = subMenu.find((item) => item.id === Slot.Delete);

      expect(buildMenu).toBeDefined();
      expect(attackMenu).toBeUndefined();
      expect(deleteMenu).toBeDefined();
    });

    it("should show attack and boat menu on enemy territory", () => {
      const enemyPlayer = {
        id: () => 2,
        isPlayer: vi.fn(() => true),
      } as unknown as PlayerView;
      mockGame.owner = vi.fn(() => enemyPlayer);

      const subMenu = rootMenuElement.subMenu!(mockParams);
      const buildMenu = subMenu.find((item) => item.id === Slot.Build);
      const attackMenu = subMenu.find((item) => item.id === Slot.Attack);
      const boatMenu = subMenu.find((item) => item.id === Slot.Boat);

      expect(attackMenu).toBeDefined();
      expect(buildMenu).toBeUndefined();
      expect(boatMenu).toBeDefined();
    });

    it("should include info menu in both cases", () => {
      const subMenu = rootMenuElement.subMenu!(mockParams);
      const infoMenu = subMenu.find((item) => item.id === Slot.Info);

      expect(infoMenu).toBeDefined();
    });

    it("should handle ally menu correctly", () => {
      const allyPlayer = {
        id: () => 2,
        isAlliedWith: vi.fn(() => true),
        isPlayer: vi.fn(() => true),
        isTraitor: vi.fn(() => false),
        isDisconnected: vi.fn(() => false),
      } as unknown as PlayerView;
      mockParams.selected = allyPlayer;
      mockGame.owner = vi.fn(() => allyPlayer);

      const subMenu = rootMenuElement.subMenu!(mockParams);
      const allyMenu = subMenu.find((item) => item.id === "ally_break");

      expect(allyMenu).toBeDefined();
    });

    it("should show extend element when inAllianceExtensionWindow is true", () => {
      const allyPlayer = {
        id: () => 2,
        isAlliedWith: vi.fn(() => true),
        isPlayer: vi.fn(() => true),
      } as unknown as PlayerView;
      mockParams.selected = allyPlayer;
      mockGame.owner = vi.fn(() => allyPlayer);
      mockPlayerActions.interaction = {
        ...mockPlayerActions.interaction,
        canBreakAlliance: true,
        allianceInfo: {
          expiresAt: 100,
          inExtensionWindow: true,
          myPlayerAgreedToExtend: true,
          otherAgreedToExtend: false,
          canExtend: false,
        },
      };

      const subMenu = rootMenuElement.subMenu!(mockParams);
      const extendMenu = subMenu.find((item) => item.id === "ally_extend");

      expect(extendMenu).toBeDefined();
    });

    it("should not show extend element when inAllianceExtensionWindow is false", () => {
      const allyPlayer = {
        id: () => 2,
        isAlliedWith: vi.fn(() => true),
        isPlayer: vi.fn(() => true),
      } as unknown as PlayerView;
      mockParams.selected = allyPlayer;
      mockGame.owner = vi.fn(() => allyPlayer);
      mockPlayerActions.interaction = {
        ...mockPlayerActions.interaction,
        canBreakAlliance: true,
        allianceInfo: {
          expiresAt: 100,
          inExtensionWindow: false,
          myPlayerAgreedToExtend: false,
          otherAgreedToExtend: false,
          canExtend: false,
        },
      };

      const subMenu = rootMenuElement.subMenu!(mockParams);
      const extendMenu = subMenu.find((item) => item.id === "ally_extend");

      expect(extendMenu).toBeUndefined();
    });

    it("should show extend element as disabled when canExtend is false", () => {
      const allyPlayer = {
        id: () => 2,
        isAlliedWith: vi.fn(() => true),
        isPlayer: vi.fn(() => true),
      } as unknown as PlayerView;
      mockParams.selected = allyPlayer;
      mockGame.owner = vi.fn(() => allyPlayer);
      mockPlayerActions.interaction = {
        ...mockPlayerActions.interaction,
        canBreakAlliance: true,
        allianceInfo: {
          expiresAt: 100,
          inExtensionWindow: true,
          myPlayerAgreedToExtend: true,
          otherAgreedToExtend: false,
          canExtend: false,
        },
      };

      const subMenu = rootMenuElement.subMenu!(mockParams);
      const extendMenu = subMenu.find((item) => item.id === "ally_extend");

      expect(extendMenu).toBeDefined();
      expect(extendMenu!.disabled(mockParams)).toBe(true);
    });

    it("should show extend element as enabled when canExtend is true", () => {
      const allyPlayer = {
        id: () => 2,
        isAlliedWith: vi.fn(() => true),
        isPlayer: vi.fn(() => true),
      } as unknown as PlayerView;
      mockParams.selected = allyPlayer;
      mockGame.owner = vi.fn(() => allyPlayer);
      mockPlayerActions.interaction = {
        ...mockPlayerActions.interaction,
        canBreakAlliance: true,
        allianceInfo: {
          expiresAt: 100,
          inExtensionWindow: true,
          myPlayerAgreedToExtend: false,
          otherAgreedToExtend: false,
          canExtend: true,
        },
      };

      const subMenu = rootMenuElement.subMenu!(mockParams);
      const extendMenu = subMenu.find((item) => item.id === "ally_extend");

      expect(extendMenu).toBeDefined();
      expect(extendMenu!.disabled(mockParams)).toBe(false);
    });
  });

  describe("Menu element actions", () => {
    it("should execute build action correctly", () => {
      const subMenu = buildMenuElement.subMenu!(mockParams);
      const cityElement = subMenu.find((item) => item.id === "build_City");

      expect(cityElement).toBeDefined();
      expect(cityElement!.action).toBeDefined();

      if (cityElement!.action) {
        cityElement!.action(mockParams);
        expect(mockBuildMenu.sendBuildOrUpgrade).toHaveBeenCalledWith(
          expect.objectContaining({ type: UnitType.City }),
          mockTile,
        );
        expect(mockParams.eventBus.emit).not.toHaveBeenCalled();
        expect(mockParams.closeMenu).toHaveBeenCalled();
      }
    });

    it("should execute attack action correctly", () => {
      const enemyPlayer = {
        id: () => 2,
        isPlayer: vi.fn(() => true),
      } as unknown as PlayerView;
      mockParams.selected = enemyPlayer;

      const subMenu = attackMenuElement.subMenu!(mockParams);

      const atomBombElement = subMenu.find(
        (item) => item.id === "attack_Atom Bomb",
      );

      expect(atomBombElement).toBeDefined();
      expect(atomBombElement!.action).toBeDefined();

      if (atomBombElement!.action) {
        atomBombElement!.action(mockParams);
        expect(mockBuildMenu.sendBuildOrUpgrade).toHaveBeenCalledWith(
          expect.objectContaining({ type: UnitType.AtomBomb }),
          mockTile,
        );
        expect(mockParams.eventBus.emit).not.toHaveBeenCalled();
        expect(mockParams.closeMenu).toHaveBeenCalled();
      }
    });

    it("should not execute action when buildable unit is not found", () => {
      mockPlayerActions.buildableUnits = [];
      mockBuildMenu.canBuildOrUpgrade = vi.fn(() => false);

      const subMenu = buildMenuElement.subMenu!(mockParams);
      const cityElement = subMenu.find((item) => item.id === "build_City");

      if (cityElement!.action) {
        cityElement!.action(mockParams);
        expect(mockParams.eventBus.emit).not.toHaveBeenCalled();
        expect(mockParams.closeMenu).not.toHaveBeenCalled();
      }
    });

    it("routes upgrades to the shared quantity chooser without a radial bulk submenu", () => {
      mockPlayerActions.buildableUnits = [
        {
          type: UnitType.City,
          canBuild: true,
          canUpgrade: 123,
          cost: 100n,
          upgradeCosts: [100n, 250n, 450n, 700n, 1000n],
        },
      ];

      const subMenu = buildMenuElement.subMenu!(mockParams);
      const cityElement = subMenu.find((item) => item.id === "build_City");

      expect(cityElement!.subMenu!(mockParams)).toHaveLength(0);
      cityElement!.action!(mockParams);
      expect(mockParams.closeMenu).toHaveBeenCalledOnce();
      expect(mockBuildMenu.sendBuildOrUpgrade).toHaveBeenCalledWith(
        mockPlayerActions.buildableUnits[0],
        mockTile,
      );
      expect(mockParams.eventBus.emit).not.toHaveBeenCalled();
    });

    it("routes every radial ship and strategic launch through the shared chooser", () => {
      const enemyPlayer = {
        id: () => 2,
        isPlayer: vi.fn(() => true),
      } as unknown as PlayerView;
      mockParams.selected = enemyPlayer;

      const elements = attackMenuElement.subMenu!(mockParams);
      for (const type of [
        UnitType.Warship,
        UnitType.AtomBomb,
        UnitType.HydrogenBomb,
        UnitType.MIRV,
      ]) {
        const element = elements.find((item) => item.id === `attack_${type}`)!;
        expect(element.subMenu!(mockParams)).toEqual([]);
        element.action!(mockParams);
        expect(mockBuildMenu.sendBuildOrUpgrade).toHaveBeenCalledWith(
          expect.objectContaining({ type }),
          mockTile,
        );
      }
      expect(mockParams.eventBus.emit).not.toHaveBeenCalled();
    });

    it("opens the two-role fighter picker from the radial menu", () => {
      const enemyPlayer = {
        id: () => 2,
        isPlayer: vi.fn(() => true),
      } as unknown as PlayerView;
      mockParams.selected = enemyPlayer;
      mockBuildMenu.canBuildOrUpgrade = vi.fn(() => false);
      const fighter = attackMenuElement.subMenu!(mockParams).find(
        (item) => item.id === `attack_${UnitType.FighterJet}`,
      )!;

      expect(fighter.disabled(mockParams)).toBe(false);
      fighter.action!(mockParams);

      expect(mockParams.closeMenu).toHaveBeenCalledOnce();
      expect(mockBuildMenu.showFighterMissions).toHaveBeenCalledWith(
        mockTile,
        expect.objectContaining({
          canBuild: expect.anything(),
          cost: 100n,
          type: UnitType.FighterJet,
        }),
      );
      expect(mockBuildMenu.sendBuildOrUpgrade).not.toHaveBeenCalled();
      expect(mockParams.eventBus.emit).not.toHaveBeenCalled();
    });

    it("routes depth upgrades and AtomBomb launches through the same chooser", () => {
      const baseConfig = mockGame.config();
      mockGame.config = vi.fn(() => ({
        ...baseConfig,
        cityTroopIncrease: () => 250_000,
        depthProgressionEnabled: () => true,
        samRange: (level: number) => level * 10,
      })) as unknown as GameView["config"];
      (mockGame as any).unit = vi.fn(() => ({ level: () => 3 }));
      (mockGame as any).myPlayer = vi.fn(() => ({
        gold: () => 1_000_000n,
        readyMissileCount: () => 12,
      }));
      mockPlayerActions.buildableUnits = [
        {
          type: UnitType.City,
          canBuild: true,
          canUpgrade: 123,
          cost: 450n,
          upgradeCosts: [450n, 700n],
        },
        {
          type: UnitType.AtomBomb,
          canBuild: true,
          canUpgrade: false,
          cost: 100n,
          upgradeCosts: Array.from({ length: 12 }, (_, index) =>
            BigInt((index + 1) * 100),
          ),
        },
      ];

      const buildItems = buildMenuElement.subMenu!(mockParams);
      const cityElement = buildItems.find(
        (item) => item.id === `build_${UnitType.City}`,
      )!;
      expect(cityElement.subMenu!(mockParams)).toEqual([]);
      cityElement.action!(mockParams);
      expect(mockBuildMenu.sendBuildOrUpgrade).toHaveBeenLastCalledWith(
        expect.objectContaining({ type: UnitType.City }),
        mockTile,
      );
      expect(cityElement.tooltipItems?.map((item) => item.text)).toContain(
        "depth_progression.effect_city",
      );

      mockParams.selected = {
        id: () => 2,
        isPlayer: () => true,
      } as unknown as PlayerView;
      const attackItems = attackMenuElement.subMenu!(mockParams);
      const atomBombElement = attackItems.find(
        (item) => item.id === `attack_${UnitType.AtomBomb}`,
      )!;
      expect(atomBombElement.subMenu!(mockParams)).toHaveLength(0);
    });

    it("renders a depth L5 structure as an explicit maximum without a duplicate count suffix or price", () => {
      const baseConfig = mockGame.config();
      mockGame.config = vi.fn(() => ({
        ...baseConfig,
        depthProgressionEnabled: () => true,
        structureMinDist: () => 4,
      })) as unknown as GameView["config"];
      (mockGame as any).myPlayer = vi.fn(() => mockPlayer);
      (mockGame as any).nearbyUnits = vi.fn(() => [
        {
          unit: {
            isActive: () => true,
            isUnderConstruction: () => false,
            level: () => 5,
            markedForDeletion: () => false,
            owner: () => mockPlayer,
          },
        },
      ]);
      mockBuildMenu.count.mockReturnValue("1× · Σ5");
      mockPlayerActions.buildableUnits = [
        {
          type: UnitType.City,
          canBuild: false,
          canUpgrade: false,
          cost: 1_000_000n,
        },
      ];

      const cityElement = buildMenuElement.subMenu!(mockParams).find(
        (item) => item.id === `build_${UnitType.City}`,
      )!;
      const tooltipTexts = cityElement.tooltipItems!.map((item) => item.text);

      expect(tooltipTexts).toContain("L5 maximum · no upgrade");
      expect(tooltipTexts).toContain("1× · Σ5");
      expect(tooltipTexts).not.toContain("1× · Σ5x");
      expect(
        cityElement.tooltipItems!.some((item) => item.className === "cost"),
      ).toBe(false);
    });
  });

  describe("Menu element tooltips", () => {
    it("should generate correct tooltip items for build elements", () => {
      const subMenu = buildMenuElement.subMenu!(mockParams);
      const cityElement = subMenu.find((item) => item.id === "build_City");

      expect(cityElement!.tooltipItems).toBeDefined();
      expect(cityElement!.tooltipItems!.length).toBeGreaterThan(0);

      const tooltipTexts = cityElement!.tooltipItems!.map((item) => item.text);
      expect(tooltipTexts).toContain("unit_type.city");
      expect(tooltipTexts).toContain("unit_type.city_desc");
      expect(tooltipTexts.some((text) => text.includes("100"))).toBe(true);
      expect(tooltipTexts.some((text) => text.includes("5x"))).toBe(true);
    });

    it("should generate correct tooltip items for attack elements", () => {
      const enemyPlayer = {
        id: () => 2,
        isPlayer: vi.fn(() => true),
      } as unknown as PlayerView;
      mockParams.selected = enemyPlayer;

      const subMenu = attackMenuElement.subMenu!(mockParams);
      const atomBombElement = subMenu.find(
        (item) => item.id === "attack_Atom Bomb",
      );

      expect(atomBombElement!.tooltipItems).toBeDefined();
      expect(atomBombElement!.tooltipItems!.length).toBeGreaterThan(0);

      const tooltipTexts = atomBombElement!.tooltipItems!.map(
        (item) => item.text,
      );
      expect(tooltipTexts).toContain("unit_type.atom_bomb");
      expect(tooltipTexts).toContain("unit_type.atom_bomb_desc");
      expect(tooltipTexts.some((text) => text.includes("100"))).toBe(true);
    });
  });

  describe("Menu element colors", () => {
    it("should use correct colors for build elements", () => {
      const subMenu = buildMenuElement.subMenu!(mockParams);
      const cityElement = subMenu.find((item) => item.id === "build_City");

      expect(
        (cityElement!.color as (params: MenuElementParams) => string)(
          mockParams,
        ),
      ).toBe(COLORS.building);
    });

    it("should use correct colors for attack elements", () => {
      const enemyPlayer = {
        id: () => 2,
        isPlayer: vi.fn(() => true),
      } as unknown as PlayerView;
      mockParams.selected = enemyPlayer;

      const subMenu = attackMenuElement.subMenu!(mockParams);
      const atomBombElement = subMenu.find(
        (item) => item.id === "attack_Atom Bomb",
      );

      expect(
        (atomBombElement!.color as (params: MenuElementParams) => string)(
          mockParams,
        ),
      ).toBe(COLORS.attack);
    });

    it("should use disabled color when element is disabled", () => {
      mockBuildMenu.canBuildOrUpgrade = vi.fn(() => false);

      const subMenu = buildMenuElement.subMenu!(mockParams);
      const cityElement = subMenu.find((item) => item.id === "build_City");

      expect(
        (cityElement!.color as (params: MenuElementParams) => string)(
          mockParams,
        ),
      ).toBe(COLORS.building);
    });
  });

  describe("Translation integration", () => {
    it("should use translateText for tooltip items in build menu", async () => {
      const { translateText } = await vi.importMock<
        typeof import("../../../src/client/Utils")
      >("../../../src/client/Utils");

      (translateText as Mock).mockClear();

      buildMenuElement.subMenu!(mockParams);

      expect(translateText).toHaveBeenCalledWith("unit_type.city");
      expect(translateText).toHaveBeenCalledWith("unit_type.city_desc");
      expect(translateText).toHaveBeenCalledWith("unit_type.factory");
      expect(translateText).toHaveBeenCalledWith("unit_type.factory_desc");
    });

    it("should use translateText for tooltip items in attack menu", async () => {
      const { translateText } = await vi.importMock<
        typeof import("../../../src/client/Utils")
      >("../../../src/client/Utils");

      (translateText as Mock).mockClear();

      const enemyPlayer = {
        id: () => 2,
        isPlayer: vi.fn(() => true),
      } as unknown as PlayerView;
      mockParams.selected = enemyPlayer;

      attackMenuElement.subMenu!(mockParams);

      expect(translateText).toHaveBeenCalledWith("unit_type.atom_bomb");
      expect(translateText).toHaveBeenCalledWith("unit_type.atom_bomb_desc");
      expect(translateText).toHaveBeenCalledWith("unit_type.hydrogen_bomb");
      expect(translateText).toHaveBeenCalledWith(
        "unit_type.hydrogen_bomb_desc",
      );
    });
  });
});
