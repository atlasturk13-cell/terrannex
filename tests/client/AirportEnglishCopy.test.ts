import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

function locale(name: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "resources/lang", name), "utf8"),
  ) as Record<string, unknown>;
}

describe("Airport profile English copy", () => {
  it("uses the exact short English reasons", () => {
    const en = locale("en.json") as {
      build_menu: {
        airport_status: Record<string, string>;
      };
    };

    expect(en.build_menu.airport_status).toEqual({
      airport_building: "Airport is still building.",
      airport_cooldown: "Airport is rearming.",
      airport_full: "Airport is full.",
      airport_required: "Build an Airport first.",
      insufficient_gold: "Need more gold.",
      ready: "Ready.",
      spawn_immunity: "Wait for spawn shield.",
      unavailable: "Unit is disabled.",
    });
  });

  it("does not add Airport-profile explanations to Turkish", () => {
    const tr = locale("tr.json") as {
      build_menu?: { airport_capacity?: unknown; airport_status?: unknown };
    };

    expect(tr.build_menu?.airport_capacity).toBeUndefined();
    expect(tr.build_menu?.airport_status).toBeUndefined();
  });
});
