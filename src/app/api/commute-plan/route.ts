import { NextRequest, NextResponse } from 'next/server';

import { buildCommutePlan } from '@/lib/server/commutePlanner';
import { isRouteWaypoint } from '@/lib/commute';
import { CommutePlanRequest, FuelGrade, GeocodedDestination } from '@/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const FUEL_GRADES: FuelGrade[] = ['regular', 'midgrade', 'premium', 'diesel'];
const RATE_LIMIT_WINDOW_MS = 60_000;
const recentRequests = new Map<string, number>();

const isDestination = (value: unknown): value is GeocodedDestination => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const destination = value as Partial<GeocodedDestination>;
  return typeof destination.id === 'string'
    && typeof destination.name === 'string'
    && typeof destination.address === 'string'
    && isRouteWaypoint(destination.coordinates);
};

const isPlanRequest = (value: unknown): value is CommutePlanRequest => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const request = value as Partial<CommutePlanRequest>;
  return isRouteWaypoint(request.origin)
    && isDestination(request.destination)
    && Number.isFinite(request.currentRangeMiles)
    && (request.currentRangeMiles ?? 0) > 5
    && (request.currentRangeMiles ?? 0) <= 1_000
    && Number.isFinite(request.fullTankRangeMiles)
    && (request.fullTankRangeMiles ?? 0) > 5
    && (request.fullTankRangeMiles ?? 0) <= 1_000
    && FUEL_GRADES.includes(request.fuelGrade as FuelGrade);
};

export async function POST(request: NextRequest) {
  try {
    const clientId = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
    const lastRequestAt = recentRequests.get(clientId) ?? 0;
    if (Date.now() - lastRequestAt < RATE_LIMIT_WINDOW_MS) {
      return NextResponse.json(
        { error: 'Please wait a minute before planning another route.' },
        { status: 429 }
      );
    }

    const body = await request.json() as unknown;
    if (!isPlanRequest(body)) {
      return NextResponse.json(
        { error: 'Enter a valid US destination, fuel grade, and ranges between 5 and 1,000 miles.' },
        { status: 400 }
      );
    }

    recentRequests.set(clientId, Date.now());
    const plan = await buildCommutePlan(body, request.signal);
    return NextResponse.json({ plan });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const expectedMessages = [
      'Commute routes are limited',
      'A route requiring more than',
      'No safely reachable priced gas station',
      'The final route could not satisfy',
      'The final route exceeds',
    ];
    const safeMessage = message.includes('GOOGLE_PLACES_API_KEY')
      ? 'Gas price searches are not configured on this server.'
      : expectedMessages.some((expectedMessage) => message.startsWith(expectedMessage))
        ? message
        : 'Route planning is temporarily unavailable. Please try again.';

    return NextResponse.json({ error: safeMessage }, { status: 503 });
  }
}
