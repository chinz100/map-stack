
export default {
  Base: '/api',
  Users: {
    Base: '/users',
    Get: '/all',
    Add: '/add',
    Update: '/update',
    Delete: '/delete/:id',
  },
  Geo: {
    Base: '/geo',
    Cities: '/cities',
    Pois: '/pois',
    PoiClusters: '/pois/clusters',
    PoiTile: '/pois-tile/:z/:x/:y',
  },
} as const;
