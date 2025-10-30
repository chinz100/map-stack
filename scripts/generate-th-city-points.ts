#!/usr/bin/env ts-node

import fs from 'fs';
import path from 'path';

type LonLat = [number, number];

interface Feature {
  type: 'Feature';
  properties: Record<string, unknown>;
  geometry: {
    type: string;
    coordinates: LonLat | unknown;
  };
}

interface FeatureCollection {
  type: 'FeatureCollection';
  name?: string;
  features: Feature[];
}

interface CliOptions {
  in: string;
  out: string;
  clustersPerCity: number;
  spreadKm: number;
  minCount: number;
  maxCount: number;
  seed: string;
  insertCity?: string;
  clusterInput?: string;
}

interface CityStats {
  id: string;
  region?: string;
  population?: number;
  nameTh: string;
  nameEn: string;
  count: number;
  openCount: number;
  ratingSum: number;
  ratingCount: number;
  categories: Record<string, number>;
  sumLat: number;
  sumLon: number;
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

const CATEGORY_FALLBACK = 'unknown';
const CATEGORY_POOL = [
  'healthcare',
  'education',
  'retail',
  'logistics',
  'emergency',
  'government',
  'tourism',
  'hospitality',
  'finance',
  'food',
  'transport',
  'technology',
  'culture',
  'sport',
];

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const opts: Partial<CliOptions> = {};

  const getNumber = (value: string | undefined, fallback: number, min: number, max: number) => {
    if (!value) return fallback;
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.min(max, Math.max(min, Math.floor(num)));
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case '--in':
      case '--input':
        opts.in = args[i + 1];
        i += 1;
        break;
      case '--out':
      case '--output':
        opts.out = args[i + 1];
        i += 1;
        break;
      case '--clusters':
      case '--clusters-per-city':
        opts.clustersPerCity = getNumber(args[i + 1], 8, 1, 24);
        i += 1;
        break;
      case '--spread-km':
        opts.spreadKm = getNumber(args[i + 1], 35, 5, 120);
        i += 1;
        break;
      case '--min-count':
        opts.minCount = getNumber(args[i + 1], 120, 10, 5000);
        i += 1;
        break;
      case '--max-count':
        opts.maxCount = getNumber(args[i + 1], 900, 50, 20000);
        i += 1;
        break;
      case '--seed':
        opts.seed = args[i + 1] ?? 'map-stack';
        i += 1;
        break;
      case '--insert-city':
      case '--insert-city-path':
      case '--city-insert':
        opts.insertCity = args[i + 1];
        i += 1;
        break;
      case '--cluster-input':
      case '--cluster-in':
      case '--clusters-input':
        opts.clusterInput = args[i + 1];
        i += 1;
        break;
      default:
        break;
    }
  }

  if (!opts.in || !opts.out) {
    console.error('Usage: pnpm exec tsx scripts/generate-th-city-points.ts --in <poi.geojson> --out <city-points.geojson> [--clusters-per-city 8] [--spread-km 35] [--min-count 120] [--max-count 900] [--seed string] [--insert-city <city.geojson>] [--cluster-input <cluster.geojson>]');
    process.exit(1);
  }

  return {
    in: opts.in,
    out: opts.out,
    clustersPerCity: opts.clustersPerCity ?? 8,
    spreadKm: opts.spreadKm ?? 35,
    minCount: opts.minCount ?? 120,
    maxCount: opts.maxCount ?? 900,
    seed: opts.seed ?? 'map-stack',
    insertCity: opts.insertCity,
    clusterInput: opts.clusterInput,
  };
}

function createSeededRandom(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i += 1) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function mulberry32() {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    const t = (h ^= h >>> 16) >>> 0;
    return (t & 0xfffffff) / 0x10000000;
  };
}

function offsetCoordinate(lat: number, lon: number, radiusKm: number, rand: () => number): LonLat {
  const angle = rand() * Math.PI * 2;
  const distance = radiusKm * (0.35 + rand() * 0.65);

  const deltaLat = distance * Math.cos(angle) / 110.574;
  const cosine = Math.cos((lat * Math.PI) / 180);
  const adjustedCos = Math.abs(cosine) < 1e-6 ? 1e-6 : cosine;
  const deltaLon = distance * Math.sin(angle) / (111.320 * adjustedCos);

  const newLat = lat + deltaLat;
  let newLon = lon + deltaLon;

  if (newLon > 180) newLon -= 360;
  if (newLon < -180) newLon += 360;

  return [Number(newLon.toFixed(6)), Number(newLat.toFixed(6))];
}

