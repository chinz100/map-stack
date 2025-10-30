```
pnpm exec tsx scripts/generate-th-pois.ts \
  --in apps/backend/src/data/thailand-cities-min.geojson \
  --out apps/backend/src/data/thailand-cities.geojson \
  --count 800000 --format json --radius-km 35 --seed 2025
```