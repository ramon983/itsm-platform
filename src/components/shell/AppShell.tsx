'use client';

import clsx from 'clsx';
import {
  AlertOctagon,
  BarChart3,
  BookOpen,
  Bot,
  ChevronsLeft,
  ChevronsRight,
  Cloud,
  GitPullRequestArrow,
  Home,
  KeyRound,
  Laptop,
  MessageCircleHeart,
  RotateCcw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Ticket as TicketIcon,
  Trophy,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { CommandPalette } from '@/components/shell/CommandPalette';
import { ThemeSwitcher, useApplyTheme } from '@/components/shell/ThemeSwitcher';
import { AssetInspectorDrawer } from '@/components/inspectors/AssetInspectorDrawer';
import { JitAccessModal } from '@/components/inspectors/JitAccessModal';
import { SaasInspectorDrawer } from '@/components/inspectors/SaasInspectorDrawer';
import { TicketInspectorDrawer } from '@/components/tickets/TicketInspectorDrawer';
import { Button, Kbd, Modal, Toaster } from '@/components/ui/primitives';
import { useApiHealth } from '@/hooks/useApiHealth';
import { useNow } from '@/hooks/useNow';
import { detectPatterns } from '@/lib/patterns';
import { MODULE_LABEL, usePlatformStore, type ViewKey } from '@/store/usePlatformStore';
import type { ModuleKey } from '@/types/platform';

/** Which module owns each view. A view whose module is off is hidden everywhere. */
export const VIEW_MODULE: Record<ViewKey, ModuleKey | null> = {
  dashboard: null,
  reports: 'itsm_core',
  tickets: 'itsm_core',
  problems: 'itsm_core',
  changes: 'itsm_core',
  knowledge: 'itsm_core',
  portal: 'ai_agents',
  saas: 'torii_saas',
  assets: 'itam_cmdb',
  vault: 'password_vault',
  admin: null,
};

export function AppShell({ children }: { children: ReactNode }) {
  const openPalette = usePlatformStore((s) => s.openPalette);
  const paletteOpen = usePlatformStore((s) => s.palette.open);
  const closePalette = usePlatformStore((s) => s.closePalette);
  useApplyTheme();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (paletteOpen) closePalette();
        else openPalette();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openPalette, closePalette, paletteOpen]);

  return (
    <div className="flex h-dvh overflow-hidden bg-canvas text-slate-100">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
      <TicketInspectorDrawer />
      <AssetInspectorDrawer />
      <SaasInspectorDrawer />
      <JitAccessModal />
      <CommandPalette />
      <Toaster />
    </div>
  );
}

interface NavItem {
  view: ViewKey;
  label: string;
  icon: typeof Bot;
  badge?: string;
  tone?: 'rose' | 'amber';
}

