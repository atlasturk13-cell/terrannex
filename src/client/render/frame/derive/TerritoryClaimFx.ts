import type { TerritoryClaimBurst, TerritoryClaimFx } from "../../types";

/** A tile whose authoritative owner changed during the current game tick. */
export interface OwnershipChange {
  tile: number;
  previousOwnerID: number;
  ownerID: number;
}

/** Most connected transfer clusters surfaced in one tick (local ones first). */
export const MAX_TERRITORY_CLAIM_CLUSTERS = 12;
/** Most combustion bursts one cluster may spawn along its front. */
export const MAX_TERRITORY_CLAIM_BURSTS_PER_CLUSTER = 6;
/** Hard per-tick burst budget across every cluster. */
export const MAX_TERRITORY_CLAIM_BURSTS = 36;
/** Bursts inside one cluster pop within this window so a front crackles. */
export const TERRITORY_CLAIM_BURST_STAGGER_MS = 260;

interface ExtractTerritoryClaimFxOptions {
  mapWidth: number;
  localOwnerID: number;
  isBorder: (tile: number) => boolean;
  colorForOwner: (ownerID: number) => readonly [number, number, number];
  maxClusters?: number;
  maxBursts?: number;
}

interface ClaimCluster {
  changes: OwnershipChange[];
  firstTile: number;
  local: boolean;
}

function normalizedColor(
  color: readonly [number, number, number],
): readonly [number, number, number] {
  return color.map((channel) =>
    Number.isFinite(channel) ? Math.min(Math.max(channel, 0), 1) : 1,
  ) as unknown as readonly [number, number, number];
}

/** Deterministic float in [0,1) from an integer seed (mulberry32 step). */
export function claimHash(seed: number): number {
  let t = (seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), 1 | t);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function connectedClusters(
  changes: readonly OwnershipChange[],
  mapWidth: number,
  localOwnerID: number,
): ClaimCluster[] {
  const byTile = new Map(changes.map((change) => [change.tile, change]));
  const visited = new Set<number>();
  const clusters: ClaimCluster[] = [];

  for (const seed of changes) {
    if (visited.has(seed.tile)) continue;

    const queue = [seed];
    const cluster: OwnershipChange[] = [];
    visited.add(seed.tile);

    for (let head = 0; head < queue.length; head++) {
      const current = queue[head];
      cluster.push(current);
      const x = current.tile % mapWidth;
      const neighbors = [
        x > 0 ? current.tile - 1 : -1,
        x < mapWidth - 1 ? current.tile + 1 : -1,
        current.tile >= mapWidth ? current.tile - mapWidth : -1,
        current.tile + mapWidth,
      ];

      for (const tile of neighbors) {
        const next = byTile.get(tile);
        if (next === undefined || visited.has(tile)) continue;
        visited.add(tile);
        queue.push(next);
      }
    }

    clusters.push({
      changes: cluster,
      firstTile: cluster[0].tile,
      local:
        seed.ownerID === localOwnerID || seed.previousOwnerID === localOwnerID,
    });
  }

  return clusters;
}

function representativeTile(
  cluster: readonly OwnershipChange[],
  mapWidth: number,
  isBorder: (tile: number) => boolean,
): number {
  const borderTiles = cluster.filter((change) => isBorder(change.tile));
  const candidates = borderTiles.length > 0 ? borderTiles : cluster;
  let centerX = 0;
  let centerY = 0;

  for (const change of cluster) {
    centerX += change.tile % mapWidth;
    centerY += Math.floor(change.tile / mapWidth);
  }
  centerX /= cluster.length;
  centerY /= cluster.length;

  let bestTile = candidates[0].tile;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const x = candidate.tile % mapWidth;
    const y = Math.floor(candidate.tile / mapWidth);
    const distance = (x - centerX) ** 2 + (y - centerY) ** 2;
    if (
      distance < bestDistance ||
      (distance === bestDistance && candidate.tile < bestTile)
    ) {
      bestTile = candidate.tile;
      bestDistance = distance;
    }
  }
  return bestTile;
}

/** How many bursts a cluster of `tileCount` transferred tiles deserves. */
export function burstCountForCluster(tileCount: number): number {
  return Math.min(
    MAX_TERRITORY_CLAIM_BURSTS_PER_CLUSTER,
    Math.max(1, Math.round(Math.sqrt(Math.max(tileCount, 1)) * 0.9)),
  );
}

