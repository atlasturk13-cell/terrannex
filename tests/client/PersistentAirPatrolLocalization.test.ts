import fs from "fs";
import path from "path";

describe("Persistent air patrol localization", () => {
  it("ships explicit English and Turkish role and airborne-command copy", () => {
    const root = path.resolve(__dirname, "../..");
    const en = JSON.parse(
      fs.readFileSync(path.join(root, "resources/lang/en.json"), "utf8"),
    );
    const tr = JSON.parse(
      fs.readFileSync(path.join(root, "resources/lang/tr.json"), "utf8"),
    );

    expect(en.build_menu.air_mission).toEqual(
      expect.objectContaining({
        airborne_attack: "Attack with airborne jets",
        combat_air_patrol: "Combat Air Patrol",
      }),
    );
    expect(tr.build_menu.air_mission).toEqual(
      expect.objectContaining({
        air_superiority_patrol: "Hava Üstünlüğü Devriyesi",
        airborne_attack: "Havadaki jetlerle saldır",
        combat_air_patrol: "Muharebe Hava Devriyesi",
      }),
    );
    expect(en.build_menu.air_mission.air_superiority_instructions).toBe(
      "Launch one patrol. It fights automatically.",
    );
    expect(en.build_menu.air_mission.air_superiority_patrol_desc).toBe(
      "Stays airborne. Shoots enemy jets and nearby enemy ships.",
    );
    expect(en.build_menu.desc.fighter_jet_air_superiority).toBe(
      "Stays airborne. Shoots enemy jets and nearby enemy ships.",
    );
    for (const englishOnlyKey of [
      "air_superiority_instructions",
      "air_superiority_patrol_desc",
    ]) {
      expect(tr.build_menu.air_mission).not.toHaveProperty(englishOnlyKey);
    }
    expect(tr.build_menu.desc).not.toHaveProperty(
      "fighter_jet_air_superiority",
    );
    expect(
      en.build_menu.quantity.description.replace(
        "{item}",
        en.build_menu.air_mission.airborne_attack_quantity_item,
      ),
    ).toBe("Set quantity for airborne fighter-jet attack.");
    expect(
      tr.build_menu.quantity.description.replace(
        "{item}",
        tr.build_menu.air_mission.airborne_attack_quantity_item,
      ),
    ).toBe(
      "Kaç adet havadaki savaş jetleriyle saldırı komutu vermek istiyorsun?",
    );

    for (const language of [en, tr]) {
      for (const key of [
        "airborne_attack_desc",
        "airborne_attack_no_patrols",
        "airborne_attack_quantity_item",
        "airborne_attack_target_required",
        "combat_air_patrol_desc",
      ]) {
        expect(language.build_menu.air_mission[key]).toEqual(
          expect.any(String),
        );
        expect(language.build_menu.air_mission[key].length).toBeGreaterThan(20);
      }
    }
  });
});
