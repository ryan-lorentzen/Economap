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

export interface GeocodedDestination {
  id: string;
  name: string;
  address: string;
  coordinates: RouteWaypoint;
}

export interface CommuteStop {
  id: string;
  name: string;
  address: string;
  type: 'gas' | 'destination';
  coordinates: RouteWaypoint;
  pricePerGallon?: number;
  priceUpdatedAt?: string;
  fuelType?: string;
  googleMapsUri?: string;
}

export interface CommuteRouteLeg {
  fromStopId: string;
  toStopId: string;
  distanceMeters: number;
  durationSeconds: number;
}

export type CommutePlanStatus = 'active' | 'awaiting_range' | 'completed';

export interface CommutePlan {
  version: 1;
  id: string;
  createdAt: string;
  expiresAt: string;
  fuelGrade: FuelGrade;
  initialRangeMiles: number;
  fullTankRangeMiles: number;
  currentRangeMiles: number;
  origin: RouteStop;
  destination: GeocodedDestination;
  stops: CommuteStop[];
  legs: CommuteRouteLeg[];
  routeGeometry: RouteWaypoint[];
  totalDistanceMeters: number;
  totalDurationSeconds: number;
  currentStopIndex: number;
  status: CommutePlanStatus;
}

export interface CommutePlanRequest {
  origin: RouteWaypoint;
  destination: GeocodedDestination;
  currentRangeMiles: number;
  fullTankRangeMiles: number;
  fuelGrade: FuelGrade;
}
