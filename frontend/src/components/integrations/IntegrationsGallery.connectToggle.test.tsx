import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { IntegrationsGallery } from './IntegrationsGallery';
import * as api from '@/lib/builderforceApi';
import type { BoardConnection, BoardProviderMeta, IntegrationCredential } from '@/lib/builderforceApi';

vi.mock('@/lib/useConsumption', () => ({ useConsumption: () => null }));

/**
 * Connect / Disconnect on an app-integration card.
 *
 * "Connected" here is TWO stored things — the credential and the board connection polling
 * with it — and only the pair being gone makes the card's own state true. Dropping just the
 * credential leaves a connection that keeps listing and keeps failing with nothing left to
 * authenticate against, which is the regression these tests exist to catch.
 *
 * Copy is the passthrough key under the global next-intl mock; the global confirm stub
 * answers "confirmed" (see src/test/setup.ts).
 */
const jira: BoardProviderMeta = {
  id: 'jira', label: 'Jira', category: 'pm',
  externalBoardId: 'required', externalBoardIdHint: '', supportsWebhook: true, supportsDiscovery: true,
};

const credential = (id: string): IntegrationCredential => ({
  id, projectId: null, provider: 'jira', name: `Jira ${id}`, baseUrl: null,
  isEnabled: true, createdAt: '2026-01-01T00:00:00Z',
});

const connection = (id: string, provider: string): BoardConnection => ({
  id, projectId: 1, provider, credentialId: null, externalBoardId: 'BF', status: 'active',
  webhookEnabled: false, pollIntervalSec: 300, lastPolledAt: null,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
});

function mockGallery(credentials: IntegrationCredential[]) {
  vi.spyOn(api.boardConnectionsApi, 'providers').mockResolvedValue([jira]);
  vi.spyOn(api.integrationsApi, 'list').mockResolvedValue(credentials);
}

describe('IntegrationsGallery — connect/disconnect on the card', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // The action is manager-gated; the card's STATE stays visible to everyone.
    localStorage.setItem('bf_tenant', JSON.stringify({ role: 'owner' }));
  });
  afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

  it('labels the action from the connection state', async () => {
    mockGallery([]);
    render(<IntegrationsGallery />);
    expect(await screen.findByLabelText('common.connectToggle.connectAria Jira')).toHaveTextContent('common.connectToggle.connect');
  });

  it('deletes the credentials AND the connections polling with them', async () => {
    mockGallery([credential('c1'), credential('c2')]);
    vi.spyOn(api.boardConnectionsApi, 'list').mockResolvedValue([
      connection('bc1', 'jira'),
      // A different provider's connection must survive — disconnecting Jira is not a purge.
      connection('bc2', 'github'),
    ]);
    const removeConnection = vi.spyOn(api.boardConnectionsApi, 'remove').mockResolvedValue(undefined as never);
    const removeCredential = vi.spyOn(api.integrationsApi, 'remove').mockResolvedValue({ deleted: true });

    render(<IntegrationsGallery />);
    fireEvent.click(await screen.findByLabelText('common.connectToggle.disconnectAria Jira'));

    await waitFor(() => expect(removeCredential).toHaveBeenCalledTimes(2));
    expect(removeCredential).toHaveBeenCalledWith('c1');
    expect(removeCredential).toHaveBeenCalledWith('c2');
    expect(removeConnection).toHaveBeenCalledTimes(1);
    expect(removeConnection).toHaveBeenCalledWith('bc1');
  });

  it('hides the action from a member who cannot manage integrations', async () => {
    localStorage.setItem('bf_tenant', JSON.stringify({ role: 'viewer' }));
    mockGallery([credential('c1')]);
    render(<IntegrationsGallery />);
    // The state is still reported — only the ability to change it is withheld.
    expect(await screen.findByText(/integrations\.gallery\.connected/)).toBeInTheDocument();
    expect(screen.queryByLabelText('common.connectToggle.disconnectAria Jira')).not.toBeInTheDocument();
  });
});
