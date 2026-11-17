import { act, render } from '@testing-library/react';
import axe from 'axe-core';
import { beforeEach, describe, expect, it } from 'vitest';

import Home from '@/app/page';
import { usePlatformStore, type ViewKey } from '@/store/usePlatformStore';

// Structural WCAG 2.2 A/AA checks on every page (roles, names, labels, landmarks, headings, ARIA).
// Colour contrast is checked in real Chrome by scripts/a11y-audit.mjs — jsdom cannot compute rendered colours.
const VIEWS: ViewKey[] = ['dashboard', 'tickets', 'problems', 'changes', 'knowledge', 'reports', 'portal', 'saas', 'assets', 'vault', 'admin'];

beforeEach(() => {
  localStorage.clear();
  act(() => usePlatformStore.getState().resetDemo());
});

describe('accessibility (axe-core, WCAG 2.2 AA)', () => {
  it.each(VIEWS)('%s has no violations', async (view) => {
    window.location.hash = `#${view}`;
    const { container } = render(<Home />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const result = await axe.run(container, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      rules: { 'color-contrast': { enabled: false } },
    });
    const summary = result.violations.map((v) => `${v.id}: ${v.nodes.length} × ${v.nodes[0]?.target.join(' ')}`);
    expect(summary).toEqual([]);
  });
});
