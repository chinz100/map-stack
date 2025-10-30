import fs from 'fs';
import path from 'path';
import { Request, Response } from 'express';

type LonLat = [number, number];

interface GeoFeature {
  type: 'Feature';
  properties: Record<string, unknown>;
  geometry: {
    type: 'Point';
    coordinates: LonLat;
  };
}

interface GeoCollection {
  type: 'FeatureCollection';
  name?: string;
  features: GeoFeature[];
}

const dataDir = path.join(__dirname, '..', 'data');

const cityCollection: GeoCollection = JSON.parse(
  fs.readFileSync(path.join(dataDir, 'thailand-cities-point.geojson'), 'utf-8'),
);

const poiCollection: GeoCollection = JSON.parse(
  fs.readFileSync(path.join(dataDir, 'thailand-cities.geojson'), 'utf-8'),
);

function parseBbox(
  bboxRaw: string | string[] | undefined,
): [number, number, number, number] | null {
  if (!bboxRaw) {
    return null;
  }

  const value = Array.isArray(bboxRaw) ? bboxRaw.join(',') : bboxRaw;
  const parts = value
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((part) => !Number.isNaN(part));

  if (parts.length !== 4) {
    return null;
  }

  const [minLon, minLat, maxLon, maxLat] = parts;
  if (minLon > maxLon || minLat > maxLat) {
    return null;
  }

  return [minLon, minLat, maxLon, maxLat];
}

function filterByBbox(
  features: GeoFeature[],
  bbox: ReturnType<typeof parseBbox>,
): GeoFeature[] {
  if (!bbox) {
    return features;
  }
  const [minLon, minLat, maxLon, maxLat] = bbox;
  return features.filter((feature) => {
    const [lon, lat] = feature.geometry.coordinates;
    return lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat;
  });
}

function parseLimit(value: string | string[] | undefined, defaultValue: number) {
  const num = Number(Array.isArray(value) ? value[0] : value);
  if (Number.isFinite(num)) {
    return Math.max(1, Math.min(5000, Math.floor(num)));
  }
  return defaultValue;
}

function parseZoom(value: string | string[] | undefined): number {
  const zoom = Number(Array.isArray(value) ? value[0] : value);
  if (Number.isFinite(zoom)) {
    return Math.min(22, Math.max(0, zoom));
  }
  return 8;
}

function gridSizeForZoom(zoom: number): number {
  if (zoom >= 14) return 0.02;
  if (zoom >= 12) return 0.05;
  if (zoom >= 10) return 0.1;
  if (zoom >= 8) return 0.25;
  if (zoom >= 6) return 0.5;
  if (zoom >= 4) return 1.0;
  if (zoom >= 2) return 2.0;
  return 4.0;
}

function parseKindParam(value: string | string[] | undefined): 'city' | 'cluster' | 'all' {
  if (!value) {
    return 'city';
  }
  const raw = Array.isArray(value) ? value[0] : value;
  const normalized = raw.toLowerCase();
  if (normalized === 'all' || normalized === 'mixed') return 'all';
  if (['cluster', 'clusters', 'cluster_seed', 'seed'].includes(normalized)) return 'cluster';
  return 'city';
}

export function getCitySummary(req: Request, res: Response): void {
  const bbox = parseBbox(req.query.bbox);
  if (req.query.bbox && !bbox) {
    res.status(400).json({
      error: 'Invalid bbox parameter. Expected format: minLon,minLat,maxLon,maxLat',
    });
    return;
  }

  const kind = parseKindParam(req.query.kind);
  const bboxFiltered = filterByBbox(cityCollection.features, bbox);
  const features = bboxFiltered.filter((feature) => {
    const featureKind = String(feature.properties?.kind ?? 'city').toLowerCase();
    if (kind === 'all') return true;
    if (kind === 'cluster') {
      return featureKind !== 'city';
    }
    return featureKind === 'city';
  });
  res.json({
    type: cityCollection.type,
    name: cityCollection.name ?? 'thailand_city_summary',
    count: features.length,
    total_in_bbox: bboxFiltered.length,
    kind,
    bbox: bbox ?? null,
    features,
  });
}

