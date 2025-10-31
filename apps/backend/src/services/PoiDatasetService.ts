import fs from 'node:fs';
import path from 'node:path';

import { GeoCollection, GeoFeature, LonLat } from '@src/types/geo';

export interface PoiDatasetInfo {
  absolutePath: string;
  relativePath: string;
  type: 'geojson' | 'geojsonl';
  lastModified: number;
  featureCount: number;
}

export interface PoiDataset {
  collection: GeoCollection;
  info: PoiDatasetInfo;
}

export const GEO_DATA_DIR = path.join(__dirname, '..', 'data');

const CANDIDATE_FILES = [
  'thailand-cities.geojsonl',
  'thailand-cities.geojson',
  'thailand-cities-point.geojson',
] as const;

let cachedDataset: PoiDataset | null = null;

export function getPoiDataset(): PoiDataset | null {
  if (cachedDataset) {
    return cachedDataset;
  }

  for (const candidate of CANDIDATE_FILES) {
    const absolutePath = path.join(GEO_DATA_DIR, candidate);
    if (!fs.existsSync(absolutePath)) {
      continue;
    }

    try {
      cachedDataset = loadDatasetFromFile(absolutePath);
      return cachedDataset;
    } catch (error) {
      // Skip invalid or unreadable files and continue to the next candidate.
      cachedDataset = null;
    }
  }

  return null;
}

function loadDatasetFromFile(absolutePath: string): PoiDataset {
  const stat = fs.statSync(absolutePath);
  const extension = path.extname(absolutePath).toLowerCase();
  const type = extension === '.geojsonl' ? 'geojsonl' : 'geojson';
  const features =
    type === 'geojsonl'
      ? readGeoJsonLines(absolutePath)
      : readGeoJsonCollection(absolutePath);

  const relativePath = path.relative(GEO_DATA_DIR, absolutePath) || path.basename(absolutePath);
  const name = path.basename(absolutePath, path.extname(absolutePath));

  const collection: GeoCollection = {
    type: 'FeatureCollection',
    name,
    features,
  };

  return {
    collection,
    info: {
      absolutePath,
      relativePath,
      type,
      lastModified: stat.mtimeMs,
      featureCount: features.length,
    },
  };
}

function readGeoJsonCollection(filePath: string): GeoFeature[] {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw);

  if (parsed?.type === 'FeatureCollection' && Array.isArray(parsed.features)) {
    return sanitizeFeatureArray(parsed.features);
  }

  if (Array.isArray(parsed)) {
    return sanitizeFeatureArray(parsed);
  }

  throw new Error(`Unsupported GeoJSON format in ${filePath}`);
}

function readGeoJsonLines(filePath: string): GeoFeature[] {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/);
  const features: GeoFeature[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    try {
      const parsed = JSON.parse(trimmed);
      const feature = toPointFeature(parsed);
      if (feature) {
        features.push(feature);
      }
    } catch {
      // Ignore malformed JSON lines.
    }
  }

  return features;
}

function sanitizeFeatureArray(values: unknown[]): GeoFeature[] {
  const features: GeoFeature[] = [];
  for (const value of values) {
    const feature = toPointFeature(value);
    if (feature) {
      features.push(feature);
    }
  }
  return features;
}

function toPointFeature(value: unknown): GeoFeature | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const maybeFeature = value as Record<string, unknown>;
  if (maybeFeature.type !== 'Feature') {
    return null;
  }

  const geometry = maybeFeature.geometry as Record<string, unknown> | undefined;
  if (!geometry || geometry.type !== 'Point') {
    return null;
  }

  const coords = geometry.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) {
    return null;
  }

  const lon = Number(coords[0]);
  const lat = Number(coords[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    return null;
  }

  const coordinates: LonLat = [lon, lat];
  const properties = sanitizeProperties(maybeFeature.properties);

  return {
    type: 'Feature',
    properties,
    geometry: {
      type: 'Point',
      coordinates,
    },
  };
}

function sanitizeProperties(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}
