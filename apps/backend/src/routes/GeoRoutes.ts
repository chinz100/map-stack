import fs from "node:fs";
import path from "node:path";
import { NextFunction, Request, Response } from "express";

import {
  GEO_DATA_DIR,
  PoiDataset,
  PoiDatasetInfo,
  getPoiDataset,
} from "@src/services/PoiDatasetService";
import {
  PoiTileCachePayload,
  getPoiTileCachePath,
  readPoiTileFromCache,
  writePoiTileToCache,
} from "@src/services/PoiTileCache";
import {
  CityTileCachePayload,
  getCityTileCachePath,
  readCityTileFromCache,
  writeCityTileToCache,
} from "@src/services/CityTileCache";
import { GeoCollection, GeoFeature, LonLat } from "@src/types/geo";

const cityPointDataPath = path.join(
  GEO_DATA_DIR,
  "thailand-cities-point.geojson"
);
const cityCollection = loadGeoCollection(cityPointDataPath, "thailand_cities");

const cityTileDataPath = path.join(GEO_DATA_DIR, "thailand-cities.geojson");
const cityTileCollection = loadGeoCollection(
  cityTileDataPath,
  "thailand_cities"
);
const cityTileDatasetInfo = createDatasetInfo(
  cityTileDataPath,
  cityTileCollection
);

const poiDataset: PoiDataset | null = getPoiDataset();

const poiCollection: GeoCollection = poiDataset?.collection ?? cityCollection;
const poiTileCollection: GeoCollection = cityCollection;
const poiTileDatasetInfo: PoiDatasetInfo = createDatasetInfo(
  cityPointDataPath,
  poiTileCollection
);

function parseBbox(
  bboxRaw: string | string[] | undefined
): [number, number, number, number] | null {
  if (!bboxRaw) {
    return null;
  }

  const value = Array.isArray(bboxRaw) ? bboxRaw.join(",") : bboxRaw;
  const parts = value
    .split(",")
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
  bbox: ReturnType<typeof parseBbox>
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

function parseLimit(
  value: string | string[] | undefined,
  defaultValue: number
) {
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

function parseKindParam(
  value: string | string[] | undefined
): "city" | "cluster" | "all" {
  if (!value) {
    return "city";
  }
  const raw = Array.isArray(value) ? value[0] : value;
  const normalized = raw.toLowerCase();
  if (normalized === "all" || normalized === "mixed") return "all";
  if (["cluster", "clusters", "cluster_seed", "seed"].includes(normalized))
    return "cluster";
  return "city";
}

export function getCitySummary(req: Request, res: Response): void {
  const bbox = parseBbox(req.query.bbox);
  if (req.query.bbox && !bbox) {
    res.status(400).json({
      error:
        "Invalid bbox parameter. Expected format: minLon,minLat,maxLon,maxLat",
    });
    return;
  }

  const kind = parseKindParam(req.query.kind);
  const bboxFiltered = filterByBbox(cityCollection.features, bbox);
  const features = bboxFiltered.filter((feature) => {
    const featureKind = String(
      feature.properties?.kind ?? "city"
    ).toLowerCase();
    if (kind === "all") return true;
    if (kind === "cluster") {
      return featureKind !== "city";
    }
    return featureKind === "city";
  });
  res.json({
    type: cityCollection.type,
    name: cityCollection.name ?? "thailand_cities",
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
      error:
        "Invalid bbox parameter. Expected format: minLon,minLat,maxLon,maxLat",
    });
    return;
  }

  const limit = parseLimit(req.query.limit, 1000);
  const filtered = filterByBbox(poiCollection.features, bbox);
  const features = filtered.slice(0, limit);

  res.json({
    type: poiCollection.type,
    name: poiCollection.name ?? "thailand_pois",
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
      error:
        "Invalid bbox parameter. Expected format: minLon,minLat,maxLon,maxLat",
    });
    return;
  }

  const zoom = parseZoom(req.query.zoom);
  const limit = parseLimit(req.query.limit, 500);
  const cellSize = gridSizeForZoom(zoom);

  const features = filterByBbox(poiCollection.features, bbox);

  interface Cluster {
    id: string;
    count: number;
    sumLon: number;
    sumLat: number;
    minLon: number;
    minLat: number;
    maxLon: number;
    maxLat: number;
    categories: Record<string, number>;
  }

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

    const category = String(feature.properties.category ?? "unknown");
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
        type: "Feature",
        properties: {
          id: `cluster_${idx}`,
          cluster_key: cluster.id,
          count: cluster.count,
          top_categories: topCategories,
          bbox: [
            cluster.minLon,
            cluster.minLat,
            cluster.maxLon,
            cluster.maxLat,
          ],
          zoom,
          cellSizeDeg: cellSize,
        },
        geometry: {
          type: "Point",
          coordinates: [
            cluster.sumLon / cluster.count,
            cluster.sumLat / cluster.count,
          ] as LonLat,
        },
      } as GeoFeature;
    });

  res.json({
    type: "FeatureCollection",
    name: "thailand_poi_clusters",
    bbox: bbox ?? null,
    zoom,
    count: clusterFeatures.length,
    originalCount: features.length,
    cellSizeDeg: cellSize,
    features: clusterFeatures,
  });
}

