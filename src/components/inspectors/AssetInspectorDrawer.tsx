'use client';

import clsx from 'clsx';
import { Cpu, HardDrive, Lock, MapPin, ShieldCheck, User, X } from 'lucide-react';

import { Button, Drawer, PriorityBadge, StatusBadge } from '@/components/ui/primitives';
import { useNow } from '@/hooks/useNow';
import { usePlatformStore } from '@/store/usePlatformStore';
import type { HardwareAsset } from '@/types/platform';

export function AssetInspectorDrawer() {
  const inspector = usePlatformStore((s) => s.inspector);
  const close = usePlatformStore((s) => s.closeInspector);
  const enabled = usePlatformStore((s) => s.flags.itam_cmdb);
  const asset = usePlatformStore((s) =>
    s.inspector?.kind === 'asset' ? s.assets.find((a) => a.id === s.inspector!.id) : undefined,
  );
  return (
    <Drawer open={inspector?.kind === 'asset' && !!asset && enabled} onClose={close} label="Asset inspector">
      {asset && <AssetInspector asset={asset} onClose={close} />}
    </Drawer>
  );
}

function AssetInspector({ asset, onClose }: { asset: HardwareAsset; onClose: () => void }) {
  const now = useNow();
  const openInspector = usePlatformStore((s) => s.openInspector);
  const allTickets = usePlatformStore((s) => s.tickets);
  const tickets = allTickets.filter((t) => t.linkedAssetId === asset.id || asset.linkedTicketIds.includes(t.id));
  const warrantyDays = asset.appleCareExpires ? Math.ceil((Date.parse(asset.appleCareExpires) - now) / 86_400_000) : null;

  return (
    <>
      <header className="flex items-start gap-3 border-b border-white/[0.08] p-5">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-xs text-slate-400">{asset.id} · {asset.serialNumber}</p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-50">{asset.name}</h2>
          <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
            <span className="rounded-md border border-white/[0.08] px-1.5 py-0.5 text-slate-300">{asset.lifecycle}</span>
            <span className="rounded-md border border-white/[0.08] px-1.5 py-0.5 text-slate-300">{asset.category} · {asset.model}</span>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close"><X className="size-4" /></Button>
      </header>
      <div className="flex-1 space-y-5 overflow-y-auto p-5 text-sm">
        <section className="grid grid-cols-2 gap-3">
          <Stat icon={User} label="Assigned to" value={asset.assignedTo ?? 'Unassigned'} sub={asset.assignedEmail ?? undefined} />
          <Stat icon={MapPin} label="Location" value={asset.location} />
          <Stat
            icon={ShieldCheck}
            label="MDM"
            value={asset.mdmEnrolled ? 'Enrolled (Jamf)' : 'Not enrolled'}
            tone={asset.mdmEnrolled ? 'good' : 'bad'}
            sub={asset.osVersion}
          />
          <Stat
            icon={Lock}
            label="FileVault"
            value={asset.fileVault}
            tone={asset.fileVault === 'Encrypted' ? 'good' : asset.fileVault === 'Disabled' ? 'bad' : undefined}
          />
          <Stat
            icon={HardDrive}
            label="AppleCare+"
            value={warrantyDays === null ? 'Not applicable' : warrantyDays < 0 ? 'Expired' : `${warrantyDays} days left`}
            sub={asset.appleCareExpires ?? undefined}
            tone={warrantyDays !== null && warrantyDays < 60 ? 'bad' : 'good'}
          />
          <Stat icon={Cpu} label="Specs" value={Object.values(asset.specs).join(' · ')} />
        </section>
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Installed software</h3>
          {asset.installedSoftware.length ? (
            <ul className="flex flex-wrap gap-1.5">
              {asset.installedSoftware.map((s) => (
                <li key={s} className="rounded-md border border-white/[0.06] bg-white/[0.02] px-2 py-0.5 font-mono text-[11px] text-slate-300">{s}</li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-slate-500">No packages reported yet (device not enrolled).</p>
          )}
        </section>
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Linked tickets ({tickets.length})</h3>
          <ul className="space-y-1.5">
            {tickets.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => openInspector({ kind: 'ticket', id: t.id })}
                  className="flex w-full items-center gap-2 rounded-lg border border-white/[0.06] p-2.5 text-left transition hover:border-white/[0.16]"
                >
                  <span className="font-mono text-xs text-slate-300">{t.id}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-slate-200">{t.title}</span>
                  <PriorityBadge priority={t.priority} />
                  <StatusBadge status={t.status} />
                </button>
              </li>
            ))}
            {!tickets.length && <li className="text-xs text-slate-500">No tickets reference this asset.</li>}
          </ul>
        </section>
      </div>
    </>
  );
}

function Stat({ icon: Icon, label, value, sub, tone }: { icon: typeof User; label: string; value: string; sub?: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
      <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-slate-500"><Icon className="size-3.5" />{label}</p>
      <p className={clsx('mt-1 text-sm font-medium', tone === 'good' ? 'text-emerald-300' : tone === 'bad' ? 'text-rose-300' : 'text-slate-100')}>{value}</p>
      {sub && <p className="font-mono text-[11px] text-slate-500">{sub}</p>}
    </div>
  );
}
