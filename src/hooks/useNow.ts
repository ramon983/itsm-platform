'use client';

import { useSyncExternalStore } from 'react';

// One shared 1-second ticker for every live SLA timer / countdown on screen. It starts on first use and
// keeps `now` fresh, so render code reads a stable snapshot instead of calling Date.now() (impure).
let now = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      listeners.forEach((l) => l());
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
  };
}

const getNow = () => now;

export function useNow(): number {
  return useSyncExternalStore(subscribe, getNow, getNow);
}

const noopSubscribe = () => () => {};

/** True only after client hydration — persisted localStorage state never renders on the server. */
export function useHydrated(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}