function bboxFromCenter(lat: number, lon: number, radiusKm: number): [number, number, number, number] {
  const deltaLat = radiusKm / 110.574;
  const cosine = Math.cos((lat * Math.PI) / 180);
  const adjustedCos = Math.abs(cosine) < 1e-6 ? 1e-6 : cosine;
  const deltaLon = radiusKm / (111.320 * adjustedCos);
  const minLon = lon - deltaLon;
  const maxLon = lon + deltaLon;
  const minLat = lat - deltaLat;
  const maxLat = lat + deltaLat;
  return [
    Number(minLon.toFixed(6)),
    Number(minLat.toFixed(6)),
    Number(maxLon.toFixed(6)),
    Number(maxLat.toFixed(6)),
  ];
}

function selectTopCategories(categoryCounts: Record<string, number>, limit = 3) {
  const entries = Object.entries(categoryCounts);
  if (!entries.length) {
    return [{ name: CATEGORY_FALLBACK, count: 0 }];
  }
  return entries
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

function extractFeatureId(feature: Feature, fallback: string): string {
  const props = feature.properties ?? {};
  const candidates: unknown[] = [
    props.id,
    props.city_id,
    props.cityId,
    props.cityID,
    props.slug,
    props.code,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return String(candidate);
    }
  }
  return fallback;
}

function coercePointCoordinates(value: unknown): LonLat | null {
  if (!Array.isArray(value) || value.length < 2) {
    return null;
  }

  const lon = Number(value[0]);
  const lat = Number(value[1]);

  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    return null;
  }

  return [Number(lon.toFixed(6)), Number(lat.toFixed(6))];
}

function detectFeatureKind(feature: Feature): 'city' | 'cluster' | null {
  const props = feature.properties ?? {};
  const rawKind = typeof props.kind === 'string' ? props.kind.toLowerCase() : '';

  if (rawKind.includes('city')) {
    return 'city';
  }
  if (rawKind.includes('cluster') || rawKind.includes('seed')) {
    return 'cluster';
  }
  if (
    'poi_total' in props
    || 'poi_count' in props
    || 'population' in props
    || 'name_th' in props
    || 'name_en' in props
  ) {
    return 'city';
  }
  if ('approx_count' in props || 'coverage_km' in props || 'min_zoom' in props || 'level' in props) {
    return 'cluster';
  }
  return null;
}

function addFeaturesToMap(
  map: Map<string, Feature>,
  features: Feature[],
  target: 'city' | 'cluster',
  prefix: string,
) {
  features.forEach((feature, index) => {
    if (!feature || feature.type !== 'Feature') {
      return;
    }
    if (!feature.geometry || feature.geometry.type !== 'Point') {
      return;
    }

    const coords = coercePointCoordinates(feature.geometry.coordinates);
    if (!coords) {
      console.warn(
        `[WARN] Skipping ${target} feature ${index} from ${prefix}: invalid coordinates.`,
      );
      return;
    }

    const detected = detectFeatureKind(feature);
    if (detected && detected !== target) {
      return;
    }

    if (!detected && prefix !== 'generated') {
      return;
    }

    const id = extractFeatureId(feature, `${prefix}_${index}`);
    const props = feature.properties ?? {};
    const kind =
      target === 'city'
        ? 'city'
        : typeof props.kind === 'string' && props.kind.trim()
          ? String(props.kind)
          : 'cluster_seed';

    map.set(id, {
      type: 'Feature',
      properties: {
        ...props,
        id,
        kind,
      },
      geometry: {
        type: 'Point',
        coordinates: coords,
      },
    });
  });
}

function loadOptionalFeatureCollection(
  filePath: string | undefined,
  label: string,
): FeatureCollection | null {
  if (!filePath) {
    return null;
  }

  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    console.warn(`[WARN] ${label} file not found: ${resolved}`);
    return null;
  }

  try {
    const raw = fs.readFileSync(resolved, 'utf-8');
    const parsed = JSON.parse(raw) as FeatureCollection;
    if (!Array.isArray(parsed.features)) {
      console.warn(`[WARN] ${label} file is missing a "features" array: ${resolved}`);
      return null;
    }
    return parsed;
  } catch (error) {
    console.warn(
      `[WARN] Failed to load ${label} file (${resolved}): ${(error as Error).message}`,
    );
    return null;
  }
}

function toCityId(props: Record<string, unknown>, fallbackIndex: number): string {
  return String(
    props.city_id
      ?? props.cityId
      ?? props.id
      ?? `city_${fallbackIndex}`,
  );
}

