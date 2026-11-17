'use client';

import { useEffect } from 'react';

import { AppShell } from '@/components/shell/AppShell';
import { DashboardView } from '@/components/views/DashboardView';
import { EndUserPortalView } from '@/components/views/EndUserPortalView';
import { useHydrated } from '@/hooks/useNow';
import { usePlatformStore, type ViewKey } from '@/store/usePlatformStore';

const VIEWS: readonly ViewKey[] = ['dashboard', 'portal'];

export default function Home() {
  const hydrated = useHydrated();
  const view = usePlatformStore((s) => s.activeView);
  const aiOn = usePlatformStore((s) => s.flags.ai_agents);
  const setView = usePlatformStore((s) => s.setView);

  // Deep links: #dashboard, #portal. The hash follows the active view so views are bookmarkable.
  useEffect(() => {
    const fromHash = () => {
      const key = window.location.hash.slice(1) as ViewKey;
      if (VIEWS.includes(key)) setView(key);
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, [setView]);
  useEffect(() => {
    if (hydrated && window.location.hash.slice(1) !== view) window.history.replaceState(null, '', `#${view}`);
  }, [view, hydrated]);

  // The store persists to localStorage, so the app renders client-side only to avoid hydration mismatches.
  if (!hydrated) {
    return (
      <div className="grid h-dvh place-items-center bg-[#090D16]">
        <div className="flex items-center gap-3 text-sm text-slate-400">
          <span className="grid size-8 animate-pulse place-items-center rounded-lg bg-indigo-600 font-mono text-sm font-bold text-white">A0</span>
          Loading AdminZero…
        </div>
      </div>
    );
  }

  // A view whose module is switched off falls back to the dashboard instead of rendering a dead page.
  return <AppShell>{view === 'portal' && aiOn ? <EndUserPortalView /> : <DashboardView />}</AppShell>;
}
