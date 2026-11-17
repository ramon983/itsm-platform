'use client';

import { useEffect } from 'react';

import { AppShell, VIEW_MODULE } from '@/components/shell/AppShell';
import { AdminView } from '@/components/views/AdminView';
import { ChangesView } from '@/components/views/ChangesView';
import { DashboardView } from '@/components/views/DashboardView';
import { EndUserPortalView } from '@/components/views/EndUserPortalView';
import { KnowledgeView } from '@/components/views/KnowledgeView';
import { AssetsView, SaasView, VaultView } from '@/components/views/ModuleViews';
import { ProblemsView } from '@/components/views/ProblemsView';
import { TicketsView } from '@/components/views/TicketsView';
import { useHydrated } from '@/hooks/useNow';
import { usePlatformStore, type ViewKey } from '@/store/usePlatformStore';

const VIEWS: Record<ViewKey, () => React.ReactNode> = {
  dashboard: () => <DashboardView />,
  tickets: () => <TicketsView />,
  problems: () => <ProblemsView />,
  changes: () => <ChangesView />,
  knowledge: () => <KnowledgeView />,
  portal: () => <EndUserPortalView />,
  saas: () => <SaasView />,
  assets: () => <AssetsView />,
  vault: () => <VaultView />,
  admin: () => <AdminView />,
};

export default function Home() {
  const hydrated = useHydrated();
  const view = usePlatformStore((s) => s.activeView);
  const flags = usePlatformStore((s) => s.flags);
  const setView = usePlatformStore((s) => s.setView);

  // Deep links (#tickets, #knowledge, #admin …). The hash follows the active view so pages are bookmarkable.
  useEffect(() => {
    const fromHash = () => {
      const key = window.location.hash.slice(1) as ViewKey;
      if (key in VIEWS) setView(key);
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, [setView]);
  useEffect(() => {
    if (hydrated && window.location.hash.slice(1) !== view) window.history.replaceState(null, '', `#${view}`);
  }, [view, hydrated]);

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

  // A page whose module is switched off falls back to Home instead of rendering a dead page.
  const owner = VIEW_MODULE[view];
  const visible = owner === null || flags[owner] ? view : 'dashboard';
  return <AppShell>{VIEWS[visible]()}</AppShell>;
}
