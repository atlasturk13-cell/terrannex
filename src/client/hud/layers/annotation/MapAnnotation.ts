import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { EventBus } from "../../../../core/EventBus";
import { UserSettings } from "../../../../core/game/UserSettings";
import { Controller } from "../../../Controller";
import { MouseMoveEvent } from "../../../InputHandler";
import { TransformHandler } from "../../../TransformHandler";
import { translateText } from "../../../Utils";
import { GameView } from "../../../view";
import {
  Annotation,
  annotationAt,
  AnnotationGame,
  annotationKey,
} from "./AnnotationResolver";

/** The cursor rests this long before the label appears — well under half a second. */
export const HOVER_REST_MS = 300;
const MOVE_THROTTLE_MS = 30;
const CURSOR_OFFSET_X = 12;
const CURSOR_OFFSET_Y = 16;
const LABEL_MAX_WIDTH_PX = 160;

type Placed = { annotation: Annotation; x: number; y: number };

/**
 * A small name chip that follows the cursor over the map: the unit or
 * structure under it, the owner of empty land, or the terrain. It appears
 * after a short rest, stays while the cursor moves across the same thing,
 * and hides over the HUD or when the setting is off. Clicking does nothing.
 */
@customElement("map-annotation")
export class MapAnnotation extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;
  public transform: TransformHandler;
  public userSettings: UserSettings;

  @state() private label: Placed | null = null;
  private pending: Placed | null = null;
  private restTimer: ReturnType<typeof setTimeout> | null = null;
  private lastMoveMs = 0;

  createRenderRoot() {
    return this;
  }

  init() {
    this.eventBus.on(MouseMoveEvent, (e) => this.onHover(e.x, e.y));
  }

  tick() {
    if (!this.enabled()) {
      this.hide();
      return;
    }
    const unitId = this.label?.annotation.unitId;
    if (unitId !== undefined) {
      const unit = this.game.unit(unitId);
      if (unit === undefined || !unit.isActive()) this.hide();
    }
  }

  getTickIntervalMs(): number {
    return 250;
  }

  disconnectedCallback() {
    this.cancelRest();
    super.disconnectedCallback();
  }

  private enabled(): boolean {
    return this.userSettings?.mapAnnotations() ?? true;
  }

  private resolverGame(): AnnotationGame {
    return this.game as unknown as AnnotationGame;
  }

  /** True when the topmost element at the pointer is the map itself. */
  private pointerOnMap(x: number, y: number): boolean {
    if (typeof document.elementFromPoint !== "function") return true;
    const element = document.elementFromPoint(x, y);
    if (element === null) return true;
    if (element.id === "game-input-overlay") return true;
    return element.closest("map-annotation") !== null;
  }

  private cancelRest() {
    if (this.restTimer !== null) clearTimeout(this.restTimer);
    this.restTimer = null;
    this.pending = null;
  }

  private hide() {
    this.cancelRest();
    if (this.label !== null) this.label = null;
  }

  private onHover(x: number, y: number) {
    if (!this.enabled() || !Number.isFinite(x) || !Number.isFinite(y)) {
      this.hide();
      return;
    }
    const now = performance.now();
    if (now - this.lastMoveMs < MOVE_THROTTLE_MS) return;
    this.lastMoveMs = now;
    if (!this.pointerOnMap(x, y)) {
      this.hide();
      return;
    }
    const world = this.transform.screenToWorldCoordinatesFloat(x, y);
    const annotation = annotationAt(this.resolverGame(), world.x, world.y);
    if (annotation === null) {
      this.hide();
      return;
    }
    const key = annotationKey(annotation);
    // Still over the same thing: the chip follows without a new rest.
    if (this.label !== null && annotationKey(this.label.annotation) === key) {
      this.cancelRest();
      this.label = { annotation, x, y };
      return;
    }
    if (
      this.pending !== null &&
      annotationKey(this.pending.annotation) === key
    ) {
      this.pending = { annotation, x, y };
      return;
    }
    // Something else: hide the old chip and wait for the cursor to rest.
    if (this.label !== null) this.label = null;
    this.cancelRest();
    this.pending = { annotation, x, y };
    this.restTimer = setTimeout(() => {
      this.restTimer = null;
      if (this.pending !== null) this.label = this.pending;
      this.pending = null;
    }, HOVER_REST_MS);
  }

  private position(x: number, y: number) {
    const viewportW = typeof window === "undefined" ? 1920 : window.innerWidth;
    const viewportH = typeof window === "undefined" ? 1080 : window.innerHeight;
    const left = Math.max(
      2,
      Math.min(x + CURSOR_OFFSET_X, viewportW - LABEL_MAX_WIDTH_PX - 2),
    );
    const top = Math.max(2, Math.min(y + CURSOR_OFFSET_Y, viewportH - 24));
    return `left:${left}px;top:${top}px;max-width:${LABEL_MAX_WIDTH_PX}px;`;
  }

  private ownerDot(annotation: Annotation) {
    if (annotation.ownerSmallID === undefined) return nothing;
    const player = this.game.playerBySmallID(annotation.ownerSmallID);
    const color =
      player !== undefined && "territoryColor" in player
        ? (player as { territoryColor(): { toHex(): string } })
            .territoryColor()
            .toHex()
        : null;
    if (color === null) return nothing;
    return html`<span
      class="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle"
      style="background:${color}"
    ></span>`;
  }

  render() {
    if (!this.enabled() || this.label === null) return nothing;
    const { annotation, x, y } = this.label;
    const text =
      "text" in annotation.label
        ? annotation.label.text
        : translateText(annotation.label.key, annotation.label.params);
    return html`<div
      class="map-annotation-label pointer-events-none fixed z-[1002] truncate rounded px-1.5 py-0.5 text-[10px] font-semibold leading-tight text-white"
      style="${this.position(
        x,
        y,
      )}background:rgba(9,22,34,0.85);border:1px solid rgba(120,160,190,0.35)"
      data-annotation-kind=${annotation.kind}
    >
      ${this.ownerDot(annotation)}${text}
    </div>`;
  }
}
