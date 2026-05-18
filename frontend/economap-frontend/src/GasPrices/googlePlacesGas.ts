import 'server-only';

import { LiveGasStationSearchParams } from '@/GasPrices/types';
import { FuelGrade, FuelPriceOption, GasStation } from '@/types';

const GOOGLE_PLACES_NEARBY_URL = 'https://places.googleapis.com/v1/places:searchNearby';
const GOOGLE_PLACES_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.fuelOptions',
  'places.googleMapsUri',
].join(',');

const DEFAULT_MAX_RESULTS = 20;
const METERS_PER_MILE = 1_609.34;
const MAX_RADIUS_METERS = 15 * METERS_PER_MILE;
const MIN_RADIUS_METERS = 500;
const SINGLE_SEARCH_MAX_RADIUS_METERS = 5 * METERS_PER_MILE;
const FIVE_POINT_SEARCH_MAX_RADIUS_METERS = 10 * METERS_PER_MILE;
const FUEL_TYPE_PRIORITY = [
  'REGULAR_UNLEADED',
  'MIDGRADE',
  'PREMIUM',
  'SP91',
  'SP91_E10',
  'SP92',
  'SP95',
  'SP95_E10',
  'SP98',
  'SP99',
  'SP100',
  'E85',
  'DIESEL',
  'DIESEL_PLUS',
  'TRUCK_DIESEL',
  'BIO_DIESEL',
  'LPG',
] as const;

const FUEL_GRADE_TYPE_MAP: Record<FuelGrade, readonly string[]> = {
  regular: ['REGULAR_UNLEADED', 'UNLEADED', 'SP87', 'SP88', 'UNLEADED_88', 'E10'],
  midgrade: ['MIDGRADE', 'PLUS', 'SPECIAL_UNLEADED', 'SP89', 'SP90'],
  premium: ['PREMIUM', 'SUPER_UNLEADED', 'SP91', 'SP91_E10', 'SP92', 'SP93', 'SP95', 'SP95_E10', 'SP98', 'SP99', 'SP100'],
  diesel: ['DIESEL', 'DIESEL_PLUS', 'TRUCK_DIESEL', 'BIO_DIESEL'],
};

interface GooglePlacesNearbyResponse {
  places?: GooglePlace[];
}

interface GooglePlace {
  displayName?: {
    text?: string;
  };
  formattedAddress?: string;
  fuelOptions?: {
    fuelPrices?: GoogleFuelPrice[];
  };
  googleMapsUri?: string;
  id?: string;
  location?: {
    latitude?: number;
    longitude?: number;
  };
}

interface GoogleFuelPrice {
  price?: GoogleMoney;
  type?: string;
  updateTime?: string;
}

interface GoogleMoney {
  nanos?: number;
  units?: string;
}

interface SearchArea {
  latitude: number;
  longitude: number;
  radiusMeters: number;
}

const parseMoney = (money?: GoogleMoney) => {
  if (!money) {
    return null;
  }

  const units = Number(money.units ?? '0');
  const nanos = (money.nanos ?? 0) / 1_000_000_000;
  const value = units + nanos;

  return Number.isFinite(value) ? value : null;
};

const chooseFuelPrice = (fuelPrices: GoogleFuelPrice[]) => {
  const validPrices = fuelPrices.filter((fuelPrice) => {
    const amount = parseMoney(fuelPrice.price);
    return amount !== null && amount > 0;
  });

  for (const fuelType of FUEL_TYPE_PRIORITY) {
    const preferredMatch = validPrices.find((fuelPrice) => fuelPrice.type === fuelType);
    if (preferredMatch) {
      return preferredMatch;
    }
  }

  return validPrices
    .slice()
    .sort((left, right) => {
      const leftAmount = parseMoney(left.price) ?? Number.POSITIVE_INFINITY;
      const rightAmount = parseMoney(right.price) ?? Number.POSITIVE_INFINITY;

      return leftAmount - rightAmount;
    })[0] ?? null;
};

