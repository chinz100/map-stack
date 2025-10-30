import path from 'path';
import fs from 'fs';
import { Request, Response } from 'express';

type GeoPoint = [number, number];

interface GeoFeature {
  type: 'Feature';
  properties: Record<string, unknown>;
  geometry: {
    type: 'Point';
    coordinates: GeoPoint;
  };
}

interface GeoCollection {
  type: 'FeatureCollection';
  name?: string;
  features: GeoFeature[];
}

const dataFile = path.join(__dirname, '..', 'data', 'thailand-cities.geojson');

const collection: GeoCollection = JSON.parse(
  fs.readFileSync(dataFile, 'utf-8'),
);

function parseBbox(bboxRaw: string | string[] | undefined): [
  number,
  number,
  number,
  number,
] | null {
  if (!bboxRaw) {
    return null;
  }

  const value = Array.isArray(bboxRaw) ? bboxRaw.join(',') : bboxRaw;
  const parts = value.split(',').map((part) => Number(part.trim()));

  if (parts.length !== 4 || parts.some((num) => Number.isNaN(num))) {
    return null;
  }

  const [minLon, minLat, maxLon, maxLat] = parts;

  if (minLon > maxLon || minLat > maxLat) {
    return null;
  }

  return [minLon, minLat, maxLon, maxLat];
}

function filterByBbox(features: GeoFeature[], bbox: ReturnType<typeof parseBbox>) {
  if (!bbox) {
    return features;
  }
  const [minLon, minLat, maxLon, maxLat] = bbox;
  return features.filter((feature) => {
    const [lon, lat] = feature.geometry.coordinates;
    return lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat;
  });
}

export function getThailandCities(req: Request, res: Response): void {
  const bbox = parseBbox(req.query.bbox);

  if (req.query.bbox && !bbox) {
    res.status(400).json({
      error: 'Invalid bbox parameter. Expected format: minLon,minLat,maxLon,maxLat',
    });
    return;
  }

  const features = filterByBbox(collection.features, bbox);

  res.json({
    type: collection.type,
    name: collection.name,
    count: features.length,
    bbox: bbox ?? null,
    features,
  });
}

export default {
  getThailandCities,
};
