import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import Home from '@/app/page';
import { usePlatformStore } from '@/store/usePlatformStore';

const store = () => usePlatformStore.getState();

beforeEach(() => {
  localStorage.clear();
  window.location.hash = '';
  act(() => store().resetDemo());
});

describe('one-person IT shop ↔ large IT org', () => {
  it('Solo folds every squad into one IT team, removes handoffs, and allows audited self-approval', async () => {
    act(() => { store().setOrgProfile('solo'); });
    expect(store().squads).toEqual(['IT']);
    expect(new Set(store().tickets.map((t) => t.swarmSquad))).toEqual(new Set(['IT']));
    expect(store().aiSettings.autonomy).toBe('auto_resolve_low_risk');

    const id = store().createChange({
      title: 'Rotate Wi-Fi PSK in the office', description: 'Quarterly key rotation', swarmSquad: 'IT', impact: 5, affectedAssetIds: [],
      testedInStaging: false, outsideMaintenanceWindow: true, touchesSecurityControls: true,
      windowStart: new Date().toISOString(), windowEnd: new Date(Date.now() + 3600_000).toISOString(), implementationPlan: 'Update controller and notify staff', rollbackPlan: null,
    });
    expect(store().decideCab(id, true).ok).toBe(false); // needs a reason
    expect(store().decideCab(id, true, 'Low-traffic window, I am the only admin').ok).toBe(true);
    expect(store().auditLog[0]).toMatchObject({ action: 'Solo self-approved' });

    const user = userEvent.setup();
    render(<Home />);
    await user.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: /^Tickets/ }));
    expect(screen.queryByRole('button', { name: /Hand off/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Swarm squad')).toBeDisabled();
  });

  it('Enterprise keeps separation of duties and supports custom squads (rename moves the work)', () => {
    act(() => { store().setOrgProfile('enterprise'); });
    expect(store().addSquad('Service Desk – EMEA').ok).toBe(true);
    expect(store().renameSquad('Network & Identity', 'Network Engineering').ok).toBe(true);
    expect(store().tickets.find((t) => t.id === 'INC-1049')!.swarmSquad).toBe('Network Engineering');
    expect(store().users.find((u) => u.name === 'Alex Rivera')!.squad).toBe('Network Engineering');
    expect(store().removeSquad('Security & SIEM', 'Service Desk – EMEA').ok).toBe(true);
    expect(store().tickets.find((t) => t.id === 'INC-1047')!.swarmSquad).toBe('Service Desk – EMEA');
    // a SIEM alert still lands somewhere sensible once the Security squad is gone
    const id = store().simulateSentinelAlert();
    expect(store().squads).toContain(store().tickets.find((t) => t.id === id)!.swarmSquad);
  });
});

describe('keyboard-first', () => {
  it('? opens the cheat sheet; g then t goes to Tickets; j moves through the queue', async () => {
    const user = userEvent.setup();
    render(<Home />);
    await user.keyboard('?');
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.keyboard('gt');
    expect(store().activeView).toBe('tickets');
    await user.keyboard('j');
    const first = store().selectedTicketId;
    await user.keyboard('j');
    expect(store().selectedTicketId).not.toBe(first);
  });

  it('dialogs trap focus and return it to the opener', async () => {
    const user = userEvent.setup();
    render(<Home />);
    const opener = screen.getByRole('button', { name: 'Keyboard shortcuts and help' });
    await user.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
    for (let i = 0; i < 5; i += 1) await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.keyboard('{Escape}');
    expect(document.activeElement).toBe(opener);
  });
});