function toNameTh(props: Record<string, unknown>, fallback: string): string {
  return String(
    props.city_th
      ?? props.name_th
      ?? props.cityNameTh
      ?? props.name_thai
      ?? fallback,
  );
}

function toNameEn(props: Record<string, unknown>, fallback: string): string {
  return String(
    props.city_en
      ?? props.name_en
      ?? props.cityNameEn
      ?? props.name
      ?? fallback,
  );
}

function accumulateStats(feature: Feature, index: number, statsMap: Map<string, CityStats>) {
  if (!feature || feature.type !== 'Feature' || feature.geometry?.type !== 'Point') {
    return;
  }

  const props = feature.properties ?? {};
  const coordinates = feature.geometry.coordinates as LonLat;
  const [lon, lat] = coordinates;
  const cityId = toCityId(props, index);

  if (!statsMap.has(cityId)) {
    statsMap.set(cityId, {
      id: cityId,
      region: props.region ? String(props.region) : undefined,
      population: typeof props.population_city === 'number'
        ? props.population_city
        : typeof props.population === 'number'
          ? props.population
          : undefined,
      nameTh: toNameTh(props, cityId),
      nameEn: toNameEn(props, cityId),
      count: 0,
      openCount: 0,
      ratingSum: 0,
      ratingCount: 0,
      categories: {},
      sumLat: 0,
      sumLon: 0,
      minLat: Number.POSITIVE_INFINITY,
      maxLat: Number.NEGATIVE_INFINITY,
      minLon: Number.POSITIVE_INFINITY,
      maxLon: Number.NEGATIVE_INFINITY,
    });
  }

  const stats = statsMap.get(cityId)!;

  stats.count += 1;
  stats.sumLat += lat;
  stats.sumLon += lon;
  stats.minLat = Math.min(stats.minLat, lat);
  stats.maxLat = Math.max(stats.maxLat, lat);
  stats.minLon = Math.min(stats.minLon, lon);
  stats.maxLon = Math.max(stats.maxLon, lon);

  const category = props.category ? String(props.category) : CATEGORY_FALLBACK;
  stats.categories[category] = (stats.categories[category] ?? 0) + 1;

  if (props.is_open === true || props.is_open === 'true') {
    stats.openCount += 1;
  }

  if (typeof props.rating === 'number') {
    stats.ratingSum += props.rating;
    stats.ratingCount += 1;
  } else if (typeof props.rating === 'string') {
    const parsed = Number(props.rating);
    if (Number.isFinite(parsed)) {
      stats.ratingSum += parsed;
      stats.ratingCount += 1;
    }
  }
}

function buildCityFeature(stats: CityStats): Feature {
  const centerLat = stats.sumLat / stats.count;
  const centerLon = stats.sumLon / stats.count;
  const avgRating = stats.ratingCount ? stats.ratingSum / stats.ratingCount : null;
  const openRatio = stats.count ? stats.openCount / stats.count : null;

  return {
    type: 'Feature',
    properties: {
      id: stats.id,
      kind: 'city',
      name_th: stats.nameTh,
      name_en: stats.nameEn,
      region: stats.region ?? null,
      population: stats.population ?? null,
      poi_total: stats.count,
      avg_rating: avgRating ? Number(avgRating.toFixed(2)) : null,
      open_ratio: openRatio ? Number(openRatio.toFixed(2)) : null,
      top_categories: selectTopCategories(stats.categories, 5),
      bbox: [
        Number(stats.minLon.toFixed(5)),
        Number(stats.minLat.toFixed(5)),
        Number(stats.maxLon.toFixed(5)),
        Number(stats.maxLat.toFixed(5)),
      ],
    },
    geometry: {
      type: 'Point',
      coordinates: [
        Number(centerLon.toFixed(6)),
        Number(centerLat.toFixed(6)),
      ],
    },
  };
}

