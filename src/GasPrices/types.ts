import { GasStation } from '@/types';

export interface LiveGasStationSearchParams {
  latitude: number;
  longitude: number;
  radiusMeters: number;
}

export interface GasStationsApiResponse {
  error?: string;
  meta?: {
    fetchedAt: string;
    source: 'google_places';
  };
  stations?: GasStation[];
}
