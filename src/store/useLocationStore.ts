import { create } from 'zustand';

interface LocationState {
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  setLocation: (latitude: number, longitude: number, accuracyMeters?: number) => void;
}

export const useLocationStore = create<LocationState>((set) => ({
  latitude: null,
  longitude: null,
  accuracyMeters: null,
  setLocation: (latitude, longitude, accuracyMeters) => set({
    latitude,
    longitude,
    accuracyMeters: accuracyMeters ?? null,
  }),
}));
