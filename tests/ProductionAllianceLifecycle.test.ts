import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  type Game,
  type Player,
} from "../src/core/game/Game";
import {
  GameUpdateType,
  type DonateEventUpdate,
  type GameUpdateViewData,
  type HashUpdate,
} from "../src/core/game/GameUpdates";
import {
  GameConfigSchema,
  GameStartInfoSchema,
  StampedIntentSchema,
  TurnSchema,
  type StampedIntent,
  type Turn,
} from "../src/core/Schemas";
import { NodeGameMapLoader } from "./perf/fullgame/NodeGameMapLoader";

const MAPS_DIR = path.resolve(process.cwd(), "resources/maps");
const GAME_ID = "AllyLife";
const DONOR_CLIENT_ID = "AllyP001";
const RECIPIENT_CLIENT_ID = "AllyP002";
const FIRST_REQUEST_TURN = 351;
const COUNTER_REQUEST_TURN = 352;
const DEFAULT_DONATION_TURN = 353;
const IMMEDIATE_RETRY_TURN = 354;
const COOLDOWN_READY_TURN = 453;
const BREAK_TURN = 455;
const POST_BREAK_ATTACK_TURN = 456;
const FINAL_TURN = 460;

type DeterministicEmission = Omit<GameUpdateViewData, "tickExecutionDuration">;

interface EconomySnapshot {
  tick: number;
  donorGold: bigint;
  recipientGold: bigint;
  totalGold: bigint;
  donorCanDonate: boolean;
}

interface LifecycleSnapshot {
  turns: Turn[];
  playerIDs: { donor: string; recipient: string };
  beforeAlliance: EconomySnapshot;
  allied: {
    tick: number;
    donorAllies: string[];
    recipientAllies: string[];
    sharesBorder: boolean;
  };
  beforeDefaultDonation: EconomySnapshot & {
    expectedDefaultAmount: bigint;
    outgoingAttacks: number;
  };
  afterDefaultDonation: EconomySnapshot;
  afterImmediateRetry: EconomySnapshot;
  beforeCooldownExpiry: EconomySnapshot;
  cooldownReady: EconomySnapshot;
  afterExplicitDonation: EconomySnapshot;
  afterBreak: {
    tick: number;
    donorAllies: string[];
    recipientAllies: string[];
    donorIsTraitor: boolean;
    recipientIsTraitor: boolean;
    donorOutgoingAttacks: number;
    donorTroops: number;
  };
  donations: Array<{ tick: number; update: DonateEventUpdate }>;
  allianceEventTicks: {
    requests: number[];
    replies: number[];
    breaks: number[];
  };
  finalHash: HashUpdate;
  finalState: ReturnType<typeof canonicalState>;
}

function productionAllianceConfig() {
  return GameConfigSchema.parse({
    gameMap: GameMapType.TheBox,
    gameMapSize: GameMapSize.Normal,
    gameType: GameType.Public,
    gameMode: GameMode.FFA,
    maxPlayers: 2,
    difficulty: Difficulty.Medium,
    bots: 0,
    nations: "disabled",
    donateGold: true,
    donateTroops: false,
    infiniteGold: false,
    infiniteTroops: false,
    instantBuild: false,
    randomSpawn: false,
    disabledUnits: [],
    customAllianceDuration: 15,
  });
}

function economySnapshot(
  game: Game,
  donor: Player,
  recipient: Player,
): EconomySnapshot {
  return {
    tick: game.ticks(),
    donorGold: donor.gold(),
    recipientGold: recipient.gold(),
    totalGold: donor.gold() + recipient.gold(),
    donorCanDonate: donor.canDonateGold(recipient),
  };
}

function ownedTileHash(player: Player): string {
  const tiles = Array.from(player.tiles()).sort((a, b) => a - b);
  let hash = 0x811c9dc5;
  for (const tile of tiles) {
    hash = Math.imul(hash ^ tile, 0x01000193) >>> 0;
  }
  return `${tiles.length}:${hash.toString(16).padStart(8, "0")}`;
}

