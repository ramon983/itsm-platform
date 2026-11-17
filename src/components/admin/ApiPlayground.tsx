'use client';

import clsx from 'clsx';
import { Check, Copy, Play, Radio, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useState } from 'react';

import { Button, Card, Field, inputClass } from '@/components/ui/primitives';
import { API_BASE, API_MODE, getHealth, getSaasDiscovery, postIntake, postSiemWebhook, type ApiResult, type SiemApiResponse } from '@/lib/api';
import { usePlatformStore } from '@/store/usePlatformStore';

type EndpointKey = 'siem' | 'intake' | 'discovery' | 'health';
type SiemSource = 'sentinel' | 'splunk' | 'datadog';

const ENDPOINTS: { key: EndpointKey; method: 'GET' | 'POST'; path: string; label: string; liveOnly?: boolean }[] = [
  { key: 'siem', method: 'POST', path: '/api/v1/siem/webhook', label: 'SIEM webhook → auto P1' },
  { key: 'intake', method: 'POST', path: '/api/v1/tickets/intake', label: 'Multilingual AI intake' },
  { key: 'discovery', method: 'GET', path: '/api/v1/saas/discovery', label: 'SaaS spend & seats' },
  { key: 'health', method: 'GET', path: '/api/v1/health', label: 'Health & Secret Manager', liveOnly: true },
];

const SIEM_SAMPLES: Record<SiemSource, object> = {
  sentinel: {
    properties: {
      systemAlertId: `sent-${Math.floor(Math.random() * 9000) + 1000}`,
      alertDisplayName: 'Okta MFA brute force',
      severity: 'High',
      entities: [
        { kind: 'Host', hostName: 'maria-mbp' },
        { kind: 'Ip', address: '45.83.12.9' },
        { kind: 'Account', upn: 'maria.gonzalez@adminzero.io' },
      ],
    },
  },
  splunk: { sid: 'scheduler__soc__suspicious_ps', search_name: 'Suspicious PowerShell execution', result: { host: '10.40.1.88', user: 'priya.shah@adminzero.io', severity: 'critical' } },
  datadog: { id: 'dd-48121', title: 'Core switch CPU saturation', priority: 'P2', alert_type: 'error', tags: 'host:lis-f3-core,env:prod' },
};

const INTAKE_SAMPLE = {
  message: 'Hola, no puedo conectarme a la VPN desde esta mañana y tengo una presentación con un cliente en 45 minutos.',
  requester_name: 'María González',
  requester_email: 'maria.gonzalez@adminzero.io',
  context: { kb_articles: [{ id: 'KB-402', title: 'Cisco AnyConnect drops: re-push split-tunnel certificate', steps: ['Quit and reopen Cisco AnyConnect.'] }] },
};

const pretty = (v: unknown) => JSON.stringify(v, null, 2);

