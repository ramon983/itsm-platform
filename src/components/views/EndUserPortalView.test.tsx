import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { AppShell } from '@/components/shell/AppShell';
import { DashboardView } from '@/components/views/DashboardView';
import { EndUserPortalView } from '@/components/views/EndUserPortalView';
import { usePlatformStore } from '@/store/usePlatformStore';

beforeEach(() => {
  localStorage.clear();
  act(() => usePlatformStore.getState().resetDemo());
});

const inspector = () => screen.getByRole('complementary', { name: 'Live structured template inspector' });

describe('EndUserPortalView', () => {
  it('Spanish preset: animates the 3 AI steps, replies in Spanish and populates the template', async () => {
    const user = userEvent.setup();
    render(<EndUserPortalView stepMs={1} />);
    await user.click(screen.getByRole('button', { name: /Spanish · VPN drop/ }));

    expect(within(inspector()).getByText(/1\. Detecting Language & Sentiment/)).toBeInTheDocument();
    expect(await screen.findByText(/Hola María, siento mucho/, { selector: '[lang="es"]:not(p)' })).toBeInTheDocument();
    const panel = inspector();
    expect(await within(panel).findByText('#INC-NET-04')).toBeInTheDocument();
    expect(within(panel).getByText('Spanish')).toBeInTheDocument();
    expect(within(panel).getByText('Urgent Client Impact')).toBeInTheDocument();
    expect(within(panel).getByText(/Deadline in 45 min → P1/)).toBeInTheDocument();
    expect(await within(panel).findByText(/MBP-0942 · C02FK3ZHMD6T/)).toBeInTheDocument();
    expect(within(panel).getByText(/English for the agent:/)).toBeInTheDocument();
  });

  it('Submit & Route creates a ticket that immediately appears on the dashboard board', async () => {
    const user = userEvent.setup();
    render(<EndUserPortalView stepMs={1} />);
    await user.click(screen.getByRole('button', { name: /French · Cracked MacBook/ }));
    await user.click(await screen.findByRole('button', { name: /Submit & Route to Swarm Queue/ }));

    const created = usePlatformStore.getState().tickets[0]!;
    expect(created).toMatchObject({
      id: 'SR-2089', channel: 'Portal', templateId: '#SR-HW-01', detectedLanguage: 'fr', status: 'AI_TRIAGED',
      swarmSquad: 'Endpoint & Mac', linkedAssetId: 'MBP-1004', requesterName: 'Camille Laurent',
    });
    expect(created.messages[0]).toMatchObject({ role: 'end_user', originalLang: 'fr', translatedText: expect.stringContaining('cracked') });
    expect(await screen.findByText(/Votre ticket SR-2089/)).toBeInTheDocument();

    render(<AppShell><DashboardView /></AppShell>);
    expect(screen.getAllByText('SR-2089').length).toBeGreaterThan(0);
  });

  it('freeform message in a new language with a missing field asks one clarifying question', async () => {
    const user = userEvent.setup();
    render(<EndUserPortalView stepMs={1} />);
    await user.selectOptions(screen.getByLabelText('Signed-in employee'), 'haruto.tanaka@adminzero.io');
    await user.type(screen.getByLabelText('Message'), 'ライセンスが必要です{Enter}');
    expect(await screen.findByText(/どのアプリケーションへのアクセスが必要ですか？/, { selector: '[lang="ja"]:not(p)' })).toBeInTheDocument();
    expect(await within(inspector()).findByText('Missing — asked user')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Message'), 'Figmaの編集ライセンスです{Enter}');
    expect(await within(inspector()).findByText('Figma Enterprise')).toBeInTheDocument();
  });
});
