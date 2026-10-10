/**
 * FxPass — orchestrates three independent GPU effect sub-passes:
 *   1. FxSpritePass    — animated sprite atlas (explosions, dust, conquest)
 *   2. FxShockwavePass — procedural rings for nuke/SAM events
 *   3. FxAttackRingPass — persistent rings at transport ship targets
 *
 * Spawn events that produce both a sprite and a shockwave (nukes, SAM
 * interceptions) are coordinated here so each sub-pass stays self-contained.
 */

import type { Config } from "../../../../../core/configuration/Config";
import type {
  AirStrikeFx,
  AttackRingInput,
  ConquestFx,
  DeadUnitFx,
  RendererConfig,
  TerritoryClaimFx,
} from "../../../types";
import { UT_FIGHTER_JET, UT_FIGHTER_MISSILE } from "../../../types";
import type { RenderSettings } from "../../RenderSettings";
import { FxAttackRingPass } from "./FxAttackRingPass";
import { FxShockwavePass } from "./FxShockwavePass";
import { FxSpritePass, NUKE_EXPLOSION_RADII } from "./FxSpritePass";

export type { AttackRingInput } from "../../../types";

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** Visual impact radius (world tiles) per aircraft model; gameplay is unchanged. */
export const AIR_STRIKE_BURST_RADIUS: Readonly<Record<string, number>> = {
  f16: 5,
  f35: 6.5,
  b2: 9,
  f22: 5,
  kaan: 6,
  typhoon: 5,
  a10: 7,
  b52: 10,
};

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(REDUCED_MOTION_QUERY).matches
  );
}

export class FxPass {
  private spritePass: FxSpritePass;
  private shockwavePass: FxShockwavePass;
  private attackRingPass: FxAttackRingPass;
  private mapW: number;
  private timeFn: () => number = () => performance.now();

  constructor(
    gl: WebGL2RenderingContext,
    header: RendererConfig,
    settings: RenderSettings,
    private config: Config,
  ) {
    this.mapW = header.mapWidth;
    this.spritePass = new FxSpritePass(gl, header, settings, config);
    this.shockwavePass = new FxShockwavePass(gl, settings);
    this.attackRingPass = new FxAttackRingPass(gl, settings);
  }

  // -------------------------------------------------------------------------
  // Spawning — coordinated across sub-passes
  // -------------------------------------------------------------------------

  applyDeadUnits(deadUnits: DeadUnitFx[]): void {
    const now = this.timeFn();
    for (const unit of deadUnits) {
      const startMs = now - (unit.tickAge ?? 0) * this.config.msPerTick();
      this.spawnUnit(unit, startMs);
    }
  }

  private spawnUnit(unit: DeadUnitFx, now: number): void {
    const typeName = unit.unitType;
    const x = unit.pos % this.mapW;
    const y = (unit.pos - x) / this.mapW;

    const nukeRadius = NUKE_EXPLOSION_RADII[typeName];
    if (nukeRadius !== undefined) {
      if (unit.reachedTarget) {
        this.spritePass.spawnFxForUnit(unit, now);
        this.shockwavePass.pushNukeShockwave(x, y, nukeRadius, unit.explosion);
      } else {
        // SAM interception: sprite pass handles the SAM explosion sprite
        this.spritePass.spawnFxForUnit(unit, now);
        this.shockwavePass.pushSAMShockwave(x, y);
      }
      return;
    }

    // Air combat reads through procedural bursts rather than tiny sprites:
    // a downed fighter breaks up in a fireball with smoke, a missile hit
    // flashes a small burst at the impact tile.
    if (typeName === UT_FIGHTER_JET && unit.combatDestroyed === true) {
      const reducedMotion = prefersReducedMotion();
      this.shockwavePass.pushAirStrikeBurst(x, y, 4.5, reducedMotion);
      if (!reducedMotion) {
        this.spritePass.spawnStrikeDebris(x, y, 4, now, unit.pos);
      }
      return;
    }
    if (
      typeName === UT_FIGHTER_MISSILE &&
      unit.reachedTarget &&
      this.config.airportOperationsV1Enabled?.() === true
    ) {
      this.shockwavePass.pushAirStrikeBurst(x, y, 3, prefersReducedMotion());
      return;
    }

    // All other units: sprite-only effects
    this.spritePass.spawnFxForUnit(unit, now);
  }

  applyRailroadDust(tileRefs: number[]): void {
    this.spritePass.applyRailroadDust(tileRefs);
  }

  applyConquestEvents(events: ConquestFx[]): void {
    this.spritePass.applyConquestEvents(events);
  }

  applyAirStrikeEvents(events: AirStrikeFx[]): void {
    const reducedMotion = prefersReducedMotion();
    const now = this.timeFn();
    for (const event of events) {
      const radius = AIR_STRIKE_BURST_RADIUS[event.aircraftType] ?? 5;
      this.shockwavePass.pushAirStrikeBurst(
        event.x,
        event.y,
        radius,
        reducedMotion,
      );
      if (!reducedMotion) {
        this.spritePass.spawnStrikeDebris(
          event.x,
          event.y,
          radius,
          now,
          event.y * this.mapW + event.x,
        );
      }
    }
  }

  applyTerritoryClaimEvents(events: TerritoryClaimFx[]): void {
    const reducedMotion = prefersReducedMotion();
    for (const event of events) {
      this.shockwavePass.pushTerritoryClaimBlast(event, reducedMotion);
    }
  }

  updateAttackRings(rings: AttackRingInput[]): void {
    this.attackRingPass.update(rings);
  }

  // -------------------------------------------------------------------------
  // Per-frame
  // -------------------------------------------------------------------------

  tick(): void {
    this.spritePass.tick();
    this.shockwavePass.tick();
    this.attackRingPass.tick();
  }

  draw(cameraMatrix: Float32Array, zoom: number): void {
    this.spritePass.draw(cameraMatrix);
    this.shockwavePass.draw(cameraMatrix);
    this.attackRingPass.draw(cameraMatrix, zoom);
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  setTimeFn(fn: () => number): void {
    this.timeFn = fn;
    this.spritePass.setTimeFn(fn);
    this.shockwavePass.setTimeFn(fn);
  }

  clear(): void {
    this.spritePass.clear();
    this.shockwavePass.clear();
    this.attackRingPass.clear();
  }

  dispose(): void {
    this.spritePass.dispose();
    this.shockwavePass.dispose();
    this.attackRingPass.dispose();
  }
}
