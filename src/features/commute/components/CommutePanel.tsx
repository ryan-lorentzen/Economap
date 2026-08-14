'use client';

import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Fuel, LoaderCircle, MapPin, Navigation, Route, Trash2 } from 'lucide-react';

import {
  createCommutePlan,
  DestinationSuggestion,
  resolveDestinationSuggestion,
  searchDestinationSuggestions,
} from '@/Commute/client';
import {
  getLegAfterCurrentStop,
  getNextCommuteStop,
  getSafeRangeMiles,
  METERS_PER_MILE,
} from '@/lib/commute';
import { getWebDirectionsUrl, openPreferredDirections } from '@/lib/mapLinks';
import { useCommuteStore } from '@/store/useCommuteStore';
import { FuelGrade, GeocodedDestination, RouteWaypoint } from '@/types';

const FUEL_GRADE_OPTIONS: { value: FuelGrade; label: string }[] = [
  { value: 'regular', label: 'Regular' },
  { value: 'midgrade', label: 'Midgrade' },
  { value: 'premium', label: 'Premium' },
  { value: 'diesel', label: 'Diesel' },
];

const formatMiles = (distanceMeters: number) => `${(distanceMeters / METERS_PER_MILE).toFixed(1)} mi`;
const createSessionToken = () => crypto.randomUUID();

const formatDuration = (seconds: number) => {
  const minutes = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return hours === 0 ? `${minutes} min` : `${hours} hr${remainingMinutes ? ` ${remainingMinutes} min` : ''}`;
};

interface CommutePanelProps {
  origin: RouteWaypoint | null;
  locationErrorMessage: string | null;
  onPlanReady: () => void;
  onViewMap: () => void;
}

