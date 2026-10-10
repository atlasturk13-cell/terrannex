import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RadialMenu,
  type RadialMenuConfig,
} from "../../../src/client/hud/layers/RadialMenu";
import type {
  CenterButtonElement,
  MenuElement,
  MenuElementParams,
} from "../../../src/client/hud/layers/RadialMenuElements";

vi.mock("../../../src/client/Utils", () => ({
  getSvgAspectRatio: vi.fn(async () => 1),
  translateText: vi.fn((key: string) => key),
}));

function setup(reason = "Need more gold.") {
  const disabledAction = vi.fn();
  const enabledAction = vi.fn();
  const disabled: MenuElement = {
    id: "disabled-test",
    name: "Disabled test",
    text: "D",
    disabled: () => true,
    disabledReason: (params) =>
      (params as MenuElementParams & { reason?: string }).reason ?? reason,
    action: disabledAction,
  };
  const enabled: MenuElement = {
    id: "enabled-test",
    name: "Enabled test",
    text: "E",
    disabled: () => false,
    action: enabledAction,
  };
  const root: MenuElement = {
    id: "root",
    name: "Root",
    disabled: () => false,
    subMenu: () => [disabled, enabled],
  };
  const center: CenterButtonElement = {
    disabled: () => false,
    action: vi.fn(),
  };
  const eventBus = { on: vi.fn(), emit: vi.fn() };
  const config: RadialMenuConfig = { menuTransitionDuration: 0 };
  const radial = new RadialMenu(eventBus as never, root, center, config);
  radial.init();
  const params = {
    reason,
    game: { inSpawnPhase: () => false },
  } as unknown as MenuElementParams & { reason: string };
  radial.setParams(params);
  radial.showRadialMenu(320, 240);
  return { disabledAction, enabledAction, params, radial };
}

function path(id: string): SVGPathElement {
  const result = document.querySelector<SVGPathElement>(
    `.menu-item-path[data-id="${id}"]`,
  );
  if (!result) throw new Error(`Missing radial path: ${id}`);
  return result;
}

afterEach(() => {
  document.body.replaceChildren();
  document
    .querySelectorAll("style")
    .forEach(
      (style) =>
        style.textContent?.includes(".radial-tooltip") && style.remove(),
    );
});

describe("RadialMenu disabled reason panel", () => {
  it("keeps a below-ring reason visible without executing or closing", () => {
    const { disabledAction, radial } = setup();
    const disabledPath = path("disabled-test");
    const panel = document.querySelector<HTMLElement>(
      ".radial-disabled-reason",
    )!;

    expect(disabledPath.getAttribute("tabindex")).toBe("0");
    expect(disabledPath.getAttribute("role")).toBe("button");
    expect(disabledPath.getAttribute("aria-disabled")).toBe("true");
    expect(disabledPath.getAttribute("aria-describedby")).toBe(panel.id);
    expect(panel.textContent).toBe("Need more gold.");
    expect(panel.style.display).toBe("block");

    disabledPath.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    expect(panel.style.display).toBe("block");

    disabledPath.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(disabledAction).not.toHaveBeenCalled();
    expect(radial.isMenuVisible()).toBe(true);
  });

  it.each(["Enter", " "])(
    "handles disabled %s from the keyboard without executing",
    (key) => {
      const { disabledAction, radial } = setup("Unit is disabled.");
      const disabledPath = path("disabled-test");
      disabledPath.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key }),
      );

      expect(disabledAction).not.toHaveBeenCalled();
      expect(radial.isMenuVisible()).toBe(true);
      expect(
        document.querySelector<HTMLElement>(".radial-disabled-reason")
          ?.textContent,
      ).toBe("Unit is disabled.");
    },
  );

  it("handles a disabled touch without executing", () => {
    const { disabledAction, radial } = setup("Airport is full.");
    path("disabled-test").dispatchEvent(
      new Event("touchstart", { bubbles: true, cancelable: true }),
    );

    expect(disabledAction).not.toHaveBeenCalled();
    expect(radial.isMenuVisible()).toBe(true);
  });

  it("refreshes the reason from the latest params", () => {
    const { params, radial } = setup();
    params.reason = "Airport is rearming.";
    radial.refresh();

    expect(
      document.querySelector<HTMLElement>(".radial-disabled-reason")
        ?.textContent,
    ).toBe("Airport is rearming.");
  });

  it("executes an enabled item from Enter", () => {
    const { enabledAction, radial } = setup();
    path("enabled-test").dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
    );

    expect(enabledAction).toHaveBeenCalledOnce();
    expect(radial.isMenuVisible()).toBe(false);
  });
});
