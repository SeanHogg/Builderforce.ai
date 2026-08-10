import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProviderKeysSettings } from './ProviderKeysSettings';
import * as api from '@/lib/builderforceApi';
import type { ProviderDiagnostic } from '@/lib/builderforceApi';

/**
 * Connect / Disconnect on the integration cards themselves.
 *
 * The cards used to state whether an account was connected and offer no way to act on it:
 * the only route to a credential was to open the card, find the right control inside the
 * drawer, and remove it there. So the states worth pinning are the ones an operator
 * actually hits from the grid — the label follows the connection, Disconnect really removes
 * the credential, and (the failure mode a nested button invites) pressing either one does
 * NOT also open the drawer behind it.
 *
 * Copy is the passthrough key under the global next-intl mock (see src/test/setup.ts); the
 * global confirm stub answers "confirmed", so the disconnect path runs to completion.
 */
function mockApi(details: Array<{ provider: api.LlmProvider; authType: api.ProviderAuthType; priority: number | null }>) {
  vi.spyOn(api.providerKeysApi, 'list').mockResolvedValue({
    providers: details.map((d) => d.provider),
    details,
  } as Awaited<ReturnType<typeof api.providerKeysApi.list>>);
  vi.spyOn(api.providerKeysApi, 'status').mockResolvedValue({
    provider: 'anthropic', configured: true, usable: true, status: 'ready',
    usage: { periodDays: 30, requests: 0, tokens: 0, lastUsedAt: null },
  } as ProviderDiagnostic);
  vi.spyOn(api.llmApi, 'usage').mockResolvedValue(null as unknown as api.LlmUsageStats);
}

/** The card action for one provider, found by its accessible name (the card itself is a
 *  role=button too, so a bare getByRole('button') would be ambiguous). */
const toggleFor = (key: 'connect' | 'disconnect', label: string) =>
  screen.getByLabelText(`common.connectToggle.${key}Aria ${label}`);

describe('ProviderKeysSettings — connect/disconnect on the card', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('offers Connect on an unconnected provider and Disconnect on a connected one', async () => {
    mockApi([{ provider: 'anthropic', authType: 'oauth', priority: 0 }]);
    render(<ProviderKeysSettings />);
    await waitFor(() => expect(screen.queryByText('providerKeys.loading')).not.toBeInTheDocument());
    expect(toggleFor('disconnect', 'Anthropic (Claude)')).toHaveTextContent('common.connectToggle.disconnect');
    // Everything else in the catalog is unconnected and must invite a connection instead.
    expect(toggleFor('connect', 'OpenAI')).toHaveTextContent('common.connectToggle.connect');
  });

  it('removes the credential and flips the card to not-connected', async () => {
    mockApi([{ provider: 'anthropic', authType: 'oauth', priority: 0 }]);
    const remove = vi.spyOn(api.providerKeysApi, 'remove').mockResolvedValue({ ok: true });
    render(<ProviderKeysSettings />);
    fireEvent.click(await screen.findByLabelText('common.connectToggle.disconnectAria Anthropic (Claude)'));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('anthropic'));
    // The grid must repaint from the removal, not wait for a page reload to catch up.
    expect(await screen.findByLabelText('common.connectToggle.connectAria Anthropic (Claude)')).toBeInTheDocument();
  });

  it('does not open the drawer behind the button when disconnecting', async () => {
    // The card is clickable and the button sits inside it; without stopped propagation a
    // disconnect would also open the panel for the account just removed.
    mockApi([{ provider: 'anthropic', authType: 'oauth', priority: 0 }]);
    vi.spyOn(api.providerKeysApi, 'remove').mockResolvedValue({ ok: true });
    render(<ProviderKeysSettings />);
    fireEvent.click(await screen.findByLabelText('common.connectToggle.disconnectAria Anthropic (Claude)'));
    await waitFor(() => expect(api.providerKeysApi.remove).toHaveBeenCalled());
    expect(screen.queryByText(/providerKeys\.diagnostic\.currentStatus/)).not.toBeInTheDocument();
  });

  it('opens the connect flow from Connect — the credential form lives in the drawer', async () => {
    mockApi([]);
    render(<ProviderKeysSettings />);
    fireEvent.click(await screen.findByLabelText('common.connectToggle.connectAria Anthropic (Claude)'));
    expect(await screen.findByText(/providerKeys\.diagnostic\.currentStatus/)).toBeInTheDocument();
  });

  it('disconnects the whole OpenRouter registration set from its card', async () => {
    // The card states ONE connected/not-connected fact for the set, so its Disconnect has
    // to clear the set — leaving a registration behind would contradict the card.
    mockApi([]);
    vi.spyOn(api.openRouterConnectionsApi, 'list').mockResolvedValue({
      connections: [
        { id: 7, label: 'Primary', models: ['x/y'], hasKey: true },
        { id: 8, label: 'Backup', models: ['a/b'], hasKey: false },
      ] as api.OpenRouterConnection[],
    });
    vi.spyOn(api.openRouterConnectionsApi, 'precedence').mockResolvedValue({ entries: [] });
    const remove = vi.spyOn(api.openRouterConnectionsApi, 'remove').mockResolvedValue({ ok: true });
    render(<ProviderKeysSettings />);
    fireEvent.click(await screen.findByLabelText('common.connectToggle.disconnectAria OpenRouter'));
    await waitFor(() => expect(remove).toHaveBeenCalledTimes(2));
    expect(remove).toHaveBeenCalledWith(7);
    expect(remove).toHaveBeenCalledWith(8);
  });
});
