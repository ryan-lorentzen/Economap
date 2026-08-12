import { GasStationsApiResponse, LiveGasStationSearchParams } from '@/GasPrices/types';
import { GasStation } from '@/types';

export const getLiveGasStations = async (
  params: LiveGasStationSearchParams & { signal?: AbortSignal }
): Promise<GasStation[]> => {
  const searchParams = new URLSearchParams({
    latitude: params.latitude.toString(),
    longitude: params.longitude.toString(),
    radiusMeters: Math.round(params.radiusMeters).toString(),
  });

  const response = await fetch(`/api/gas-prices?${searchParams.toString()}`, {
    cache: 'no-store',
    method: 'GET',
    signal: params.signal,
  });

  const payload = (await response.json()) as GasStationsApiResponse;

  if (!response.ok) {
    throw new Error(payload.error ?? 'Unable to load live gas station data.');
  }

  return payload.stations ?? [];
};
