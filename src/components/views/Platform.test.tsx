import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import Home from '@/app/page';
import { EndUserPortalView } from '@/components/views/EndUserPortalView';
import { usePlatformStore } from '@/store/usePlatformStore';

beforeEach(() => {
  localStorage.clear();
  window.location.hash = '';
  act(() => usePlatformStore.getState().resetDemo());
});

const nav = () => screen.getByRole('navigation', { name: 'Main' });
const go = async (user: ReturnType<typeof userEvent.setup>, label: string) => user.click(within(nav()).getByRole('button', { name: new RegExp(`^${label}`) }));

describe('platform navigation & modules', () => {
  it('ITSM section lists Tickets, Problems, Changes and Knowledge', () => {
    render(<Home />);
    for (const label of ['Tickets', 'Problems', 'Changes', 'Knowledge']) expect(within(nav()).getByRole('button', { name: new RegExp(`^${label}`) })).toBeInTheDocument();
  });

  it('turning a module off in Admin removes it from navigation, Home widgets and ticket side panels', async () => {
    const user = userEvent.setup();
    render(<Home />);
    expect(within(nav()).getByRole('button', { name: /^SaaS apps/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Admin console/ }));
    await user.click(within(screen.getByRole('navigation', { name: 'Admin sections' })).getByRole('button', { name: /Modules/ }));
    await user.click(screen.getByRole('switch', { name: 'Torii SaaS module' }));
    await user.click(screen.getByRole('switch', { name: 'Dual AI Agents module' }));
    expect(within(nav()).queryByRole('button', { name: /^SaaS apps/ })).not.toBeInTheDocument();
    expect(within(nav()).queryByRole('button', { name: /^Employee portal/ })).not.toBeInTheDocument();
    await go(user, 'Home');
    expect(screen.queryByText('Monthly SaaS Spend')).not.toBeInTheDocument();
    await go(user, 'Tickets');
    expect(screen.queryByRole('region', { name: 'AI Copilot' })).not.toBeInTheDocument();
    expect(usePlatformStore.getState().auditLog[0]).toMatchObject({ action: 'Module disabled', entity: 'ai_agents' });
  });
});

describe('tickets workspace', () => {
  it('pauses the SLA from the workspace and requires handoff context to change squad', async () => {
    const user = userEvent.setup();
    render(<Home />);
    await go(user, 'Tickets');
    await user.click(screen.getAllByText('VPN failing before client pitch in 45 minutes')[0]!);
    const workspace = screen.getByRole('region', { name: 'Ticket INC-1049' });
    await user.selectOptions(within(workspace).getByLabelText('Status'), 'WAITING_ON_CUSTOMER');
    expect(usePlatformStore.getState().tickets.find((t) => t.id === 'INC-1049')!.slaPaused).toBe(true);
    await user.selectOptions(within(workspace).getByLabelText('Swarm squad'), 'Endpoint & Mac');
    expect(screen.getByRole('dialog', { name: 'Hand off INC-1049' })).toBeInTheDocument();
  });

  it('copilot cites KB-402 and the agent can resolve with it in one approved click', async () => {
    const user = userEvent.setup();
    render(<Home />);
    await go(user, 'Tickets');
    await user.click(screen.getAllByText('VPN failing before client pitch in 45 minutes')[0]!);
    const copilot = screen.getByRole('region', { name: 'AI Copilot' });
    expect(within(copilot).getByText(/Grounded · \d+ sources/)).toBeInTheDocument();
    await user.click(within(copilot).getByRole('button', { name: 'Resolve with KB-402' }));
    expect(usePlatformStore.getState().tickets.find((t) => t.id === 'INC-1049')).toMatchObject({ status: 'RESOLVED_KB_LINKED', linkedKbId: 'KB-402' });
  });

  it('AI draft fills a bilingual reply that is sent in the requester’s language', async () => {
    const user = userEvent.setup();
    render(<Home />);
    await go(user, 'Tickets');
    await user.click(screen.getAllByText('VPN failing before client pitch in 45 minutes')[0]!);
    await user.click(screen.getByRole('button', { name: 'AI draft empathetic reply' }));
    await user.click(screen.getByRole('button', { name: 'Send' }));
    const last = usePlatformStore.getState().tickets.find((t) => t.id === 'INC-1049')!.messages.at(-1)!;
    expect(last).toMatchObject({ role: 'agent', originalLang: 'es' });
    expect(last.originalText).toMatch(/^Hola María/);
    expect(last.translatedText).toMatch(/^Hi María/);
  });
});

describe('knowledge → portal deflection', () => {
  it('publishing the AI-drafted Outlook article makes the portal solve it without a ticket', async () => {
    const user = userEvent.setup();
    render(<Home />);
    await go(user, 'Knowledge');
    const outlook = screen.getByRole('heading', { name: /Outlook Calendar/ }).closest('div.rounded-xl') as HTMLElement;
    await user.click(within(outlook).getByRole('button', { name: /Review & publish article/ }));
    const dialog = screen.getByRole('dialog', { name: 'Publish article' });
    expect(within(dialog).getByRole('checkbox', { name: /Let the portal AI answer employees/ })).toBeChecked();
    await user.click(within(dialog).getByRole('button', { name: 'Publish' }));
    const published = usePlatformStore.getState().kbArticles.at(-1)!;
    expect(usePlatformStore.getState().kbStats[published.id]!.selfServiceEnabled).toBe(true);

    const ticketsBefore = usePlatformStore.getState().tickets.length;
    render(<EndUserPortalView stepMs={1} />);
    await user.click(screen.getByRole('button', { name: /English · Outlook calendar/ }));
    const fix = await screen.findByRole('generic', { name: 'Suggested self-service fix' });
    await user.click(within(fix).getByRole('button', { name: 'That fixed it' }));
    expect(screen.getByText('Solved by self-service — no human needed.')).toBeInTheDocument();
    expect(usePlatformStore.getState().tickets).toHaveLength(ticketsBefore);
    expect(usePlatformStore.getState().kbStats[published.id]!.deflections).toBe(1);
  });
});

describe('admin API playground', () => {
  it('firing the Sentinel webhook (simulated) creates a P1 linked to MBP-0942 on the board', async () => {
    const user = userEvent.setup();
    render(<Home />);
    await user.click(screen.getByRole('button', { name: /^Admin console/ }));
    await user.click(screen.getByRole('button', { name: /API & webhooks/ }));
    expect(screen.getByText(/Simulated in your browser/)).toBeInTheDocument();
    const before = usePlatformStore.getState().tickets.length;
    await user.click(screen.getByRole('button', { name: 'Fire live request' }));
    expect(await screen.findByText(/is on the board/)).toBeInTheDocument();
    const t = usePlatformStore.getState().tickets[0]!;
    expect(usePlatformStore.getState().tickets).toHaveLength(before + 1);
    expect(t).toMatchObject({ priority: 'P1', channel: 'SIEM Webhook', linkedAssetId: 'MBP-0942', swarmSquad: 'Security & SIEM' });
    expect(t.activeSwarmAgents).toContain('Noor Haddad'); // SIEM automation ran
  });
});
