'use client';

import { useEffect, useState } from 'react';

import { API_MODE, getHealth, type HealthResponse } from '@/lib/api';

export type ApiHealth = { state: 'simulated' } | { state: 'checking' } | { state: 'down'; error: string } | { state: 'up'; health: HealthResponse };

/** Polls /api/v1/health every minute in live mode — powers the real Secret Manager status in the top bar. */
export function useApiHealth(): ApiHealth {
  const [health, setHealth] = useState<ApiHealth>(API_MODE === 'live' ? { state: 'checking' } : { state: 'simulated' });
  useEffect(() => {
    if (API_MODE !== 'live') return;
    let cancelled = false;
    const check = () =>
      getHealth().then((res) => {
        if (cancelled) return;
        setHealth(res.ok ? { state: 'up', health: res.body as HealthResponse } : { state: 'down', error: (res.body as { detail: string }).detail });
      });
    void check();
    const timer = setInterval(check, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);
  return health;
}
