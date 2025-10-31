import fs from 'node:fs/promises';
import path from 'node:path';

import { GeoFeature } from '@src/types/geo';
import { GEO_DATA_DIR, PoiDatasetInfo } from './PoiDatasetService';

export interface PoiTileCachePayload {
  type: 'FeatureCollection';
  tile: { z: number; x: number; y: number };
  bbox: [number, number, number, number];
  count: number;
  dataset: {
    relativePath: string;
    type: 'geojson' | 'geojsonl';
    lastModified: number;
    totalFeatures: number;
  };
  cache: {
    key: string;
    generatedAt: string;
    hit: boolean;
  };
  features: GeoFeature[];
}

export const POI_TILE_CACHE_DIR = path.join(GEO_DATA_DIR, 'tiles', 'pois');

export function getPoiTileCachePath(z: number, x: number, y: number): string {
  return path.join(POI_TILE_CACHE_DIR, String(z), String(x), `${y}.json`);
}

export async function readPoiTileFromCache(
  cachePath: string,
  datasetInfo: PoiDatasetInfo,
): Promise<PoiTileCachePayload | null> {
  try {
    const raw = await fs.readFile(cachePath, 'utf8');
    const parsed = JSON.parse(raw) as PoiTileCachePayload;

    if (!isValidTilePayload(parsed)) {
      return null;
    }

    if (
      parsed.dataset.relativePath !== datasetInfo.relativePath ||
      parsed.dataset.lastModified !== datasetInfo.lastModified
    ) {
      return null;
    }

    parsed.cache.hit = true;
    return parsed;
  } catch (error: unknown) {
    if (isErrnoException(error) && error.code === 'ENOENT') {
      return null;
    }
    return null;
  }
}

export async function writePoiTileToCache(
  cachePath: string,
  payload: PoiTileCachePayload,
): Promise<void> {
  const toPersist: PoiTileCachePayload = {
    ...payload,
    cache: {
      ...payload.cache,
      hit: false,
    },
  };

  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, JSON.stringify(toPersist));
}

function isValidTilePayload(value: unknown): value is PoiTileCachePayload {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const maybe = value as PoiTileCachePayload;
  return (
    maybe.type === 'FeatureCollection' &&
    typeof maybe.count === 'number' &&
    Array.isArray(maybe.features) &&
    typeof maybe.dataset === 'object' &&
    typeof maybe.cache === 'object' &&
    Array.isArray(maybe.bbox) &&
    maybe.bbox.length === 4
  );
}

function isErrnoException(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && 'code' in value;
}
