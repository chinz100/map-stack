```
pnpm exec tsx apps/backend/scripts/generate-th-pois.ts \
  --in apps/backend/src/data/thailand-cities.geojson \
  --out apps/backend/src/data/thailand-pois-200k.geojson \
  --count 200000 --format json --radius-km 35 --seed 2025
```