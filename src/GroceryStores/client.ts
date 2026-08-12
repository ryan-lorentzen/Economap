import { GroceryStoresApiResponse, LiveGroceryStoreSearchParams } from '@/GroceryStores/types';
import { Store } from '@/types';

export const getLiveGroceryStores = async (
  params: LiveGroceryStoreSearchParams & { signal?: AbortSignal }
): Promise<Store[]> => {
  const searchParams = new URLSearchParams({
    latitude: params.latitude.toString(),
    longitude: params.longitude.toString(),
    radiusMeters: Math.round(params.radiusMeters).toString(),
  });

  const response = await fetch(`/api/grocery-stores?${searchParams.toString()}`, {
    cache: 'no-store',
    method: 'GET',
    signal: params.signal,
  });

  const payload = (await response.json()) as GroceryStoresApiResponse;

  if (!response.ok) {
    throw new Error(payload.error ?? 'Unable to load live grocery stores.');
  }

  return payload.stores ?? [];
};
