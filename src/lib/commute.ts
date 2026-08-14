import { CommutePlan, RouteWaypoint } from '@/types';

export const METERS_PER_MILE = 1_609.34;
export const COMMUTE_ARRIVAL_RADIUS_METERS = 0.25 * METERS_PER_MILE;
export const MAX_COMMUTE_ROUTE_MILES = 2_000;
export const MAX_COMMUTE_GAS_STOPS = 8;
export const COMMUTE_PLAN_RETENTION_DAYS = 7;

export const getRangeReserveMiles = (rangeMiles: number) =>
  Math.min(50, Math.max(5, rangeMiles * 0.15));

export const getSafeRangeMiles = (rangeMiles: number) =>
  Math.max(0, rangeMiles - getRangeReserveMiles(rangeMiles));

export const getNextCommuteStop = (plan: CommutePlan) =>
  plan.stops[plan.currentStopIndex] ?? null;

export const getLegAfterCurrentStop = (plan: CommutePlan) =>
  plan.legs[plan.currentStopIndex + 1] ?? null;

export const isRouteWaypoint = (value: unknown): value is RouteWaypoint => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const waypoint = value as Partial<RouteWaypoint>;
  return Number.isFinite(waypoint.lat)
    && Number.isFinite(waypoint.lng)
    && (waypoint.lat ?? 91) >= -90
    && (waypoint.lat ?? -91) <= 90
    && (waypoint.lng ?? 181) >= -180
    && (waypoint.lng ?? -181) <= 180;
};

export const isCommutePlan = (value: unknown): value is CommutePlan => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const plan = value as Partial<CommutePlan>;
  const validStops = Array.isArray(plan.stops)
    && plan.stops.length > 0
    && plan.stops.every((stop) => (
      stop
      && typeof stop.id === 'string'
      && typeof stop.name === 'string'
      && typeof stop.address === 'string'
      && (stop.type === 'gas' || stop.type === 'destination')
      && isRouteWaypoint(stop.coordinates)
    ));
  const stopCount = Array.isArray(plan.stops) ? plan.stops.length : 0;
  const validLegs = Array.isArray(plan.legs)
    && plan.legs.length === plan.stops?.length
    && plan.legs.every((leg) => (
      leg
      && typeof leg.fromStopId === 'string'
      && typeof leg.toStopId === 'string'
      && Number.isFinite(leg.distanceMeters)
      && leg.distanceMeters >= 0
      && Number.isFinite(leg.durationSeconds)
      && leg.durationSeconds >= 0
    ));
  const expiresAt = Date.parse(plan.expiresAt ?? '');
  return plan.version === 1
    && typeof plan.id === 'string'
    && typeof plan.createdAt === 'string'
    && Number.isFinite(expiresAt)
    && expiresAt > Date.now()
    && isRouteWaypoint(plan.origin?.coordinates)
    && isRouteWaypoint(plan.destination?.coordinates)
    && validStops
    && validLegs
    && Array.isArray(plan.routeGeometry)
    && plan.routeGeometry.length >= 2
    && plan.routeGeometry.every(isRouteWaypoint)
    && Number.isInteger(plan.currentStopIndex)
    && (plan.currentStopIndex ?? -1) >= 0
    && (plan.currentStopIndex ?? 0) < stopCount
    && Number.isFinite(plan.currentRangeMiles)
    && Number.isFinite(plan.fullTankRangeMiles)
    && Number.isFinite(plan.totalDistanceMeters)
    && Number.isFinite(plan.totalDurationSeconds)
    && ['active', 'awaiting_range', 'completed'].includes(plan.status ?? '');
};
