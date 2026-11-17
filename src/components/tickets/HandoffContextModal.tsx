'use client';

import { ArrowRightLeft } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button, Field, Modal, inputClass } from '@/components/ui/primitives';
import { HANDOFF_MIN, validateHandoff, type HandoffInput } from '@/lib/rules';
import { usePlatformStore } from '@/store/usePlatformStore';
import type { SwarmSquad, Ticket } from '@/types/platform';

interface Props {
  ticket: Ticket;
  initialSquad?: SwarmSquad;
  open: boolean;
  onClose: () => void;
}

/** §3.2 No silent handoffs — the only way to move a ticket between squads or owners. */
export function HandoffContextModal({ ticket, initialSquad, open, onClose }: Props) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Hand off ${ticket.id}`}
      subtitle="No silent handoffs. The receiving swarm gets this context as a permanent audit card on the timeline."
      width="max-w-xl"
    >
      {open && <HandoffForm ticket={ticket} initialSquad={initialSquad} onClose={onClose} />}
    </Modal>
  );
}

function HandoffForm({ ticket, initialSquad, onClose }: Omit<Props, 'open'>) {
  const squads = usePlatformStore((s) => s.squads);
  const users = usePlatformStore((s) => s.users);
  const handoffTicket = usePlatformStore((s) => s.handoffTicket);
  const firstOther = squads.find((sq) => sq !== ticket.swarmSquad) ?? ticket.swarmSquad;
  const [form, setForm] = useState<HandoffInput>({
    toSquad: initialSquad && initialSquad !== ticket.swarmSquad ? initialSquad : firstOther,
    toAgent: undefined,
    handoffReason: '',
    diagnosticsAttempted: '',
    recommendedNextStep: '',
  });
  const [touched, setTouched] = useState(false);
  const errors = useMemo(() => validateHandoff(ticket, form), [ticket, form]);
  const valid = Object.keys(errors).length === 0;
  const set = <K extends keyof HandoffInput>(k: K, v: HandoffInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!valid) return;
    if (handoffTicket(ticket.id, form).ok) onClose();
  };

  const show = (k: keyof HandoffInput) => (touched ? errors[k] : undefined);
  const counter = (k: keyof typeof HANDOFF_MIN) => `${form[k].trim().length}/${HANDOFF_MIN[k]} min`;

  return (
    <form onSubmit={submit} className="space-y-3.5">
      <div className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-xs text-slate-400">
        <span className="font-medium text-slate-300">{ticket.swarmSquad}</span>
        <ArrowRightLeft className="size-3.5 text-indigo-400" />
        <span className="font-medium text-indigo-300">{form.toSquad}</span>
        <span className="ml-auto">Status will update to Active Swarm · requester notified</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Receiving swarm squad" error={show('toSquad')}>
          <select
            className={inputClass}
            value={form.toSquad}
            onChange={(e) => setForm((f) => ({ ...f, toSquad: e.target.value as SwarmSquad, toAgent: undefined }))}
          >
            {squads.map((sq) => (
              <option key={sq} value={sq} className="bg-slate-900">
                {sq}
                {sq === ticket.swarmSquad ? ' (current)' : ''}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Lead agent (optional)">
          <select className={inputClass} value={form.toAgent ?? ''} onChange={(e) => set('toAgent', e.target.value || undefined)}>
            <option value="" className="bg-slate-900">Whole squad swarms</option>
            {users.filter((u) => u.active && u.squad === form.toSquad).map((a) => (
              <option key={a.name} value={a.name} className="bg-slate-900">
                {a.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Handoff reason" error={show('handoffReason')} hint={counter('handoffReason')}>
        <textarea
          rows={2}
          className={inputClass}
          value={form.handoffReason}
          onChange={(e) => set('handoffReason', e.target.value)}
          placeholder="Why does this need the receiving squad?"
        />
      </Field>
      <Field label="Diagnostics attempted" error={show('diagnosticsAttempted')} hint={counter('diagnosticsAttempted')}>
        <textarea
          rows={3}
          className={inputClass}
          value={form.diagnosticsAttempted}
          onChange={(e) => set('diagnosticsAttempted', e.target.value)}
          placeholder="What has already been checked or tried, and what did it show?"
        />
      </Field>
      <Field label="Recommended next step" error={show('recommendedNextStep')} hint={counter('recommendedNextStep')}>
        <textarea
          rows={2}
          className={inputClass}
          value={form.recommendedNextStep}
          onChange={(e) => set('recommendedNextStep', e.target.value)}
          placeholder="What should the receiving squad do first?"
        />
      </Field>
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={touched && !valid}>
          Hand off with context
        </Button>
      </div>
    </form>
  );
}
