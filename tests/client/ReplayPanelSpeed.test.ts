import { describe, expect, it } from "vitest";
import {
  ReplaySpeedChangeEvent,
  RequestReplaySpeedEvent,
} from "../../src/client/InputHandler";
import {
  ReplayPanel,
  ShowReplayPanelEvent,
} from "../../src/client/hud/layers/ReplayPanel";
import { ReplaySpeedMultiplier } from "../../src/client/utilities/ReplaySpeedMultiplier";
import { EventBus } from "../../src/core/EventBus";

describe("ReplayPanel speed synchronization", () => {
  it("requests the scheduler speed whenever the panel opens", async () => {
    const eventBus = new EventBus();
    const panel = new ReplayPanel();
    panel.eventBus = eventBus;
    panel.init();
    document.body.appendChild(panel);

    let requests = 0;
    eventBus.on(RequestReplaySpeedEvent, () => {
      requests++;
      eventBus.emit(new ReplaySpeedChangeEvent(ReplaySpeedMultiplier.fast));
    });

    eventBus.emit(new ShowReplayPanelEvent(true, true));
    await panel.updateComplete;

    expect(requests).toBe(1);
    expect(
      (panel as unknown as { _replaySpeedMultiplier: number })
        ._replaySpeedMultiplier,
    ).toBe(ReplaySpeedMultiplier.fast);
    expect(panel.textContent).toContain("×2");
    expect(panel.textContent).not.toContain("Max");
    expect(panel.querySelectorAll("button")).toHaveLength(3);

    panel.remove();
  });

  it("keeps Max replay-only", async () => {
    const eventBus = new EventBus();
    const panel = new ReplayPanel();
    panel.eventBus = eventBus;
    panel.game = {
      config: () => ({ isReplay: () => true }),
    } as never;
    panel.init();
    document.body.appendChild(panel);
    eventBus.emit(new ShowReplayPanelEvent(true, true));
    await panel.updateComplete;

    const changes: ReplaySpeedMultiplier[] = [];
    eventBus.on(ReplaySpeedChangeEvent, (event) => {
      changes.push(event.replaySpeedMultiplier);
    });
    const buttons = panel.querySelectorAll("button");
    expect(buttons).toHaveLength(4);
    buttons[3].click();

    expect(changes).toEqual([ReplaySpeedMultiplier.fastest]);
    panel.remove();
  });
});