export function getPois(req: Request, res: Response): void {
  const bbox = parseBbox(req.query.bbox);
  if (req.query.bbox && !bbox) {
    res.status(400).json({
      error: 'Invalid bbox parameter. Expected format: minLon,minLat,maxLon,maxLat',
    });
    return;
  }

  const limit = parseLimit(req.query.limit, 1000);
  const filtered = filterByBbox(poiCollection.features, bbox);
  const features = filtered.slice(0, limit);

  res.json({
    type: poiCollection.type,
    name: poiCollection.name ?? 'thailand_pois',
    count: filtered.length,
    returned: features.length,
    bbox: bbox ?? null,
    features,
  });
}

export function getPoiClusters(req: Request, res: Response): void {
  const bbox = parseBbox(req.query.bbox);
  if (req.query.bbox && !bbox) {
    res.status(400).json({
      error: 'Invalid bbox parameter. Expected format: minLon,minLat,maxLon,maxLat',
    });
    return;
  }

  const zoom = parseZoom(req.query.zoom);
  const limit = parseLimit(req.query.limit, 500);
  const cellSize = gridSizeForZoom(zoom);

  const features = filterByBbox(poiCollection.features, bbox);

  type Cluster = {
    id: string;
    count: number;
    sumLon: number;
    sumLat: number;
    minLon: number;
    minLat: number;
    maxLon: number;
    maxLat: number;
    categories: Record<string, number>;
  };

  const clusters = new Map<string, Cluster>();

  for (const feature of features) {
    const [lon, lat] = feature.geometry.coordinates;
    const x = Math.floor(lon / cellSize);
    const y = Math.floor(lat / cellSize);
    const key = `${x}:${y}`;

    const cluster = clusters.get(key) ?? {
      id: key,
      count: 0,
      sumLon: 0,
      sumLat: 0,
      minLon: Number.POSITIVE_INFINITY,
      minLat: Number.POSITIVE_INFINITY,
      maxLon: Number.NEGATIVE_INFINITY,
      maxLat: Number.NEGATIVE_INFINITY,
      categories: {},
    };

    cluster.count += 1;
    cluster.sumLon += lon;
    cluster.sumLat += lat;
    cluster.minLon = Math.min(cluster.minLon, lon);
    cluster.minLat = Math.min(cluster.minLat, lat);
    cluster.maxLon = Math.max(cluster.maxLon, lon);
    cluster.maxLat = Math.max(cluster.maxLat, lat);

    const category = String(feature.properties.category ?? 'unknown');
    cluster.categories[category] = (cluster.categories[category] ?? 0) + 1;

    clusters.set(key, cluster);
  }

  const clusterFeatures = Array.from(clusters.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((cluster, idx) => {
      const topCategories = Object.entries(cluster.categories)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([name, count]) => ({ name, count }));

      return {
        type: 'Feature',
        properties: {
          id: `cluster_${idx}`,
          cluster_key: cluster.id,
          count: cluster.count,
          top_categories: topCategories,
          bbox: [cluster.minLon, cluster.minLat, cluster.maxLon, cluster.maxLat],
          zoom,
          cellSizeDeg: cellSize,
        },
        geometry: {
          type: 'Point',
          coordinates: [
            cluster.sumLon / cluster.count,
            cluster.sumLat / cluster.count,
          ] as LonLat,
        },
      } as GeoFeature;
    });

  res.json({
    type: 'FeatureCollection',
    name: 'thailand_poi_clusters',
    bbox: bbox ?? null,
    zoom,
    count: clusterFeatures.length,
    originalCount: features.length,
    cellSizeDeg: cellSize,
    features: clusterFeatures,
  });
}

export default {
  getCitySummary,
  getPois,
  getPoiClusters,
};
