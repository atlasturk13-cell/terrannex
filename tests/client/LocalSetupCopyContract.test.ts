import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import { translateText } from "../../src/client/Utils";

const PROJECT_ROOT = path.join(__dirname, "../..");
const LANGUAGE_DIR = path.join(PROJECT_ROOT, "resources", "lang");

const GAME_SETTINGS_DESCRIPTION_KEYS = [
  "game_settings.bots_desc",
  "game_settings.nations_desc",
  "game_settings.map_natural_earth_desc",
  "game_settings.map_the_box_desc",
  "game_settings.difficulty_easy_desc",
  "game_settings.difficulty_medium_desc",
  "game_settings.difficulty_hard_desc",
  "game_settings.difficulty_impossible_desc",
  "game_settings.mode_ffa_desc",
  "game_settings.mode_teams_desc",
  "game_settings.team_count_desc",
  "game_settings.instant_build_desc",
  "game_settings.random_spawn_desc",
  "game_settings.infinite_gold_desc",
  "game_settings.infinite_troops_desc",
  "game_settings.compact_map_desc",
  "game_settings.water_nukes_desc",
  "game_settings.doomsday_clock_desc",
  "game_settings.doomsday_clock_speed_desc",
  "game_settings.max_timer_desc",
  "game_settings.gold_multiplier_desc",
  "game_settings.starting_gold_desc",
  "game_settings.custom_alliances_desc",
  "game_settings.unit_city_desc",
  "game_settings.unit_defense_post_desc",
  "game_settings.unit_port_desc",
  "game_settings.unit_warship_desc",
  "game_settings.unit_fighter_jet_desc",
  "game_settings.unit_boat_desc",
  "game_settings.unit_missile_silo_desc",
  "game_settings.unit_sam_launcher_desc",
  "game_settings.unit_atom_bomb_desc",
  "game_settings.unit_hydrogen_bomb_desc",
  "game_settings.unit_mirv_desc",
  "game_settings.unit_factory_desc",
] as const;

const LOCAL_HELP_KEYS = [
  "local.depth_progression_help",
  "local.commander_help",
  "local.camera_follow_help",
  "local.camera_pan_help",
  "local.camera_zoom_help",
  "local.game_speed_help",
  "local.match_tempo_help",
  "local.tempo_slow_help",
  "local.tempo_medium_help",
  "local.tempo_fast_help",
  "local.victory_help",
  "local.victory_territory_help",
  "local.victory_elimination_help",
  "local.players_colors_help",
  "local.advanced_options_help",
] as const;

const LOCAL_PRIMARY_KEYS = [
  "local.game_speed",
  "local.match_tempo",
  "local.tempo_slow",
  "local.tempo_medium",
  "local.tempo_fast",
  "local.victory",
  "local.victory_territory",
  "local.victory_elimination",
  "local.starting_funds",
  "local.decrease_starting_funds",
  "local.increase_starting_funds",
  "local.players_colors",
  "local.match_setup",
  "local.start_battle",
] as const;

const REQUIRED_COPY_KEYS = [
  ...GAME_SETTINGS_DESCRIPTION_KEYS,
  ...LOCAL_HELP_KEYS,
  ...LOCAL_PRIMARY_KEYS,
] as const;

const BANNED_TECHNICAL_TERMS =
  /\b(authoritative|deterministic|simulation|legacy|experimental|aggregate)\b/i;

type TranslationObject = Record<string, unknown>;

function readTranslations(language: "en" | "tr"): TranslationObject {
  return JSON.parse(
    readFileSync(path.join(LANGUAGE_DIR, `${language}.json`), "utf8"),
  ) as TranslationObject;
}

function nestedValue(translations: TranslationObject, dottedKey: string) {
  return dottedKey.split(".").reduce<unknown>((value, segment) => {
    if (value === null || typeof value !== "object") return undefined;
    return (value as TranslationObject)[segment];
  }, translations);
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(entryPath);
    return /\.(?:[cm]?[jt]sx?)$/.test(entry.name) ? [entryPath] : [];
  });
}

function staticStringReferences(file: string): Set<string> {
  const sourceFile = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    false,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const references = new Set<string>();

  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      references.add(node.text);
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return references;
}

type MockLangSelector = HTMLElement & {
  currentLang: string;
  translations: Record<string, string>;
  defaultTranslations: Record<string, string>;
};

type TranslateTextState = typeof translateText & {
  langSelector?: Element | null;
  formatterCache?: Map<string, unknown>;
  lastLang?: string | null;
};

function resetTranslateTextState(): void {
  const state = translateText as TranslateTextState;
  state.langSelector = null;
  state.formatterCache?.clear();
  state.lastLang = null;
}

describe("local setup copy contract", () => {
  afterEach(() => {
    document.body.replaceChildren();
    resetTranslateTextState();
  });

  it("keeps every required English explanation short and plain", () => {
    const english = readTranslations("en");
    const errors: string[] = [];

    for (const key of REQUIRED_COPY_KEYS) {
      const value = nestedValue(english, key);
      if (typeof value !== "string" || value.trim().length === 0) {
        errors.push(`${key}: missing or empty`);
        continue;
      }

      const wordCount = value.trim().split(/\s+/).length;
      if (wordCount > 7) {
        errors.push(`${key}: ${wordCount} words (maximum 7)`);
      }

      const bannedTerm = value.match(BANNED_TECHNICAL_TERMS)?.[0];
      if (bannedTerm !== undefined) {
        errors.push(`${key}: contains banned term "${bannedTerm}"`);
      }
    }

    expect(errors).toEqual([]);
  });

  it("keeps local setup explanations out of the Turkish catalog", () => {
    const turkish = readTranslations("tr");
    const unexpectedKeys = REQUIRED_COPY_KEYS.filter(
      (key) => nestedValue(turkish, key) !== undefined,
    );

    expect(unexpectedKeys).toEqual([]);
  });

  it("keeps every required explanation statically referenced by source", () => {
    const references = new Set(
      sourceFiles(path.join(PROJECT_ROOT, "src")).flatMap((file) => [
        ...staticStringReferences(file),
      ]),
    );
    const unreferencedKeys = REQUIRED_COPY_KEYS.filter(
      (key) => !references.has(key),
    );

    expect(unreferencedKeys).toEqual([]);
  });

  it("falls back to English when Turkish omits a setup explanation", () => {
    const fallbackKey = "game_settings.bots_desc";
    const englishValue = nestedValue(readTranslations("en"), fallbackKey);
    expect(typeof englishValue).toBe("string");

    const selector = document.createElement(
      "lang-selector",
    ) as MockLangSelector;
    selector.currentLang = "tr";
    selector.translations = {};
    selector.defaultTranslations = {
      [fallbackKey]: englishValue as string,
    };
    document.body.appendChild(selector);
    resetTranslateTextState();

    const translated = translateText(fallbackKey);
    expect(translated).toBe(englishValue);
    expect(translated).not.toBe(fallbackKey);
  });
});
