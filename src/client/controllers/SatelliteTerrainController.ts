/**
 * SatelliteTerrainController — finds the current map's satellite imagery
 * (resources/maps/<map>/satellite/, Natural Earth maps only), hands the
 * overview and a detail-tile fetcher to the renderer off the critical path,
 * and follows the "Satellite map" setting.
 */

import { assetUrl } from "../../core/AssetUrls";
import { GameMapType } from "../../core/game/Game";
import {
  USER_SETTINGS_CHANGED_EVENT,
  UserSettings,
} from "../../core/game/UserSettings";
import { Controller } from "../Controller";
import type { MapRenderer } from "../render/gl";
import type { SatelliteIndex } from "../render/gl/SatelliteTerrain";

/** The asset folder of a map, as the terrain loader derives it. */
export function mapAssetFolder(map: GameMapType): string | null {
  const key = Object.keys(GameMapType).find(
    (k) => GameMapType[k as keyof typeof GameMapType] === map,
  );
  return key?.toLowerCase() ?? null;
}

async function fetchBitmap(url: string): Promise<ImageBitmap> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return createImageBitmap(await response.blob());
}

export class SatelliteTerrainController implements Controller {
  constructor(
    private readonly view: Pick<
      MapRenderer,
      "setSatelliteSource" | "setSatelliteEnabled"
    >,
    private readonly gameMap: GameMapType,
    private readonly userSettings: UserSettings,
    private readonly abortSignal: AbortSignal,
  ) {}

  init(): void {
    this.view.setSatelliteEnabled(this.userSettings.satelliteTerrain());
    globalThis.addEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:settings.satelliteTerrain`,
      (e) =>
        this.view.setSatelliteEnabled(
          (e as CustomEvent<string>).detail === "true",
        ),
      { signal: this.abortSignal },
    );
    void this.load();
  }

  private async load(): Promise<void> {
    const folder = mapAssetFolder(this.gameMap);
    if (folder === null) return;
    const base = `maps/${folder}/satellite`;
    try {
      const response = await fetch(assetUrl(`${base}/index.json`));
      // Maps without imagery keep the procedural terrain (the dev server
      // answers unknown paths with the HTML shell, hence the type check).
      if (
        !response.ok ||
        !(response.headers.get("content-type") ?? "").includes("json")
      ) {
        return;
      }
      const index = (await response.json()) as SatelliteIndex;
      if (index.version !== 1) return;
      const overview = await fetchBitmap(
        assetUrl(`${base}/${index.overview.file}`),
      );
      if (this.abortSignal.aborted) {
        overview.close();
        return;
      }
      this.view.setSatelliteSource({
        index,
        overview,
        fetchTile: (col, row) =>
          fetchBitmap(assetUrl(`${base}/tiles/${col}_${row}.webp`)),
      });
    } catch (error) {
      console.warn("[SatelliteTerrain] imagery unavailable:", error);
    }
  }
}
