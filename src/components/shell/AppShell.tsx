'use client';

import clsx from 'clsx';
import {
  Bot,
  ChevronsLeft,
  ChevronsRight,
  Cloud,
  KeyRound,
  LayoutDashboard,
  Laptop,
  Lock,
  MessageCircleHeart,
  RotateCcw,
  Search,
  ShieldCheck,
  Siren,
  Sparkles,
  Trophy,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import { CommandPalette } from '@/components/shell/CommandPalette';
import { AssetInspectorDrawer } from '@/components/inspectors/AssetInspectorDrawer';
import { JitAccessModal } from '@/components/inspectors/JitAccessModal';
import { SaasInspectorDrawer } from '@/components/inspectors/SaasInspectorDrawer';
import { TicketInspectorDrawer } from '@/components/tickets/TicketInspectorDrawer';
import { Button, Kbd, Modal, Toaster } from '@/components/ui/primitives';
import { useNow } from '@/hooks/useNow';
import { MODULE_LABEL, usePlatformStore } from '@/store/usePlatformStore';
import type { ModuleKey } from '@/types/platform';

const MODULE_ICON: Record<ModuleKey, typeof Bot> = {
  itsm_core: LayoutDashboard,
  ai_agents: Bot,
  torii_saas: Cloud,
  itam_cmdb: Laptop,
  password_vault: KeyRound,
};

export function AppShell({ children }: { children: ReactNode }) {
  const openPalette = usePlatformStore((s) => s.openPalette);
  const paletteOpen = usePlatformStore((s) => s.palette.open);
  const closePalette = usePlatformStore((s) => s.closePalette);

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
    <div className="flex h-dvh overflow-hidden bg-[#090D16] text-slate-100">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="flex-1 overflow-y-auto">{children}</main>
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

function Sidebar() {
  const collapsed = usePlatformStore((s) => s.sidebarCollapsed);
  const toggle = usePlatformStore((s) => s.toggleSidebar);
  const flags = usePlatformStore((s) => s.flags);
  const tickets = usePlatformStore((s) => s.tickets);
  const assets = usePlatformStore((s) => s.assets);
  const saasApps = usePlatformStore((s) => s.saasApps);
  const vault = usePlatformStore((s) => s.vault);
  const activeView = usePlatformStore((s) => s.activeView);
  const setView = usePlatformStore((s) => s.setView);
  const openPalette = usePlatformStore((s) => s.openPalette);
  const openJitModal = usePlatformStore((s) => s.openJitModal);
  const boardFilter = usePlatformStore((s) => s.boardFilter);
  const setBoardFilter = usePlatformStore((s) => s.setBoardFilter);
  const [confirmReset, setConfirmReset] = useState(false);
  const now = useNow();

  const open = tickets.filter((t) => t.status !== 'RESOLVED_KB_LINKED');
  const p1 = open.filter((t) => t.priority === 'P1').length;
  const macros = open.filter((t) => t.recommendedMacro).length;
  const idleSeats = saasApps.reduce((n, a) => n + a.inactiveUsers.length, 0);
  const activeGrants = vault.filter((v) => v.activeGrant && Date.parse(v.activeGrant.expiresAt) > now).length;

  const nav: { key: string; module: ModuleKey; icon?: typeof Bot; label: string; badge?: string; tone?: 'rose'; active?: boolean; onClick: () => void }[] = [
    { key: 'dashboard', module: 'itsm_core', label: 'Swarm Dashboard', badge: String(open.length),
      active: activeView === 'dashboard' && boardFilter.priority === 'ALL',
      onClick: () => { setView('dashboard'); setBoardFilter({ priority: 'ALL', status: 'ALL', query: '' }); } },
    { key: 'p1', module: 'itsm_core', icon: Siren, label: 'P1 Critical', badge: String(p1), tone: p1 ? 'rose' : undefined,
      active: activeView === 'dashboard' && boardFilter.priority === 'P1',
      onClick: () => { setView('dashboard'); setBoardFilter({ priority: 'P1', status: 'ALL' }); } },
    { key: 'portal', module: 'ai_agents', icon: MessageCircleHeart, label: 'End-User Portal', active: activeView === 'portal', onClick: () => setView('portal') },
    { key: 'macros', module: 'ai_agents', icon: Sparkles, label: 'AI Macros', badge: String(macros), onClick: () => openPalette('macros') },
    { key: 'saas', module: 'torii_saas', label: 'SaaS Apps', badge: idleSeats ? `${idleSeats} idle` : String(saasApps.length), onClick: () => openPalette('saas') },
    { key: 'assets', module: 'itam_cmdb', label: 'CMDB Assets', badge: String(assets.length), onClick: () => openPalette('assets') },
    { key: 'vault', module: 'password_vault', label: 'JIT Vault', badge: activeGrants ? `${activeGrants} live` : undefined, onClick: () => openJitModal() },
  ];
  const sections = (Object.keys(MODULE_LABEL) as ModuleKey[]).filter((m) => flags[m]);

  return (
    <aside
      className={clsx(
        'flex shrink-0 flex-col border-r border-white/[0.08] bg-[#0b101b] transition-[width] duration-200',
        collapsed ? 'w-[60px]' : 'w-64',
      )}
    >
      <div className="flex h-14 items-center gap-2 border-b border-white/[0.06] px-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-indigo-600 font-mono text-sm font-bold shadow-[0_0_20px_rgba(99,102,241,0.35)]">A0</span>
        {!collapsed && (
          <div className="min-w-0 leading-tight">
            <p className="text-sm font-semibold tracking-tight">AdminZero</p>
            <p className="text-[11px] text-slate-500">Human-centric ITSM</p>
          </div>
        )}
        <button
          type="button"
          onClick={toggle}
          className="ml-auto rounded-md p-1 text-slate-500 hover:bg-white/[0.05] hover:text-slate-200"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
        </button>
      </div>

      <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-3">
        {sections.map((module) => {
          const items = nav.filter((n) => n.module === module);
          const Icon = MODULE_ICON[module];
          return (
            <div key={module}>
              {!collapsed && <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{MODULE_LABEL[module]}</p>}
              {items.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={item.onClick}
                  title={item.label}
                  className={clsx(
                    'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition',
                    item.active ? 'bg-white/[0.07] text-slate-50' : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-100',
                    collapsed && 'justify-center',
                  )}
                >
                  {(() => {
                    const ItemIcon = item.icon ?? Icon;
                    return <ItemIcon className="size-4 shrink-0" />;
                  })()}
                  {!collapsed && <span className="flex-1 truncate text-left">{item.label}</span>}
                  {!collapsed && item.badge && (
                    <span
                      className={clsx(
                        'rounded-md px-1.5 font-mono text-[10px]',
                        item.tone === 'rose' ? 'animate-pulse bg-rose-500/15 text-rose-300' : 'bg-white/[0.06] text-slate-400',
                      )}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              ))}
            </div>
          );
        })}
      </nav>

      <div className="space-y-2 border-t border-white/[0.06] p-3">
        <XpBar collapsed={collapsed} />
        <Button variant="ghost" size="sm" className="w-full" onClick={() => setConfirmReset(true)} title="Reset demo state">
          <RotateCcw className="size-3.5" />{!collapsed && 'Reset Demo State'}
        </Button>
      </div>
      <ResetDialog open={confirmReset} onClose={() => setConfirmReset(false)} />
    </aside>
  );
}

function ResetDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const resetDemo = usePlatformStore((s) => s.resetDemo);
  return (
    <Modal open={open} onClose={onClose} title="Reset demo state?" subtitle="Re-seeds every ticket, asset, SaaS app, vault grant, flag and XP. This clears your local changes.">
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button
          variant="danger"
          data-autofocus
          onClick={() => {
            resetDemo();
            onClose();
          }}
        >
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
    return (
      <div className="grid place-items-center" title={`Level ${p.level} • ${p.title} • ${p.xp.toLocaleString()} XP`}>
        <Trophy className="size-4 text-amber-400" />
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-amber-400/15 bg-gradient-to-br from-amber-400/[0.08] to-transparent p-2.5">
      <div className="flex items-center gap-2 text-xs">
        <Trophy className="size-3.5 text-amber-400" />
        <span className="font-medium text-slate-200">{p.name}</span>
      </div>
      <p className="mt-1 text-[11px] text-amber-200/80">
        Level {p.level} • {p.title} • <span className="font-mono">{p.xp.toLocaleString()} XP</span>
      </p>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.06]" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="XP to next level">
        <div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-500 transition-all duration-700" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-right font-mono text-[10px] text-slate-500">{(p.xpForNextLevel - p.xp).toLocaleString()} XP to L{p.level + 1}</p>
    </div>
  );
}

function TopBar() {
  const openPalette = usePlatformStore((s) => s.openPalette);
  const flags = usePlatformStore((s) => s.flags);
  const toggleFlag = usePlatformStore((s) => s.toggleFlag);
  const [secretsOpen, setSecretsOpen] = useState(false);
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL;

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-white/[0.08] bg-[#090D16]/80 px-4 backdrop-blur-md">
      <button
        type="button"
        onClick={() => openPalette()}
        className="flex h-9 w-full max-w-md items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 text-sm text-slate-500 transition hover:border-white/[0.16]"
      >
        <Search className="size-4" />
        <span className="flex-1 text-left">Search tickets, assets, SaaS… or run a macro</span>
        <Kbd>⌘K</Kbd>
      </button>

      <div className="ml-auto hidden items-center gap-1.5 lg:flex">
        {(Object.keys(MODULE_LABEL) as ModuleKey[]).map((m) => {
          const Icon = MODULE_ICON[m];
          const locked = m === 'itsm_core';
          return (
            <button
              key={m}
              type="button"
              onClick={() => toggleFlag(m)}
              title={locked ? 'ITSM Core is always on' : `${flags[m] ? 'Disable' : 'Enable'} ${MODULE_LABEL[m]}`}
              aria-label={MODULE_LABEL[m]}
              aria-pressed={flags[m]}
              className={clsx(
                'flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-medium transition',
                flags[m]
                  ? 'border-indigo-500/30 bg-indigo-500/10 text-indigo-200 hover:border-indigo-400/50'
                  : 'border-white/[0.08] text-slate-500 line-through hover:text-slate-300',
              )}
            >
              {locked ? <Lock className="size-3" /> : <Icon className="size-3" />}
              <span className="hidden whitespace-nowrap 2xl:inline">{MODULE_LABEL[m]}</span>
            </button>
          );
        })}
      </div>

      <div className="relative">
        <button
          type="button"
          onClick={() => setSecretsOpen((v) => !v)}
          className={clsx(
            'flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-medium',
            apiBase ? 'border-emerald-500/30 text-emerald-300' : 'border-amber-500/30 text-amber-300',
          )}
          aria-expanded={secretsOpen}
        >
          <ShieldCheck className="size-3.5" />
          <span className={clsx('size-1.5 rounded-full', apiBase ? 'bg-emerald-400' : 'bg-amber-400')} />
          Secret Manager
        </button>
        {secretsOpen && (
          <div className="az-pop-in absolute right-0 top-9 z-30 w-80 rounded-xl border border-white/[0.1] bg-[#0f1424] p-3.5 text-xs shadow-2xl">
            <p className="font-semibold text-slate-100">Google Cloud Secret Manager</p>
            <p className="mt-1 text-slate-400">
              {apiBase
                ? `Backend ${apiBase} resolves every secret from Secret Manager at startup.`
                : 'Browser demo mode: no backend is connected, so no secrets are loaded in this session. The FastAPI backend reads these from Secret Manager (with .env.local only for offline dev):'}
            </p>
            <ul className="mt-2 space-y-1">
              {['ANTHROPIC_API_KEY', 'DATABASE_URL', 'SIEM_WEBHOOK_SECRET', 'VAULT_KMS_KEY'].map((name) => (
                <li key={name} className="flex items-center justify-between rounded-md bg-white/[0.03] px-2 py-1">
                  <span className="font-mono text-slate-300">{name}</span>
                  <span className={apiBase ? 'text-emerald-300' : 'text-slate-500'}>{apiBase ? 'resolved' : 'not loaded'}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 flex items-center gap-1 text-slate-500"><Sparkles className="size-3" />Secrets are never bundled into the browser.</p>
          </div>
        )}
      </div>
    </header>
  );
}
