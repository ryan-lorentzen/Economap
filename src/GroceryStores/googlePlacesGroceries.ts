import 'server-only';

import { LiveGroceryStoreSearchParams } from '@/GroceryStores/types';
import { Store } from '@/types';

const GOOGLE_PLACES_NEARBY_URL = 'https://places.googleapis.com/v1/places:searchNearby';
const GOOGLE_PLACES_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.googleMapsUri',
  'places.primaryType',
].join(',');

const DEFAULT_MAX_RESULTS = 20;
const METERS_PER_MILE = 1_609.34;
const MAX_RADIUS_METERS = 15 * METERS_PER_MILE;
const MIN_RADIUS_METERS = 500;
const SINGLE_SEARCH_MAX_RADIUS_METERS = 5 * METERS_PER_MILE;
const FIVE_POINT_SEARCH_MAX_RADIUS_METERS = 10 * METERS_PER_MILE;
const GROCERY_PLACE_TYPES = [
  'supermarket',
  'grocery_store',
  'asian_grocery_store',
  'discount_supermarket',
  'food_store',
  'hypermarket',
  'warehouse_store',
] as const;

interface SearchArea {
  latitude: number;
  longitude: number;
  radiusMeters: number;
}

interface GooglePlacesNearbyResponse {
  places?: GooglePlace[];
}

interface GooglePlace {
  displayName?: {
    text?: string;
  };
  formattedAddress?: string;
  googleMapsUri?: string;
  id?: string;
  location?: {
    latitude?: number;
    longitude?: number;
  };
  primaryType?: string;
}

const ALLOWED_PRIMARY_TYPES = new Set([
  'supermarket',
  'grocery_store',
  'discount_supermarket',
  'hypermarket',
  'warehouse_store',
]);

const ALLOWED_CHAIN_KEYWORDS = [
  'publix',
  'sprouts',
  'walmart',
  'target',
  'whole foods',
  'wholefoods',
  'trader joe',
  "trader joe's",
  'aldi',
  'costco',
  "sam's club",
  'sams club',
  "bj's",
  'bjs',
  'kroger',
  'safeway',
  'food lion',
  'wegmans',
  'meijer',
  'giant eagle',
  'h-e-b',
  'heb',
  'fresh market',
  'winn-dixie',
  'winn dixie',
  'neighborhood market',
  'supercenter',
] as const;

const EXCLUDED_NAME_KEYWORDS = [
  'ice cream',
  'gelato',
  'frozen yogurt',
  'coffee',
  'cafe',
  'espresso',
  'bakery',
  'boba',
  'tea',
  'juice',
  'smoothie',
  'restaurant',
  'grill',
  'deli',
  'pizza',
  'donut',
  'doughnut',
  'liquor',
  'wine',
  'beer',
] as const;

const looksLikeFullGroceryStore = (place: GooglePlace) => {
  const normalizedName = place.displayName?.text?.toLowerCase() ?? '';
  const primaryType = place.primaryType ?? '';

  if (!normalizedName) {
    return false;
  }

  if (EXCLUDED_NAME_KEYWORDS.some((keyword) => normalizedName.includes(keyword))) {
    return false;
  }

  if (ALLOWED_PRIMARY_TYPES.has(primaryType)) {
    return true;
  }

  return ALLOWED_CHAIN_KEYWORDS.some((keyword) => normalizedName.includes(keyword));
};

const metersToLatitudeDegrees = (meters: number) => meters / 111_320;

const metersToLongitudeDegrees = (meters: number, latitude: number) => {
  const cosine = Math.cos((latitude * Math.PI) / 180);
  const safeCosine = Math.abs(cosine) < 0.01 ? 0.01 : cosine;
  return meters / (111_320 * safeCosine);
};

const offsetCoordinate = (
  latitude: number,
  longitude: number,
  northMeters: number,
  eastMeters: number
) => ({
  latitude: latitude + metersToLatitudeDegrees(northMeters),
  longitude: longitude + metersToLongitudeDegrees(eastMeters, latitude),
});

const haversineDistanceMeters = (
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number
) => {
  const earthRadiusMeters = 6_371_000;
  const latitudeDelta = ((latitudeB - latitudeA) * Math.PI) / 180;
  const longitudeDelta = ((longitudeB - longitudeA) * Math.PI) / 180;
  const latitudeARadians = (latitudeA * Math.PI) / 180;
  const latitudeBRadians = (latitudeB * Math.PI) / 180;

  const a =
    Math.sin(latitudeDelta / 2) * Math.sin(latitudeDelta / 2) +
    Math.cos(latitudeARadians) *
      Math.cos(latitudeBRadians) *
      Math.sin(longitudeDelta / 2) *
      Math.sin(longitudeDelta / 2);

  return earthRadiusMeters * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
};

