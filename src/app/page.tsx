'use client';

import { AppShell } from '@/components/shell/AppShell';
import { DashboardView } from '@/components/views/DashboardView';
import { useHydrated } from '@/hooks/useNow';
import { usePlatformStore } from '@/store/usePlatformStore';

export default function Home() {
  const hydrated = useHydrated();
  const view = usePlatformStore((s) => s.activeView);

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

  return <AppShell>{view === 'dashboard' && <DashboardView />}</AppShell>;
}