const getFuelPriceForGrade = (
  fuelPrices: GoogleFuelPrice[],
  fuelGrade: FuelGrade
): FuelPriceOption | null => {
  const validPrices = fuelPrices.filter((fuelPrice) => {
    const amount = parseMoney(fuelPrice.price);
    return amount !== null && amount > 0;
  });

  for (const mappedType of FUEL_GRADE_TYPE_MAP[fuelGrade]) {
    const match = validPrices.find((fuelPrice) => fuelPrice.type === mappedType);

    if (match) {
      return {
        fuelType: match.type ?? mappedType,
        pricePerGallon: Number((parseMoney(match.price) ?? 0).toFixed(3)),
        priceUpdatedAt: match.updateTime,
      };
    }
  }

  return null;
};

const buildFuelPriceMap = (fuelPrices: GoogleFuelPrice[]) => {
  const mappedFuelPrices = Object.entries(FUEL_GRADE_TYPE_MAP).reduce(
    (accumulator, [fuelGrade]) => {
      const fuelPrice = getFuelPriceForGrade(fuelPrices, fuelGrade as FuelGrade);

      if (fuelPrice) {
        accumulator[fuelGrade as FuelGrade] = fuelPrice;
      }

      return accumulator;
    },
    {} as Partial<Record<FuelGrade, FuelPriceOption>>
  );

  return mappedFuelPrices;
};

const mapPlaceToGasStation = (place: GooglePlace): GasStation | null => {
  const latitude = place.location?.latitude;
  const longitude = place.location?.longitude;
  const allFuelPrices = place.fuelOptions?.fuelPrices ?? [];
  const selectedFuelPrice = chooseFuelPrice(allFuelPrices);
  const pricePerGallon = parseMoney(selectedFuelPrice?.price);
  const fuelPrices = buildFuelPriceMap(allFuelPrices);

  if (
    !place.id ||
    !place.displayName?.text ||
    !place.formattedAddress ||
    latitude === undefined ||
    longitude === undefined ||
    pricePerGallon === null
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
    fuelType: selectedFuelPrice?.type,
    fuelPrices,
    googleMapsUri: place.googleMapsUri,
    pricePerGallon: Number(pricePerGallon.toFixed(3)),
    priceUpdatedAt: selectedFuelPrice?.updateTime,
    source: 'google_places',
  };
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

const fetchGasStationsForArea = async (
  apiKey: string,
  searchArea: SearchArea
): Promise<GasStation[]> => {
  const response = await fetch(GOOGLE_PLACES_NEARBY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': GOOGLE_PLACES_FIELD_MASK,
    },
    body: JSON.stringify({
      includedTypes: ['gas_station'],
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
      `Google Places gas lookup failed with status ${response.status}: ${errorText.slice(0, 240)}`
    );
  }

  const payload = (await response.json()) as GooglePlacesNearbyResponse;

  return (payload.places ?? [])
    .map(mapPlaceToGasStation)
    .filter((station): station is GasStation => station !== null);
};

export const fetchNearbyGasStations = async ({
  latitude,
  longitude,
  radiusMeters,
}: LiveGasStationSearchParams): Promise<GasStation[]> => {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;

  if (!apiKey) {
    throw new Error('GOOGLE_PLACES_API_KEY is not configured.');
  }

  const clampedRadiusMeters = Math.min(
    Math.max(radiusMeters, MIN_RADIUS_METERS),
    MAX_RADIUS_METERS
  );
  const searchAreas = buildSearchAreas(latitude, longitude, clampedRadiusMeters);
  const stationMap = new Map<string, GasStation>();
  const searchResults = await Promise.all(
    searchAreas.map((searchArea) => fetchGasStationsForArea(apiKey, searchArea))
  );

  searchResults.flat().forEach((station) => {
    const distanceFromUser = haversineDistanceMeters(
      latitude,
      longitude,
      station.coordinates.lat,
      station.coordinates.lng
    );

    if (distanceFromUser <= clampedRadiusMeters) {
      stationMap.set(station.id, station);
    }
  });

  return [...stationMap.values()].sort((left, right) => {
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