const buildSearchAreas = (
  latitude: number,
  longitude: number,
  radiusMeters: number
): SearchArea[] => {
  const clampedRadiusMeters = Math.min(
    Math.max(radiusMeters, MIN_RADIUS_METERS),
    MAX_RADIUS_METERS
  );

  if (clampedRadiusMeters <= SINGLE_SEARCH_MAX_RADIUS_METERS) {
    return [
      {
        latitude,
        longitude,
        radiusMeters: clampedRadiusMeters,
      },
    ];
  }

  if (clampedRadiusMeters <= FIVE_POINT_SEARCH_MAX_RADIUS_METERS) {
    const offsetMeters = clampedRadiusMeters / 2;
    const localRadiusMeters = Math.min(
      clampedRadiusMeters,
      offsetMeters + 0.75 * METERS_PER_MILE
    );

    return [
      { latitude, longitude, radiusMeters: localRadiusMeters },
      { ...offsetCoordinate(latitude, longitude, offsetMeters, 0), radiusMeters: localRadiusMeters },
      { ...offsetCoordinate(latitude, longitude, -offsetMeters, 0), radiusMeters: localRadiusMeters },
      { ...offsetCoordinate(latitude, longitude, 0, offsetMeters), radiusMeters: localRadiusMeters },
      { ...offsetCoordinate(latitude, longitude, 0, -offsetMeters), radiusMeters: localRadiusMeters },
    ];
  }

  const offsetMeters = clampedRadiusMeters / 2;
  const localRadiusMeters = Math.min(
    clampedRadiusMeters,
    offsetMeters + 1.25 * METERS_PER_MILE
  );
  const directionalOffsets = [-offsetMeters, 0, offsetMeters];

  return directionalOffsets.flatMap((northMeters) =>
    directionalOffsets.map((eastMeters) => ({
      ...offsetCoordinate(latitude, longitude, northMeters, eastMeters),
      radiusMeters: localRadiusMeters,
    }))
  );
};

const mapPlaceToStore = (place: GooglePlace): Store | null => {
  const latitude = place.location?.latitude;
  const longitude = place.location?.longitude;

  if (
    !place.id ||
    !place.displayName?.text ||
    !place.formattedAddress ||
    latitude === undefined ||
    longitude === undefined ||
    !looksLikeFullGroceryStore(place)
  ) {
    return null;
  }

  return {
    id: place.id,
    name: place.displayName.text,
    address: place.formattedAddress,
    coordinates: {
      lat: latitude,
      lng: longitude,
    },
    googleMapsUri: place.googleMapsUri,
    source: 'google_places',
  };
};

const fetchStoresForArea = async (
  apiKey: string,
  searchArea: SearchArea
): Promise<Store[]> => {
  const response = await fetch(GOOGLE_PLACES_NEARBY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': GOOGLE_PLACES_FIELD_MASK,
    },
    body: JSON.stringify({
      includedTypes: [...GROCERY_PLACE_TYPES],
      locationRestriction: {
        circle: {
          center: {
            latitude: searchArea.latitude,
            longitude: searchArea.longitude,
          },
          radius: Math.min(Math.max(searchArea.radiusMeters, MIN_RADIUS_METERS), MAX_RADIUS_METERS),
        },
      },
      maxResultCount: DEFAULT_MAX_RESULTS,
      rankPreference: 'DISTANCE',
    }),
    cache: 'no-store',
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Google Places grocery lookup failed with status ${response.status}: ${errorText.slice(0, 240)}`
    );
  }

  const payload = (await response.json()) as GooglePlacesNearbyResponse;

  return (payload.places ?? [])
    .map(mapPlaceToStore)
    .filter((store): store is Store => store !== null);
};

export const fetchNearbyGroceryStores = async ({
  latitude,
  longitude,
  radiusMeters,
}: LiveGroceryStoreSearchParams): Promise<Store[]> => {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;

  if (!apiKey) {
    throw new Error('GOOGLE_PLACES_API_KEY is not configured.');
  }

  const clampedRadiusMeters = Math.min(
    Math.max(radiusMeters, MIN_RADIUS_METERS),
    MAX_RADIUS_METERS
  );
  const searchAreas = buildSearchAreas(latitude, longitude, clampedRadiusMeters);
  const storeMap = new Map<string, Store>();
  const searchResults = await Promise.all(
    searchAreas.map((searchArea) => fetchStoresForArea(apiKey, searchArea))
  );

  searchResults.flat().forEach((store) => {
    const distanceFromUser = haversineDistanceMeters(
      latitude,
      longitude,
      store.coordinates.lat,
      store.coordinates.lng
    );

    if (distanceFromUser <= clampedRadiusMeters) {
      storeMap.set(store.id, store);
    }
  });

  return [...storeMap.values()].sort((left, right) => {
    const leftDistance = haversineDistanceMeters(
      latitude,
      longitude,
      left.coordinates.lat,
      left.coordinates.lng
    );
    const rightDistance = haversineDistanceMeters(
      latitude,
      longitude,
      right.coordinates.lat,
      right.coordinates.lng
    );

    return leftDistance - rightDistance;
  });
};
