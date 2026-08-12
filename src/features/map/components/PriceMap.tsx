'use client';

import { Store, GasStation } from '@/types';
import { useLocationStore } from '@/store/useLocationStore';
import { useEffect, useMemo, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import 'leaflet-routing-machine/dist/leaflet-routing-machine.css';
import L from 'leaflet'; // Import Leaflet for custom icon
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from 'react-leaflet';
import RoutingMachine from "./routing-machine";
import userLocationIcon from './user-location-marker';

interface PriceMapProps {
  stores: Store[];
  onStoreClick: (id: string) => void;
  onGasStationClick?: (id: string) => void;
  selectedGasStationId?: string | null;
  waypoints?: { lat: number; lng: number }[];
  gasStations?: GasStation[];
  locationErrorMessage?: string | null;
}

const GAS_LABEL_ICON_WIDTH = 60;
const GAS_LABEL_ICON_HEIGHT = 56;
const GAS_LABEL_ICON_ANCHOR_X = 30;
const GAS_LABEL_ICON_ANCHOR_Y = 50;
const GAS_LABEL_OVERLAP_INSET_X = 6;
const GAS_LABEL_OVERLAP_INSET_Y = 4;

const getWebMapUrl = (station: GasStation) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${station.coordinates.lat},${station.coordinates.lng}`)}`;

const getPreferredMapUrl = (station: GasStation) => {
  const { lat, lng } = station.coordinates;
  const destination = `${lat},${lng}`;
  const label = encodeURIComponent(station.name);
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  if (isIOS) {
    return `https://maps.apple.com/?ll=${destination}&q=${label}`;
  }

  if (/Android/i.test(navigator.userAgent)) {
    return `geo:0,0?q=${encodeURIComponent(`${destination}(${station.name})`)}`;
  }

  return getWebMapUrl(station);
};

interface GasStationClusterMarkerProps {
  gasStations: GasStation[];
  onGasStationClick?: (id: string) => void;
  selectedGasStationId?: string | null;
}

interface VisibleGasStation {
  station: GasStation;
  hiddenCount: number;
  box: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  };
}

const buildPriceIcon = (pricePerGallon: number, hiddenCount: number) =>
  L.divIcon({
    className: 'gas-price-marker',
    html: `
      <div class="gas-price-marker__wrap">
        <span class="gas-price-marker__price">
          $${pricePerGallon.toFixed(2)}
          ${hiddenCount > 0 ? `<span class="gas-price-marker__count">+${hiddenCount}</span>` : ''}
        </span>
        <span class="gas-price-marker__pin"></span>
      </div>
    `,
    iconSize: [GAS_LABEL_ICON_WIDTH, GAS_LABEL_ICON_HEIGHT],
    iconAnchor: [GAS_LABEL_ICON_ANCHOR_X, GAS_LABEL_ICON_ANCHOR_Y],
    popupAnchor: [0, -42],
  });

const getGasLabelBox = (map: L.Map, station: GasStation) => {
  const point = map.latLngToContainerPoint([station.coordinates.lat, station.coordinates.lng]);

  return {
    left: point.x - GAS_LABEL_ICON_ANCHOR_X + GAS_LABEL_OVERLAP_INSET_X,
    top: point.y - GAS_LABEL_ICON_ANCHOR_Y + GAS_LABEL_OVERLAP_INSET_Y,
    right: point.x - GAS_LABEL_ICON_ANCHOR_X + GAS_LABEL_ICON_WIDTH - GAS_LABEL_OVERLAP_INSET_X,
    bottom: point.y - GAS_LABEL_ICON_ANCHOR_Y + GAS_LABEL_ICON_HEIGHT - GAS_LABEL_OVERLAP_INSET_Y,
  };
};

const boxesOverlap = (
  left: VisibleGasStation['box'],
  right: VisibleGasStation['box']
) => (
  left.left < right.right
  && left.right > right.left
  && left.top < right.bottom
  && left.bottom > right.top
);

