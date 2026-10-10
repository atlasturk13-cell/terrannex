import { describe, expect, it } from "vitest";
import { isAtWar } from "../../src/client/ClientGameRunner";
import type { PlayerView } from "../../src/client/view";

function player(opts: {
  alive?: boolean;
  incoming?: number[];
  outgoing?: number[];
}): PlayerView {
  const attack = (targetID: number) => ({
    attackerID: 1,
    targetID,
    troops: 10,
    id: `a${targetID}`,
    retreating: false,
  });
  return {
    isAlive: () => opts.alive ?? true,
    incomingAttacks: () => (opts.incoming ?? []).map(attack),
    outgoingAttacks: () => (opts.outgoing ?? []).map(attack),
  } as unknown as PlayerView;
}

describe("isAtWar", () => {
  it("is false with no player (spectating) or a dead player", () => {
    expect(isAtWar(null)).toBe(false);
    expect(isAtWar(player({ alive: false, incoming: [2] }))).toBe(false);
  });

  it("is false while only expanding into unclaimed land", () => {
    expect(isAtWar(player({ outgoing: [0] }))).toBe(false);
  });

  it("is true when attacking another player or being attacked", () => {
    expect(isAtWar(player({ outgoing: [0, 3] }))).toBe(true);
    expect(isAtWar(player({ incoming: [2] }))).toBe(true);
  });
});
