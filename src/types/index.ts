export type FuelGrade = 'regular' | 'midgrade' | 'premium' | 'diesel';

export interface FuelPriceOption {
  fuelType: string;
  pricePerGallon: number;
  priceUpdatedAt?: string;
}

export interface GasStation {
  id: string;
  name: string;
  address: string;
  coordinates: {
    lat: number;
    lng: number;
  };
  fuelType?: string;
  fuelPrices?: Partial<Record<FuelGrade, FuelPriceOption>>;
  googleMapsUri?: string;
  pricePerGallon: number;
  priceUpdatedAt?: string;
  source?: 'google_places';
}

export interface NearbySearchParams {
  latitude: number;
  longitude: number;
  radiusMeters: number;
  limit?: number;
}

export interface RouteWaypoint {
  lat: number;
  lng: number;
}

export interface RouteStop {
  id: string;
  name: string;
  address: string;
  type: 'user' | 'gas';
  coordinates: RouteWaypoint;
  pricePerGallon?: number;
}

export interface TripPlan {
  orderedStops: RouteStop[];
  totalDistanceMeters: number;
  estimatedScore: number;
  selectedGasStationId?: string;
}

export interface RouteLegEstimate {
  fromStopId: string;
  toStopId: string;
  distanceMeters: number;
  durationSeconds: number;
}

export interface TripEstimateSummary {
  legs: RouteLegEstimate[];
  returnToStart: RouteLegEstimate | null;
}

export interface RouteSummary {
  totalDistance: number;
  totalTime: number;
}
