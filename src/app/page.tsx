'use client';

import { getLiveGasStations } from '@/GasPrices/client';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import { useEffect, useMemo, useRef, useState } from 'react';

import { buildTripPlan } from '@/features/map/components/routing-engine';
import { getRouteMetrics, haversineDistance } from '@/lib/routingUtils';
import { useLocationStore } from '@/store/useLocationStore';
import { FuelGrade, FuelPriceOption, GasStation, RouteLegEstimate, TripEstimateSummary } from '@/types';

const PriceMap = dynamic(() => import('@/features/map/components/PriceMap').then(mod => mod.PriceMap), { ssr: false });

const legendMarker = (fill: string, stroke: string, innerFill: string) =>
  `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="34" viewBox="0 0 24 34">
      <path fill="${fill}" stroke="${stroke}" stroke-width="1.5" d="M12 1C6.48 1 2 5.48 2 11c0 7.33 10 21 10 21s10-13.67 10-21C22 5.48 17.52 1 12 1z"/>
      <circle cx="12" cy="11" r="3.5" fill="${innerFill}"/>
    </svg>
  `)}`;

const gasPriceLegendMarker = (priceLabel: string) =>
  `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="74" height="56" viewBox="0 0 74 56">
      <rect x="7" y="4" width="60" height="24" rx="12" fill="#0f172a" stroke="rgba(255,255,255,0.88)" stroke-width="1.2"/>
      <text x="37" y="20" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="11" font-weight="700" fill="#ffffff">${priceLabel}</text>
      <circle cx="37" cy="40" r="7" fill="#ef4444" stroke="#ffffff" stroke-width="2"/>
    </svg>
  `)}`;

const legendItems = [
  {
    label: 'Your location',
    icon: legendMarker('#16a34a', '#166534', '#eafff0'),
  },
  {
    label: 'Gas station',
    icon: gasPriceLegendMarker('$4.48'),
  },
];

interface GasStationWithDistance extends GasStation {
  distanceMiles: number | null;
  economapScore: number | null;
}

type GasSortMode = 'best' | 'price' | 'distance';

const FUEL_GRADE_OPTIONS: { value: FuelGrade; label: string }[] = [
  { value: 'regular', label: 'Regular' },
  { value: 'midgrade', label: 'Midgrade' },
  { value: 'premium', label: 'Premium' },
  { value: 'diesel', label: 'Diesel' },
];

const METERS_PER_MILE = 1_609.34;
const MIN_SEARCH_RADIUS_MILES = 2;
const MAX_SEARCH_RADIUS_MILES = 15;
const DEFAULT_SEARCH_RADIUS_MILES = 7;
const SECONDS_PER_MINUTE = 60;
const GAS_CACHE_LOCATION_PRECISION = 3;
const DIRECT_DISTANCE_WEIGHT = 0.1;

interface CachedGasStationsEntry {
  fetchedRadiusMeters: number;
  stations: GasStation[];
}

const formatMiles = (distanceMeters: number) => `${(distanceMeters / METERS_PER_MILE).toFixed(1)} mi`;
const buildGasCacheKey = (latitude: number, longitude: number) =>
  `${latitude.toFixed(GAS_CACHE_LOCATION_PRECISION)}:${longitude.toFixed(GAS_CACHE_LOCATION_PRECISION)}`;

const formatFuelGradeLabel = (fuelGrade: FuelGrade) =>
  FUEL_GRADE_OPTIONS.find((option) => option.value === fuelGrade)?.label ?? fuelGrade;

const formatUpdatedTime = (timestamp?: string) => {
  if (!timestamp) {
    return null;
  }

  const parsedDate = new Date(timestamp);

  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsedDate);
};

const formatDuration = (durationSeconds: number) => {
  const roundedMinutes = Math.max(1, Math.round(durationSeconds / SECONDS_PER_MINUTE));
  const hours = Math.floor(roundedMinutes / 60);
  const minutes = roundedMinutes % 60;

  if (hours === 0) {
    return `${roundedMinutes} min`;
  }

  if (minutes === 0) {
    return `${hours} hr`;
  }

  return `${hours} hr ${minutes} min`;
};

