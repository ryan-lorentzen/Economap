const METERS_PER_MILE = 1_609.34;
const FALLBACK_ROUTE_MULTIPLIER = 1.18;
const FALLBACK_AVERAGE_SPEED_MPH = 32;

interface RouteMetrics {
  distanceMeters: number;
  durationSeconds: number;
}

// Haversine formula to calculate distance between two lat/lng points
export const haversineDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371e3; // metres
  const φ1 = lat1 * Math.PI/180; // φ, λ in radians
  const φ2 = lat2 * Math.PI/180;
  const Δφ = (lat2-lat1) * Math.PI/180;
  const Δλ = (lon2-lon1) * Math.PI/180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  const d = R * c; // in metres
  return d;
};

const getFallbackRouteMetrics = (
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number }
): RouteMetrics => {
  const straightLineDistanceMeters = haversineDistance(
    origin.lat,
    origin.lng,
    destination.lat,
    destination.lng
  );
  const estimatedDistanceMeters = straightLineDistanceMeters * FALLBACK_ROUTE_MULTIPLIER;
  const durationHours = (estimatedDistanceMeters / METERS_PER_MILE) / FALLBACK_AVERAGE_SPEED_MPH;

  return {
    distanceMeters: estimatedDistanceMeters,
    durationSeconds: durationHours * 60 * 60,
  };
};

export const getRouteMetrics = async (
  waypoints: { lat: number; lng: number }[]
): Promise<RouteMetrics> => {
  if (waypoints.length < 2) {
    return {
      distanceMeters: 0,
      durationSeconds: 0,
    };
  }

  const [origin, destination] = [waypoints[0], waypoints[waypoints.length - 1]];

  if (typeof window === 'undefined') {
    return getFallbackRouteMetrics(origin, destination);
  }

  try {
    const L = await import('leaflet');
    await import('leaflet-routing-machine');

    const leafletWaypoints = waypoints.map((waypoint) =>
      L.Routing.waypoint(L.latLng(waypoint.lat, waypoint.lng))
    );

    return await new Promise((resolve, reject) => {
      const router = L.Routing.osrmv1();

      // @ts-expect-error The OSRMv1 router does not have up-to-date types for the route callback.
      router.route(leafletWaypoints, (err: Error, routes: L.Routing.IRoute[]) => {
        if (err) {
          reject(err);
          return;
        }

        if (!routes || routes.length === 0) {
          resolve(getFallbackRouteMetrics(origin, destination));
          return;
        }

        resolve({
          distanceMeters: routes[0].summary.totalDistance,
          durationSeconds: routes[0].summary.totalTime,
        });
      });
    });
  } catch {
    return getFallbackRouteMetrics(origin, destination);
  }
};

export const getRouteDistance = async (waypoints: { lat: number; lng: number }[]): Promise<number> => {
  const metrics = await getRouteMetrics(waypoints);
  return metrics.distanceMeters;
};