const getVisibleGasStations = (
  map: L.Map,
  gasStations: GasStation[],
  selectedGasStationId?: string | null
) => {
  const stationsByPriority = gasStations
    .map((station) => ({
      station,
      box: getGasLabelBox(map, station),
    }))
    .sort((left, right) => {
      if (left.station.pricePerGallon !== right.station.pricePerGallon) {
        return left.station.pricePerGallon - right.station.pricePerGallon;
      }

      return left.station.id.localeCompare(right.station.id);
    });

  const visibleStations: VisibleGasStation[] = [];

  for (const candidate of stationsByPriority) {
    const overlappingVisibleStation = visibleStations.find((visibleStation) =>
      boxesOverlap(candidate.box, visibleStation.box)
    );

    if (overlappingVisibleStation) {
      overlappingVisibleStation.hiddenCount += 1;
    } else {
      visibleStations.push({
        ...candidate,
        hiddenCount: 0,
      });
    }
  }

  if (selectedGasStationId) {
    const selectedGasStation = gasStations.find((station) => station.id === selectedGasStationId);
    const selectionAlreadyVisible = visibleStations.some(
      (visibleStation) => visibleStation.station.id === selectedGasStationId
    );

    if (selectedGasStation && !selectionAlreadyVisible) {
      visibleStations.push({
        station: selectedGasStation,
        hiddenCount: 0,
        box: getGasLabelBox(map, selectedGasStation),
      });
    }
  }

  return visibleStations;
};

const GasPriceClusterLayer = ({ gasStations, onGasStationClick, selectedGasStationId }: GasStationClusterMarkerProps) => {
  const map = useMap();
  const [viewTick, setViewTick] = useState(0);
  const markerRefs = useRef(new Map<string, L.Marker>());
  const pendingAutoOpenIdRef = useRef<string | null>(null);
  const previousSelectedGasStationIdRef = useRef<string | null>(null);

  useMapEvents({
    zoomend: () => setViewTick((value) => value + 1),
    moveend: () => setViewTick((value) => value + 1),
    resize: () => setViewTick((value) => value + 1),
  });

  const visibleStations = useMemo(() => {
    void viewTick;

    if (gasStations.length === 0) {
      return [];
    }

    return getVisibleGasStations(map, gasStations, selectedGasStationId);
  }, [gasStations, map, selectedGasStationId, viewTick]);

  useEffect(() => {
    if (selectedGasStationId !== previousSelectedGasStationIdRef.current) {
      previousSelectedGasStationIdRef.current = selectedGasStationId ?? null;
      pendingAutoOpenIdRef.current = selectedGasStationId ?? null;
    }
  }, [selectedGasStationId]);

  useEffect(() => {
    const pendingAutoOpenId = pendingAutoOpenIdRef.current;

    if (!pendingAutoOpenId) {
      return;
    }

    const selectedMarker = markerRefs.current.get(pendingAutoOpenId);

    if (!selectedMarker) {
      return;
    }

    map.panTo(selectedMarker.getLatLng(), { animate: true });
    selectedMarker.openPopup();
    pendingAutoOpenIdRef.current = null;
  }, [map, visibleStations]);

  return (
    <>
      {visibleStations.map(({ station, hiddenCount }) => (
        <Marker
          key={station.id}
          ref={(markerInstance) => {
            if (markerInstance) {
              markerRefs.current.set(station.id, markerInstance);
            } else {
              markerRefs.current.delete(station.id);
            }
          }}
          position={[station.coordinates.lat, station.coordinates.lng]}
          icon={buildPriceIcon(station.pricePerGallon, hiddenCount)}
          eventHandlers={{
            click: () => {
              onGasStationClick?.(station.id);
            },
          }}
        >
          <Popup>
            <div className="font-sans text-foreground">
              <h3 className="text-lg font-semibold">{station.name}</h3>
              <p>{station.address}</p>
              <p>Price: ${station.pricePerGallon.toFixed(2)}/gal{station.fuelType ? ` (${formatFuelType(station.fuelType)})` : ''}</p>
              {station.priceUpdatedAt && (
                <p>Updated: {formatUpdatedTime(station.priceUpdatedAt)}</p>
              )}
              <a
                href={getWebMapUrl(station)}
                target="_blank"
                rel="noreferrer"
                onClick={(event) => {
                  event.preventDefault();
                  window.open(getPreferredMapUrl(station), '_blank', 'noopener,noreferrer');
                }}
                className="mt-3 inline-flex rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-800 ring-1 ring-slate-200 transition-colors duration-200 hover:bg-slate-200"
              >
                Open in Maps
              </a>
            </div>
          </Popup>
        </Marker>
      ))}
    </>
  );
};

