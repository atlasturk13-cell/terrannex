import {
  ANNOTATED_UNIT_TYPES,
  ANNOTATION_SEARCH_RANGE,
  annotationAt,
  AnnotationGame,
  annotationKey,
  AnnotationPlayer,
  AnnotationUnit,
  unitUnderCursor,
} from "../../src/client/hud/layers/annotation/AnnotationResolver";
import { AircraftType, UnitType } from "../../src/core/game/Game";

const W = 100;
const ref = (x: number, y: number) => y * W + x;

function player(smallID: number, name: string): AnnotationPlayer {
  return {
    isPlayer: () => true,
    smallID: () => smallID,
    displayName: () => name,
  };
}

const terraNullius = { isPlayer: () => false };

function unit(
  id: number,
  type: UnitType,
  tile: number,
  overrides: Partial<AnnotationUnit> = {},
): AnnotationUnit {
  return {
    id: () => id,
    type: () => type,
    tile: () => tile,
    isActive: () => true,
    aircraftState: () => ({}),
    ...overrides,
  };
}

function fakeGame(options: {
  units?: AnnotationUnit[];
  owners?: Map<number, AnnotationPlayer>;
  land?: (tile: number) => boolean;
  ocean?: (tile: number) => boolean;
}): AnnotationGame {
  const units = options.units ?? [];
  return {
    isValidCoord: (x, y) => x >= 0 && y >= 0 && x < W && y < W,
    ref,
    owner: (tile) => options.owners?.get(tile) ?? terraNullius,
    isLand: (tile) => options.land?.(tile) ?? true,
    isOcean: (tile) => options.ocean?.(tile) ?? false,
    nearbyUnits: (tile, range, types) => {
      const tx = tile % W;
      const ty = (tile - tx) / W;
      return units
        .filter((u) => types.includes(u.type()))
        .map((u) => {
          const ux = u.tile() % W;
          const uy = (u.tile() - ux) / W;
          return { unit: u, distSquared: (ux - tx) ** 2 + (uy - ty) ** 2 };
        })
        .filter(({ distSquared }) => distSquared <= range * range);
    },
  };
}

describe("Annotation resolver", () => {
  const rival = player(2, "Rival");

  it("covers every drawn unit type and looks as far as the widest footprint", () => {
    expect(ANNOTATION_SEARCH_RANGE).toBe(8);
    for (const type of [
      UnitType.Warship,
      UnitType.TradeShip,
      UnitType.TransportShip,
      UnitType.FighterJet,
      UnitType.Port,
      UnitType.City,
      UnitType.Factory,
      UnitType.SAMLauncher,
      UnitType.Train,
      UnitType.AtomBomb,
      UnitType.Shell,
    ]) {
      expect(ANNOTATED_UNIT_TYPES).toContain(type);
    }
  });

  it("names a unit by its type only, and a jet by its airframe", () => {
    const warship = unit(7, UnitType.Warship, ref(50, 50));
    const factory = unit(8, UnitType.Factory, ref(10, 10));
    const jet = unit(9, UnitType.FighterJet, ref(20, 20), {
      aircraftState: () => ({ aircraftType: AircraftType.KAAN }),
    });
    const game = fakeGame({
      units: [warship, factory, jet],
      owners: new Map([[ref(50, 50), rival]]),
    });
    expect(annotationAt(game, 54.4, 51.2)).toEqual({
      kind: "unit",
      label: { key: "unit_type.warship" },
      tile: ref(50, 50),
      unitId: 7,
    });
    expect(annotationAt(game, 11, 11)).toEqual({
      kind: "unit",
      label: { key: "unit_type.factory" },
      tile: ref(10, 10),
      unitId: 8,
    });
    expect(annotationAt(game, 26, 24)?.label).toEqual({
      key: "build_menu.airport_launch.aircraft.kaan.name",
    });
    // No owner leaks into a unit label.
    expect(JSON.stringify(annotationAt(game, 54, 51))).not.toContain("Rival");
  });

  it("prefers the thing whose footprint the cursor is closest to, by size", () => {
    const warship = unit(1, UnitType.Warship, ref(50, 50));
    const port = unit(2, UnitType.Port, ref(53, 50));
    const game = fakeGame({ units: [warship, port] });
    // 2 tiles from the port (radius 3.5 → 0.57) and 5 from the ship (7 → 0.71).
    expect(unitUnderCursor(game, ref(55, 50))?.id()).toBe(2);
    // Right next to the ship, the port is 3 tiles off (0.86) and loses.
    expect(unitUnderCursor(game, ref(50, 51))?.id()).toBe(1);
    expect(unitUnderCursor(game, ref(70, 70))).toBeNull();
    const ghost = unit(5, UnitType.Warship, ref(80, 80), {
      isActive: () => false,
    });
    expect(
      unitUnderCursor(fakeGame({ units: [ghost] }), ref(80, 80)),
    ).toBeNull();
  });

  it("names empty owned land by its owner, and bare terrain by the terrain word", () => {
    const game = fakeGame({
      owners: new Map([[ref(30, 30), rival]]),
      land: (tile) => tile !== ref(5, 5) && tile !== ref(6, 6),
      ocean: (tile) => tile === ref(5, 5),
    });
    expect(annotationAt(game, 30.7, 30.2)).toEqual({
      kind: "territory",
      label: { text: "Rival" },
      tile: ref(30, 30),
      ownerSmallID: 2,
    });
    expect(annotationAt(game, 7, 7)).toEqual({
      kind: "terrain",
      label: { key: "annotation.wilderness" },
      tile: ref(7, 7),
    });
    expect(annotationAt(game, 5, 5)?.label).toEqual({
      key: "annotation.terrain.ocean",
    });
    expect(annotationAt(game, 6, 6)?.label).toEqual({
      key: "annotation.terrain.lake",
    });
    expect(annotationAt(game, -1, 4)).toBeNull();
    expect(annotationAt(game, 4, 200)).toBeNull();
  });

  it("keys labels by what they name so the chip survives movement across it", () => {
    const warship = unit(1, UnitType.Warship, ref(50, 50));
    const game = fakeGame({
      units: [warship],
      owners: new Map([
        [ref(30, 30), rival],
        [ref(31, 30), rival],
      ]),
    });
    expect(annotationKey(annotationAt(game, 50, 50)!)).toBe("unit:1");
    expect(annotationKey(annotationAt(game, 30, 30)!)).toBe(
      annotationKey(annotationAt(game, 31, 30)!),
    );
    expect(annotationKey(annotationAt(game, 30, 30)!)).toBe("owner:2");
    expect(annotationKey(annotationAt(game, 70, 70)!)).toBe(
      "terrain:annotation.wilderness",
    );
  });
});
