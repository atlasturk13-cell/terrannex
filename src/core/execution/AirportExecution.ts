import { pruneExpiredAirportRearmSlots } from "../game/AirportOperations";
import { Execution, Game, Unit } from "../game/Game";

/** Maintains the three independent launch-slot cooldowns of one Airport. */
export class AirportExecution implements Execution {
  private active = true;
  private game!: Game;

  constructor(private readonly airport: Unit) {}

  init(game: Game, _ticks: number): void {
    this.game = game;
  }

  tick(ticks: number): void {
    if (!this.airport.isActive()) {
      this.active = false;
      return;
    }
    pruneExpiredAirportRearmSlots(this.game, this.airport, ticks);
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
