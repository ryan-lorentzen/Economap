import { NextRequest, NextResponse } from 'next/server';

import { GeocodedDestination } from '@/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const GOOGLE_AUTOCOMPLETE_URL = 'https://places.googleapis.com/v1/places:autocomplete';
const GOOGLE_PLACES_BASE_URL = 'https://places.googleapis.com/v1/places';
const AUTOCOMPLETE_FIELD_MASK = [
  'suggestions.placePrediction.placeId',
  'suggestions.placePrediction.text.text',
  'suggestions.placePrediction.structuredFormat.mainText.text',
  'suggestions.placePrediction.structuredFormat.secondaryText.text',
].join(',');
const DETAILS_FIELD_MASK = 'id,formattedAddress,location';
const MIN_QUERY_LENGTH = 3;
const MAX_QUERY_LENGTH = 160;
const SESSION_TOKEN_PATTERN = /^[a-zA-Z0-9_-]{16,128}$/;

interface GoogleAutocompleteResponse {
  suggestions?: Array<{
    placePrediction?: {
      placeId?: string;
      text?: { text?: string };
      structuredFormat?: {
        mainText?: { text?: string };
        secondaryText?: { text?: string };
      };
    };
  }>;
}

interface GooglePlaceDetailsResponse {
  id?: string;
  formattedAddress?: string;
  location?: {
    latitude?: number;
    longitude?: number;
  };
}

const getApiKey = () => {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    throw new Error('Google Places is not configured.');
  }

  return apiKey;
};

const getSessionToken = (request: NextRequest) => {
  const sessionToken = request.nextUrl.searchParams.get('sessionToken') ?? '';
  return SESSION_TOKEN_PATTERN.test(sessionToken) ? sessionToken : null;
};

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('q')?.trim() ?? '';
  const sessionToken = getSessionToken(request);

  if (query.length < MIN_QUERY_LENGTH || query.length > MAX_QUERY_LENGTH || !sessionToken) {
    return NextResponse.json(
      { error: 'Enter at least three address characters.' },
      { status: 400 }
    );
  }

  try {
    const latitude = Number(request.nextUrl.searchParams.get('latitude'));
    const longitude = Number(request.nextUrl.searchParams.get('longitude'));
    const hasValidOrigin = Number.isFinite(latitude)
      && latitude >= -90
      && latitude <= 90
      && Number.isFinite(longitude)
      && longitude >= -180
      && longitude <= 180;
    const response = await fetch(GOOGLE_AUTOCOMPLETE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': getApiKey(),
        'X-Goog-FieldMask': AUTOCOMPLETE_FIELD_MASK,
      },
      body: JSON.stringify({
        input: query,
        includedRegionCodes: ['us'],
        languageCode: 'en-US',
        regionCode: 'us',
        sessionToken,
        ...(hasValidOrigin && {
          origin: { latitude, longitude },
          locationBias: {
            circle: {
              center: { latitude, longitude },
              radius: 50_000,
            },
          },
        }),
      }),
      cache: 'no-store',
      signal: request.signal,
    });

    if (!response.ok) {
      throw new Error(`Google autocomplete returned status ${response.status}.`);
    }

    const payload = await response.json() as GoogleAutocompleteResponse;
    const suggestions = (payload.suggestions ?? []).flatMap((suggestion) => {
      const prediction = suggestion.placePrediction;
      const placeId = prediction?.placeId;
      const text = prediction?.text?.text;
      if (!placeId || !text) {
        return [];
      }

      return [{
        placeId,
        text,
        mainText: prediction.structuredFormat?.mainText?.text ?? text,
        secondaryText: prediction.structuredFormat?.secondaryText?.text ?? '',
      }];
    });

    return NextResponse.json({ suggestions });
  } catch {
    return NextResponse.json(
      { error: 'Address suggestions are temporarily unavailable.' },
      { status: 503 }
    );
  }
}

export async function POST(request: NextRequest) {
  const sessionToken = getSessionToken(request);
  const body = await request.json().catch(() => null) as { placeId?: unknown; name?: unknown } | null;
  const placeId = typeof body?.placeId === 'string' ? body.placeId.trim() : '';
  const name = typeof body?.name === 'string' ? body.name.trim() : '';

  if (!sessionToken || !placeId || placeId.length > 256 || !name || name.length > 160) {
    return NextResponse.json({ error: 'Select a valid address suggestion.' }, { status: 400 });
  }

  try {
    const searchParams = new URLSearchParams({
      languageCode: 'en-US',
      regionCode: 'us',
      sessionToken,
    });
    const response = await fetch(
      `${GOOGLE_PLACES_BASE_URL}/${encodeURIComponent(placeId)}?${searchParams.toString()}`,
      {
        headers: {
          'X-Goog-Api-Key': getApiKey(),
          'X-Goog-FieldMask': DETAILS_FIELD_MASK,
        },
        cache: 'no-store',
        signal: request.signal,
      }
    );

    if (!response.ok) {
      throw new Error(`Google place details returned status ${response.status}.`);
    }

    const place = await response.json() as GooglePlaceDetailsResponse;
    const latitude = place.location?.latitude;
    const longitude = place.location?.longitude;
    if (
      !place.id
      || !place.formattedAddress
      || !Number.isFinite(latitude)
      || !Number.isFinite(longitude)
    ) {
      throw new Error('Google place details were incomplete.');
    }

    const destination: GeocodedDestination = {
      id: `google:${place.id}`,
      name,
      address: place.formattedAddress,
      coordinates: {
        lat: latitude as number,
        lng: longitude as number,
      },
    };

    return NextResponse.json({ destination });
  } catch {
    return NextResponse.json(
      { error: 'That address could not be resolved. Please choose another suggestion.' },
      { status: 503 }
    );
  }
}
