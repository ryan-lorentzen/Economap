import { fetchNearbyGasStations } from '@/GasPrices/googlePlacesGas';
import { GasStationsApiResponse } from '@/GasPrices/types';
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
    return NextResponse.json<GasStationsApiResponse>(
      {
        error: 'latitude, longitude, and radiusMeters query params are required.',
      },
      { status: 400 }
    );
  }

  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180 || radiusMeters <= 0) {
    return NextResponse.json<GasStationsApiResponse>(
      {
        error: 'Invalid search coordinates or radius.',
      },
      { status: 400 }
    );
  }

  try {
    const stations = await fetchNearbyGasStations({
      latitude,
      longitude,
      radiusMeters,
    });

    return NextResponse.json<GasStationsApiResponse>({
      meta: {
        fetchedAt: new Date().toISOString(),
        source: 'google_places',
      },
      stations,
    });
  } catch (error) {
    return NextResponse.json<GasStationsApiResponse>(
      {
        error:
          error instanceof Error ? error.message : 'Unable to fetch live gas station prices.',
      },
      { status: 500 }
    );
  }
}
