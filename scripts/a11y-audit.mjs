// Accessibility gate: runs axe-core (WCAG 2.0/2.1/2.2 A + AA + best practice) in real headless Chrome on every
// page in every theme, and exits non-zero on any violation. Used locally and in CI.
// Usage: node scripts/a11y-audit.mjs <baseUrl> node_modules/axe-core/axe.min.js
// Requires Chrome listening on 127.0.0.1:9333 (--remote-debugging-port=9333). THEMES=dark,light,contrast by default.
// Note: AAA enhanced contrast for the High contrast theme is verified separately — axe misreads CSS lab() colours.
import fs from 'node:fs';
const [base, axePath, level] = process.argv.slice(2);
const axeSrc = fs.readFileSync(axePath, 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const views = ['dashboard', 'tickets', 'problems', 'changes', 'knowledge', 'reports', 'portal', 'saas', 'assets', 'vault', 'admin'];
const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice', ...(level === 'aaa' ? ['wcag2aaa'] : [])];
const summary = {};
for (const theme of (process.env.THEMES ?? 'dark,light,contrast').split(',')) {
  for (const view of views) {
    const target = await (await fetch(`http://127.0.0.1:9333/json/new?${encodeURIComponent(`${base}/#${view}`)}`, { method: 'PUT' })).json();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener('open', r));
    let id = 0; const pending = new Map();
    ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); pending.get(m.id)?.(m); pending.delete(m.id); });
    const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await sleep(2500);
    await send('Runtime.evaluate', { expression: `localStorage.setItem('x','1');(()=>{const r=document.querySelector('[role=radio][aria-label=${theme === 'contrast' ? '"High contrast"' : theme === 'light' ? 'Light' : 'Dark'}]'); r && r.click();})()` });
    await sleep(600);
    await send('Runtime.evaluate', { expression: axeSrc });
    const r = await send('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `axe.run(document, { runOnly: { type: 'tag', values: ${JSON.stringify(tags)} }, resultTypes: ['violations'] }).then(r => r.violations.map(v => ({ id: v.id, impact: v.impact, n: v.nodes.length, sample: v.nodes.slice(0,3).map(n => (n.any[0]?.message || n.failureSummary || '').slice(0,160) + ' @ ' + n.target.join(' ').slice(0,90)) })))` });
    const v = r.result?.result?.value ?? [{ id: 'ERROR', n: 1, sample: [JSON.stringify(r).slice(0, 200)] }];
    for (const x of v) { const k = `${x.id} [${x.impact}]`; summary[k] ??= { count: 0, where: new Set(), sample: x.sample }; summary[k].count += x.n; summary[k].where.add(`${theme}:${view}`); }
    await send('Target.closeTarget', { targetId: target.id }).catch(() => {});
    ws.close();
  }
}
const rows = Object.entries(summary).sort((a, b) => b[1].count - a[1].count);
if (!rows.length) console.log('NO VIOLATIONS');
for (const [k, v] of rows) { console.log(`${String(v.count).padStart(4)}  ${k}  (${[...v.where].slice(0,6).join(', ')}${v.where.size > 6 ? '…' : ''})`); for (const s of v.sample) console.log('        - ' + s); }

process.exit(rows.length ? 1 : 0);
