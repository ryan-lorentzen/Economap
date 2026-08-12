export interface Product {
  id: string;
  name: string;
  brand: string;
  category: string;
  image_url: string;
}

export interface CartItem {
  product: Product;
  quantity: number;
}

export interface Store {
  id: string;
  name: string; // e.g., "Publix", "Walmart"
  address: string;
  coordinates: {
    lat: number;
    lng: number;
  };
  googleMapsUri?: string;
  source?: 'google_places';
}

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

export interface ProductPricingQuery {
  storeIds: string[];
  products: Product[];
}

export type ProductPriceLookup = Record<string, Record<string, number>>;

export interface RouteWaypoint {
  lat: number;
  lng: number;
}

export interface RouteStop {
  id: string;
  name: string;
  address: string;
  type: 'user' | 'grocery' | 'gas';
  coordinates: RouteWaypoint;
  pricePerGallon?: number;
}

export interface TripPlan {
  orderedStops: RouteStop[];
  totalDistanceMeters: number;
  estimatedScore: number;
  selectedStoreId?: string;
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

export interface PriceRecord {
  productId: string;
  storeId: string;
  price: number;
  unit: 'oz' | 'lb' | 'each' | 'qt';
  updatedAt: string; // ISO String
}

export interface ShoppingTrip {
  totalCost: number;
  stores: Store[];
  optimizedRoute: string[]; // Array of Store IDs
}

export interface RouteSummary {
  totalDistance: number;
  totalTime: number;
}