export const CommutePanel = ({
  origin,
  locationErrorMessage,
  onPlanReady,
  onViewMap,
}: CommutePanelProps) => {
  const { plan, hasHydrated, setPlan, clearPlan, acceptRangeAndAdvance } = useCommuteStore();
  const [address, setAddress] = useState('');
  const [currentRange, setCurrentRange] = useState('');
  const [fullTankRange, setFullTankRange] = useState('');
  const [fuelGrade, setFuelGrade] = useState<FuelGrade>('regular');
  const [destinationSuggestions, setDestinationSuggestions] = useState<DestinationSuggestion[]>([]);
  const [selectedDestination, setSelectedDestination] = useState<GeocodedDestination | null>(null);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
  const [sessionToken, setSessionToken] = useState(createSessionToken);
  const [isSearchingAddress, setIsSearchingAddress] = useState(false);
  const [isResolvingAddress, setIsResolvingAddress] = useState(false);
  const [isPlanning, setIsPlanning] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [arrivalRange, setArrivalRange] = useState('');
  const autocompleteControllerRef = useRef<AbortController | null>(null);
  const resolveControllerRef = useRef<AbortController | null>(null);
  const planningControllerRef = useRef<AbortController | null>(null);
  const nextStop = plan ? getNextCommuteStop(plan) : null;
  const gasStopCount = plan?.stops.filter((stop) => stop.type === 'gas').length ?? 0;
  const safeCurrentRange = useMemo(() => {
    const range = Number(currentRange);
    return Number.isFinite(range) && range > 0 ? getSafeRangeMiles(range) : null;
  }, [currentRange]);

  useEffect(() => {
    const trimmedAddress = address.trim();
    if (selectedDestination || isResolvingAddress || trimmedAddress.length < 3) {
      autocompleteControllerRef.current?.abort();
      setDestinationSuggestions([]);
      setActiveSuggestionIndex(-1);
      setIsSearchingAddress(false);
      return;
    }

    const controller = new AbortController();
    autocompleteControllerRef.current?.abort();
    autocompleteControllerRef.current = controller;
    const timeoutId = window.setTimeout(async () => {
      setIsSearchingAddress(true);
      try {
        const suggestions = await searchDestinationSuggestions(
          trimmedAddress,
          sessionToken,
          origin,
          controller.signal
        );
        setDestinationSuggestions(suggestions);
        setActiveSuggestionIndex(suggestions.length > 0 ? 0 : -1);
      } catch (error) {
        if (!controller.signal.aborted) {
          setDestinationSuggestions([]);
          setErrorMessage(error instanceof Error ? error.message : 'Unable to load address suggestions.');
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsSearchingAddress(false);
        }
      }
    }, 350);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [address, isResolvingAddress, origin, selectedDestination, sessionToken]);

  const selectSuggestion = async (suggestion: DestinationSuggestion) => {
    autocompleteControllerRef.current?.abort();
    resolveControllerRef.current?.abort();
    const controller = new AbortController();
    resolveControllerRef.current = controller;
    setAddress(suggestion.text);
    setDestinationSuggestions([]);
    setActiveSuggestionIndex(-1);
    setErrorMessage(null);
    setIsResolvingAddress(true);

    try {
      const destination = await resolveDestinationSuggestion(
        suggestion.placeId,
        suggestion.mainText,
        sessionToken,
        controller.signal
      );
      setAddress(destination.address);
      setSelectedDestination(destination);
    } catch (error) {
      if (!controller.signal.aborted) {
        setSelectedDestination(null);
        setErrorMessage(error instanceof Error ? error.message : 'Unable to resolve that address.');
      }
    } finally {
      if (!controller.signal.aborted) {
        setIsResolvingAddress(false);
      }
    }
  };

  const handleAddressKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (destinationSuggestions.length === 0) {
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveSuggestionIndex((current) => (current + 1) % destinationSuggestions.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveSuggestionIndex((current) => (
        current <= 0 ? destinationSuggestions.length - 1 : current - 1
      ));
    } else if (event.key === 'Enter' && activeSuggestionIndex >= 0) {
      event.preventDefault();
      void selectSuggestion(destinationSuggestions[activeSuggestionIndex]);
    } else if (event.key === 'Escape') {
      setDestinationSuggestions([]);
      setActiveSuggestionIndex(-1);
    }
  };

  const planToDestination = async (destination: GeocodedDestination) => {
    if (!origin) {
      setErrorMessage(locationErrorMessage ?? 'Your current location is required to plan a route.');
      return;
    }

    const currentRangeMiles = Number(currentRange);
    const fullTankRangeMiles = Number(fullTankRange);
    if (
      !Number.isFinite(currentRangeMiles)
      || !Number.isFinite(fullTankRangeMiles)
      || currentRangeMiles <= 5
      || fullTankRangeMiles <= 5
    ) {
      setErrorMessage('Enter current and full-tank ranges greater than 5 miles.');
      return;
    }

    planningControllerRef.current?.abort();
    const controller = new AbortController();
    planningControllerRef.current = controller;
    setErrorMessage(null);
    setIsPlanning(true);

    try {
      const nextPlan = await createCommutePlan({
        origin,
        destination,
        currentRangeMiles,
        fullTankRangeMiles,
        fuelGrade,
      }, controller.signal);
      setPlan(nextPlan);
      onPlanReady();
    } catch (error) {
      if (!controller.signal.aborted) {
        setErrorMessage(error instanceof Error ? error.message : 'Unable to plan a safe route.');
      }
    } finally {
      if (!controller.signal.aborted) {
        setIsPlanning(false);
      }
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedDestination) {
      setErrorMessage('Choose a destination from the address suggestions first.');
      return;
    }

    void planToDestination(selectedDestination);
  };

  const handleArrivalRange = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!plan) {
      return;
    }

    const rangeMiles = Number(arrivalRange);
    const nextLeg = getLegAfterCurrentStop(plan);
    if (!Number.isFinite(rangeMiles) || rangeMiles <= 5) {
      setErrorMessage('Enter an estimated range greater than 5 miles.');
      return;
    }

    if (nextLeg && getSafeRangeMiles(rangeMiles) * METERS_PER_MILE < nextLeg.distanceMeters) {
      setErrorMessage(
        `That range is not enough to safely cover the next ${formatMiles(nextLeg.distanceMeters)} leg. Add fuel and enter the updated range.`
      );
      return;
    }

    setErrorMessage(null);
    setArrivalRange('');
    acceptRangeAndAdvance(rangeMiles);
    const followingStop = plan.stops[Math.min(plan.currentStopIndex + 1, plan.stops.length - 1)];
    if (followingStop) {
      openPreferredDirections(followingStop);
    }
  };

  if (!hasHydrated) {
    return (
      <div className="w-full rounded-2xl border border-white/70 bg-white/90 p-6 text-center shadow-lg backdrop-blur">
        <p className="text-sm font-medium text-slate-600">Loading your saved commute...</p>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-5">
      <section className="overflow-hidden rounded-2xl border border-white/70 bg-white/95 shadow-xl backdrop-blur">
        <div className="bg-gradient-to-br from-blue-700 via-blue-600 to-cyan-500 px-6 py-6 text-white">
          <div className="flex items-center gap-3">
            <span className="rounded-xl bg-white/15 p-3 ring-1 ring-white/20"><Route aria-hidden="true" size={24} /></span>
            <div>
              <h2 className="text-2xl font-semibold">Plan a fuel-smart route</h2>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 p-6">
          <div>
            <label htmlFor="commute-address" className="text-sm font-semibold text-slate-800">Destination address</label>
            <div className="relative mt-2">
              <MapPin aria-hidden="true" size={18} className="absolute left-3 top-3.5 text-slate-400" />
              <input
                id="commute-address"
                value={address}
                onChange={(event) => {
                  if (selectedDestination) {
                    setSessionToken(createSessionToken());
                  }
                  setAddress(event.target.value);
                  setSelectedDestination(null);
                  setErrorMessage(null);
                }}
                onKeyDown={handleAddressKeyDown}
                placeholder="1600 Pennsylvania Avenue NW, Washington, DC"
                autoComplete="off"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={destinationSuggestions.length > 0}
                aria-controls="commute-address-suggestions"
                aria-activedescendant={activeSuggestionIndex >= 0 ? `commute-address-suggestion-${activeSuggestionIndex}` : undefined}
                className={`w-full rounded-xl border bg-white py-3 pl-10 pr-11 text-base text-slate-900 shadow-sm outline-none transition focus:ring-4 ${selectedDestination ? 'border-emerald-400 focus:border-emerald-500 focus:ring-emerald-100' : 'border-slate-300 focus:border-blue-500 focus:ring-blue-100'}`}
                maxLength={160}
                required
              />
              <span className="absolute right-3 top-3.5 text-slate-400" aria-hidden="true">
                {isSearchingAddress || isResolvingAddress
                  ? <LoaderCircle size={18} className="animate-spin" />
                  : selectedDestination ? <Check size={18} className="text-emerald-600" /> : null}
              </span>

              {destinationSuggestions.length > 0 && (
                <div
                  id="commute-address-suggestions"
                  role="listbox"
                  className="absolute inset-x-0 top-[calc(100%+0.4rem)] z-50 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
                >
                  {destinationSuggestions.map((suggestion, index) => (
                    <button
                      key={suggestion.placeId}
                      id={`commute-address-suggestion-${index}`}
                      type="button"
                      role="option"
                      aria-selected={activeSuggestionIndex === index}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setActiveSuggestionIndex(index)}
                      onClick={() => void selectSuggestion(suggestion)}
                      className={`block w-full border-b border-slate-100 px-4 py-3 text-left last:border-b-0 ${activeSuggestionIndex === index ? 'bg-blue-50' : 'bg-white hover:bg-slate-50'}`}
                    >
                      <span className="block text-sm font-semibold text-slate-900">{suggestion.mainText}</span>
                      {suggestion.secondaryText && (
                        <span className="mt-0.5 block text-xs text-slate-500">{suggestion.secondaryText}</span>
                      )}
                    </button>
                  ))}
                  <div className="bg-slate-50 px-4 py-2 text-right text-[11px] font-semibold text-slate-500">
                    Powered by Google
                  </div>
                </div>
              )}
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {selectedDestination ? 'Destination confirmed.' : 'Type at least three characters, then choose a suggested address.'}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="current-range" className="text-sm font-semibold text-slate-800">Miles currently in tank</label>
              <input
                id="current-range"
                type="number"
                inputMode="decimal"
                min="6"
                max="1000"
                step="1"
                value={currentRange}
                onChange={(event) => setCurrentRange(event.target.value)}
                placeholder="400"
                className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                required
              />
              {safeCurrentRange !== null && (
                <p className="mt-2 text-xs font-medium text-slate-500">First stop planned within {safeCurrentRange.toFixed(0)} safe miles.</p>
              )}
            </div>
            <div>
              <label htmlFor="full-tank-range" className="text-sm font-semibold text-slate-800">Normal full-tank range</label>
              <input
                id="full-tank-range"
                type="number"
                inputMode="decimal"
                min="6"
                max="1000"
                step="1"
                value={fullTankRange}
                onChange={(event) => setFullTankRange(event.target.value)}
                placeholder="420"
                className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                required
              />
            </div>
          </div>

          <fieldset>
            <legend className="text-sm font-semibold text-slate-800">Fuel grade</legend>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {FUEL_GRADE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setFuelGrade(option.value)}
                  aria-pressed={fuelGrade === option.value}
                  className={`rounded-full px-3 py-2.5 text-sm font-semibold ring-1 ${fuelGrade === option.value ? 'bg-primary text-primary-foreground ring-emerald-200' : 'bg-slate-100 text-slate-700 ring-slate-200 hover:bg-slate-200'}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>

          <button
            type="submit"
            disabled={!origin || !selectedDestination || isSearchingAddress || isResolvingAddress || isPlanning}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3.5 text-base font-semibold text-white shadow-[0_14px_30px_-14px_rgba(37,99,235,0.9)] hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Navigation aria-hidden="true" size={19} />
            {isPlanning ? 'Planning safe stops...' : 'Plan Route'}
          </button>

          {!origin && (
            <p className="text-sm text-rose-600" role="status">{locationErrorMessage ?? 'Waiting for your current location.'}</p>
          )}
          {errorMessage && <p className="text-sm font-medium text-rose-600" role="alert">{errorMessage}</p>}
        </form>
      </section>

      {plan && (
        <section className="rounded-2xl border border-white/70 bg-white/95 p-5 shadow-lg backdrop-blur" aria-labelledby="active-route-heading">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600">Saved in this browser</p>
              <h3 id="active-route-heading" className="mt-1 text-xl font-semibold text-slate-900">Route to {plan.destination.name}</h3>
              <p className="mt-1 text-sm text-slate-500">{formatMiles(plan.totalDistanceMeters)} · {formatDuration(plan.totalDurationSeconds)} · {gasStopCount} gas stop{gasStopCount === 1 ? '' : 's'}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                planningControllerRef.current?.abort();
                clearPlan();
                setErrorMessage(null);
              }}
              className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-rose-50 hover:text-rose-700"
            >
              <Trash2 aria-hidden="true" size={16} /> Clear
            </button>
          </div>

          {plan.status === 'completed' ? (
            <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
              <p className="font-semibold">Destination reached</p>
              <p className="mt-1 text-sm">This completed route remains saved until you clear or replace it.</p>
            </div>
          ) : plan.status === 'awaiting_range' ? (
            <form onSubmit={handleArrivalRange} className="mt-5 rounded-xl border border-orange-200 bg-orange-50 p-4">
              <div className="flex items-start gap-3">
                <Fuel aria-hidden="true" className="mt-0.5 text-orange-600" size={20} />
                <div className="flex-1">
                  <h4 className="font-semibold text-orange-950">You are near {nextStop?.name}</h4>
                  <p className="mt-1 text-sm text-orange-900">Enter the car&apos;s updated estimated range before continuing.</p>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <label htmlFor="arrival-range" className="sr-only">Updated estimated range in miles</label>
                    <input
                      id="arrival-range"
                      type="number"
                      min="6"
                      max="1000"
                      step="1"
                      value={arrivalRange}
                      onChange={(event) => setArrivalRange(event.target.value)}
                      placeholder="Updated miles"
                      className="min-w-0 flex-1 rounded-lg border border-orange-300 bg-white px-3 py-2.5 text-slate-900 outline-none focus:ring-4 focus:ring-orange-100"
                      required
                    />
                    <button type="submit" className="rounded-lg bg-orange-600 px-4 py-2.5 font-semibold text-white hover:bg-orange-700">Continue</button>
                  </div>
                </div>
              </div>
            </form>
          ) : nextStop && (
            <div className="mt-5 rounded-xl border border-blue-200 bg-blue-50 p-4">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600">Next {nextStop.type === 'gas' ? `stop ${plan.currentStopIndex + 1}` : 'destination'}</p>
              <p className="mt-1 font-semibold text-slate-900">{nextStop.name}</p>
              <p className="mt-1 text-sm text-slate-600">{nextStop.address}</p>
              {nextStop.pricePerGallon !== undefined && (
                <p className="mt-2 text-sm font-bold text-emerald-700">${nextStop.pricePerGallon.toFixed(2)}/gal</p>
              )}
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <a
                  href={getWebDirectionsUrl(nextStop)}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(event) => {
                    event.preventDefault();
                    openPreferredDirections(nextStop);
                  }}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700"
                >
                  <Navigation aria-hidden="true" size={17} /> Open Next Stop in Maps
                </a>
                <button type="button" onClick={onViewMap} className="rounded-lg bg-white px-4 py-3 text-sm font-semibold text-blue-700 ring-1 ring-blue-200 hover:bg-blue-50">View Full Route</button>
              </div>
            </div>
          )}

          <ol className="mt-5 space-y-3">
            {plan.stops.map((stop, index) => (
              <li key={stop.id} className={`flex gap-3 rounded-xl border p-4 ${index === plan.currentStopIndex && plan.status !== 'completed' ? 'border-blue-300 bg-blue-50/60' : 'border-slate-200 bg-slate-50'}`}>
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${stop.type === 'gas' ? 'bg-orange-500' : 'bg-blue-600'}`}>
                  {stop.type === 'gas' ? index + 1 : <MapPin aria-hidden="true" size={16} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-900">{stop.name}</p>
                  <p className="truncate text-sm text-slate-500">{stop.address}</p>
                  {plan.legs[index] && <p className="mt-1 text-xs font-medium text-slate-500">{formatMiles(plan.legs[index].distanceMeters)} from previous point</p>}
                </div>
                {stop.pricePerGallon !== undefined && <span className="shrink-0 font-bold text-emerald-700">${stop.pricePerGallon.toFixed(2)}</span>}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
};
