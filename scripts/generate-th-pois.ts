// scripts/generate-th-pois.ts
// Usage:
// pnpm tsx scripts/generate-th-pois.ts \
//   --in apps/backend/src/data/thailand-cities.geojson \
//   --out apps/backend/src/data/thailand-pois-200k.geojson \
//   --count 200000 --format json --radius-km 35 --seed 2025

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// --- CLI args (no external deps) ---
type Args = {
  in: string;
  out: string;
  count: number;
  format: "json" | "jsonl";
  radiusKm: number;
  seed: number;
};
function parseArgs(): Args {
  const get = (k: string, d?: string) => {
    const i = process.argv.indexOf(`--${k}`);
    return i > -1 ? process.argv[i + 1] : d;
  };
  const fmt = (get("format", "json") as "json" | "jsonl");
  return {
    in: get("in", "apps/backend/src/data/thailand-cities-min.geojson")!,
    out: get("out", "apps/backend/src/data/thailand-cities.geojson")!,
    count: Number(get("count", "100000")),
    format: fmt,
    radiusKm: Number(get("radius-km", "35")),
    seed: Number(get("seed", "2025")),
  };
}

// --- Minimal types ---
type Feature = {
  type: "Feature";
  properties: Record<string, any>;
  geometry: { type: "Point"; coordinates: [number, number] };
};
type FeatureCollection = { type: "FeatureCollection"; features: Feature[] };

// --- RNG (deterministic) ---
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}
function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

// --- Helpers ---
const CATS = [
  "retail","education","healthcare","logistics","emergency",
  "hospitality","transport","finance","office","leisure"
];
const TAGS = ["24h","parking","wifi","card","atm","delivery","pickup","wheelchair","family","promo"];

function kmToDegLat(km: number) { return km / 111.32; }
function kmToDegLon(km: number, latDeg: number) {
  const latRad = (latDeg * Math.PI) / 180;
  return km / (111.32 * Math.cos(latRad));
}

// Box–Muller to sample ~normal distribution (mean 0, sd 1)
function randNorm(rng: () => number) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function main() {
  const args = parseArgs();

  const raw = fs.readFileSync(args.in, "utf8");
  const seedFC = JSON.parse(raw) as FeatureCollection;
  if (seedFC.type !== "FeatureCollection") throw new Error("Seed must be FeatureCollection");

  // Weight cities by population (fallback 1 if missing)
  const cities = seedFC.features.map(f => {
    const p = f.properties || {};
    const pop = Number(p.population ?? 1);
    return {
      id: String(p.id ?? hashString(JSON.stringify(f))),
      name_th: p.name_th ?? "",
      name_en: p.name_en ?? "",
      region: p.region ?? "",
      population: pop > 0 ? pop : 1,
      lon: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
    };
  });

  const popSum = cities.reduce((s, c) => s + c.population, 0);
  // initial allocation
  let allocations = cities.map(c => ({
    city: c,
    n: Math.max(1, Math.floor((c.population / popSum) * args.count))
  }));
  // fix rounding to exact total
  let allocated = allocations.reduce((s, a) => s + a.n, 0);
  while (allocated < args.count) { allocations[Math.floor(Math.random()*allocations.length)].n++; allocated++; }
  while (allocated > args.count) {
    const idx = allocations.findIndex(a => a.n > 1);
    if (idx === -1) break;
    allocations[idx].n--; allocated--;
  }

  // prepare writers
  const outDir = path.dirname(args.out);
  fs.mkdirSync(outDir, { recursive: true });

  const rng = mulberry32(args.seed);
  const now = Date.now();

  if (args.format === "jsonl") {
    const fd = fs.openSync(args.out, "w");
    try {
      for (const a of allocations) {
        for (let i = 0; i < a.n; i++) {
          const feat = makePoiFeature(rng, a.city, i, args.radiusKm, now);
          fs.writeSync(fd, JSON.stringify(feat) + "\n", undefined, "utf8");
        }
      }
    } finally {
      fs.closeSync(fd);
    }
    console.log(`[OK] Wrote GeoJSONL: ${args.out}`);
  } else {
    // streaming-ish FeatureCollection writer
    const fd = fs.openSync(args.out, "w");
    try {
      fs.writeSync(fd, `{"type":"FeatureCollection","features":[\n`);
      let first = true;
      for (const a of allocations) {
        for (let i = 0; i < a.n; i++) {
          const feat = makePoiFeature(rng, a.city, i, args.radiusKm, now);
          const line = (first ? "" : ",") + JSON.stringify(feat) + "\n";
          fs.writeSync(fd, line, undefined, "utf8");
          first = false;
        }
      }
      fs.writeSync(fd, `]}\n`);
    } finally {
      fs.closeSync(fd);
    }
    console.log(`[OK] Wrote GeoJSON: ${args.out}`);
  }
}

function makePoiFeature(
  rng: () => number,
  city: { id:string; name_th:string; name_en:string; region:string; population:number; lon:number; lat:number },
  idx: number,
  radiusKm: number,
  nowMs: number
): Feature {
  // radial distance (km): half-normal around ~0 with ~radiusKm/2 typical distance
  const rNorm = Math.abs(randNorm(rng));
  const rKm = clamp((rNorm * radiusKm) / 1.5, 0.2, radiusKm * 1.2);

  // random angle
  const ang = rng() * Math.PI * 2;
  const dLat = kmToDegLat(rKm) * Math.sin(ang);
  const dLon = kmToDegLon(rKm, city.lat) * Math.cos(ang);

  const lat = city.lat + dLat + 0.001 * randNorm(rng); // tiny jitter
  const lon = city.lon + dLon + 0.001 * randNorm(rng);

  const category = pick(rng, CATS);
  const rating = Math.round((rng() * 5) * 10) / 10; // 0.0..5.0
  const is_open = rng() > 0.4; // ~60% เปิดอยู่
  const tagCount = 1 + Math.floor(rng() * 3);
  const tags: string[] = [];
  const bag = [...TAGS];
  for (let t = 0; t < tagCount; t++) {
    const k = Math.floor(rng() * bag.length);
    tags.push(bag.splice(k, 1)[0]);
  }

  // updated_at: ภายใน 180 วันหลังสุด
  const deltaDays = Math.floor(rng() * 180);
  const updated_at = new Date(nowMs - deltaDays * 24 * 60 * 60 * 1000).toISOString();

  const id = `poi_${city.id}_${idx}_${hashString(`${lon.toFixed(5)}_${lat.toFixed(5)}`)}`;

  const properties = {
    id,
    city_id: city.id,
    city_th: city.name_th,
    city_en: city.name_en,
    region: city.region,
    population_city: city.population,
    category,
    rating,
    is_open,
    tags,
    updated_at
  };

  return {
    type: "Feature",
    properties,
    geometry: { type: "Point", coordinates: [lon, lat] }
  };
}

main();