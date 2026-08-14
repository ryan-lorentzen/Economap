import 'server-only';

import { RouteWaypoint } from '@/types';

const DEFAULT_OSRM_BASE_URL = 'https://router.project-osrm.org';
const OSRM_TIMEOUT_MS = 30_000;

interface OsrmWaypoint {
  location?: [number, number];
}

interface OsrmRouteResponse {
  code?: string;
  message?: string;
  routes?: Array<{
    distance?: number;
    duration?: number;
    geometry?: {
      type?: string;
      coordinates?: [number, number][];
    };
    legs?: Array<{
      distance?: number;
      duration?: number;
    }>;
  }>;
  waypoints?: OsrmWaypoint[];
}

interface OsrmTableResponse {
  code?: string;
  message?: string;
  distances?: Array<Array<number | null>>;
  durations?: Array<Array<number | null>>;
}

export interface RoadRoute {
  distanceMeters: number;
  durationSeconds: number;
  geometry: RouteWaypoint[];
  legs: Array<{
    distanceMeters: number;
    durationSeconds: number;
  }>;
}

const getCoordinatesPath = (waypoints: RouteWaypoint[]) => waypoints
  .map((waypoint) => `${waypoint.lng},${waypoint.lat}`)
  .join(';');

const fetchOsrm = async <T>(path: string, signal?: AbortSignal): Promise<T> => {
  const configuredBaseUrl = process.env.OSRM_BASE_URL ?? DEFAULT_OSRM_BASE_URL;
  const baseUrl = configuredBaseUrl.replace(/\/$/, '');
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), OSRM_TIMEOUT_MS);
  const combinedSignal = signal
    ? AbortSignal.any([signal, timeoutController.signal])
    : timeoutController.signal;

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      cache: 'no-store',
      signal: combinedSignal,
    });

    if (!response.ok) {
      throw new Error(`Routing service returned status ${response.status}.`);
    }

    return await response.json() as T;
  } finally {
    clearTimeout(timeoutId);
  }
};

export const getRoadRoute = async (
  waypoints: RouteWaypoint[],
  signal?: AbortSignal
): Promise<RoadRoute> => {
  if (waypoints.length < 2) {
    throw new Error('At least two route waypoints are required.');
  }

  const coordinates = getCoordinatesPath(waypoints);
  const payload = await fetchOsrm<OsrmRouteResponse>(
    `/route/v1/driving/${coordinates}?alternatives=false&steps=false&overview=full&geometries=geojson`,
    signal
  );
  const route = payload.routes?.[0];
  const geometryCoordinates = route?.geometry?.coordinates;

  if (
    payload.code !== 'Ok'
    || !route
    || !Number.isFinite(route.distance)
    || !Number.isFinite(route.duration)
    || !Array.isArray(geometryCoordinates)
    || geometryCoordinates.length < 2
  ) {
    throw new Error(payload.message ?? 'No safe driving route was returned.');
  }

  const legs = route.legs ?? [];
  if (legs.length !== waypoints.length - 1) {
    throw new Error('The routing service returned incomplete route legs.');
  }

  return {
    distanceMeters: route.distance as number,
    durationSeconds: route.duration as number,
    geometry: geometryCoordinates.map(([lng, lat]) => ({ lat, lng })),
    legs: legs.map((leg) => {
      if (!Number.isFinite(leg.distance) || !Number.isFinite(leg.duration)) {
        throw new Error('The routing service returned an invalid route leg.');
      }

      return {
        distanceMeters: leg.distance as number,
        durationSeconds: leg.duration as number,
      };
    }),
  };
};

export const getRoadDistanceTable = async (
  waypoints: RouteWaypoint[],
  sourceIndexes: number[],
  destinationIndexes: number[],
  signal?: AbortSignal
) => {
  const coordinates = getCoordinatesPath(waypoints);
  const payload = await fetchOsrm<OsrmTableResponse>(
    `/table/v1/driving/${coordinates}?annotations=distance,duration&sources=${sourceIndexes.join(';')}&destinations=${destinationIndexes.join(';')}`,
    signal
  );

  if (payload.code !== 'Ok' || !payload.distances || !payload.durations) {
    throw new Error(payload.message ?? 'Road distances could not be verified.');
  }

  return {
    distances: payload.distances,
    durations: payload.durations,
  };
};
