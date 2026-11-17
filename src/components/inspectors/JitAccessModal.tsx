'use client';

import { Check, Copy, KeyRound, ShieldOff } from 'lucide-react';
import { useState } from 'react';

import { Button, Field, Modal, inputClass } from '@/components/ui/primitives';
import { CURRENT_AGENT } from '@/data/seed';
import { useNow } from '@/hooks/useNow';
import { formatSla } from '@/lib/sla';
import { usePlatformStore } from '@/store/usePlatformStore';

export function JitAccessModal() {
  const jit = usePlatformStore((s) => s.jitModal);
  const close = usePlatformStore((s) => s.closeJitModal);
  const enabled = usePlatformStore((s) => s.flags.password_vault);
  return (
    <Modal
      open={jit.open && enabled}
      onClose={close}
      title="Just-In-Time vault elevation"
      subtitle="Zero-knowledge vault · 1-hour access tied to an open ticket · every grant is audited."
      width="max-w-xl"
    >
      {jit.open && <JitForm initialVaultId={jit.vaultId} initialTicketId={jit.ticketId} />}
    </Modal>
  );
}

function JitForm({ initialVaultId, initialTicketId }: { initialVaultId?: string; initialTicketId?: string }) {
  const vault = usePlatformStore((s) => s.vault);
  const tickets = usePlatformStore((s) => s.tickets);
  const grant = usePlatformStore((s) => s.grantJitAccess);
  const revoke = usePlatformStore((s) => s.revokeJitAccess);
  const now = useNow();
  const ticket = tickets.find((t) => t.id === initialTicketId);
  const defaultVault =
    initialVaultId ??
    vault.find((v) => ticket && (v.scope === ticket.linkedAssetId || v.allowedSquads.includes(ticket.swarmSquad)))?.id ??
    vault[0]!.id;
  const [vaultId, setVaultId] = useState(defaultVault);
  const [ticketId, setTicketId] = useState(initialTicketId ?? '');
  const [copied, setCopied] = useState(false);
  const item = vault.find((v) => v.id === vaultId)!;
  const active = item.activeGrant && Date.parse(item.activeGrant.expiresAt) > now ? item.activeGrant : null;
  const remaining = active ? Math.max(0, Math.round((Date.parse(active.expiresAt) - now) / 1000)) : 0;

  const copy = async () => {
    if (!active) return;
    await navigator.clipboard.writeText(active.token);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-3.5">
      <Field label="Credential">
        <select className={inputClass} value={vaultId} onChange={(e) => setVaultId(e.target.value)}>
          {vault.map((v) => (
            <option key={v.id} value={v.id} className="bg-slate-900">
              {v.name} · {v.kind} · {v.allowedSquads.join(' / ')}
            </option>
          ))}
        </select>
      </Field>

      {active ? (
        <div className="space-y-3 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] p-3.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-emerald-300">Granted to {active.agentName} for <span className="font-mono">{active.ticketId}</span></span>
            <span className="font-mono text-base font-semibold text-emerald-200">{formatSla(remaining)}</span>
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-lg bg-black/40 px-3 py-2 font-mono text-sm tracking-wider text-slate-100">{active.token}</code>
            <Button size="sm" onClick={copy} aria-label="Copy token">
              {copied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
            </Button>
          </div>
          <Button size="sm" variant="danger" onClick={() => revoke(item.id)}>
            <ShieldOff className="size-3.5" />Revoke & rotate now
          </Button>
        </div>
      ) : (
        <form
          className="space-y-3.5"
          onSubmit={(e) => {
            e.preventDefault();
            grant(item.id, ticketId, CURRENT_AGENT);
          }}
        >
          <Field label="Ticket ID" hint={`Allowed squads: ${item.allowedSquads.join(', ')}`}>
            <input
              className={`${inputClass} font-mono uppercase`}
              value={ticketId}
              onChange={(e) => setTicketId(e.target.value)}
              placeholder="INC-1049"
              list="jit-ticket-ids"
            />
            <datalist id="jit-ticket-ids">
              {tickets.filter((t) => t.status !== 'RESOLVED_KB_LINKED').map((t) => (
                <option key={t.id} value={t.id}>{t.title}</option>
              ))}
            </datalist>
          </Field>
          <div className="flex justify-end">
            <Button type="submit" variant="primary" disabled={!ticketId.trim()}>
              <KeyRound className="size-4" />Grant 1-hour JIT access
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
