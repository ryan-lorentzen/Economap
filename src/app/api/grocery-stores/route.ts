import { fetchNearbyGroceryStores } from '@/GroceryStores/googlePlacesGroceries';
import { GroceryStoresApiResponse } from '@/GroceryStores/types';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const isFiniteCoordinate = (value: number) => Number.isFinite(value);

export async function GET(request: NextRequest) {
  const latitude = Number(request.nextUrl.searchParams.get('latitude'));
  const longitude = Number(request.nextUrl.searchParams.get('longitude'));
  const radiusMeters = Number(request.nextUrl.searchParams.get('radiusMeters'));

  if (
    !isFiniteCoordinate(latitude) ||
    !isFiniteCoordinate(longitude) ||
    !Number.isFinite(radiusMeters)
  ) {
    return NextResponse.json<GroceryStoresApiResponse>(
      {
        error: 'latitude, longitude, and radiusMeters query params are required.',
      },
      { status: 400 }
    );
  }

  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180 || radiusMeters <= 0) {
    return NextResponse.json<GroceryStoresApiResponse>(
      {
        error: 'Invalid search coordinates or radius.',
      },
      { status: 400 }
    );
  }

  try {
    const stores = await fetchNearbyGroceryStores({
      latitude,
      longitude,
      radiusMeters,
    });

    return NextResponse.json<GroceryStoresApiResponse>({
      meta: {
        fetchedAt: new Date().toISOString(),
        source: 'google_places',
      },
      stores,
    });
  } catch (error) {
    return NextResponse.json<GroceryStoresApiResponse>(
      {
        error:
          error instanceof Error ? error.message : 'Unable to fetch live grocery stores.',
      },
      { status: 500 }
    );
  }
}