/**
 * Spread bursts evenly along the cluster's front (border tiles first). Sites,
 * delays and sizes are pure functions of the tile refs so live play, replays
 * and tests agree regardless of input order.
 */
function burstSites(
  cluster: readonly OwnershipChange[],
  mapWidth: number,
  isBorder: (tile: number) => boolean,
  budget: number,
): TerritoryClaimBurst[] {
  const count = Math.min(budget, burstCountForCluster(cluster.length));
  if (count <= 0) return [];
  const front = cluster.filter((change) => isBorder(change.tile));
  const pool = (front.length >= count ? front : cluster)
    .map((change) => change.tile)
    .sort((a, b) => a - b);
  const sites: TerritoryClaimBurst[] = [];
  const used = new Set<number>();
  for (let i = 0; i < count; i++) {
    // Evenly spaced picks along the sorted front, nudged by a tile hash so a
    // straight front does not pop in perfect lockstep.
    const slot = Math.floor(((i + 0.5) * pool.length) / count);
    const tile = pool[Math.min(pool.length - 1, slot)];
    if (used.has(tile)) continue;
    used.add(tile);
    const h1 = claimHash(tile * 3 + 1);
    const h2 = claimHash(tile * 7 + 5);
    sites.push({
      x: tile % mapWidth,
      y: Math.floor(tile / mapWidth),
      delayMs: Math.floor(h1 * TERRITORY_CLAIM_BURST_STAGGER_MS),
      scale: 0.75 + h2 * 0.55,
    });
  }
  return sites;
}

/**
 * Turn authoritative tile transfers into a bounded, deterministic set of
 * combustion bursts along every moving front. Player-to-player transfers are
 * surfaced for the whole visible battlefield so bot wars read as alive; the
 * local player's fronts are always ranked first. Initial neutral painting stays
 * silent. Input order never changes the output.
 */
export function extractTerritoryClaimFx(
  ownershipChanges: readonly OwnershipChange[],
  options: ExtractTerritoryClaimFxOptions,
): TerritoryClaimFx[] {
  const { mapWidth, localOwnerID, isBorder, colorForOwner } = options;
  const maxClusters = Math.max(
    0,
    Math.floor(options.maxClusters ?? MAX_TERRITORY_CLAIM_CLUSTERS),
  );
  const maxBursts = Math.max(
    0,
    Math.floor(options.maxBursts ?? MAX_TERRITORY_CLAIM_BURSTS),
  );
  if (mapWidth <= 0 || maxClusters === 0 || maxBursts === 0) return [];

  // De-duplicate defensively, then establish a stable scan order.
  const unique = new Map<number, OwnershipChange>();
  for (const change of ownershipChanges) {
    if (
      change.previousOwnerID <= 0 ||
      change.ownerID <= 0 ||
      change.previousOwnerID === change.ownerID
    ) {
      continue;
    }
    unique.set(change.tile, change);
  }
  const relevant = [...unique.values()].sort((a, b) => a.tile - b.tile);

  const byTransfer = new Map<string, OwnershipChange[]>();
  for (const change of relevant) {
    const key = `${change.previousOwnerID}>${change.ownerID}`;
    const group = byTransfer.get(key);
    if (group) group.push(change);
    else byTransfer.set(key, [change]);
  }

  const clusters = [...byTransfer.values()].flatMap((group) =>
    connectedClusters(group, mapWidth, localOwnerID),
  );
  clusters.sort(
    (a, b) =>
      Number(b.local) - Number(a.local) ||
      b.changes.length - a.changes.length ||
      a.firstTile - b.firstTile,
  );

  let burstBudget = maxBursts;
  const result: TerritoryClaimFx[] = [];
  for (const cluster of clusters.slice(0, maxClusters)) {
    const tile = representativeTile(cluster.changes, mapWidth, isBorder);
    const ownerID = cluster.changes[0].ownerID;
    const bursts = burstSites(cluster.changes, mapWidth, isBorder, burstBudget);
    burstBudget -= bursts.length;
    result.push({
      x: tile % mapWidth,
      y: Math.floor(tile / mapWidth),
      ownerID,
      color: normalizedColor(colorForOwner(ownerID)),
      tileCount: cluster.changes.length,
      local: cluster.local,
      bursts,
    });
    if (burstBudget <= 0) break;
  }
  return result;
}