function Sidebar() {
  const collapsed = usePlatformStore((s) => s.sidebarCollapsed);
  const toggle = usePlatformStore((s) => s.toggleSidebar);
  const flags = usePlatformStore((s) => s.flags);
  const tickets = usePlatformStore((s) => s.tickets);
  const problems = usePlatformStore((s) => s.problems);
  const changeDetails = usePlatformStore((s) => s.changeDetails);
  const closed = usePlatformStore((s) => s.closedTickets);
  const kbArticles = usePlatformStore((s) => s.kbArticles);
  const kbStats = usePlatformStore((s) => s.kbStats);
  const assets = usePlatformStore((s) => s.assets);
  const saasApps = usePlatformStore((s) => s.saasApps);
  const vault = usePlatformStore((s) => s.vault);
  const activeView = usePlatformStore((s) => s.activeView);
  const setView = usePlatformStore((s) => s.setView);
  const [confirmReset, setConfirmReset] = useState(false);
  const now = useNow();

  const openTickets = tickets.filter((t) => t.status !== 'RESOLVED_KB_LINKED' && t.type !== 'CHANGE');
  const p1 = openTickets.filter((t) => t.priority === 'P1').length;
  const gaps = useMemo(
    () => (flags.ai_agents ? detectPatterns(closed, tickets, kbArticles, kbStats).filter((p) => p.coverage === 'uncovered').length : 0),
    [flags.ai_agents, closed, tickets, kbArticles, kbStats],
  );

  const sections: { module: ModuleKey | null; title: string | null; items: NavItem[] }[] = [
    { module: null, title: null, items: [{ view: 'dashboard', label: 'Home', icon: Home }] },
    {
      module: 'itsm_core', title: 'Service management', items: [
        { view: 'tickets', label: 'Tickets', icon: TicketIcon, badge: p1 ? `${p1} P1` : String(openTickets.length), tone: p1 ? 'rose' : undefined },
        { view: 'problems', label: 'Problems', icon: AlertOctagon, badge: String(problems.filter((p) => p.status !== 'RESOLVED').length) },
        { view: 'changes', label: 'Changes', icon: GitPullRequestArrow, badge: (() => { const n = Object.values(changeDetails).filter((d) => d.cabStatus === 'PENDING').length; return n ? `${n} CAB` : undefined; })(), tone: 'amber' },
        { view: 'reports', label: 'Reports', icon: BarChart3 },
        { view: 'knowledge', label: 'Knowledge', icon: BookOpen, badge: gaps ? `${gaps} AI` : undefined, tone: 'amber' },
      ],
    },
    { module: 'ai_agents', title: 'AI agents', items: [{ view: 'portal', label: 'Employee portal', icon: MessageCircleHeart }] },
    { module: 'torii_saas', title: 'SaaS', items: [{ view: 'saas', label: 'SaaS apps', icon: Cloud, badge: (() => { const n = saasApps.reduce((s, a) => s + a.inactiveUsers.length, 0); return n ? `${n} idle` : undefined; })() }] },
    { module: 'itam_cmdb', title: 'Assets', items: [{ view: 'assets', label: 'CMDB', icon: Laptop, badge: String(assets.length) }] },
    { module: 'password_vault', title: 'Security', items: [{ view: 'vault', label: 'Password vault', icon: KeyRound, badge: (() => { const n = vault.filter((v) => v.activeGrant && Date.parse(v.activeGrant.expiresAt) > now).length; return n ? `${n} live` : undefined; })() }] },
  ];

  const renderItem = (item: NavItem) => (
    <button
      key={item.view}
      type="button"
      onClick={() => setView(item.view)}
      title={item.label}
      aria-current={activeView === item.view ? 'page' : undefined}
      className={clsx(
        'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition',
        activeView === item.view ? 'bg-white/[0.07] text-slate-50' : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-100',
        collapsed && 'justify-center',
      )}
    >
      <item.icon className="size-4 shrink-0" />
      {!collapsed && <span className="flex-1 truncate text-left">{item.label}</span>}
      {!collapsed && item.badge && (
        <span className={clsx('rounded-md px-1.5 font-mono text-[10px]', item.tone === 'rose' ? 'animate-pulse bg-rose-500/15 text-rose-300' : item.tone === 'amber' ? 'bg-amber-400/15 text-amber-200' : 'bg-white/[0.06] text-slate-400')}>
          {item.badge}
        </span>
      )}
    </button>
  );

  return (
    <aside className={clsx('flex shrink-0 flex-col border-r border-white/[0.08] bg-sidebar transition-[width] duration-200', collapsed ? 'w-[60px]' : 'w-60')}>
      <div className="flex h-14 items-center gap-2 border-b border-white/[0.06] px-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-indigo-600 font-mono text-sm font-bold">A0</span>
        {!collapsed && (
          <div className="min-w-0 leading-tight">
            <p className="text-sm font-semibold tracking-tight">AdminZero</p>
            <p className="text-[11px] text-slate-500">50/50 AI + human ITSM</p>
          </div>
        )}
        <button type="button" onClick={toggle} className="ml-auto rounded-md p-1 text-slate-500 hover:bg-white/[0.05] hover:text-slate-200" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
        </button>
      </div>

      <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-3" aria-label="Main">
        {sections.filter((s) => s.module === null || flags[s.module]).map((s) => (
          <div key={s.title ?? 'home'} className="space-y-0.5">
            {!collapsed && s.title && <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{s.title}</p>}
            {s.items.map(renderItem)}
          </div>
        ))}
      </nav>

      <div className="space-y-2 border-t border-white/[0.06] p-3">
        {renderItem({ view: 'admin', label: 'Admin console', icon: Settings })}
        <XpBar collapsed={collapsed} />
        <Button variant="ghost" size="sm" className="w-full" onClick={() => setConfirmReset(true)} title="Reset demo state">
          <RotateCcw className="size-3.5" />{!collapsed && 'Reset demo state'}
        </Button>
      </div>
      <ResetDialog open={confirmReset} onClose={() => setConfirmReset(false)} />
    </aside>
  );
}

function ResetDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const resetDemo = usePlatformStore((s) => s.resetDemo);
  return (
    <Modal open={open} onClose={onClose} title="Reset demo state?" subtitle="Re-seeds every ticket, problem, change, article, asset, setting and XP. This clears your local changes.">
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="danger" data-autofocus onClick={() => { resetDemo(); onClose(); }}>
          <RotateCcw className="size-4" />Reset everything
        </Button>
      </div>
    </Modal>
  );
}

