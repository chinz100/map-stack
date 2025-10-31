export type LonLat = [number, number];

export interface GeoFeature {
  type: 'Feature';
  properties: Record<string, unknown>;
  geometry: {
    type: 'Point';
    coordinates: LonLat;
  };
}

export interface GeoCollection {
  type: 'FeatureCollection';
  name?: string;
  features: GeoFeature[];
}
