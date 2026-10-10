import { describe, expect, it } from "vitest";
import { playerAutoCenterPhase } from "../../src/client/ClientGameRunner";

describe("ClientGameRunner camera follow preference", () => {
  it.each([
    { randomSpawn: true, follow: true, expected: "random-spawn" },
    { randomSpawn: true, follow: false, expected: null },
    { randomSpawn: false, follow: true, expected: "manual-spawn" },
    { randomSpawn: false, follow: false, expected: null },
  ] as const)(
    "selects $expected for random=$randomSpawn follow=$follow",
    ({ randomSpawn, follow, expected }) => {
      expect(playerAutoCenterPhase(randomSpawn, follow)).toBe(expected);
    },
  );
});