function XpBar({ collapsed }: { collapsed: boolean }) {
  const p = usePlatformStore((s) => s.profile);
  const prevLevelXp = p.xpForNextLevel - 600;
  const pct = Math.min(100, Math.max(0, ((p.xp - prevLevelXp) / (p.xpForNextLevel - prevLevelXp)) * 100));
  if (collapsed) {
    return <div className="grid place-items-center" title={`Level ${p.level} • ${p.title} • ${p.xp.toLocaleString()} XP`}><Trophy className="size-4 text-amber-400" /></div>;
  }
  return (
    <div className="rounded-xl border border-amber-400/15 bg-gradient-to-br from-amber-400/[0.08] to-transparent p-2.5">
      <div className="flex items-center gap-2 text-xs"><Trophy className="size-3.5 text-amber-400" /><span className="font-medium text-slate-200">{p.name}</span></div>
      <p className="mt-1 text-[11px] text-amber-200/80">Level {p.level} • {p.title} • <span className="font-mono">{p.xp.toLocaleString()} XP</span></p>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.06]" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="XP to next level">
        <div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-500 transition-all duration-700" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function TopBar() {
  const openPalette = usePlatformStore((s) => s.openPalette);
  const flags = usePlatformStore((s) => s.flags);
  const aiSettings = usePlatformStore((s) => s.aiSettings);
  const setView = usePlatformStore((s) => s.setView);
  const [secretsOpen, setSecretsOpen] = useState(false);
  const apiHealth = useApiHealth();
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL;
  const resolved = apiHealth.state === 'up' ? apiHealth.health.secrets.resolved : null;
  const viaGcp = apiHealth.state === 'up' && apiHealth.health.secrets.source === 'gcp_secret_manager';
  const tone = viaGcp ? 'good' : apiHealth.state === 'down' ? 'bad' : 'warn';
  const enabled = (Object.keys(MODULE_LABEL) as ModuleKey[]).filter((m) => flags[m]).length;
  const autonomy = { suggest_only: 'Suggest only', self_service_deflection: 'Self-service', auto_resolve_low_risk: 'Auto-resolve low risk' }[aiSettings.autonomy];

  return (
    <header className="relative z-30 flex h-14 shrink-0 items-center gap-3 border-b border-white/[0.08] bg-canvas/85 px-4 backdrop-blur-md">
      <button
        type="button"
        onClick={() => openPalette()}
        className="flex h-9 w-full max-w-md items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 text-sm text-slate-500 transition hover:border-white/[0.16]"
      >
        <Search className="size-4" />
        <span className="flex-1 truncate text-left">Search tickets, assets, SaaS… or run a macro</span>
        <Kbd>⌘K</Kbd>
      </button>

      <div className="ml-auto flex items-center gap-2">
        <ThemeSwitcher />
        {flags.ai_agents && (
          <button type="button" onClick={() => setView('admin')} className="hidden items-center gap-1.5 whitespace-nowrap rounded-full border border-sky-500/30 px-2.5 py-1 text-[11px] font-medium text-sky-200 md:flex" title="AI autonomy — change in Admin → AI & grounding">
            <Sparkles className="size-3.5" />AI · {autonomy}
          </button>
        )}
        <button type="button" onClick={() => setView('admin')} className="hidden whitespace-nowrap rounded-full border border-white/[0.08] px-2.5 py-1 text-[11px] text-slate-400 hover:text-slate-200 lg:block" title="Manage modules in Admin">
          {enabled}/5 modules
        </button>
        <div className="relative">
          <button
            type="button"
            onClick={() => setSecretsOpen((v) => !v)}
            className={clsx('flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-medium', tone === 'good' ? 'border-emerald-500/30 text-emerald-300' : tone === 'bad' ? 'border-rose-500/30 text-rose-300' : 'border-amber-500/30 text-amber-300')}
            aria-expanded={secretsOpen}
          >
            <ShieldCheck className="size-3.5" />
            <span className={clsx('size-1.5 rounded-full', tone === 'good' ? 'bg-emerald-400' : tone === 'bad' ? 'bg-rose-400' : 'bg-amber-400')} />
            Secret Manager
          </button>
          {secretsOpen && (
            <div className="az-pop-in absolute right-0 top-9 z-30 w-80 rounded-xl border border-white/[0.1] bg-raised p-3.5 text-xs shadow-2xl">
              <p className="font-semibold text-slate-100">Google Cloud Secret Manager</p>
              <p className="mt-1 text-slate-400">
                {apiHealth.state === 'up'
                  ? `${apiBase} — secrets from ${viaGcp ? 'Google Cloud Secret Manager' : '.env.local (development fallback)'} · AI: ${apiHealth.health.ai.engine === 'claude' ? apiHealth.health.ai.model : 'offline engine'}`
                  : apiHealth.state === 'down'
                    ? `${apiBase} is unreachable (${apiHealth.error}). The dashboard keeps working on local state.`
                    : apiHealth.state === 'checking'
                      ? `Checking ${apiBase}…`
                      : 'Browser demo mode: no backend is configured for this build, so no secrets are loaded. The FastAPI backend reads these from Secret Manager (.env.local only for offline dev):'}
              </p>
              <ul className="mt-2 space-y-1">
                {['ANTHROPIC_API_KEY', 'DATABASE_URL', 'SIEM_WEBHOOK_SECRET', 'VAULT_KMS_KEY'].map((name) => (
                  <li key={name} className="flex items-center justify-between rounded-md bg-white/[0.03] px-2 py-1">
                    <span className="font-mono text-slate-300">{name}</span>
                    <span className={resolved?.[name] ? 'text-emerald-300' : resolved ? 'text-rose-300' : 'text-slate-500'}>{resolved ? (resolved[name] ? 'resolved' : 'missing') : 'not loaded'}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 flex items-center gap-1 text-slate-500"><Bot className="size-3" />Secrets are never bundled into the browser.</p>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
