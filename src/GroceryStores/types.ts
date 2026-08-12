import { Store } from '@/types';

export interface LiveGroceryStoreSearchParams {
  latitude: number;
  longitude: number;
  radiusMeters: number;
}

export interface GroceryStoresApiResponse {
  error?: string;
  meta?: {
    fetchedAt: string;
    source: 'google_places';
  };
  stores?: Store[];
}
