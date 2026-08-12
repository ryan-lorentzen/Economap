'use client';

import { haversineDistance } from '@/lib/routingUtils';
import { GasStation, RouteStop, TripPlan } from '@/types';

interface BuildTripPlanArgs {
  userLocation: { lat: number; lng: number } | null;
  gasStations: GasStation[];
}

const DIRECT_DISTANCE_WEIGHT = 0.1;

const getRouteDistance = (waypoints: { lat: number; lng: number }[]) => {
  if (waypoints.length < 2) {
    return 0;
  }

  return waypoints.slice(1).reduce((totalDistance, waypoint, index) => {
    const previousWaypoint = waypoints[index];

    return totalDistance + haversineDistance(
      previousWaypoint.lat,
      previousWaypoint.lng,
      waypoint.lat,
      waypoint.lng
    );
  }, 0);
};

const milesFromMeters = (meters: number) => meters / 1_609.34;

const buildGasStop = (gasStation: GasStation): RouteStop => ({
  id: gasStation.id,
  name: gasStation.name,
  address: gasStation.address,
  type: 'gas',
  coordinates: gasStation.coordinates,
  pricePerGallon: gasStation.pricePerGallon,
});

const chooseGasOnlyPlan = (
  userStop: RouteStop,
  userLocation: { lat: number; lng: number },
  gasStations: GasStation[]
): TripPlan | null => {
  let bestGasOnlyPlan: TripPlan | null = null;

  for (const gasStation of gasStations) {
    const gasStop = buildGasStop(gasStation);
    const totalDistanceMeters = getRouteDistance([
      userLocation,
      gasStation.coordinates,
    ]);
    const distanceMiles = milesFromMeters(totalDistanceMeters);
    const estimatedScore =
      distanceMiles * DIRECT_DISTANCE_WEIGHT +
      gasStation.pricePerGallon;

    if (!bestGasOnlyPlan || estimatedScore < bestGasOnlyPlan.estimatedScore) {
      bestGasOnlyPlan = {
        orderedStops: [userStop, gasStop],
        totalDistanceMeters,
        estimatedScore,
        selectedGasStationId: gasStation.id,
      };
    }
  }

  return bestGasOnlyPlan;
};

export const buildTripPlan = ({
  userLocation,
  gasStations,
}: BuildTripPlanArgs): TripPlan | null => {
  if (!userLocation || gasStations.length === 0) {
    return null;
  }

  const userStop: RouteStop = {
    id: 'user-location',
    name: 'Your Location',
    address: 'Current position',
    type: 'user',
    coordinates: userLocation,
  };

  return chooseGasOnlyPlan(userStop, userLocation, gasStations);
};
