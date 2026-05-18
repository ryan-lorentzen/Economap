
import { GasStation, Product, ProductPriceLookup, Store } from '@/types';

const EAST_WEST_STREETS = [
  'Market St',
  'Broadway',
  'Main St',
  'Oak St',
  'Maple St',
  'River Rd',
  'Cedar St',
  'Park Blvd',
];

const NORTH_SOUTH_AVENUES = [
  '1st Ave',
  'Central Ave',
  'Grand Ave',
  'Union Ave',
  'Lake Ave',
  'Summit Ave',
  'Harbor Blvd',
  'Elm Ave',
];

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const randomBetween = (min: number, max: number) => Math.random() * (max - min) + min;

const hashString = (value: string) => {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash;
};

const metersToLatitudeDegrees = (meters: number) => meters / 111_320;

const metersToLongitudeDegrees = (meters: number, latitude: number) => {
  const cosine = Math.cos((latitude * Math.PI) / 180);
  const safeCosine = Math.abs(cosine) < 0.01 ? 0.01 : cosine;
  return meters / (111_320 * safeCosine);
};

const offsetCoordinate = (lat: number, lng: number, northMeters: number, eastMeters: number) => ({
  lat: lat + metersToLatitudeDegrees(northMeters),
  lng: lng + metersToLongitudeDegrees(eastMeters, lat),
});

const clampToRadius = (value: number, radius: number) => Math.max(-radius, Math.min(radius, value));

const buildGridValue = (radius: number, spacing: number, seed: number, multiplier: number) => {
  const usableRadius = radius * 0.76;
  const indexCount = Math.max(2, Math.floor(usableRadius / spacing));
  const index = (seed * multiplier) % (indexCount * 2 + 1) - indexCount;
  const jitter = randomBetween(-spacing * 0.18, spacing * 0.18);

  return clampToRadius(index * spacing + jitter, usableRadius);
};

const buildStreetCoordinate = (lat: number, lng: number, radius: number, seed: number) => {
  const eastWestSpacing = clamp(radius / 5.5, 700, 2_400);
  const northSouthSpacing = clamp(radius / 5.5, 700, 2_400);
  const streetRunSpacing = clamp(radius / 8.5, 480, 1_500);
  const avenueRunSpacing = clamp(radius / 8.5, 480, 1_500);
  const sideOfStreetJitter = randomBetween(-14, 14);
  const placeOnEastWestStreet = seed % 2 === 0;

  const northRoadOffset = buildGridValue(radius, eastWestSpacing, seed + 3, 5);
  const eastRoadOffset = buildGridValue(radius, northSouthSpacing, seed + 7, 7);
  const eastRunOffset = buildGridValue(radius, avenueRunSpacing, seed + 11, 9);
  const northRunOffset = buildGridValue(radius, streetRunSpacing, seed + 13, 11);

  const northMeters = placeOnEastWestStreet
    ? northRoadOffset + sideOfStreetJitter
    : northRunOffset;
  const eastMeters = placeOnEastWestStreet
    ? eastRunOffset
    : eastRoadOffset + sideOfStreetJitter;

  const coordinate = offsetCoordinate(lat, lng, northMeters, eastMeters);
  const addressNumber = 100 + ((seed * 37) % 8900);
  const roadName = placeOnEastWestStreet
    ? EAST_WEST_STREETS[(seed + 2) % EAST_WEST_STREETS.length]
    : NORTH_SOUTH_AVENUES[(seed + 2) % NORTH_SOUTH_AVENUES.length];
  const crossStreet = placeOnEastWestStreet
    ? NORTH_SOUTH_AVENUES[(seed + 5) % NORTH_SOUTH_AVENUES.length]
    : EAST_WEST_STREETS[(seed + 5) % EAST_WEST_STREETS.length];

  return {
    coordinate,
    address: `${addressNumber} ${roadName}, near ${crossStreet}`,
  };
};

// Function to generate a list of fake stores
export const generateFakeStores = (count: number, lat: number, lng: number, radius: number): Store[] => {
  const stores: Store[] = [];
  const storeNames = [
    "Budget Basket",
    "Market Square",
    "Fresh Corner",
    "Family Foods",
    "Neighborhood Grocer",
    "Sunrise Market",
  ];

  for (let i = 0; i < count; i++) {
    const location = buildStreetCoordinate(lat, lng, radius, i + 11);
    stores.push({
      id: `store-${i}`,
      name: `${storeNames[i % storeNames.length]} ${i + 1}`,
      address: location.address,
      coordinates: location.coordinate,
    });
  }
  return stores;
};

// Function to generate fake product prices for stores
export const generateFakeProductPrices = (storeIds: string[], products: Product[]): ProductPriceLookup => {
  const prices: ProductPriceLookup = {};

  storeIds.forEach((storeId) => {
    prices[storeId] = {};
    products.forEach(product => {
      const seededValue = hashString(`${storeId}:${product.id}`) / 0xffffffff;
      prices[storeId][product.id] = parseFloat((1 + seededValue * 9).toFixed(2));
    });
  });

  return prices;
};

// Function to generate fake gas stations
export const generateFakeGasStations = (count: number, lat: number, lng: number, radius: number): GasStation[] => {
  const stations: GasStation[] = [];
  const gasNames = ["Shell", "Exxon", "Chevron", "BP", "7-Eleven", "Costco Gas"];

  for (let i = 0; i < count; i++) {
    const location = buildStreetCoordinate(lat, lng, radius, i + 101);
    const regularPrice = parseFloat((Math.random() * 1.5 + 3.5).toFixed(2));
    const midgradePrice = parseFloat((regularPrice + 0.3).toFixed(2));
    const premiumPrice = parseFloat((regularPrice + 0.6).toFixed(2));
    const dieselPrice = parseFloat((regularPrice + 0.4).toFixed(2));

    stations.push({
      id: `gas-${i}`,
      name: `${gasNames[i % gasNames.length]} ${i + 1}`,
      address: location.address,
      coordinates: location.coordinate,
      fuelType: 'REGULAR_UNLEADED',
      fuelPrices: {
        regular: { fuelType: 'REGULAR_UNLEADED', pricePerGallon: regularPrice },
        midgrade: { fuelType: 'MIDGRADE', pricePerGallon: midgradePrice },
        premium: { fuelType: 'PREMIUM', pricePerGallon: premiumPrice },
        diesel: { fuelType: 'DIESEL', pricePerGallon: dieselPrice },
      },
      pricePerGallon: regularPrice,
    });
  }

  return stations;
};
