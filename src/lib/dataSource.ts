import { generateFakeGasStations, generateFakeProductPrices, generateFakeStores } from '@/lib/fakeData';
import { haversineDistance } from '@/lib/routingUtils';
import {
  GasStation,
  NearbySearchParams,
  Product,
  ProductPriceLookup,
  ProductPricingQuery,
  Store,
} from '@/types';

const METERS_PER_MILE = 1_609.34;
const MAX_FAKE_DATASET_RADIUS_METERS = 25 * METERS_PER_MILE;
const DEFAULT_FAKE_STORE_COUNT = 56;
const DEFAULT_FAKE_GAS_STATION_COUNT = 30;

const PRODUCTS: Product[] = [
  {
    id: 'prod1',
    name: 'Milk',
    brand: 'DairyCo',
    category: 'Dairy',
    image_url: '/images/milk.png',
  },
  {
    id: 'prod2',
    name: 'Bread',
    brand: 'Bakery Delights',
    category: 'Baked Goods',
    image_url: '/images/bread.png',
  },
  {
    id: 'prod3',
    name: 'Eggs',
    brand: 'Farm Fresh',
    category: 'Dairy & Eggs',
    image_url: '/images/eggs.png',
  },
  {
    id: 'prod4',
    name: 'Chicken Breast',
    brand: 'Poultry King',
    category: 'Meat',
    image_url: '/images/chicken.png',
  },
  {
    id: 'prod5',
    name: 'Rice',
    brand: 'Grain Goodness',
    category: 'Pantry',
    image_url: '/images/rice.png',
  },
  {
    id: 'prod6',
    name: 'Pasta',
    brand: 'Italian Delights',
    category: 'Pantry',
    image_url: '/images/pasta.png',
  },
  {
    id: 'prod7',
    name: 'Tomatoes',
    brand: 'Garden Fresh',
    category: 'Produce',
    image_url: '/images/tomatoes.png',
  },
  {
    id: 'prod8',
    name: 'Potatoes',
    brand: "Earth's Bounty",
    category: 'Produce',
    image_url: '/images/potatoes.png',
  },
  {
    id: 'prod9',
    name: 'Cheese',
    brand: 'DairyCo',
    category: 'Dairy',
    image_url: '/images/cheese.png',
  },
  {
    id: 'prod10',
    name: 'Yogurt',
    brand: 'Happy Cow',
    category: 'Dairy',
    image_url: '/images/yogurt.png',
  },
];

interface FakeLocationDataset {
  gasStations: GasStation[];
  stores: Store[];
}

export interface PlanningDataSource {
  getGasStations(params: NearbySearchParams): Promise<GasStation[]>;
  getProductPrices(query: ProductPricingQuery): Promise<ProductPriceLookup>;
  getProducts(): Promise<Product[]>;
  getStores(params: NearbySearchParams): Promise<Store[]>;
}

const datasetCache = new Map<string, FakeLocationDataset>();

const buildLocationKey = (latitude: number, longitude: number) =>
  `${latitude.toFixed(4)}:${longitude.toFixed(4)}`;

const filterByRadius = <T extends { coordinates: { lat: number; lng: number } }>(
  entries: T[],
  { latitude, limit, longitude, radiusMeters }: NearbySearchParams
) =>
  entries
    .filter((entry) =>
      haversineDistance(latitude, longitude, entry.coordinates.lat, entry.coordinates.lng) <= radiusMeters
    )
    .slice(0, limit);

const getOrCreateDataset = (latitude: number, longitude: number): FakeLocationDataset => {
  const cacheKey = buildLocationKey(latitude, longitude);
  const cachedDataset = datasetCache.get(cacheKey);

  if (cachedDataset) {
    return cachedDataset;
  }

  const dataset = {
    stores: generateFakeStores(
      DEFAULT_FAKE_STORE_COUNT,
      latitude,
      longitude,
      MAX_FAKE_DATASET_RADIUS_METERS
    ),
    gasStations: generateFakeGasStations(
      DEFAULT_FAKE_GAS_STATION_COUNT,
      latitude,
      longitude,
      MAX_FAKE_DATASET_RADIUS_METERS
    ),
  };

  datasetCache.set(cacheKey, dataset);
  return dataset;
};

export const getAvailableProducts = (): Product[] => PRODUCTS;

export const getStoresNearLocation = (params: NearbySearchParams): Store[] => {
  const dataset = getOrCreateDataset(params.latitude, params.longitude);
  return filterByRadius(dataset.stores, params);
};

export const getGasStationsNearLocation = (params: NearbySearchParams): GasStation[] => {
  const dataset = getOrCreateDataset(params.latitude, params.longitude);
  return filterByRadius(dataset.gasStations, params);
};

export const getProductPricesForStores = ({
  products,
  storeIds,
}: ProductPricingQuery): ProductPriceLookup => generateFakeProductPrices(storeIds, products);

const fakePlanningDataSource: PlanningDataSource = {
  getProducts: async () => getAvailableProducts(),
  getStores: async (params) => getStoresNearLocation(params),
  getGasStations: async (params) => getGasStationsNearLocation(params),
  getProductPrices: async (query) => getProductPricesForStores(query),
};

// Swap this export to a backend-backed implementation later.
export const planningDataSource = fakePlanningDataSource;
