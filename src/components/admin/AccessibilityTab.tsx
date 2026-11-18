'use client';

import { CheckCircle2, CircleDashed } from 'lucide-react';

import { Card } from '@/components/ui/primitives';

const MET: [string, string][] = [
  ['1.1.1 / 1.3.1 Text alternatives & structure', 'Icons have text labels; landmarks, headings, tables and forms are marked up semantically.'],
  ['1.3.5 / 3.3.2 Labels & purpose', 'Every input has a visible or programmatic label.'],
  ['1.4.1 Use of colour', 'Status, priority and tool health use icon shapes and text, never colour alone.'],
  ['1.4.3 Contrast (AA) / 1.4.6 (AAA)', 'All text ≥ 4.5:1 in Light and Dark; ≥ 7:1 in High contrast (verified in Chrome).'],
  ['1.4.4 / 1.4.10 Resize & reflow', 'rem-based sizing; layouts reflow to a single column on narrow screens.'],
  ['1.4.11 Non-text contrast', 'Form-field boundaries and focus indicators ≥ 3:1.'],
  ['2.1.1 / 2.1.2 Keyboard, no traps', 'Everything works by keyboard; dialogs trap focus while open and release it on close.'],
  ['2.2.2 Pause, stop, hide', 'The spotlight carousel pauses on hover/focus and has a Pause button.'],
  ['2.3.3 / prefers-reduced-motion', 'Animations are disabled when the OS asks for reduced motion.'],
  ['2.4.1 Bypass blocks', '“Skip to main content” link.'],
  ['2.4.3 / 2.4.7 / 2.4.13 Focus', 'Logical focus order; thick high-contrast focus outline (AAA focus appearance).'],
  ['2.5.7 Dragging movements', 'Drag-and-drop on the board always has a click/keyboard alternative.'],
  ['2.5.8 Target size (minimum)', 'Interactive targets are at least 24×24 px.'],
  ['3.1.2 Language of parts', 'Messages in other languages are marked with their language for screen readers.'],
  ['3.2.6 Consistent help', 'Keyboard shortcuts and this page are reachable from the same place on every screen.'],
  ['4.1.2 / 4.1.3 Name, role, value & status messages', 'ARIA roles on tabs, switches, dialogs and listboxes; toasts announced via a live region.'],
];

const NOT_YET: [string, string][] = [
  ['Manual screen-reader testing', 'Planned with NVDA, JAWS and VoiceOver. Automated checks catch structure, not every reading experience.'],
  ['Third-party audit & VPAT / ACR', 'An independent WCAG 2.2 audit and Accessibility Conformance Report before general availability.'],
  ['Charts', 'Charts have text summaries; data-table alternatives for every chart are planned.'],
];

export function AccessibilityTab() {
  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Accessibility</h2>
        <p className="text-sm text-slate-400">
          Target: <strong className="text-slate-100">WCAG 2.2 Level AA</strong> everywhere, with an <strong className="text-slate-100">AAA High-contrast theme</strong>.
        </p>
      </div>
      <Card className="space-y-2 p-4 text-sm">
        <h3 className="font-semibold">How we test</h3>
        <ul className="list-disc space-y-1 pl-5 text-slate-300">
          <li>Every build runs axe-core (WCAG 2.0 / 2.1 / 2.2 A & AA rules) on all 11 pages in Dark, Light and High-contrast themes in real Chrome. Any violation fails the build.</li>
          <li>Unit tests run axe structural checks on every page.</li>
          <li>High-contrast text-on-fill pairs are measured from the rendered colours (all ≥ 7:1).</li>
        </ul>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h3 className="mb-2 text-sm font-semibold">What we meet today</h3>
          <ul className="space-y-2 text-xs">
            {MET.map(([k, v]) => (
              <li key={k} className="flex gap-2">
                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-400" aria-hidden />
                <span><span className="font-medium text-slate-100">{k}</span> — <span className="text-slate-300">{v}</span></span>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="p-4">
          <h3 className="mb-2 text-sm font-semibold">Not yet done (being honest)</h3>
          <ul className="space-y-2 text-xs">
            {NOT_YET.map(([k, v]) => (
              <li key={k} className="flex gap-2">
                <CircleDashed className="mt-0.5 size-3.5 shrink-0 text-amber-300" aria-hidden />
                <span><span className="font-medium text-slate-100">{k}</span> — <span className="text-slate-300">{v}</span></span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-slate-400">Found a barrier? <a className="text-indigo-300 underline" href="https://github.com/ramon983/itsm-platform/issues/new?labels=accessibility" target="_blank" rel="noreferrer">Report it as an accessibility issue</a> — barriers are treated as bugs, not feature requests.</p>
        </Card>
      </div>
    </section>
  );
}