function canonicalState(game: Game) {
  return {
    tick: game.ticks(),
    players: game
      .allPlayers()
      .map((player) => ({
        clientID: player.clientID(),
        id: player.id(),
        smallID: player.smallID(),
        alive: player.isAlive(),
        ownedTiles: ownedTileHash(player),
        troops: player.troops(),
        gold: player.gold(),
        allies: player
          .alliances()
          .map((alliance) => alliance.other(player).id())
          .sort(),
        traitor: player.isTraitor(),
        outgoingAttacks: player
          .outgoingAttacks()
          .map((attack) => ({
            id: attack.id(),
            target: attack.target().id(),
            troops: attack.troops(),
            active: attack.isActive(),
          }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      }))
      .sort((a, b) => (a.clientID ?? "").localeCompare(b.clientID ?? "")),
  };
}

async function runProductionLifecycle(
  viewerClientID: typeof DONOR_CLIENT_ID | typeof RECIPIENT_CLIENT_ID,
): Promise<LifecycleSnapshot> {
  // Production clients run in isolated workers. A fresh module graph also
  // isolates TerrainMapLoader's mutable cache for the second viewer realm.
  vi.resetModules();
  const { createGameRunner } = await import("../src/core/GameRunner");
  const start = GameStartInfoSchema.parse({
    gameID: GAME_ID,
    lobbyCreatedAt: 0,
    config: productionAllianceConfig(),
    players: [
      {
        clientID: DONOR_CLIENT_ID,
        username: DONOR_CLIENT_ID,
        clanTag: null,
        cosmetics: {},
      },
      {
        clientID: RECIPIENT_CLIENT_ID,
        username: RECIPIENT_CLIENT_ID,
        clanTag: null,
        cosmetics: {},
      },
    ],
  });

  let runtimeError: string | undefined;
  const emissions: DeterministicEmission[] = [];
  const runner = await createGameRunner(
    start,
    viewerClientID,
    new NodeGameMapLoader(MAPS_DIR),
    (update) => {
      if ("errMsg" in update) {
        runtimeError = `${update.errMsg}\n${update.stack ?? ""}`;
        return;
      }
      const deterministic = structuredClone(update);
      delete deterministic.tickExecutionDuration;
      emissions.push(deterministic);
    },
  );

  const turns: Turn[] = [];
  let nextTurn = 0;
  const executeTurn = (intents: StampedIntent[] = []) => {
    for (const intent of intents) StampedIntentSchema.parse(intent);
    const turn = TurnSchema.parse({ turnNumber: nextTurn++, intents });
    turns.push(turn);
    runner.addTurn(turn);
    if (!runner.executeNextTick() || runtimeError !== undefined) {
      throw new Error(
        `production lifecycle failed on turn ${turn.turnNumber}: ${runtimeError ?? "runner rejected turn"}`,
      );
    }
  };

  executeTurn([
    {
      type: "spawn",
      tile: runner.game.ref(256, 256),
      clientID: DONOR_CLIENT_ID,
    },
    {
      type: "spawn",
      tile: runner.game.ref(264, 256),
      clientID: RECIPIENT_CLIENT_ID,
    },
  ]);
  while (nextTurn < FIRST_REQUEST_TURN) executeTurn();

  const donor = runner.game.playerByClientID(DONOR_CLIENT_ID);
  const recipient = runner.game.playerByClientID(RECIPIENT_CLIENT_ID);
  if (donor === null || recipient === null) {
    throw new Error("production lifecycle did not resolve both human players");
  }
  if (!donor.hasSpawned() || !recipient.hasSpawned()) {
    throw new Error("production lifecycle did not apply both spawn intents");
  }
  const beforeAlliance = economySnapshot(runner.game, donor, recipient);

  executeTurn([
    {
      type: "allianceRequest",
      recipient: recipient.id(),
      clientID: DONOR_CLIENT_ID,
    },
  ]);
  executeTurn([
    {
      type: "allianceRequest",
      recipient: donor.id(),
      clientID: RECIPIENT_CLIENT_ID,
    },
  ]);
  const allied = {
    tick: runner.game.ticks(),
    donorAllies: donor
      .alliances()
      .map((alliance) => alliance.other(donor).id()),
    recipientAllies: recipient
      .alliances()
      .map((alliance) => alliance.other(recipient).id()),
    sharesBorder: donor.sharesBorderWith(recipient),
  };

  executeTurn([
    {
      type: "attack",
      targetID: recipient.id(),
      troops: 1,
      clientID: DONOR_CLIENT_ID,
    },
    {
      type: "donate_gold",
      recipient: recipient.id(),
      gold: 0,
      clientID: DONOR_CLIENT_ID,
    },
    {
      type: "donate_gold",
      recipient: recipient.id(),
      gold: null,
      clientID: DONOR_CLIENT_ID,
    },
  ]);
  const beforeDefaultDonation = {
    ...economySnapshot(runner.game, donor, recipient),
    expectedDefaultAmount: donor.gold() / 3n,
    outgoingAttacks: donor.outgoingAttacks().length,
  };

  executeTurn([
    {
      type: "donate_gold",
      recipient: recipient.id(),
      gold: null,
      clientID: DONOR_CLIENT_ID,
    },
  ]);
  const afterDefaultDonation = economySnapshot(runner.game, donor, recipient);
  executeTurn();
  const afterImmediateRetry = economySnapshot(runner.game, donor, recipient);

  while (nextTurn <= COOLDOWN_READY_TURN - 1) executeTurn();
  const beforeCooldownExpiry = economySnapshot(runner.game, donor, recipient);
  executeTurn([
    {
      type: "donate_gold",
      recipient: recipient.id(),
      gold: 777,
      clientID: DONOR_CLIENT_ID,
    },
  ]);
  const cooldownReady = economySnapshot(runner.game, donor, recipient);
  executeTurn();
  const afterExplicitDonation = economySnapshot(runner.game, donor, recipient);

  executeTurn([
    {
      type: "breakAlliance",
      recipient: recipient.id(),
      clientID: DONOR_CLIENT_ID,
    },
  ]);
  executeTurn([
    {
      type: "attack",
      targetID: recipient.id(),
      troops: 1,
      clientID: DONOR_CLIENT_ID,
    },
  ]);
  const afterBreak = {
    tick: runner.game.ticks(),
    donorAllies: donor
      .alliances()
      .map((alliance) => alliance.other(donor).id()),
    recipientAllies: recipient
      .alliances()
      .map((alliance) => alliance.other(recipient).id()),
    donorIsTraitor: donor.isTraitor(),
    recipientIsTraitor: recipient.isTraitor(),
    donorOutgoingAttacks: donor.outgoingAttacks().length,
    donorTroops: donor.troops(),
  };
  while (nextTurn <= FINAL_TURN) executeTurn();

  const donations = emissions.flatMap((emission) =>
    (emission.updates[GameUpdateType.DonateEvent] as DonateEventUpdate[]).map(
      (update) => ({ tick: emission.tick, update: structuredClone(update) }),
    ),
  );
  const eventTicks = (type: GameUpdateType) =>
    emissions
      .filter((emission) => emission.updates[type].length > 0)
      .map((emission) => emission.tick);
  const hashes = emissions.flatMap(
    (emission) => emission.updates[GameUpdateType.Hash] as HashUpdate[],
  );
  const finalHash = hashes[hashes.length - 1];
  if (finalHash === undefined)
    throw new Error("no production state hash emitted");

  return {
    turns,
    playerIDs: { donor: donor.id(), recipient: recipient.id() },
    beforeAlliance,
    allied,
    beforeDefaultDonation,
    afterDefaultDonation,
    afterImmediateRetry,
    beforeCooldownExpiry,
    cooldownReady,
    afterExplicitDonation,
    afterBreak,
    donations,
    allianceEventTicks: {
      requests: eventTicks(GameUpdateType.AllianceRequest),
      replies: eventTicks(GameUpdateType.AllianceRequestReply),
      breaks: eventTicks(GameUpdateType.BrokeAlliance),
    },
    finalHash,
    finalState: canonicalState(runner.game),
  };
}

describe("production alliance lifecycle", () => {
  it("keeps alliance, donation, cooldown, break, and attack state deterministic", async () => {
    const donorView = await runProductionLifecycle(DONOR_CLIENT_ID);
    const recipientView = await runProductionLifecycle(RECIPIENT_CLIENT_ID);

    expect(recipientView).toEqual(donorView);
    expect(donorView.turns.filter((turn) => turn.intents.length > 0)).toEqual([
      expect.objectContaining({ turnNumber: 0 }),
      expect.objectContaining({ turnNumber: FIRST_REQUEST_TURN }),
      expect.objectContaining({ turnNumber: COUNTER_REQUEST_TURN }),
      expect.objectContaining({ turnNumber: DEFAULT_DONATION_TURN }),
      expect.objectContaining({ turnNumber: IMMEDIATE_RETRY_TURN }),
      expect.objectContaining({ turnNumber: COOLDOWN_READY_TURN }),
      expect.objectContaining({ turnNumber: BREAK_TURN }),
      expect.objectContaining({ turnNumber: POST_BREAK_ATTACK_TURN }),
    ]);
    expect(donorView.beforeAlliance).toEqual({
      tick: 351,
      donorGold: 4_900n,
      recipientGold: 4_900n,
      totalGold: 9_800n,
      donorCanDonate: false,
    });
    expect(donorView.allied).toEqual({
      tick: 353,
      donorAllies: [donorView.playerIDs.recipient],
      recipientAllies: [donorView.playerIDs.donor],
      sharesBorder: true,
    });
    expect(donorView.beforeDefaultDonation).toEqual({
      tick: 354,
      donorGold: 5_200n,
      recipientGold: 5_200n,
      totalGold: 10_400n,
      donorCanDonate: true,
      expectedDefaultAmount: 1_733n,
      outgoingAttacks: 0,
    });
    expect(donorView.afterDefaultDonation).toEqual({
      tick: 355,
      donorGold: 3_567n,
      recipientGold: 7_033n,
      totalGold: 10_600n,
      donorCanDonate: false,
    });
    expect(donorView.afterDefaultDonation.totalGold).toBe(
      donorView.beforeDefaultDonation.totalGold + 200n,
    );
    expect(donorView.afterDefaultDonation.donorGold).toBe(
      donorView.beforeDefaultDonation.donorGold +
        100n -
        donorView.beforeDefaultDonation.expectedDefaultAmount,
    );
    expect(donorView.afterDefaultDonation.recipientGold).toBe(
      donorView.beforeDefaultDonation.recipientGold +
        100n +
        donorView.beforeDefaultDonation.expectedDefaultAmount,
    );
    expect(donorView.afterImmediateRetry).toEqual({
      tick: 356,
      donorGold: 3_667n,
      recipientGold: 7_133n,
      totalGold: 10_800n,
      donorCanDonate: false,
    });
    expect(donorView.beforeCooldownExpiry).toEqual({
      tick: 453,
      donorGold: 13_367n,
      recipientGold: 16_833n,
      totalGold: 30_200n,
      donorCanDonate: false,
    });
    expect(donorView.cooldownReady).toEqual({
      tick: 454,
      donorGold: 13_467n,
      recipientGold: 16_933n,
      totalGold: 30_400n,
      donorCanDonate: true,
    });
    expect(donorView.afterExplicitDonation).toEqual({
      tick: 455,
      donorGold: 12_790n,
      recipientGold: 17_810n,
      totalGold: 30_600n,
      donorCanDonate: false,
    });
    expect(donorView.afterExplicitDonation.totalGold).toBe(
      donorView.cooldownReady.totalGold + 200n,
    );
    expect(donorView.afterExplicitDonation.donorGold).toBe(
      donorView.cooldownReady.donorGold + 100n - 777n,
    );
    expect(donorView.afterExplicitDonation.recipientGold).toBe(
      donorView.cooldownReady.recipientGold + 100n + 777n,
    );
    expect(donorView.donations).toEqual([
      {
        tick: 355,
        update: {
          type: GameUpdateType.DonateEvent,
          donationType: "gold",
          senderId: donorView.playerIDs.donor,
          recipientId: donorView.playerIDs.recipient,
          amount: 1_733n,
        },
      },
      {
        tick: 455,
        update: {
          type: GameUpdateType.DonateEvent,
          donationType: "gold",
          senderId: donorView.playerIDs.donor,
          recipientId: donorView.playerIDs.recipient,
          amount: 777n,
        },
      },
    ]);
    expect(donorView.allianceEventTicks).toEqual({
      requests: [352],
      replies: [353],
      breaks: [457],
    });
    expect(donorView.afterBreak).toMatchObject({
      tick: 457,
      donorAllies: [],
      recipientAllies: [],
      donorIsTraitor: true,
      recipientIsTraitor: false,
      donorOutgoingAttacks: 1,
    });
    expect(donorView.finalHash).toEqual({
      type: GameUpdateType.Hash,
      tick: FINAL_TURN,
      hash: 178_880_681_585_005,
    });
    expect(donorView.finalState).toEqual({
      tick: 461,
      players: [
        {
          clientID: DONOR_CLIENT_ID,
          id: donorView.playerIDs.donor,
          smallID: 1,
          alive: true,
          ownedTiles: "104:88c177b5",
          troops: 94_246,
          gold: 13_390n,
          allies: [],
          traitor: true,
          outgoingAttacks: [],
        },
        {
          clientID: RECIPIENT_CLIENT_ID,
          id: donorView.playerIDs.recipient,
          smallID: 2,
          alive: false,
          ownedTiles: "0:811c9dc5",
          troops: 91_596,
          gold: 0n,
          allies: [],
          traitor: false,
          outgoingAttacks: [],
        },
      ],
    });

    const source = readFileSync(fileURLToPath(import.meta.url), "utf8");
    const forbiddenDirectCalls = [
      ["add", "Execution"],
      ["add", "Gold"],
      ["add", "Troops"],
      ["con", "quer"],
      ["create", "AllianceRequest"],
      ["break", "Alliance"],
      ["donate", "Gold"],
      ["mark", "Traitor"],
    ].map((parts) => `.${parts.join("")}(`);
    for (const call of forbiddenDirectCalls) expect(source).not.toContain(call);
    expect(
      donorView.turns.flatMap((turn) =>
        turn.intents.map((intent) => intent.type),
      ),
    ).toEqual([
      "spawn",
      "spawn",
      "allianceRequest",
      "allianceRequest",
      "attack",
      "donate_gold",
      "donate_gold",
      "donate_gold",
      "donate_gold",
      "breakAlliance",
      "attack",
    ]);
  }, 120_000);
});
