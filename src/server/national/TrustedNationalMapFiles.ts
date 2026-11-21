/**
 * Trusted NATIONAL server map adapter. Reads the SAME deployment map binaries
 * as the HTTP worker, but never exposes them or the resulting Game to clients.
 */
import type { MapFiles } from "@openfront/engine-api/game/MapFiles";
import { MapManifestSchema } from "@openfront/engine-api/game/MapManifest";
import { GameMapSize, GameMapType } from "@openfront/engine-api/game/GameTypes";
import { readMapFile } from "../MapFiles";

export async function loadTrustedNationalMapFiles(
  gameMap: GameMapType,
  gameMapSize: GameMapSize,
): Promise<MapFiles> {
  const manifest = MapManifestSchema.parse(
    JSON.parse((await readMapFile(gameMap, "manifest.json")).toString("utf8")),
  );
  if (gameMapSize === GameMapSize.Normal) {
    const [mapBin, map4xBin] = await Promise.all([
      readMapFile(gameMap, "map.bin"),
      readMapFile(gameMap, "map4x.bin"),
    ]);
    return { map: gameMap, mapSize: gameMapSize, manifest, mapBin, map4xBin };
  }
  const [map4xBin, map16xBin] = await Promise.all([
    readMapFile(gameMap, "map4x.bin"),
    readMapFile(gameMap, "map16x.bin"),
  ]);
  return { map: gameMap, mapSize: gameMapSize, manifest, map4xBin, map16xBin };
}
