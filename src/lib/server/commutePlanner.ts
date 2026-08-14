import 'server-only';

import { randomUUID } from 'node:crypto';

import { fetchGasStationsInCircle } from '@/GasPrices/googlePlacesGas';
import {
  getSafeRangeMiles,
  COMMUTE_PLAN_RETENTION_DAYS,
  MAX_COMMUTE_GAS_STOPS,
  MAX_COMMUTE_ROUTE_MILES,
  METERS_PER_MILE,
} from '@/lib/commute';
import { getRoadDistanceTable, getRoadRoute, RoadRoute } from '@/lib/server/osrm';
import {
  CommutePlan,
  CommutePlanRequest,
  CommuteStop,
  FuelPriceOption,
  GasStation,
  RouteWaypoint,
} from '@/types';

// Candidate discovery is wider than the permitted detour so sparse route samples do not
// leave long gaps. Every candidate still has to pass both one-mile detour checks below.
const CANDIDATE_SEARCH_RADIUS_METERS = 5 * METERS_PER_MILE;
const MAX_ROUTE_OFFSET_METERS = METERS_PER_MILE;
const MAX_ADDED_DETOUR_METERS = METERS_PER_MILE;
const MAX_TABLE_CANDIDATES = 24;
// Treat each projected future stop as a modest price penalty. This keeps the
// itinerary practical without discarding a meaningfully cheaper nearby station.
const FUTURE_STOP_PRICE_PENALTY = 0.1;
const ADDED_DETOUR_PRICE_PENALTY_PER_MILE = 0.05;
// Six broad checks establish the viable corridor; four local checks then compare
// more stations around the sampled region with the lowest fuel price.
const SPARSE_SEARCH_FRACTIONS = [0.55, 0.64, 0.73, 0.82, 0.91, 0.99];
const REFINEMENT_OFFSETS_METERS = [-7.5, -2.5, 2.5, 7.5].map(
  (miles) => miles * METERS_PER_MILE
);

interface RouteProgress {
  waypoint: RouteWaypoint;
  distanceMeters: number;
}

interface ProjectedStation {
  station: GasStation;
  fuelPrice: FuelPriceOption;
  routeProgressMeters: number;
  routeDistanceMeters: number;
}

interface VerifiedStation extends ProjectedStation {
  distanceFromCurrentMeters: number;
  distanceToDestinationMeters: number;
  addedDetourMeters: number;
  remainingStopCount: number;
}

const getPlanningScore = (
  pricePerGallon: number,
  remainingStopCount: number,
  addedDetourMeters = 0
) => pricePerGallon
  + remainingStopCount * FUTURE_STOP_PRICE_PENALTY
  + (addedDetourMeters / METERS_PER_MILE) * ADDED_DETOUR_PRICE_PENALTY_PER_MILE;

const toRadians = (degrees: number) => degrees * Math.PI / 180;