function buildClusterFeatures(
  stats: CityStats,
  options: CliOptions,
  rand: () => number,
): Feature[] {
  const features: Feature[] = [];
  const avgLat = stats.sumLat / stats.count;
  const avgLon = stats.sumLon / stats.count;

  const latSpanKm = Math.max((stats.maxLat - stats.minLat) * 110.574, 5);
  const lonSpanKm = Math.max(
    (stats.maxLon - stats.minLon) * 111.320 * Math.cos((avgLat * Math.PI) / 180),
    5,
  );
  const spreadBase = Math.max(options.spreadKm * 0.6, Math.max(latSpanKm, lonSpanKm) * 0.5);

  for (let i = 0; i < options.clustersPerCity; i += 1) {
    const radiusKm = spreadBase * (0.4 + rand() * 0.9);
    const [clusterLon, clusterLat] = offsetCoordinate(avgLat, avgLon, radiusKm, rand);
    const bbox = bboxFromCenter(clusterLat, clusterLon, radiusKm * (0.45 + rand() * 0.4));

    const weight = 0.6 + rand() * 0.9;
    const approxCount = Math.max(
      options.minCount,
      Math.min(
        options.maxCount,
        Math.round((stats.count / options.clustersPerCity) * weight),
      ),
    );
    const avgRating = stats.ratingCount
      ? stats.ratingSum / stats.ratingCount
      : 3 + rand() * 2;
    const openRatio = stats.count ? stats.openCount / stats.count : rand() * 0.6 + 0.2;

    const topCategories = selectTopCategories(stats.categories, 3);
    if (!topCategories.length) {
      const fallbackCat = CATEGORY_POOL[Math.floor(rand() * CATEGORY_POOL.length)];
      topCategories.push({ name: fallbackCat, count: approxCount });
    }

    const minZoom = Math.min(12, Math.max(4, Math.round(10 - Math.log2(approxCount))));
    const maxZoomLevel = Math.min(16, minZoom + 4);

    features.push({
      type: 'Feature',
      properties: {
        id: `cluster_${stats.id}_${i}`,
        kind: 'cluster_seed',
        city_id: stats.id,
        level: 1,
        approx_count: approxCount,
        avg_rating: Number(avgRating.toFixed(2)),
        open_ratio: Number(openRatio.toFixed(2)),
        top_categories: topCategories,
        coverage_km: Number(radiusKm.toFixed(1)),
        bbox,
        min_zoom: minZoom,
        max_zoom: maxZoomLevel,
      },
      geometry: {
        type: 'Point',
        coordinates: [clusterLon, clusterLat],
      },
    });
  }

  return features;
}

function main() {
  const options = parseArgs();
  const sourcePath = path.resolve(options.in);
  const targetPath = path.resolve(options.out);
  const insertCityCollection = loadOptionalFeatureCollection(options.insertCity, 'insert-city');
  const clusterInputCollection = loadOptionalFeatureCollection(options.clusterInput, 'cluster-input');

  if (!fs.existsSync(sourcePath)) {
    console.error(`Input file not found: ${sourcePath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(sourcePath, 'utf-8');
  const collection: FeatureCollection = JSON.parse(raw);
  if (!Array.isArray(collection.features)) {
    console.error('Invalid GeoJSON: missing "features" array.');
    process.exit(1);
  }

  const statsMap = new Map<string, CityStats>();
  collection.features.forEach((feature, index) => accumulateStats(feature, index, statsMap));

  const rand = createSeededRandom(options.seed);
  const generatedCityFeatures: Feature[] = [];
  const generatedClusterFeatures: Feature[] = [];

  for (const stats of statsMap.values()) {
    generatedCityFeatures.push(buildCityFeature(stats));
    generatedClusterFeatures.push(...buildClusterFeatures(stats, options, rand));
  }

  const cityMap = new Map<string, Feature>();
  addFeaturesToMap(cityMap, generatedCityFeatures, 'city', 'generated');
  if (insertCityCollection) {
    addFeaturesToMap(cityMap, insertCityCollection.features, 'city', 'insert-city');
  }
  if (clusterInputCollection) {
    addFeaturesToMap(cityMap, clusterInputCollection.features, 'city', 'cluster-input');
  }
  const mergedCityFeatures = Array.from(cityMap.values());

  const clusterMap = new Map<string, Feature>();
  addFeaturesToMap(clusterMap, generatedClusterFeatures, 'cluster', 'generated');
  if (insertCityCollection) {
    addFeaturesToMap(clusterMap, insertCityCollection.features, 'cluster', 'insert-city');
  }
  if (clusterInputCollection) {
    addFeaturesToMap(clusterMap, clusterInputCollection.features, 'cluster', 'cluster-input');
  }
  const mergedClusterFeatures = Array.from(clusterMap.values());

  const pointCollection: FeatureCollection = {
    type: 'FeatureCollection',
    name: 'thailand_city_points',
    features: [...mergedCityFeatures, ...mergedClusterFeatures],
  };

  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(targetPath, JSON.stringify(pointCollection));

  console.log(
    `Generated ${generatedCityFeatures.length} city summaries + ${generatedClusterFeatures.length} cluster seeds (final: ${mergedCityFeatures.length} cities, ${mergedClusterFeatures.length} clusters) -> ${targetPath}`,
  );
}

main();
