import { AircraftType, UnitType } from "../../../../core/game/Game";
import { TileRef } from "../../../../core/game/GameMap";
import { unitTypeTranslationKey } from "../../../CommandQuantity";

/**
 * The one short name the map label shows for whatever is under the cursor:
 * a unit or structure's name, the owner of empty land, or the terrain word.
 *
 * The resolver is pure: it reads a small slice of the game view and returns
 * a translation key or raw text; the element translates. Keeping it free of
 * DOM and `translateText` lets the tests drive it with a fake game.
 */
export type AnnotationLine =
  | { key: string; params?: Record<string, string | number> }
  | { text: string };

export type Annotation = {
  kind: "unit" | "territory" | "terrain";
  label: AnnotationLine;
  /** World anchor of the annotation (the unit's tile or the hovered tile). */
  tile: TileRef;
  unitId?: number;
  /** Small ID of the owning player of hovered land, for the colour dot. */
  ownerSmallID?: number;
};

/** The subset of PlayerView the resolver reads. */
export interface AnnotationPlayer {
  isPlayer(): boolean;
  smallID(): number;
  displayName(): string;
}

/** The subset of UnitView the resolver reads. */
export interface AnnotationUnit {
  id(): number;
  type(): UnitType;
  tile(): TileRef;
  isActive(): boolean;
  aircraftState(): { aircraftType?: AircraftType };
}

/** The subset of GameView the resolver reads. */
export interface AnnotationGame {
  isValidCoord(x: number, y: number): boolean;
  ref(x: number, y: number): TileRef;
  owner(tile: TileRef): { isPlayer(): boolean } | AnnotationPlayer;
  isLand(tile: TileRef): boolean;
  isOcean(tile: TileRef): boolean;
  nearbyUnits(
    tile: TileRef,
    searchRange: number,
    types: readonly UnitType[],
  ): Array<{ unit: AnnotationUnit; distSquared: number }>;
}

/** Tiles the query looks around the cursor; the widest hit radius below. */
export const ANNOTATION_SEARCH_RANGE = 8;

/**
 * How far (in tiles) from a unit's tile the cursor may be and still pick it.
 * Roughly the drawn half-size of each thing; structures use their icon size.
 */
const HIT_RADIUS: Readonly<Partial<Record<UnitType, number>>> = {
  [UnitType.Warship]: 7,
  [UnitType.TradeShip]: 6,
  [UnitType.TransportShip]: 5,
  [UnitType.FighterJet]: 8,
  [UnitType.AtomBomb]: 4,
  [UnitType.HydrogenBomb]: 5,
  [UnitType.MIRV]: 5,
  [UnitType.MIRVWarhead]: 3,
  [UnitType.SAMMissile]: 3,
  [UnitType.Shell]: 2,
  [UnitType.FighterMissile]: 3,
  [UnitType.FighterBomb]: 3,
  [UnitType.Train]: 2,
  [UnitType.City]: 3.5,
  [UnitType.Port]: 3.5,
  [UnitType.Factory]: 3.5,
  [UnitType.Airport]: 3.5,
  [UnitType.Barracks]: 3.5,
  [UnitType.MissileSilo]: 3.5,
  [UnitType.SAMLauncher]: 3.5,
  [UnitType.DefensePost]: 3.5,
};

export const ANNOTATED_UNIT_TYPES: readonly UnitType[] = Object.keys(
  HIT_RADIUS,
) as UnitType[];

function isPlayer(
  owner: { isPlayer(): boolean } | AnnotationPlayer,
): owner is AnnotationPlayer {
  return (owner as { isPlayer(): boolean }).isPlayer();
}

/** Pick the unit whose drawn footprint the cursor is closest to, if any. */
export function unitUnderCursor(
  game: AnnotationGame,
  tile: TileRef,
): AnnotationUnit | null {
  let best: AnnotationUnit | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const { unit, distSquared } of game.nearbyUnits(
    tile,
    ANNOTATION_SEARCH_RANGE,
    ANNOTATED_UNIT_TYPES,
  )) {
    if (!unit.isActive()) continue;
    const radius = HIT_RADIUS[unit.type()];
    if (radius === undefined || distSquared > radius * radius) continue;
    // Normalised by the footprint so a small structure right under the
    // cursor beats a large ship a few tiles away; ties go to the older unit.
    const score = Math.sqrt(distSquared) / radius;
    if (
      score < bestScore ||
      (score === bestScore && best !== null && unit.id() < best.id())
    ) {
      best = unit;
      bestScore = score;
    }
  }
  return best;
}

/** A unit's name: its type, or the airframe for a jet. */
export function describeUnit(unit: AnnotationUnit): Annotation {
  const type = unit.type();
  const label: AnnotationLine =
    type === UnitType.FighterJet
      ? {
          key: `build_menu.airport_launch.aircraft.${
            unit.aircraftState().aircraftType ?? AircraftType.F16
          }.name`,
        }
      : { key: unitTypeTranslationKey(type) };
  return { kind: "unit", label, tile: unit.tile(), unitId: unit.id() };
}

/** Empty land: the owner's name; unowned land or water: the terrain word. */
export function describeTile(game: AnnotationGame, tile: TileRef): Annotation {
  const owner = game.owner(tile);
  if (isPlayer(owner)) {
    return {
      kind: "territory",
      label: { text: owner.displayName() },
      tile,
      ownerSmallID: owner.smallID(),
    };
  }
  if (!game.isLand(tile)) {
    return {
      kind: "terrain",
      label: {
        key: game.isOcean(tile)
          ? "annotation.terrain.ocean"
          : "annotation.terrain.lake",
      },
      tile,
    };
  }
  return { kind: "terrain", label: { key: "annotation.wilderness" }, tile };
}

/**
 * The annotation for a world position: the unit whose footprint is under
 * the cursor, otherwise the owner or terrain of the tile. Null off the map.
 */
export function annotationAt(
  game: AnnotationGame,
  worldX: number,
  worldY: number,
): Annotation | null {
  const x = Math.floor(worldX);
  const y = Math.floor(worldY);
  if (!game.isValidCoord(x, y)) return null;
  const tile = game.ref(x, y);
  const unit = unitUnderCursor(game, tile);
  if (unit !== null) return describeUnit(unit);
  return describeTile(game, tile);
}

/** Identity of what a label names, so moving across the same thing keeps it. */
export function annotationKey(annotation: Annotation): string {
  if (annotation.unitId !== undefined) return `unit:${annotation.unitId}`;
  if (annotation.ownerSmallID !== undefined) {
    return `owner:${annotation.ownerSmallID}`;
  }
  const label = annotation.label;
  return `terrain:${"key" in label ? label.key : label.text}`;
}