export default function Home() {
  const { latitude, longitude, setLocation } = useLocationStore();

  const [locationErrorMessage, setLocationErrorMessage] = useState<string | null>(null);
  const [hasSearchedGas, setHasSearchedGas] = useState(false);
  const [selectedGasStationId, setSelectedGasStationId] = useState<string | null>(null);
  const [selectedFuelGrade, setSelectedFuelGrade] = useState<FuelGrade>('regular');
  const [searchRadiusMiles, setSearchRadiusMiles] = useState(DEFAULT_SEARCH_RADIUS_MILES);
  const [isBestGasExpanded, setIsBestGasExpanded] = useState(true);
  const [gasSortMode, setGasSortMode] = useState<GasSortMode>('best');
  const [tripEstimateSummary, setTripEstimateSummary] = useState<TripEstimateSummary | null>(null);
  const [isTripEstimateLoading, setIsTripEstimateLoading] = useState(false);
  const [gasStationsInRadius, setGasStationsInRadius] = useState<GasStation[]>([]);
  const [gasStationsErrorMessage, setGasStationsErrorMessage] = useState<string | null>(null);
  const [isGasStationsLoading, setIsGasStationsLoading] = useState(false);
  const gasStationsCacheRef = useRef<Map<string, CachedGasStationsEntry>>(new Map());

  const searchRadiusMeters = useMemo(
    () => searchRadiusMiles * METERS_PER_MILE,
    [searchRadiusMiles]
  );
  const userLocation = useMemo(
    () => (latitude !== null && longitude !== null ? { lat: latitude, lng: longitude } : null),
    [latitude, longitude]
  );

  const gasStationsForSelectedFuel = useMemo(() => {
    return gasStationsInRadius.flatMap((station) => {
      const selectedFuelPrice: FuelPriceOption | null =
        station.fuelPrices?.[selectedFuelGrade]
        ?? (
          selectedFuelGrade === 'regular'
            ? {
                fuelType: station.fuelType ?? 'REGULAR_UNLEADED',
                pricePerGallon: station.pricePerGallon,
                priceUpdatedAt: station.priceUpdatedAt,
              }
            : null
        );

      if (!selectedFuelPrice) {
        return [];
      }

      return [{
        ...station,
        fuelType: selectedFuelPrice.fuelType,
        pricePerGallon: selectedFuelPrice.pricePerGallon,
        priceUpdatedAt: selectedFuelPrice.priceUpdatedAt,
      }];
    });
  }, [gasStationsInRadius, selectedFuelGrade]);

  const gasStationsWithDistance: GasStationWithDistance[] = useMemo(() => {
    return gasStationsForSelectedFuel.map((station) => {
      const distanceMiles = userLocation
        ? haversineDistance(
            userLocation.lat,
            userLocation.lng,
            station.coordinates.lat,
            station.coordinates.lng
          ) / METERS_PER_MILE
        : null;

      return {
        ...station,
        distanceMiles,
        economapScore: distanceMiles === null
          ? null
          : distanceMiles * DIRECT_DISTANCE_WEIGHT + station.pricePerGallon,
      };
    });
  }, [gasStationsForSelectedFuel, userLocation]);

  const gasStationsToDisplay = useMemo(() => {
    const comparableStations = gasStationsWithDistance.filter(
      (station): station is GasStationWithDistance & { distanceMiles: number; economapScore: number } =>
        station.distanceMiles !== null && station.economapScore !== null
    );

    if (comparableStations.length === 0) {
      return gasStationsWithDistance;
    }

    if (gasSortMode === 'price') {
      return [...comparableStations].sort((a, b) => {
        if (a.pricePerGallon !== b.pricePerGallon) {
          return a.pricePerGallon - b.pricePerGallon;
        }

        return a.distanceMiles - b.distanceMiles;
      });
    }

    if (gasSortMode === 'distance') {
      return [...comparableStations].sort((a, b) => {
        if (a.distanceMiles !== b.distanceMiles) {
          return a.distanceMiles - b.distanceMiles;
        }

        return a.pricePerGallon - b.pricePerGallon;
      });
    }

    return [...comparableStations].sort((a, b) => {
      if (a.economapScore !== b.economapScore) {
        return a.economapScore - b.economapScore;
      }

      return a.pricePerGallon - b.pricePerGallon;
    });
  }, [gasSortMode, gasStationsWithDistance]);

  const activeSelectedGasStationId = useMemo(
    () => (
      selectedGasStationId && gasStationsToDisplay.some((station) => station.id === selectedGasStationId)
        ? selectedGasStationId
        : null
    ),
    [selectedGasStationId, gasStationsToDisplay]
  );

  const selectedGasStation = useMemo(
    () => gasStationsToDisplay.find(station => station.id === activeSelectedGasStationId) ?? null,
    [activeSelectedGasStationId, gasStationsToDisplay]
  );

  const tripPlan = useMemo(
    () => buildTripPlan({
      userLocation,
      selectedStore: null,
      gasStations: selectedGasStation ? [selectedGasStation] : [],
      hasSelectedGroceries: false,
      shouldGetGas: selectedGasStation !== null,
    }),
    [selectedGasStation, userLocation]
  );

  const dynamicWaypoints = useMemo(
    () => {
      if (tripPlan?.orderedStops.length) {
        return tripPlan.orderedStops.map(stop => stop.coordinates);
      }

      return [];
    },
    [tripPlan]
  );

  useEffect(() => {
    if (!hasSearchedGas || latitude === null || longitude === null) {
      setGasStationsInRadius([]);
      setGasStationsErrorMessage(null);
      setIsGasStationsLoading(false);
      return;
    }

    let isActive = true;
    const abortController = new AbortController();
    const gasCacheKey = buildGasCacheKey(latitude, longitude);
    const cachedGasStations = gasStationsCacheRef.current.get(gasCacheKey);

    if (cachedGasStations) {
      const locallyFilteredStations = cachedGasStations.stations.filter((station) => {
        const distanceFromUserMeters = haversineDistance(
          latitude,
          longitude,
          station.coordinates.lat,
          station.coordinates.lng
        );

        return distanceFromUserMeters <= searchRadiusMeters;
      });

      setGasStationsInRadius(locallyFilteredStations);

      if (cachedGasStations.fetchedRadiusMeters >= searchRadiusMeters) {
        setGasStationsErrorMessage(null);
        setIsGasStationsLoading(false);
        return;
      }
    }

    const loadGasStations = async () => {
      setGasStationsErrorMessage(null);
      setIsGasStationsLoading(true);

      try {
        const stations = await getLiveGasStations({
          latitude,
          longitude,
          radiusMeters: searchRadiusMeters,
          signal: abortController.signal,
        });

        if (!isActive) {
          return;
        }

        gasStationsCacheRef.current.set(gasCacheKey, {
          fetchedRadiusMeters: searchRadiusMeters,
          stations,
        });
        setGasStationsInRadius(stations);
      } catch (error) {
        if (!isActive || abortController.signal.aborted) {
          return;
        }

        setGasStationsErrorMessage(
          error instanceof Error ? error.message : 'Unable to load live gas station prices.'
        );
      } finally {
        if (isActive) {
          setIsGasStationsLoading(false);
        }
      }
    };

    void loadGasStations();

    return () => {
      isActive = false;
      abortController.abort();
    };
  }, [hasSearchedGas, latitude, longitude, searchRadiusMeters]);

  useEffect(() => {
    if (!tripPlan || tripPlan.orderedStops.length < 2) {
      setTripEstimateSummary(null);
      setIsTripEstimateLoading(false);
      return;
    }

    let isActive = true;

    const buildEstimateSummary = async () => {
      setTripEstimateSummary(null);
      setIsTripEstimateLoading(true);

      try {
        const legSummaries = await Promise.all(
          tripPlan.orderedStops.slice(1).map(async (stop, index) => {
            const previousStop = tripPlan.orderedStops[index];
            const metrics = await getRouteMetrics([
              previousStop.coordinates,
              stop.coordinates,
            ]);

            const leg: RouteLegEstimate = {
              fromStopId: previousStop.id,
              toStopId: stop.id,
              distanceMeters: metrics.distanceMeters,
              durationSeconds: metrics.durationSeconds,
            };

            return leg;
          })
        );

        const finalStop = tripPlan.orderedStops[tripPlan.orderedStops.length - 1];
        const startStop = tripPlan.orderedStops[0];
        const returnMetrics = await getRouteMetrics([
          finalStop.coordinates,
          startStop.coordinates,
        ]);

        if (!isActive) {
          return;
        }

        setTripEstimateSummary({
          legs: legSummaries,
          returnToStart: {
            fromStopId: finalStop.id,
            toStopId: startStop.id,
            distanceMeters: returnMetrics.distanceMeters,
            durationSeconds: returnMetrics.durationSeconds,
          },
        });
      } finally {
        if (isActive) {
          setIsTripEstimateLoading(false);
        }
      }
    };

    void buildEstimateSummary();

    return () => {
      isActive = false;
    };
  }, [tripPlan]);

  useEffect(() => {
    if (!navigator.geolocation) {
      return;
    }

    navigator.geolocation.getCurrentPosition(
      position => {
        setLocationErrorMessage(null);
        setLocation(position.coords.latitude, position.coords.longitude);
      },
      error => {
        const fallbackMessage =
          error.code === error.PERMISSION_DENIED
            ? 'Location access was denied. Enable it in your browser to search nearby gas stations.'
            : 'We could not determine your location. Check your browser settings and try again.';

        setLocationErrorMessage(fallbackMessage);
      }
    );
  }, [setLocation]);

  const handleFindGasClick = () => {
    setSelectedGasStationId(null);
    setHasSearchedGas(true);
  };

  const handleGasStationMapClick = (id: string) => {
    setSelectedGasStationId(id);
  };

  const handleGasStationListClick = (id: string) => {
    setSelectedGasStationId(id);
    const mapElement = document.getElementById('price-map');

    if (mapElement) {
      mapElement.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-start overflow-hidden bg-background px-4 py-6 font-sans text-foreground md:px-8 md:py-10">
      <div className="relative z-10 flex w-full flex-col items-center">
        <h1 className="mb-6 flex items-center justify-center gap-3 text-center text-3xl font-semibold tracking-tight text-white md:mb-8 md:text-5xl">
          <Image src="/AppIcon.png" alt="Go Go Gas! icon" width={80} height={80} className="h-16 w-16 rounded-xl md:h-20 md:w-20" />
          <span className="brand-title">Go Go Gas!</span>
        </h1>

        <div className="flex w-full max-w-6xl flex-col gap-6 md:flex-row md:gap-8">
          <div className="flex w-full flex-col items-center">
            <div id="price-map" className="relative z-10 h-[420px] w-full overflow-hidden rounded-2xl border border-white/70 bg-white/80 shadow-[0_20px_60px_-20px_rgba(15,23,42,0.35)] backdrop-blur md:h-[560px]">
              <PriceMap
                stores={[]}
                onStoreClick={() => undefined}
                onGasStationClick={handleGasStationMapClick}
                selectedGasStationId={activeSelectedGasStationId}
                waypoints={dynamicWaypoints}
                gasStations={hasSearchedGas ? gasStationsToDisplay : []}
                locationErrorMessage={locationErrorMessage}
              />
            </div>

            <div className="relative z-0 -mt-10 mb-6 w-full rounded-[0_0_1.5rem_1.5rem] border border-white/80 bg-white/95 px-4 pb-4 pt-14 shadow-[0_18px_36px_-24px_rgba(15,23,42,0.55)] backdrop-blur md:px-5 md:pt-16">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Fuel Grade</h2>
                  <p className="mt-1 text-sm text-slate-600">Switch prices and recommendations without reloading the area search.</p>
                </div>
                <div className="grid w-full grid-cols-2 gap-2 md:w-auto md:grid-cols-4">
                  {FUEL_GRADE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setSelectedFuelGrade(option.value)}
                      className={`rounded-full px-4 py-2.5 text-sm font-semibold ring-1 transition-colors duration-200 ${
                        selectedFuelGrade === option.value
                          ? 'bg-primary text-primary-foreground ring-emerald-200/70 shadow-[0_10px_24px_-12px_rgba(13,148,136,0.8)]'
                          : 'bg-slate-100 text-slate-700 ring-slate-200 hover:bg-slate-200'
                      }`}
                      aria-pressed={selectedFuelGrade === option.value}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="mb-4 flex w-full max-w-xl justify-center px-2">
              <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 rounded-full border border-white/70 bg-white/90 px-5 py-3 shadow-lg backdrop-blur">
                {legendItems.map(item => (
                  <div key={item.label} className="flex items-center gap-2">
                    <Image
                      src={item.icon}
                      alt=""
                      aria-hidden="true"
                      width={item.label === 'Gas station' ? 74 : 20}
                      height={item.label === 'Gas station' ? 56 : 28}
                      className={item.label === 'Gas station' ? 'h-10 w-[3.75rem]' : 'h-7 w-5'}
                    />
                    <span className="text-sm font-medium text-slate-700">{item.label}</span>
                  </div>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={handleFindGasClick}
              disabled={latitude === null || longitude === null || isGasStationsLoading}
              className="mb-4 w-full max-w-sm rounded-full bg-blue-600 px-6 py-3 text-center text-sm font-semibold text-white shadow-[0_12px_30px_-12px_rgba(37,99,235,0.8)] ring-1 ring-blue-200/70 transition-transform duration-300 ease-in-out hover:scale-[1.02] hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 md:text-base"
            >
              {isGasStationsLoading ? 'Finding Gas...' : 'Find Gas'}
            </button>

            {(tripPlan || isTripEstimateLoading) && (
              <div className="mb-4 w-full max-w-xl px-2">
                <div className="rounded-2xl border border-white/70 bg-white/90 p-5 shadow-lg backdrop-blur">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <h2 className="text-base font-semibold text-slate-900 md:text-lg">Trip Estimates</h2>
                      <p className="text-sm text-slate-500">Drive time and distance to the selected station, plus the hidden return trip home.</p>
                    </div>
                    {isTripEstimateLoading && (
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-600">
                        Calculating...
                      </span>
                    )}
                  </div>

                  {tripPlan && tripEstimateSummary && (
                    <div className="mt-4 space-y-3">
                      {tripEstimateSummary.legs.map((leg, index) => {
                        const destinationStop = tripPlan.orderedStops[index + 1];

                        return (
                          <div key={`${leg.fromStopId}-${leg.toStopId}`} className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                                Stop {index + 1}
                              </p>
                              <p className="text-sm font-medium text-slate-900">Drive to gas station</p>
                              <p className="text-sm text-slate-500">{destinationStop.name}</p>
                              <p className="text-sm text-slate-500">{destinationStop.address}</p>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-semibold text-slate-900">{formatMiles(leg.distanceMeters)}</p>
                              <p className="text-sm text-slate-500">{formatDuration(leg.durationSeconds)}</p>
                            </div>
                          </div>
                        );
                      })}

                      {tripEstimateSummary.returnToStart && (
                        <div className="flex items-center justify-between gap-4 rounded-xl border border-dashed border-slate-300 bg-slate-50/80 px-4 py-3">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                              Return
                            </p>
                            <p className="text-sm font-medium text-slate-900">Estimated drive back home</p>
                            <p className="text-sm text-slate-500">Hidden from the map route</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-semibold text-slate-900">
                              {formatMiles(tripEstimateSummary.returnToStart.distanceMeters)}
                            </p>
                            <p className="text-sm text-slate-500">
                              {formatDuration(tripEstimateSummary.returnToStart.durationSeconds)}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="mb-4 w-full max-w-xl px-2">
              <div className="rounded-2xl border border-white/70 bg-white/90 p-5 shadow-lg backdrop-blur">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900 md:text-lg">Search Radius</h2>
                    <p className="text-sm text-slate-500">Show gas stations within your selected distance.</p>
                  </div>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">
                    {searchRadiusMiles} mi
                  </span>
                </div>
                <input
                  type="range"
                  min={MIN_SEARCH_RADIUS_MILES}
                  max={MAX_SEARCH_RADIUS_MILES}
                  step={1}
                  value={searchRadiusMiles}
                  onChange={(event) => setSearchRadiusMiles(Number(event.target.value))}
                  className="mt-4 h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-primary"
                />
                <div className="mt-2 flex justify-between text-xs font-medium uppercase tracking-[0.16em] text-slate-400">
                  <span>{MIN_SEARCH_RADIUS_MILES} miles</span>
                  <span>{MAX_SEARCH_RADIUS_MILES} miles</span>
                </div>
                <p className="mt-4 text-sm text-slate-600">
                  {hasSearchedGas
                    ? `Showing ${gasStationsToDisplay.length} stations with ${formatFuelGradeLabel(selectedFuelGrade).toLowerCase()} prices within ${searchRadiusMiles} miles.`
                    : 'Choose a radius, then find nearby gas stations with live prices.'}
                </p>
                {isGasStationsLoading && (
                  <p className="mt-2 text-sm text-slate-500">Loading live gas station prices...</p>
                )}
                {gasStationsErrorMessage && (
                  <p className="mt-2 text-sm text-rose-600">{gasStationsErrorMessage}</p>
                )}
                {hasSearchedGas && !isGasStationsLoading && gasStationsInRadius.length > 0 && gasStationsToDisplay.length === 0 && (
                  <p className="mt-2 text-sm text-slate-500">
                    No stations in this search area currently expose a {formatFuelGradeLabel(selectedFuelGrade).toLowerCase()} price.
                  </p>
                )}
              </div>
            </div>

            {!hasSearchedGas && (
              <div className="mt-4 w-full max-w-md rounded-2xl border border-white/70 bg-white/90 p-5 shadow-lg backdrop-blur animate-fade-in">
                <p className="text-center text-base text-slate-700 md:text-lg">Use your current location to find gas stations nearby.</p>
              </div>
            )}

            {hasSearchedGas && gasStationsToDisplay.length > 0 && (
              <div className="mt-6 w-full max-w-md rounded-2xl border border-white/70 bg-white/90 p-5 shadow-lg backdrop-blur animate-fade-in">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-semibold text-slate-900 md:text-2xl">Best Gas Stations</h2>
                    <p className="text-sm text-slate-500">
                      {gasStationsToDisplay.length} station{gasStationsToDisplay.length === 1 ? '' : 's'} in your current search radius.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsBestGasExpanded((currentValue) => !currentValue)}
                    className="rounded-full bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-800 ring-1 ring-slate-300 transition-colors duration-200 hover:bg-slate-300"
                    aria-expanded={isBestGasExpanded}
                  >
                    {isBestGasExpanded ? 'Collapse' : 'Expand'}
                  </button>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {[
                    { label: 'Economap Best Choice', value: 'best' as const },
                    { label: 'Lowest Price', value: 'price' as const },
                    { label: 'Lowest Distance', value: 'distance' as const },
                  ].map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setGasSortMode(option.value)}
                      className={`rounded-full px-4 py-2 text-sm font-semibold ring-1 transition-colors duration-200 ${
                        gasSortMode === option.value
                          ? 'bg-primary text-primary-foreground ring-emerald-200/70 shadow-[0_10px_24px_-12px_rgba(13,148,136,0.8)]'
                          : 'bg-slate-100 text-slate-700 ring-slate-200 hover:bg-slate-200'
                      }`}
                      aria-pressed={gasSortMode === option.value}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                {isBestGasExpanded && (
                  <ul className="mt-4 space-y-3">
                    {gasStationsToDisplay.map(station => (
                      <li key={station.id} className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <h3 className="truncate text-base font-medium text-slate-900 md:text-lg">{station.name}</h3>
                          <p className="truncate text-sm text-slate-500">{station.address}</p>
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-slate-500">
                            {station.distanceMiles !== null && (
                              <span>{station.distanceMiles.toFixed(1)} miles away</span>
                            )}
                            <span>{formatFuelGradeLabel(selectedFuelGrade)}</span>
                            {station.priceUpdatedAt && (
                              <span>Updated {formatUpdatedTime(station.priceUpdatedAt)}</span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-3 sm:justify-end">
                          <span className="text-lg font-bold text-primary">${station.pricePerGallon.toFixed(2)}/gal</span>
                          <button
                            type="button"
                            onClick={() => handleGasStationListClick(station.id)}
                            className={`rounded-full px-4 py-2 text-sm font-semibold ring-1 ring-black/10 transition-all duration-300 ease-in-out ${activeSelectedGasStationId === station.id ? 'bg-primary text-primary-foreground shadow-[0_10px_24px_-12px_rgba(13,148,136,0.8)]' : 'bg-slate-200 text-slate-800 shadow-[0_10px_24px_-16px_rgba(15,23,42,0.35)] hover:bg-slate-300'}`}
                          >
                            {activeSelectedGasStationId === station.id ? 'Selected' : 'Select'}
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {hasSearchedGas && !isGasStationsLoading && gasStationsToDisplay.length === 0 && !gasStationsErrorMessage && (
              <div className="mt-6 w-full max-w-md rounded-2xl border border-white/70 bg-white/90 p-5 shadow-lg backdrop-blur animate-fade-in">
                <p className="text-center text-base text-slate-700 md:text-lg">No gas stations with live prices were found in this radius.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