const formatFuelType = (fuelType?: string) => {
  if (!fuelType) {
    return null;
  }

  return fuelType
    .toLowerCase()
    .split('_')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
};

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

export const PriceMap = ({ stores, onStoreClick, onGasStationClick, selectedGasStationId, waypoints, gasStations, locationErrorMessage }: PriceMapProps) => {
  const { latitude, longitude } = useLocationStore();


  useEffect(() => {
    // This is a known workaround for a leaflet issue where the default icon path is not resolved correctly.
    delete (L.Icon.Default.prototype as L.Icon.Default & { _getIconUrl?: string })._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: '/images/leaflet/marker-icon-2x.png',
      iconUrl: '/images/leaflet/marker-icon.png',
      shadowUrl: '/images/leaflet/marker-shadow.png',
    });
  }, []);

  if (latitude === null || longitude === null) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-transparent px-6 text-center">
        <div>
          <p className="text-lg font-semibold text-slate-900">
            {locationErrorMessage ? 'Location unavailable' : 'Locating your current position'}
          </p>
          <p className="mt-2 text-sm text-slate-500">
            {locationErrorMessage ?? 'Allow location access so the map can start at where you are now.'}
          </p>
        </div>
      </div>
    );
  }

  const mapCenter: [number, number] = [latitude, longitude];



  return (
    <div className="relative z-0 h-full w-full overflow-hidden rounded-[inherit] bg-transparent">
      <MapContainer center={mapCenter as [number, number]} zoom={13} scrollWheelZoom={false} className="h-full w-full">
        <TileLayer
          attribution='&copy; <a href="https://www.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {latitude !== null && longitude !== null && (
          <Marker position={[latitude, longitude]} icon={userLocationIcon}>
            <Popup>You are here</Popup>
          </Marker>
        )}
        {stores.map((store) => (
          <Marker 
            key={store.id} 
            position={[store.coordinates.lat, store.coordinates.lng]} 
            eventHandlers={{
              click: () => {
                onStoreClick(store.id);
              },
            }}
          >
            <Popup>
              <div className="font-sans text-foreground">
                <h3 className="text-lg font-semibold">{store.name}</h3>
                <p>{store.address}</p>
                <button 
                  onClick={() => onStoreClick(store.id)}
                  className="mt-3 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-[0_10px_24px_-12px_rgba(13,148,136,0.85)] ring-1 ring-emerald-200/70 transition-colors duration-200 hover:bg-emerald-700"
                >
                  View Details
                </button>
                {store.googleMapsUri && (
                  <a
                    href={store.googleMapsUri}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-flex rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-800 ring-1 ring-slate-200 transition-colors duration-200 hover:bg-slate-200"
                  >
                    Open in Google Maps
                  </a>
                )}
              </div>
            </Popup>
          </Marker>
        ))}

        {gasStations && gasStations.length > 0 && (
          <GasPriceClusterLayer
            gasStations={gasStations}
            onGasStationClick={onGasStationClick}
            selectedGasStationId={selectedGasStationId}
          />
        )}

        {waypoints && waypoints.length >= 2 && (
          <RoutingMachine key={waypoints.map(p => `${p.lat}-${p.lng}`).join('_')} waypoints={waypoints.map(p => L.latLng(p.lat, p.lng))} />
        )}
      </MapContainer>
    </div>
  );
};
