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

const goTickets = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: /^Tickets/ }));

describe('look & feel', () => {
  it('light / dark / system theme applies to the whole app and survives a demo reset', async () => {
    const user = userEvent.setup();
    render(<Home />);
    await user.click(screen.getByRole('radio', { name: 'Light' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    await user.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    act(() => usePlatformStore.getState().resetDemo());
    expect(usePlatformStore.getState().themePreference).toBe('dark');
  });

  it('statuses carry an icon as well as colour and text (colour-blind safe)', async () => {
    const user = userEvent.setup();
    render(<Home />);
    await goTickets(user);
    const badge = screen.getAllByText('Active Swarm')[0]!;
    expect(badge.querySelector('svg')).not.toBeNull();
  });
});

describe('workspace features people love', () => {
  it('ServiceNow-style tabs keep several tickets open in one window', async () => {
    const user = userEvent.setup();
    render(<Home />);
    await goTickets(user);
    const queue = screen.getByRole('complementary', { name: 'Ticket queue' });
    await user.click(within(queue).getByText('Cracked MacBook Pro screen, needs loaner before Thursday trip'));
    const tabs = screen.getByRole('tablist', { name: 'Open tickets' });
    expect(within(tabs).getAllByRole('tab')).toHaveLength(2);
    await user.click(within(tabs).getAllByRole('tab')[0]!);
    expect(usePlatformStore.getState().selectedTicketId).not.toBe('INC-1046');
  });

  it('Zendesk-style "/" menu inserts a saved reply, and can run the macro', async () => {
    const user = userEvent.setup();
    render(<Home />);
    await goTickets(user);
    await user.click(screen.getAllByText('VPN failing before client pitch in 45 minutes')[0]!);
    const composer = screen.getByLabelText('Composer');
    await user.type(composer, '/check');
    const menu = screen.getByRole('listbox', { name: 'Slash commands' });
    expect(within(menu).getByText('Resolution check-in')).toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect((composer as HTMLTextAreaElement).value).toMatch(/^Hi María, we applied a fix/);

    await user.clear(composer);
    await user.type(composer, '/macro');
    await user.keyboard('{Enter}');
    expect(usePlatformStore.getState().tickets.find((t) => t.id === 'INC-1049')!.messages.at(-1)!.metadata?.macroId).toBe('macro-push-split-tunnel');
  });

  it('timeline filter isolates AI & automation activity; queue filters show counts', async () => {
    const user = userEvent.setup();
    render(<Home />);
    await goTickets(user);
    expect(screen.getByRole('button', { name: /P1 Empathy Priority 2/ })).toBeInTheDocument();
    await user.click(screen.getAllByText('VPN failing before client pitch in 45 minutes')[0]!);
    await user.click(screen.getByRole('tab', { name: /AI & automation/ }));
    expect(screen.queryByText(/no puedo conectarme/)).not.toBeInTheDocument();
    expect(screen.getByText(/Mapped to #INC-NET-04/)).toBeInTheDocument();
  });

  it('Freshservice-style catalog tiles start a request with one click', async () => {
    const user = userEvent.setup();
    render(<EndUserPortalView stepMs={1} />);
    await user.click(screen.getByRole('button', { name: /Reset my MFA/ }));
    expect((screen.getByLabelText('Message') as HTMLTextAreaElement).value).toMatch(/reset my Okta MFA/);
  });
});
