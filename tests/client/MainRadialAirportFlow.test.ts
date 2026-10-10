import { afterEach, describe, expect, it, vi } from "vitest";
import type { BuildMenu } from "../../src/client/hud/layers/BuildMenu";
import type { EmojiTable } from "../../src/client/hud/layers/EmojiTable";
import { MainRadialMenu } from "../../src/client/hud/layers/MainRadialMenu";
import type { PlayerPanel } from "../../src/client/hud/layers/PlayerPanel";
import type { TransformHandler } from "../../src/client/TransformHandler";
import type { UIState } from "../../src/client/UIState";
import type { GameView, PlayerView } from "../../src/client/view";
import { EventBus } from "../../src/core/EventBus";
import {
  type BuildableUnit,
  type PlayerActions,
  UnitType,
} from "../../src/core/game/Game";

describe("MainRadialMenu Airport entry", () => {
  afterEach(() => document.body.replaceChildren());

  it("opens the aircraft drawer directly when an owned Airport is clicked", async () => {
    document.body.append(document.createElement("chat-modal"));
    const fighterBuildable = {
      canBuild: 41,
      canUpgrade: false,
      cost: 100n,
      ghostRailPaths: [],
      overlappingRailroads: [],
      type: UnitType.FighterJet,
    } satisfies BuildableUnit;
    const actions = {
      buildableUnits: [fighterBuildable],
      canAttack: false,
      canSendEmojiAllPlayers: false,
    } satisfies PlayerActions;
    const airport = {
      id: () => 17,
      isActive: () => true,
      markedForDeletion: () => false,
      tile: () => 41,
    };
    const myPlayer = {
      units: (type: UnitType) => (type === UnitType.Airport ? [airport] : []),
    } as unknown as PlayerView;
    const showAirportLaunch = vi.fn();
    const buildMenu = {
      isChoosingAirportTarget: false,
      playerBuildables: null,
      showAirportLaunch,
    } as unknown as BuildMenu;
    const game = {
      config: () => ({ airportOperationsV1Enabled: () => true }),
    } as unknown as GameView;
    const uiState: UIState = {
      attackRatio: 0.5,
      ghostStructure: null,
      rocketDirectionUp: true,
      upgradeMultiplier: 1,
    };
    const menu = new MainRadialMenu(
      new EventBus(),
      game,
      {} as TransformHandler,
      {} as EmojiTable,
      buildMenu,
      uiState,
      {} as PlayerPanel,
    );

    await (
      menu as unknown as {
        updatePlayerActions(
          player: PlayerView,
          actions: PlayerActions,
          tile: number,
          x: number,
          y: number,
        ): Promise<void>;
      }
    ).updatePlayerActions(myPlayer, actions, 41, 200, 120);

    expect(showAirportLaunch).toHaveBeenCalledOnce();
    expect(showAirportLaunch).toHaveBeenCalledWith(17, 41, fighterBuildable);
  });
});
