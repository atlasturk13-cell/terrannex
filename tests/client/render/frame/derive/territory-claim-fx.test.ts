import {
  burstCountForCluster,
  extractTerritoryClaimFx,
  MAX_TERRITORY_CLAIM_BURSTS,
  MAX_TERRITORY_CLAIM_BURSTS_PER_CLUSTER,
  MAX_TERRITORY_CLAIM_CLUSTERS,
  TERRITORY_CLAIM_BURST_STAGGER_MS,
  type OwnershipChange,
} from "../../../../../src/client/render/frame/derive/TerritoryClaimFx";

const defaultOptions = {
  mapWidth: 10,
  localOwnerID: 1,
  isBorder: () => true,
  colorForOwner: () => [0.2, 0.6, 0.9] as const,
};

describe("territory claim FX derivation", () => {
  it("collapses an adjacent transfer into one cluster with bursts on its front", () => {
    const changes: OwnershipChange[] = [
      { tile: 22, previousOwnerID: 2, ownerID: 1 },
      { tile: 23, previousOwnerID: 2, ownerID: 1 },
      { tile: 32, previousOwnerID: 2, ownerID: 1 },
      { tile: 33, previousOwnerID: 2, ownerID: 1 },
    ];

    const result = extractTerritoryClaimFx(changes, {
      ...defaultOptions,
      isBorder: (tile) => tile === 23 || tile === 32,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      x: 3,
      y: 2,
      ownerID: 1,
      color: [0.2, 0.6, 0.9],
      tileCount: 4,
      local: true,
    });
    expect(result[0].bursts).toHaveLength(burstCountForCluster(4));
    for (const burst of result[0].bursts) {
      // Bursts sit on the cluster's own front tiles, never elsewhere.
      expect([23, 32]).toContain(burst.y * 10 + burst.x);
      expect(burst.delayMs).toBeGreaterThanOrEqual(0);
      expect(burst.delayMs).toBeLessThan(TERRITORY_CLAIM_BURST_STAGGER_MS);
      expect(burst.scale).toBeGreaterThan(0.7);
      expect(burst.scale).toBeLessThan(1.35);
    }
  });

  it("stays quiet for neutral painting but surfaces remote battles after local ones", () => {
    const result = extractTerritoryClaimFx(
      [
        { tile: 10, previousOwnerID: 0, ownerID: 1 },
        { tile: 20, previousOwnerID: 2, ownerID: 3 },
        { tile: 30, previousOwnerID: 1, ownerID: 0 },
        { tile: 40, previousOwnerID: 4, ownerID: 1 },
      ],
      defaultOptions,
    );

    expect(result.map((event) => [event.ownerID, event.local])).toEqual([
      [1, true],
      [3, false],
    ]);
  });

  it("is input-order deterministic and respects the cluster and burst budgets", () => {
    const changes: OwnershipChange[] = [
      { tile: 11, previousOwnerID: 2, ownerID: 1 },
      { tile: 12, previousOwnerID: 2, ownerID: 1 },
      { tile: 21, previousOwnerID: 2, ownerID: 1 },
      { tile: 22, previousOwnerID: 2, ownerID: 1 },
      { tile: 50, previousOwnerID: 1, ownerID: 3 },
      { tile: 51, previousOwnerID: 1, ownerID: 3 },
      { tile: 70, previousOwnerID: 4, ownerID: 1 },
      { tile: 90, previousOwnerID: 1, ownerID: 5 },
    ];

    const forward = extractTerritoryClaimFx(changes, defaultOptions);
    const reverse = extractTerritoryClaimFx(
      [...changes].reverse(),
      defaultOptions,
    );

    expect(forward).toEqual(reverse);
    expect(forward).toHaveLength(4);
    expect(forward[0].tileCount).toBe(4);
    expect(forward.length).toBeLessThanOrEqual(MAX_TERRITORY_CLAIM_CLUSTERS);
    const totalBursts = forward.reduce(
      (total, event) => total + event.bursts.length,
      0,
    );
    expect(totalBursts).toBeLessThanOrEqual(MAX_TERRITORY_CLAIM_BURSTS);
  });

  it("caps a huge front at the per-tick burst budget", () => {
    const changes: OwnershipChange[] = [];
    for (let owner = 2; owner < 20; owner++) {
      for (let i = 0; i < 40; i++) {
        changes.push({
          tile: owner * 100 + i,
          previousOwnerID: owner,
          ownerID: 1,
        });
      }
    }
    const result = extractTerritoryClaimFx(changes, {
      ...defaultOptions,
      mapWidth: 100,
    });
    const totalBursts = result.reduce(
      (total, event) => total + event.bursts.length,
      0,
    );
    expect(totalBursts).toBe(MAX_TERRITORY_CLAIM_BURSTS);
    for (const event of result) {
      expect(event.bursts.length).toBeLessThanOrEqual(
        MAX_TERRITORY_CLAIM_BURSTS_PER_CLUSTER,
      );
    }
  });

  it("scales bursts with the square root of the front size", () => {
    expect(burstCountForCluster(1)).toBe(1);
    expect(burstCountForCluster(4)).toBe(2);
    expect(burstCountForCluster(16)).toBe(4);
    expect(burstCountForCluster(400)).toBe(
      MAX_TERRITORY_CLAIM_BURSTS_PER_CLUSTER,
    );
  });

  it("clamps malformed owner colors before they reach WebGL", () => {
    const [result] = extractTerritoryClaimFx(
      [{ tile: 12, previousOwnerID: 2, ownerID: 1 }],
      {
        ...defaultOptions,
        colorForOwner: () => [-1, Number.NaN, 2] as const,
      },
    );

    expect(result.color).toEqual([0, 1, 1]);
  });
});
