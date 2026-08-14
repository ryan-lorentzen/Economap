import { CommutePlan, CommutePlanRequest, GeocodedDestination } from '@/types';

export interface DestinationSuggestion {
  placeId: string;
  text: string;
  mainText: string;
  secondaryText: string;
}

interface AutocompleteResponse {
  suggestions?: DestinationSuggestion[];
  error?: string;
}

interface PlaceDetailsResponse {
  destination?: GeocodedDestination;
  error?: string;
}

interface CommutePlanResponse {
  plan?: CommutePlan;
  error?: string;
}

export const searchDestinationSuggestions = async (
  query: string,
  sessionToken: string,
  origin?: { lat: number; lng: number } | null,
  signal?: AbortSignal
) => {
  const searchParams = new URLSearchParams({ q: query, sessionToken });
  if (origin) {
    searchParams.set('latitude', origin.lat.toString());
    searchParams.set('longitude', origin.lng.toString());
  }
  const response = await fetch(`/api/geocode?${searchParams.toString()}`, { signal });
  const payload = (await response.json()) as AutocompleteResponse;

  if (!response.ok || !payload.suggestions) {
    throw new Error(payload.error ?? 'Unable to load address suggestions.');
  }

  return payload.suggestions;
};

export const resolveDestinationSuggestion = async (
  placeId: string,
  name: string,
  sessionToken: string,
  signal?: AbortSignal
) => {
  const searchParams = new URLSearchParams({ sessionToken });
  const response = await fetch(`/api/geocode?${searchParams.toString()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ placeId, name }),
    signal,
  });
  const payload = (await response.json()) as PlaceDetailsResponse;

  if (!response.ok || !payload.destination) {
    throw new Error(payload.error ?? 'Unable to resolve that address.');
  }

  return payload.destination;
};

export const createCommutePlan = async (request: CommutePlanRequest, signal?: AbortSignal) => {
  const response = await fetch('/api/commute-plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal,
  });
  const payload = (await response.json()) as CommutePlanResponse;

  if (!response.ok || !payload.plan) {
    throw new Error(payload.error ?? 'Unable to plan a safe route right now.');
  }

  return payload.plan;
};
