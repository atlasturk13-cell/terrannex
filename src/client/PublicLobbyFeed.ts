import { PublicGames } from "../core/Schemas";
import { PublicLobbySocket } from "./LobbySocket";
import { calculateServerTimeOffset } from "./Utils";

export interface PublicLobbySnapshot {
  lobbies: PublicGames;
  /** Server clock minus client clock, for countdowns. */
  serverTimeOffset: number;
}

type Listener = (snapshot: PublicLobbySnapshot) => void;

/**
 * One public-lobby socket shared by every page that shows live lobbies (the
 * main menu's featured card and the Multiplayer page). It connects while at
 * least one listener is subscribed and disconnects when the last one leaves.
 */
export class PublicLobbyFeed {
  private readonly listeners = new Set<Listener>();
  private latest: PublicLobbySnapshot | null = null;
  private readonly socket: PublicLobbySocket;

  constructor() {
    this.socket = new PublicLobbySocket((lobbies) => this.publish(lobbies));
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    if (this.listeners.size === 1) void this.socket.start();
    else if (this.latest !== null) listener(this.latest);
    return () => {
      if (!this.listeners.delete(listener)) return;
      if (this.listeners.size === 0) {
        this.socket.stop();
        this.latest = null;
      }
    };
  }

  /** Socket callback; also the test seam. */
  publish(lobbies: PublicGames) {
    this.latest = {
      lobbies,
      serverTimeOffset: calculateServerTimeOffset(lobbies.serverTime),
    };
    for (const listener of this.listeners) listener(this.latest);
  }
}

export const publicLobbyFeed = new PublicLobbyFeed();