export function getCityTile(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const z = Number(req.params.z);
  const x = Number(req.params.x);
  const y = Number(req.params.y);
  const tileKey = { z, x, y };
  ensureRequestCancellationTracking(req);

  if (![z, x, y].every(Number.isInteger)) {
    res.status(400).json({ error: "Tile coordinates must be integers" });
    return;
  }

  if (z < 0 || z > 22) {
    res.status(400).json({ error: "Tile zoom must be between 0 and 22" });
    return;
  }

  const tileExtent = Math.pow(2, z);
  if (x < 0 || x >= tileExtent || y < 0 || y >= tileExtent) {
    res
      .status(400)
      .json({ error: "Tile coordinates are out of range for the given zoom" });
    return;
  }

  const bbox = tileToBbox(z, x, y);
  const cachePath = getCityTileCachePath(z, x, y);
  const cacheKey = `${z}/${x}/${y}`;
  const datasetInfo = cityTileDatasetInfo;
  const eTag = buildTileEtag("city", tileKey, datasetInfo);

  if (tryRespondNotModified(req, res, eTag)) {
    return;
  }

  if (tryRespondCancelled(req, res)) {
    return;
  }

  const payloadPromise = cityTileJobs.run(cacheKey, async () => {
    const cached = await readCityTileFromCache(cachePath, datasetInfo);
    if (cached) {
      return cached;
    }

    const features = filterByBbox(cityTileCollection.features, bbox);
    const payload: CityTileCachePayload = {
      type: "FeatureCollection",
      tile: { z, x, y },
      bbox,
      count: features.length,
      dataset: {
        relativePath: datasetInfo.relativePath,
        type: datasetInfo.type,
        lastModified: datasetInfo.lastModified,
        totalFeatures: datasetInfo.featureCount,
      },
      cache: {
        key: cacheKey,
        generatedAt: new Date().toISOString(),
        hit: false,
      },
      features,
    };

    await writeCityTileToCache(cachePath, payload);
    return payload;
  });

  void payloadPromise
    .then((payload) => {
      if (tryRespondCancelled(req, res) || !isResponseWritable(res)) {
        return;
      }

      applyTileCacheHeaders(res, eTag);
      res.json(payload);
    })
    .catch((error) => {
      next(error as Error);
    });
}

export function getPoiTile(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const z = Number(req.params.z);
  const x = Number(req.params.x);
  const y = Number(req.params.y);
  const tileKey = { z, x, y };
  ensureRequestCancellationTracking(req);

  if (![z, x, y].every(Number.isInteger)) {
    res.status(400).json({ error: "Tile coordinates must be integers" });
    return;
  }

  if (z < 0 || z > 22) {
    res.status(400).json({ error: "Tile zoom must be between 0 and 22" });
    return;
  }

  const tileExtent = Math.pow(2, z);
  if (x < 0 || x >= tileExtent || y < 0 || y >= tileExtent) {
    res
      .status(400)
      .json({ error: "Tile coordinates are out of range for the given zoom" });
    return;
  }

  const bbox = tileToBbox(z, x, y);
  const cachePath = getPoiTileCachePath(z, x, y);
  const cacheKey = `${z}/${x}/${y}`;
  const eTag = buildTileEtag("poi", tileKey, poiTileDatasetInfo);

  if (tryRespondNotModified(req, res, eTag)) {
    return;
  }

  if (tryRespondCancelled(req, res)) {
    return;
  }

  const payloadPromise = poiTileJobs.run(cacheKey, async () => {
    const cached = await readPoiTileFromCache(cachePath, poiTileDatasetInfo);
    if (cached) {
      return cached;
    }

    const features = filterByBbox(poiTileCollection.features, bbox);
    const payload: PoiTileCachePayload = {
      type: "FeatureCollection",
      tile: { z, x, y },
      bbox,
      count: features.length,
      dataset: {
        relativePath: poiTileDatasetInfo.relativePath,
        type: poiTileDatasetInfo.type,
        lastModified: poiTileDatasetInfo.lastModified,
        totalFeatures: poiTileDatasetInfo.featureCount,
      },
      cache: {
        key: cacheKey,
        generatedAt: new Date().toISOString(),
        hit: false,
      },
      features,
    };

    await writePoiTileToCache(cachePath, payload);
    return payload;
  });

  void payloadPromise
    .then((payload) => {
      if (tryRespondCancelled(req, res) || !isResponseWritable(res)) {
        return;
      }

      applyTileCacheHeaders(res, eTag);
      res.json(payload);
    })
    .catch((error) => {
      next(error as Error);
    });
}

export default {
  getCitySummary,
  getPois,
  getPoiClusters,
  getCityTile,
  getPoiTile,
};