export function ApiPlayground() {
  const assets = usePlatformStore((s) => s.assets);
  const saasApps = usePlatformStore((s) => s.saasApps);
  const ingestSiemAlert = usePlatformStore((s) => s.ingestSiemAlert);
  const selectTicket = usePlatformStore((s) => s.selectTicket);
  const setView = usePlatformStore((s) => s.setView);
  const [endpoint, setEndpoint] = useState<EndpointKey>('siem');
  const [source, setSource] = useState<SiemSource>('sentinel');
  const [body, setBody] = useState(pretty(SIEM_SAMPLES.sentinel));
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<(ApiResult<unknown> & { signature?: string; timestamp?: string }) | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const ep = ENDPOINTS.find((e) => e.key === endpoint)!;
  const path = endpoint === 'siem' ? `${ep.path}?source=${source}` : ep.path;
  const jsonError = (() => {
    if (ep.method === 'GET') return null;
    try {
      JSON.parse(body);
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  })();

  const choose = (key: EndpointKey) => {
    setEndpoint(key);
    setResult(null);
    setCreated(null);
    if (key === 'siem') setBody(pretty(SIEM_SAMPLES[source]));
    if (key === 'intake') setBody(pretty(INTAKE_SAMPLE));
  };

  const fire = async () => {
    setBusy(true);
    setCreated(null);
    try {
      if (endpoint === 'siem') {
        const res = await postSiemWebhook(source, body, { secret: secret || undefined, assets });
        setResult(res);
        if (res.ok) setCreated(ingestSiemAlert(res.body as SiemApiResponse, res.mode));
      } else if (endpoint === 'intake') {
        setResult(await postIntake(JSON.parse(body), { assets, saasApps }));
      } else if (endpoint === 'discovery') {
        setResult(await getSaasDiscovery(saasApps));
      } else {
        setResult(await getHealth());
      }
    } finally {
      setBusy(false);
    }
  };

  const curl = [
    `curl -X ${ep.method} '${API_BASE || 'https://<your-cloud-run-url>'}${path}'`,
    ...(ep.method === 'POST' ? [`  -H 'Content-Type: application/json'`] : []),
    ...(endpoint === 'siem' ? [`  -H "X-AdminZero-Timestamp: $TS"`, `  -H "X-AdminZero-Signature: sha256=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$SIEM_WEBHOOK_SECRET" -r | cut -d' ' -f1)"`] : []),
    ...(ep.method === 'POST' ? [`  --data "$BODY"`] : []),
  ].join(' \\\n');

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Open API & webhook playground</h2>
        <p className="text-sm text-slate-400">Edit a payload and fire it. SIEM alerts are correlated with the CMDB and become P1 incidents on the board.</p>
      </div>

      <Card className={clsx('flex items-center gap-3 p-3 text-sm', API_MODE === 'live' ? 'border-emerald-500/30' : 'border-amber-500/30')}>
        <Radio className={clsx('size-4', API_MODE === 'live' ? 'text-emerald-400' : 'text-amber-300')} />
        {API_MODE === 'live' ? (
          <span>Live API: <span className="font-mono text-emerald-200">{API_BASE}</span></span>
        ) : (
          <span>
            <span className="text-amber-200">Simulated in your browser</span> — no backend URL is configured for this build. Same contract as the FastAPI service; set the
            <span className="font-mono"> ADMINZERO_API_URL</span> repo variable to go live.
          </span>
        )}
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="space-y-3 p-4">
          <div className="flex flex-wrap gap-1.5">
            {ENDPOINTS.map((e) => (
              <button
                key={e.key}
                type="button"
                disabled={e.liveOnly && API_MODE !== 'live'}
                onClick={() => choose(e.key)}
                aria-pressed={endpoint === e.key}
                title={e.liveOnly && API_MODE !== 'live' ? 'Needs the live backend' : undefined}
                className={clsx('rounded-lg border px-2.5 py-1.5 text-left text-xs transition disabled:cursor-not-allowed disabled:opacity-40', endpoint === e.key ? 'border-indigo-500/40 bg-indigo-500/15 text-indigo-100' : 'border-white/[0.08] text-slate-400 hover:text-slate-200')}
              >
                <span className={clsx('mr-1.5 font-mono font-semibold', e.method === 'GET' ? 'text-emerald-300' : 'text-sky-300')}>{e.method}</span>
                {e.label}
              </button>
            ))}
          </div>
          <p className="font-mono text-xs text-slate-300"><span className={ep.method === 'GET' ? 'text-emerald-300' : 'text-sky-300'}>{ep.method}</span> {path}</p>

          {endpoint === 'siem' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Source">
                <select className={inputClass} value={source} onChange={(e) => { const s = e.target.value as SiemSource; setSource(s); setBody(pretty(SIEM_SAMPLES[s])); }}>
                  <option value="sentinel" className="bg-slate-900">Microsoft Sentinel</option>
                  <option value="splunk" className="bg-slate-900">Splunk</option>
                  <option value="datadog" className="bg-slate-900">Datadog</option>
                </select>
              </Field>
              <Field label="Signing secret" hint={API_MODE === 'live' ? 'Required — HMAC is computed in your browser and never stored' : 'Optional in simulation'}>
                <input type="password" autoComplete="off" className={inputClass} value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="SIEM_WEBHOOK_SECRET" aria-label="Signing secret" />
              </Field>
            </div>
          )}

          {ep.method === 'POST' && (
            <Field label="JSON body" error={jsonError ?? undefined}>
              <textarea aria-label="Request body" rows={14} spellCheck={false} className={clsx(inputClass, 'font-mono text-[11px] leading-relaxed')} value={body} onChange={(e) => setBody(e.target.value)} />
            </Field>
          )}

          <div className="flex items-center gap-2">
            <Button variant="primary" onClick={fire} disabled={busy || !!jsonError || (endpoint === 'siem' && API_MODE === 'live' && !secret)}>
              <Play className="size-4" />{busy ? 'Sending…' : 'Fire live request'}
            </Button>
            <Button
              variant="ghost"
              onClick={async () => {
                await navigator.clipboard.writeText(curl);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? <Check className="size-4 text-emerald-400" /> : <Copy className="size-4" />}Copy as curl
            </Button>
          </div>
        </Card>

        <Card className="flex min-h-[420px] flex-col p-4">
          <div className="mb-2 flex items-center gap-2 text-xs">
            <span className="font-semibold text-slate-300">Response</span>
            {result && (
              <>
                <span className={clsx('rounded-md px-1.5 py-0.5 font-mono', result.ok ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300')}>{result.status || 'ERR'}</span>
                <span className="font-mono text-slate-500">{result.ms} ms</span>
                <span className={clsx('rounded-full border px-1.5 py-0.5 text-[10px]', result.mode === 'live' ? 'border-emerald-500/30 text-emerald-300' : 'border-amber-500/30 text-amber-300')}>{result.mode}</span>
                {'engine' in (result.body as object) && <span className="rounded-full border border-sky-500/30 px-1.5 py-0.5 text-[10px] text-sky-300">engine: {(result.body as { engine: string }).engine}</span>}
              </>
            )}
          </div>
          {result?.signature && (
            <p className="mb-2 flex items-center gap-1.5 break-all font-mono text-[10px] text-slate-500">
              <ShieldCheck className="size-3 shrink-0 text-emerald-400" />X-AdminZero-Timestamp: {result.timestamp} · X-AdminZero-Signature: {result.signature}
            </p>
          )}
          {created && (
            <div className="mb-2 flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/[0.08] p-2 text-xs text-rose-100">
              <TriangleAlert className="size-3.5 text-rose-300" />P1 <span className="font-mono">{created}</span> is on the board.
              <Button size="sm" className="ml-auto" onClick={() => { selectTicket(created); setView('tickets'); }}>Open ticket</Button>
            </div>
          )}
          <pre className="flex-1 overflow-auto rounded-lg bg-code p-3 font-mono text-[11px] leading-relaxed text-slate-300" aria-label="Response body">
            {result ? pretty(result.body) : 'Fire a request to see the response.'}
          </pre>
          <details className="mt-2 text-[11px] text-slate-500">
            <summary className="cursor-pointer">curl</summary>
            <pre className="mt-1 overflow-x-auto rounded-md bg-code p-2 font-mono">{curl}</pre>
          </details>
        </Card>
      </div>
    </section>
  );
}
