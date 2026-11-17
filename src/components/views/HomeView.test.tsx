import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HomeView } from '@/components/views/HomeView';
import { usePlatformStore } from '@/store/usePlatformStore';

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

beforeEach(() => {
  localStorage.clear();
  act(() => usePlatformStore.getState().resetDemo());
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('figma')) {
      return ok({ status: { indicator: 'major', description: 'Partial System Outage' }, components: [{ name: 'Multiplayer editing', status: 'partial_outage', group: false }],
        incidents: [{ name: 'Files failing to load', status: 'investigating', impact: 'major', shortlink: 'https://status.figma.com/x', incident_updates: [{ body: 'We are investigating reports of files not loading.' }], components: [{ name: 'Multiplayer editing' }] }] });
    }
    if (url.includes('slack-status')) return ok({ status: 'ok', active_incidents: [] });
    if (url.includes('salesforce')) return ok([]);
    if (url.includes('nager')) return ok([]);
    return ok({ status: { indicator: 'none', description: 'All Systems Operational' }, components: [], incidents: [] });
  }));
});

describe('Home', () => {
  it('shows exactly four at-a-glance cards', () => {
    render(<HomeView />);
    const glance = screen.getByRole('region', { name: 'At a glance' });
    for (const title of ['Last 7 days', 'On call now', 'Needs a human', 'SLA health · 30 days']) expect(within(glance).getByText(title)).toBeInTheDocument();
  });

  it('flags tools with issues first and shows what is down', async () => {
    const user = userEvent.setup();
    render(<HomeView />);
    expect(await screen.findByText('1 tool having issues')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Figma/ }));
    const dialog = screen.getByRole('dialog', { name: /Figma — Partial outage/ });
    expect(within(dialog).getByText('Multiplayer editing')).toBeInTheDocument();
    expect(within(dialog).getByText('We are investigating reports of files not loading.')).toBeInTheDocument();
    expect(within(screen.getAllByRole('link', { name: /Okta/ })[0]!.closest('li')!).getByText('Status page')).toBeInTheDocument();
  });

  it('lets you choose tools from the catalog', async () => {
    const user = userEvent.setup();
    render(<HomeView />);
    await user.click(screen.getByRole('button', { name: /Manage tools/ }));
    const dialog = screen.getByRole('dialog', { name: 'Choose the tools to watch' });
    await user.type(within(dialog).getByLabelText('Search tools'), '1pass');
    await user.click(within(dialog).getByRole('checkbox'));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(usePlatformStore.getState().selectedTools).toContain('1password');
  });

  it('celebrations: send wishes once; availability: add time off', async () => {
    const user = userEvent.setup();
    render(<HomeView />);
    await user.click(screen.getAllByRole('button', { name: /Wish/ })[0]!);
    expect(usePlatformStore.getState().wishes).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: /Add time off/ }));
    const dialog = screen.getByRole('dialog', { name: 'Add time off' });
    await user.selectOptions(within(dialog).getByLabelText('Who'), 'Noor Haddad');
    await user.click(within(dialog).getByRole('button', { name: 'Add' }));
    expect(usePlatformStore.getState().timeOff.some((t) => t.person === 'Noor Haddad')).toBe(true);
  });

  it('spotlight: kudos and adding a pet', async () => {
    const user = userEvent.setup();
    render(<HomeView />);
    const first = usePlatformStore.getState().spotlight[0]!;
    await user.click(screen.getByRole('button', { name: `Give kudos to ${first.name}` }));
    expect(usePlatformStore.getState().spotlight[0]!.kudos).toBe(first.kudos + 1);
    await user.click(screen.getByRole('button', { name: /Add someone/ }));
    const dialog = screen.getByRole('dialog', { name: 'Add to the spotlight' });
    await user.type(within(dialog).getByLabelText('Name'), 'Waffles');
    await user.type(within(dialog).getByLabelText('Fun fact'), 'Steals socks from every desk on Fridays.');
    await user.click(within(dialog).getByRole('button', { name: 'Add to spotlight' }));
    expect(usePlatformStore.getState().spotlight[0]!.name).toBe('Waffles');
  });
});