function loadGeoCollection(
  filePath: string,
  fallbackName: string
): GeoCollection {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as GeoCollection;
    if (parsed.type === "FeatureCollection" && Array.isArray(parsed.features)) {
      return parsed;
    }
  } catch {
    // fall through to fallback
  }

  return {
    type: "FeatureCollection",
    name: fallbackName,
    features: [],
  };
}

function createDatasetInfo(
  filePath: string,
  collection: GeoCollection
): PoiDatasetInfo {
  const stat = fs.existsSync(filePath) ? fs.statSync(filePath) : undefined;
  return {
    absolutePath: filePath,
    relativePath:
      path.relative(GEO_DATA_DIR, filePath) || path.basename(filePath),
    type: filePath.endsWith(".geojsonl") ? "geojsonl" : "geojson",
    lastModified: stat?.mtimeMs ?? Date.now(),
    featureCount: collection.features.length,
  };
}

function tileToBbox(
  z: number,
  x: number,
  y: number
): [number, number, number, number] {
  const minLon = tileXToLon(x, z);
  const maxLon = tileXToLon(x + 1, z);
  const maxLat = tileYToLat(y, z);
  const minLat = tileYToLat(y + 1, z);
  return [minLon, minLat, maxLon, maxLat];
}

function tileXToLon(x: number, z: number): number {
  return (x / Math.pow(2, z)) * 360 - 180;
}

function tileYToLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

class TileJobRegistry<TPayload> {
  private readonly jobs = new Map<string, Promise<TPayload>>();

  run(key: string, factory: () => Promise<TPayload>): Promise<TPayload> {
    const existing = this.jobs.get(key);
    if (existing) {
      return existing;
    }

    const jobPromise = factory()
      .then((result) => {
        this.jobs.delete(key);
        return result;
      })
      .catch((error) => {
        this.jobs.delete(key);
        throw error;
      });

    this.jobs.set(key, jobPromise);
    return jobPromise;
  }
}

const cityTileJobs = new TileJobRegistry<CityTileCachePayload>();
const poiTileJobs = new TileJobRegistry<PoiTileCachePayload>();

function tryRespondCancelled(req: Request, res: Response): boolean {
  if (!isResponseWritable(res)) {
    return true;
  }

  if (isRequestCancelled(req)) {
    res.status(204).set("Cache-Control", "no-store").end();
    return true;
  }

  return false;
}

function tryRespondNotModified(
  req: Request,
  res: Response,
  eTag: string
): boolean {
  if (!isResponseWritable(res)) {
    return true;
  }

  const ifNoneMatchHeader = req.headers["if-none-match"];
  if (!ifNoneMatchHeader) {
    return false;
  }

  const headerValues = Array.isArray(ifNoneMatchHeader)
    ? ifNoneMatchHeader
    : [ifNoneMatchHeader];
  const matchValues = headerValues
    .flatMap((value) => (value ?? "").split(","))
    .map((value) => value.trim())
    .filter(Boolean);

  if (matchValues.includes("*") || matchValues.includes(eTag)) {
    applyTileCacheHeaders(res, eTag);
    res.status(304).end();
    return true;
  }

  return false;
}

function isRequestCancelled(req: Request): boolean {
  const state = ensureRequestCancellationTracking(req);
  return state.isCancelled();
}

function isResponseWritable(res: Response): boolean {
  if (res.headersSent || res.writableEnded) {
    return false;
  }

  if ("socket" in res && res.socket?.destroyed === true) {
    return false;
  }

  return true;
}

function buildTileEtag(
  prefix: string,
  tile: { z: number; x: number; y: number },
  datasetInfo: PoiDatasetInfo
): string {
  const safePath = datasetInfo.relativePath.replace(/[^a-zA-Z0-9_-]/g, "-");
  const lastModified = Math.round(datasetInfo.lastModified);
  return `W/"${prefix}-${safePath}-${lastModified}-${datasetInfo.featureCount}-${tile.z}-${tile.x}-${tile.y}"`;
}

const REQUEST_CANCEL_STATE = Symbol("requestCancelState");

interface RequestCancelState {
  isCancelled: () => boolean;
}

function ensureRequestCancellationTracking(req: Request): RequestCancelState {
  const existing = (req as Record<symbol, unknown>)[REQUEST_CANCEL_STATE] as
    | RequestCancelState
    | undefined;
  if (existing) {
    return existing;
  }

  let cancelled = false;
  const markCancelled = () => {
    cancelled = true;
  };

  req.once("aborted", markCancelled);
  req.once("close", markCancelled);
  if (req.socket) {
    req.socket.once("close", markCancelled);
  }

  const state: RequestCancelState = {
    isCancelled: () =>
      cancelled || req.destroyed || req.socket?.destroyed === true,
  };

  Object.defineProperty(req, REQUEST_CANCEL_STATE, {
    value: state,
    enumerable: false,
    configurable: false,
    writable: false,
  });

  return state;
}

function applyTileCacheHeaders(res: Response, eTag: string): void {
  res.set({
    "Cache-Control": "public, max-age=0, must-revalidate",
    ETag: eTag,
    Vary: "Accept-Encoding",
  });
}
