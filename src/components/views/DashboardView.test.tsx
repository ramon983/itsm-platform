import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { AppShell } from '@/components/shell/AppShell';
import { DashboardView } from '@/components/views/DashboardView';
import { usePlatformStore } from '@/store/usePlatformStore';

function renderApp() {
  return render(
    <AppShell>
      <DashboardView />
    </AppShell>,
  );
}

beforeEach(() => {
  localStorage.clear();
  act(() => usePlatformStore.getState().resetDemo());
});

describe('DashboardView', () => {
  it('opens the inspector and pauses the SLA when switched to Waiting on Customer', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByText('VPN failing before client pitch in 45 minutes'));
    const drawer = screen.getByRole('dialog', { name: 'Ticket inspector' });
    await user.selectOptions(within(drawer).getByLabelText('Status'), 'WAITING_ON_CUSTOMER');
    expect(within(drawer).getByText('SLA paused — timer frozen')).toBeInTheDocument();
    expect(usePlatformStore.getState().tickets.find((t) => t.id === 'INC-1049')!.slaPaused).toBe(true);
  });

  it('changing the swarm squad opens the mandatory handoff modal instead of moving silently', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByText('VPN failing before client pitch in 45 minutes'));
    const drawer = screen.getByRole('dialog', { name: 'Ticket inspector' });
    await user.selectOptions(within(drawer).getByLabelText('Swarm squad'), 'Endpoint & Mac');
    expect(screen.getByRole('dialog', { name: 'Hand off INC-1049' })).toBeInTheDocument();
    expect(usePlatformStore.getState().tickets.find((t) => t.id === 'INC-1049')!.swarmSquad).toBe('Network & Identity');
  });

  it('Simulate Sentinel SIEM Alert spawns a P1 on the board', async () => {
    const user = userEvent.setup();
    renderApp();
    const before = usePlatformStore.getState().tickets.length;
    await user.click(screen.getByRole('button', { name: /Simulate Sentinel SIEM Alert/ }));
    expect(usePlatformStore.getState().tickets).toHaveLength(before + 1);
    expect(screen.getAllByText(/Sentinel: MFA brute-force on MBP-0942/).length).toBeGreaterThan(0);
  });

  it('turning a module off hides its widgets and navigation', async () => {
    const user = userEvent.setup();
    renderApp();
    expect(screen.getByText('Monthly SaaS Spend')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /SaaS Apps/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Torii SaaS' }));
    expect(screen.queryByText('Monthly SaaS Spend')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /SaaS Apps/ })).not.toBeInTheDocument();
  });

  it('Cmd+K opens the command palette and finds assets', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.keyboard('{Meta>}k{/Meta}');
    await user.type(screen.getByLabelText('Search'), 'MBP-1004');
    await user.keyboard('{Enter}');
    expect(screen.getByRole('dialog', { name: 'Asset inspector' })).toBeInTheDocument();
  });
});
