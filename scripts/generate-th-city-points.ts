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
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const opts: Partial<CliOptions> = {};

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
      default:
        break;
    }
  }

  if (!opts.in || !opts.out) {
    console.error('Usage: tsx scripts/generate-th-city-points.ts --in <input.geojson> --out <output.geojson>');
    process.exit(1);
  }

  return opts as CliOptions;
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

function main() {
  const { in: inputPath, out: outputPath } = parseArgs();
  const sourcePath = path.resolve(inputPath);
  const targetPath = path.resolve(outputPath);

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

  const cityMap = new Map<string, Feature>();

  collection.features.forEach((feature, index) => {
    if (!feature || feature.type !== 'Feature' || feature.geometry?.type !== 'Point') {
      return;
    }
    const props = feature.properties ?? {};
    const cityId = toCityId(props, index);
    if (cityMap.has(cityId)) {
      return;
    }
    cityMap.set(cityId, feature);
  });

  const cityFeatures = Array.from(cityMap.entries()).map(([cityId, feature]) => {
    const props = feature.properties ?? {};
    return {
      type: 'Feature',
      properties: {
        id: cityId,
        name_th: toNameTh(props, cityId),
        name_en: toNameEn(props, cityId),
        region: props.region ?? null,
        population: props.population_city ?? props.population ?? null,
      },
      geometry: feature.geometry,
    };
  });

  const pointCollection: FeatureCollection = {
    type: 'FeatureCollection',
    name: 'thailand_city_points',
    features: cityFeatures,
  };

  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(targetPath, JSON.stringify(pointCollection));

  console.log(`Generated ${cityFeatures.length} city point features -> ${targetPath}`);
}

main();
