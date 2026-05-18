'use client';

import { haversineDistance } from '@/lib/routingUtils';
import { GasStation, RouteStop, Store, TripPlan } from '@/types';

interface BuildTripPlanArgs {
  userLocation: { lat: number; lng: number } | null;
  selectedStore: Store | null;
  gasStations: GasStation[];
  hasSelectedGroceries: boolean;
  shouldGetGas: boolean;
}

const DIRECT_DISTANCE_WEIGHT = 0.1;
const SIGNIFICANT_DETOUR_BUFFER_MILES = 1.5;
const SAME_ROUTE_BUFFER_MILES = 0.35;

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

interface CandidateGasPlan {
  detourDistanceMiles: number;
  gasPrice: number;
  orderedStops: RouteStop[];
  selectedGasStationId: string;
  totalDistanceMeters: number;
}

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

const chooseBestGasCandidate = (
  candidates: CandidateGasPlan[]
): CandidateGasPlan | null => {
  if (candidates.length === 0) {
    return null;
  }

  const cheapestGasPrice = Math.min(...candidates.map((candidate) => candidate.gasPrice));
  const cheapestStations = candidates.filter(
    (candidate) => candidate.gasPrice === cheapestGasPrice
  );
  const minimumDetourMiles = Math.min(
    ...candidates.map((candidate) => candidate.detourDistanceMiles)
  );

  const cheapestReasonableCandidate = cheapestStations
    .filter(
      (candidate) =>
        candidate.detourDistanceMiles <=
        minimumDetourMiles + SIGNIFICANT_DETOUR_BUFFER_MILES
    )
    .sort((left, right) => left.detourDistanceMiles - right.detourDistanceMiles)[0];

  if (cheapestReasonableCandidate) {
    return cheapestReasonableCandidate;
  }

  const sameRouteCandidates = candidates.filter(
    (candidate) =>
      candidate.detourDistanceMiles <= minimumDetourMiles + SAME_ROUTE_BUFFER_MILES
  );

  return sameRouteCandidates.sort((left, right) => {
    if (left.gasPrice !== right.gasPrice) {
      return left.gasPrice - right.gasPrice;
    }

    return left.detourDistanceMiles - right.detourDistanceMiles;
  })[0] ?? null;
};

export const buildTripPlan = ({
  userLocation,
  selectedStore,
  gasStations,
  hasSelectedGroceries,
  shouldGetGas,
}: BuildTripPlanArgs): TripPlan | null => {
  if (!userLocation) {
    return null;
  }

  const userStop: RouteStop = {
    id: 'user-location',
    name: 'Your Location',
    address: 'Current position',
    type: 'user',
    coordinates: userLocation,
  };

  if (!selectedStore) {
    if (!shouldGetGas || gasStations.length === 0) {
      return null;
    }

    if (hasSelectedGroceries) {
      return null;
    }

    return chooseGasOnlyPlan(userStop, userLocation, gasStations);
  }

  const groceryStop: RouteStop = {
    id: selectedStore.id,
    name: selectedStore.name,
    address: selectedStore.address,
    type: 'grocery',
    coordinates: selectedStore.coordinates,
  };

  const directRouteDistance = getRouteDistance([
    userLocation,
    selectedStore.coordinates,
  ]);

  if (!shouldGetGas || gasStations.length === 0) {
    return {
      orderedStops: [userStop, groceryStop],
      totalDistanceMeters: directRouteDistance,
      estimatedScore: directRouteDistance,
      selectedStoreId: selectedStore.id,
    };
  }

  const candidatePlansByStation = new Map<string, CandidateGasPlan>();
  const directRouteDistanceMiles = milesFromMeters(directRouteDistance);

  for (const gasStation of gasStations) {
    const gasStop = buildGasStop(gasStation);

    const candidateRoutes: RouteStop[][] = [
      [userStop, gasStop, groceryStop],
      [userStop, groceryStop, gasStop],
    ];

    for (const orderedStops of candidateRoutes) {
      const totalDistanceMeters = getRouteDistance(
        orderedStops.map(stop => stop.coordinates)
      );
      const detourDistanceMiles = Math.max(
        0,
        milesFromMeters(totalDistanceMeters) - directRouteDistanceMiles
      );
      const existingPlan = candidatePlansByStation.get(gasStation.id);

      if (!existingPlan || detourDistanceMiles < existingPlan.detourDistanceMiles) {
        candidatePlansByStation.set(gasStation.id, {
          detourDistanceMiles,
          gasPrice: gasStation.pricePerGallon,
          orderedStops,
          selectedGasStationId: gasStation.id,
          totalDistanceMeters,
        });
      }
    }
  }

  const bestCandidate = chooseBestGasCandidate([
    ...candidatePlansByStation.values(),
  ]);

  if (!bestCandidate) {
    return {
      orderedStops: [userStop, groceryStop],
      totalDistanceMeters: directRouteDistance,
      estimatedScore: directRouteDistance,
      selectedStoreId: selectedStore.id,
    };
  }

  return {
    orderedStops: bestCandidate.orderedStops,
    totalDistanceMeters: bestCandidate.totalDistanceMeters,
    estimatedScore: bestCandidate.detourDistanceMiles + bestCandidate.gasPrice,
    selectedStoreId: selectedStore.id,
    selectedGasStationId: bestCandidate.selectedGasStationId,
  };
};