const distanceMeters = (left: RouteWaypoint, right: RouteWaypoint) => {
  const earthRadiusMeters = 6_371_000;
  const latitudeDelta = toRadians(right.lat - left.lat);
  const longitudeDelta = toRadians(right.lng - left.lng);
  const leftLatitude = toRadians(left.lat);
  const rightLatitude = toRadians(right.lat);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(leftLatitude) * Math.cos(rightLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const buildRouteProgress = (geometry: RouteWaypoint[]): RouteProgress[] => {
  let cumulativeDistance = 0;
  return geometry.map((waypoint, index) => {
    if (index > 0) {
      cumulativeDistance += distanceMeters(geometry[index - 1], waypoint);
    }

    return { waypoint, distanceMeters: cumulativeDistance };
  });
};

const interpolateRoutePoint = (progress: RouteProgress[], targetDistanceMeters: number) => {
  const finalPoint = progress[progress.length - 1];
  if (targetDistanceMeters >= finalPoint.distanceMeters) {
    return finalPoint.waypoint;
  }

  for (let index = 1; index < progress.length; index += 1) {
    const current = progress[index];
    if (current.distanceMeters < targetDistanceMeters) {
      continue;
    }

    const previous = progress[index - 1];
    const segmentDistance = current.distanceMeters - previous.distanceMeters;
    const ratio = segmentDistance === 0
      ? 0
      : (targetDistanceMeters - previous.distanceMeters) / segmentDistance;
    return {
      lat: previous.waypoint.lat + (current.waypoint.lat - previous.waypoint.lat) * ratio,
      lng: previous.waypoint.lng + (current.waypoint.lng - previous.waypoint.lng) * ratio,
    };
  }

  return finalPoint.waypoint;
};

const projectPointToRoute = (
  point: RouteWaypoint,
  progress: RouteProgress[]
): { progressMeters: number; distanceMeters: number } => {
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestProgress = 0;
  const referenceLatitude = toRadians(point.lat);
  const metersPerLatitudeDegree = 111_320;
  const metersPerLongitudeDegree = metersPerLatitudeDegree * Math.max(0.01, Math.cos(referenceLatitude));

  for (let index = 1; index < progress.length; index += 1) {
    const start = progress[index - 1];
    const end = progress[index];
    const startX = (start.waypoint.lng - point.lng) * metersPerLongitudeDegree;
    const startY = (start.waypoint.lat - point.lat) * metersPerLatitudeDegree;
    const endX = (end.waypoint.lng - point.lng) * metersPerLongitudeDegree;
    const endY = (end.waypoint.lat - point.lat) * metersPerLatitudeDegree;
    const segmentX = endX - startX;
    const segmentY = endY - startY;
    const segmentLengthSquared = segmentX ** 2 + segmentY ** 2;
    const projectionRatio = segmentLengthSquared === 0
      ? 0
      : Math.min(1, Math.max(0, -(startX * segmentX + startY * segmentY) / segmentLengthSquared));
    const projectedX = startX + segmentX * projectionRatio;
    const projectedY = startY + segmentY * projectionRatio;
    const projectedDistance = Math.hypot(projectedX, projectedY);

    if (projectedDistance < bestDistance) {
      bestDistance = projectedDistance;
      bestProgress = start.distanceMeters
        + (end.distanceMeters - start.distanceMeters) * projectionRatio;
    }
  }

  return { progressMeters: bestProgress, distanceMeters: bestDistance };
};

const getFuelPrice = (station: GasStation, fuelGrade: CommutePlanRequest['fuelGrade']) =>
  station.fuelPrices?.[fuelGrade] ?? null;

const searchAtRoutePoint = async (waypoint: RouteWaypoint, signal?: AbortSignal) =>
  fetchGasStationsInCircle({
    latitude: waypoint.lat,
    longitude: waypoint.lng,
    radiusMeters: CANDIDATE_SEARCH_RADIUS_METERS,
    signal,
  });

const discoverStations = async (
  route: RoadRoute,
  safeRangeMeters: number,
  fuelGrade: CommutePlanRequest['fuelGrade'],
  signal?: AbortSignal
) => {
  const progress = buildRouteProgress(route.geometry);
  const searchableDistance = Math.min(safeRangeMeters, progress[progress.length - 1].distanceMeters);
  const sparseDistances = SPARSE_SEARCH_FRACTIONS.map((fraction) => searchableDistance * fraction);
  const sparseResults = await Promise.all(sparseDistances.map((distance) =>
    searchAtRoutePoint(interpolateRoutePoint(progress, distance), signal)
  ));

  let promisingDistance = searchableDistance * 0.88;
  let promisingPrice = Number.POSITIVE_INFINITY;
  sparseResults.forEach((stations, index) => {
    const lowestPrice = stations.reduce((lowest, station) => {
      const price = getFuelPrice(station, fuelGrade)?.pricePerGallon;
      return price === undefined ? lowest : Math.min(lowest, price);
    }, Number.POSITIVE_INFINITY);

    if (lowestPrice < promisingPrice) {
      promisingPrice = lowestPrice;
      promisingDistance = sparseDistances[index];
    }
  });

  const minimumSearchDistance = searchableDistance * 0.55;
  const maximumSearchDistance = searchableDistance * 0.995;
  const refinementDistances = [...new Set(REFINEMENT_OFFSETS_METERS.map((offsetMeters) =>
    Math.min(
      maximumSearchDistance,
      Math.max(minimumSearchDistance, promisingDistance + offsetMeters)
    )
  ))];
  const refinementResults = await Promise.all(refinementDistances.map((distance) =>
    searchAtRoutePoint(interpolateRoutePoint(progress, distance), signal)
  ));
  const stationMap = new Map<string, GasStation>();

  [...sparseResults, ...refinementResults].flat().forEach((station) => stationMap.set(station.id, station));

  return [...stationMap.values()].flatMap((station): ProjectedStation[] => {
    const fuelPrice = getFuelPrice(station, fuelGrade);
    if (!fuelPrice) {
      return [];
    }

    const projection = projectPointToRoute(station.coordinates, progress);
    if (
      projection.distanceMeters > MAX_ROUTE_OFFSET_METERS
      || projection.progressMeters < searchableDistance * 0.5
      || projection.progressMeters > safeRangeMeters
    ) {
      return [];
    }

    return [{
      station,
      fuelPrice,
      routeProgressMeters: projection.progressMeters,
      routeDistanceMeters: projection.distanceMeters,
    }];
  });
};

const verifyAndChooseStation = async (
  current: RouteWaypoint,
  destination: RouteWaypoint,
  baselineRoute: RoadRoute,
  candidates: ProjectedStation[],
  safeRangeMeters: number,
  fullTankSafeRangeMeters: number,
  signal?: AbortSignal
) => {
  const shortlist = [...candidates]
    .sort((left, right) => {
      const leftRemainingStops = Math.max(0, Math.ceil(
        (baselineRoute.distanceMeters - left.routeProgressMeters) / fullTankSafeRangeMeters
      ) - 1);
      const rightRemainingStops = Math.max(0, Math.ceil(
        (baselineRoute.distanceMeters - right.routeProgressMeters) / fullTankSafeRangeMeters
      ) - 1);
      return getPlanningScore(left.fuelPrice.pricePerGallon, leftRemainingStops)
        - getPlanningScore(right.fuelPrice.pricePerGallon, rightRemainingStops)
        || left.fuelPrice.pricePerGallon - right.fuelPrice.pricePerGallon
        || leftRemainingStops - rightRemainingStops
        || right.routeProgressMeters - left.routeProgressMeters;
    })
    .slice(0, MAX_TABLE_CANDIDATES);

  if (shortlist.length === 0) {
    return null;
  }

  const waypoints = [current, ...shortlist.map(({ station }) => station.coordinates), destination];
  const allIndexes = waypoints.map((_, index) => index);
  const table = await getRoadDistanceTable(waypoints, allIndexes, allIndexes, signal);
  const destinationIndex = waypoints.length - 1;
  const verifiedCandidates = shortlist.flatMap((candidate, shortlistIndex): VerifiedStation[] => {
    const candidateIndex = shortlistIndex + 1;
    const fromCurrent = table.distances[0]?.[candidateIndex];
    const toDestination = table.distances[candidateIndex]?.[destinationIndex];
    if (fromCurrent === null || fromCurrent === undefined || toDestination === null || toDestination === undefined) {
      return [];
    }

    const addedDetour = fromCurrent + toDestination - baselineRoute.distanceMeters;
    if (fromCurrent > safeRangeMeters || addedDetour > MAX_ADDED_DETOUR_METERS) {
      return [];
    }

    return [{
      ...candidate,
      distanceFromCurrentMeters: fromCurrent,
      distanceToDestinationMeters: toDestination,
      addedDetourMeters: Math.max(0, addedDetour),
      remainingStopCount: Math.max(0, Math.ceil(toDestination / fullTankSafeRangeMeters) - 1),
    }];
  });

  return verifiedCandidates.sort((left, right) =>
    getPlanningScore(
      left.fuelPrice.pricePerGallon,
      left.remainingStopCount,
      left.addedDetourMeters
    ) - getPlanningScore(
      right.fuelPrice.pricePerGallon,
      right.remainingStopCount,
      right.addedDetourMeters
    )
    || left.fuelPrice.pricePerGallon - right.fuelPrice.pricePerGallon
    || left.remainingStopCount - right.remainingStopCount
    || left.addedDetourMeters - right.addedDetourMeters
    || right.routeProgressMeters - left.routeProgressMeters
  )[0] ?? null;
};

export const buildCommutePlan = async (
  request: CommutePlanRequest,
  signal?: AbortSignal
): Promise<CommutePlan> => {
  const initialSafeRangeMeters = getSafeRangeMiles(request.currentRangeMiles) * METERS_PER_MILE;
  const fullTankSafeRangeMeters = getSafeRangeMiles(request.fullTankRangeMiles) * METERS_PER_MILE;
  const initialRoute = await getRoadRoute([request.origin, request.destination.coordinates], signal);

  if (initialRoute.distanceMeters > MAX_COMMUTE_ROUTE_MILES * METERS_PER_MILE) {
    throw new Error(`Commute routes are limited to ${MAX_COMMUTE_ROUTE_MILES.toLocaleString()} miles.`);
  }

  const selectedStations: VerifiedStation[] = [];
  let currentWaypoint = request.origin;
  let safeRangeMeters = initialSafeRangeMeters;

  while (true) {
    const remainingRoute = await getRoadRoute([currentWaypoint, request.destination.coordinates], signal);
    if (remainingRoute.distanceMeters <= safeRangeMeters) {
      break;
    }

    if (selectedStations.length >= MAX_COMMUTE_GAS_STOPS) {
      throw new Error(`A route requiring more than ${MAX_COMMUTE_GAS_STOPS} gas stops is not supported.`);
    }

    const candidates = await discoverStations(
      remainingRoute,
      safeRangeMeters,
      request.fuelGrade,
      signal
    );
    const selectedStation = await verifyAndChooseStation(
      currentWaypoint,
      request.destination.coordinates,
      remainingRoute,
      candidates,
      safeRangeMeters,
      fullTankSafeRangeMeters,
      signal
    );

    if (!selectedStation) {
      throw new Error('No safely reachable priced gas station was found within the one-mile detour limit.');
    }

    selectedStations.push(selectedStation);
    currentWaypoint = selectedStation.station.coordinates;
    safeRangeMeters = fullTankSafeRangeMeters;
  }

  const gasStops: CommuteStop[] = selectedStations.map(({ station, fuelPrice }) => ({
    id: station.id,
    name: station.name,
    address: station.address,
    type: 'gas',
    coordinates: station.coordinates,
    pricePerGallon: fuelPrice.pricePerGallon,
    priceUpdatedAt: fuelPrice.priceUpdatedAt,
    fuelType: fuelPrice.fuelType,
    googleMapsUri: station.googleMapsUri,
  }));
  const destinationStop: CommuteStop = {
    ...request.destination,
    type: 'destination',
  };
  const stops = [...gasStops, destinationStop];
  const finalRoute = await getRoadRoute([
    request.origin,
    ...stops.map((stop) => stop.coordinates),
  ], signal);
  if (finalRoute.distanceMeters > MAX_COMMUTE_ROUTE_MILES * METERS_PER_MILE) {
    throw new Error(`The final route exceeds the ${MAX_COMMUTE_ROUTE_MILES.toLocaleString()}-mile limit.`);
  }
  const originId = 'commute-origin';
  const stopIds = [originId, ...stops.map((stop) => stop.id)];
  const legs = finalRoute.legs.map((leg, index) => ({
    fromStopId: stopIds[index],
    toStopId: stopIds[index + 1],
    ...leg,
  }));

  legs.forEach((leg, index) => {
    const allowedRangeMeters = index === 0 ? initialSafeRangeMeters : fullTankSafeRangeMeters;
    if (leg.distanceMeters > allowedRangeMeters) {
      throw new Error('The final route could not satisfy the requested fuel-range reserve.');
    }
  });

  return {
    version: 1,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + COMMUTE_PLAN_RETENTION_DAYS * 24 * 60 * 60 * 1_000).toISOString(),
    fuelGrade: request.fuelGrade,
    initialRangeMiles: request.currentRangeMiles,
    fullTankRangeMiles: request.fullTankRangeMiles,
    currentRangeMiles: request.currentRangeMiles,
    origin: {
      id: originId,
      name: 'Starting location',
      address: 'Current location when route was planned',
      type: 'user',
      coordinates: request.origin,
    },
    destination: request.destination,
    stops,
    legs,
    routeGeometry: finalRoute.geometry,
    totalDistanceMeters: finalRoute.distanceMeters,
    totalDurationSeconds: finalRoute.durationSeconds,
    currentStopIndex: 0,
    status: 'active',
  };
};
