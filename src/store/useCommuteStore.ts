'use client';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { isCommutePlan } from '@/lib/commute';
import { CommutePlan } from '@/types';

interface CommuteState {
  plan: CommutePlan | null;
  hasHydrated: boolean;
  setPlan: (plan: CommutePlan) => void;
  clearPlan: () => void;
  setHasHydrated: (hasHydrated: boolean) => void;
  markCurrentStopReached: () => void;
  acceptRangeAndAdvance: (rangeMiles: number) => void;
  completePlan: () => void;
}

export const useCommuteStore = create<CommuteState>()(
  persist(
    (set) => ({
      plan: null,
      hasHydrated: false,
      setPlan: (plan) => set({ plan }),
      clearPlan: () => set({ plan: null }),
      setHasHydrated: (hasHydrated) => set({ hasHydrated }),
      markCurrentStopReached: () => set((state) => {
        if (!state.plan || state.plan.status !== 'active') {
          return state;
        }

        return {
          plan: {
            ...state.plan,
            status: 'awaiting_range',
          },
        };
      }),
      acceptRangeAndAdvance: (rangeMiles) => set((state) => {
        if (!state.plan || state.plan.status !== 'awaiting_range') {
          return state;
        }

        const nextStopIndex = Math.min(
          state.plan.currentStopIndex + 1,
          state.plan.stops.length - 1
        );

        return {
          plan: {
            ...state.plan,
            currentRangeMiles: rangeMiles,
            currentStopIndex: nextStopIndex,
            status: 'active',
          },
        };
      }),
      completePlan: () => set((state) => state.plan
        ? { plan: { ...state.plan, status: 'completed' } }
        : state),
    }),
    {
      name: 'go-go-gas-active-commute',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ plan: state.plan }),
      merge: (persistedState, currentState) => {
        const storedPlan = (persistedState as { plan?: unknown } | undefined)?.plan;
        return {
          ...currentState,
          plan: isCommutePlan(storedPlan) ? storedPlan : null,
        };
      },
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.setHasHydrated(true);
          return;
        }

        queueMicrotask(() => useCommuteStore.setState({ plan: null, hasHydrated: true }));
      },
    }
  )
);
