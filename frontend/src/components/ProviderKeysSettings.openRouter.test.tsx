import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProviderKeysSettings } from './ProviderKeysSettings';
import * as api from '@/lib/builderforceApi';
import type { ConnectionAuthAlert, OpenRouterConnection } from '@/lib/builderforceApi';

vi.mock('@/components/ConfirmProvider', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ error: vi.fn(), warning: vi.fn(), success: vi.fn() }) }));

/**
 * OpenRouter registrations are rankable BYO accounts with no provider card, and for a long
 * time nothing on this page could tell an operator that one had stopped working: the row
 * listed its models whether or not the key behind them had been revoked, and the only way
 * to find out was noticing that agents had quietly moved onto the shared pool.
 *
 * So the states that matter here are the same three the provider cards earned: a registration
 * can be TESTED on demand, a rejected one says so on the row AND on the grid card behind the
 * drawer, and a healthy one shows nothing.
 *
 * Copy is the passthrough key under the global next-intl mock (see src/test/setup.ts).
 */
const connection = (over: Partial<OpenRouterConnection> = {}): OpenRouterConnection => ({
  id: 1,
  label: 'Kimi (open router)',
  models: ['moonshotai/kimi-k3'],
  hasKey: true,
  priority: 0,
  ...over,
});

const connectionAlert = (over: Partial<ConnectionAuthAlert> = {}): ConnectionAuthAlert => ({
  connectionId: 1,
  reason: 'rejected',
  status: 401,
  vendor: 'openrouter',
  at: Date.now(),
  ...over,
});

function mockApi(connections: OpenRouterConnection[]) {
  vi.spyOn(api.providerKeysApi, 'list').mockResolvedValue({ providers: [], details: [] });
  vi.spyOn(api.llmApi, 'usage').mockResolvedValue(null as unknown as api.LlmUsageStats);
  vi.spyOn(api.openRouterConnectionsApi, 'list').mockResolvedValue({ connections, usageWindowDays: 30 });
  vi.spyOn(api.openRouterConnectionsApi, 'catalog').mockResolvedValue({ data: [] });
  vi.spyOn(api.openRouterConnectionsApi, 'precedence').mockResolvedValue({
    entries: connections.map((c) => ({ ref: `openrouter:${c.id}`, kind: 'connection' as const, connection: c, priority: c.priority })),
  });
}

/** Open the OpenRouter drawer the way an operator does — via its grid card. The card is a
 *  `role="button"` div, not a `<button>`, so its own action controls stay real (see
 *  {@link ClickableCard}); target the role rather than the tag. */
async function openDrawer() {
  fireEvent.click((await screen.findByText('OpenRouter')).closest('[role="button"]')!);
}

describe('ProviderKeysSettings — OpenRouter connection health', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('tests one registration on demand and reports the verdict', async () => {
    mockApi([connection()]);
    const test = vi.spyOn(api.openRouterConnectionsApi, 'test').mockResolvedValue({
      ok: true, status: 'ready', model: 'moonshotai/kimi-k3', ownKey: true,
    });
    render(<ProviderKeysSettings />);
    await openDrawer();

    fireEvent.click(await screen.findByText('providerKeys.diagnostic.test'));

    await waitFor(() => expect(test).toHaveBeenCalledWith(1));
    expect(await screen.findByText(/providerKeys\.diagnostic\.verifiedWith/)).toBeInTheDocument();
  });

  it('shows a model limiter without disabling a connection that has a working fallback', async () => {
    mockApi([connection({ models: ['deepseek/deepseek-v4-pro', 'moonshotai/kimi-k3'] })]);
    vi.spyOn(api.openRouterConnectionsApi, 'test').mockResolvedValue({
      ok: true,
      status: 'ready',
      model: 'moonshotai/kimi-k3',
      ownKey: true,
      limitedModels: ['deepseek/deepseek-v4-pro'],
    });
    render(<ProviderKeysSettings />);
    await openDrawer();

    fireEvent.click(await screen.findByText('providerKeys.diagnostic.test'));

    expect(await screen.findByText(/diagnostic\.verifiedWithLimited.*deepseek\/deepseek-v4-pro/)).toBeInTheDocument();
    expect(screen.queryByText(/providerKeys\.status\.needsAttention/)).not.toBeInTheDocument();
    expect(screen.getByText(/providerKeys\.openRouter\.connectedCount/)).toBeInTheDocument();
  });

  it('surfaces the probe failure rather than a bare red state', async () => {
    mockApi([connection()]);
    vi.spyOn(api.openRouterConnectionsApi, 'test').mockResolvedValue({
      ok: false, status: 'failed', model: 'moonshotai/kimi-k3', ownKey: true,
      error: 'OpenRouter connection test failed: No auth credentials found',
      authAlert: connectionAlert(),
    });
    render(<ProviderKeysSettings />);
    await openDrawer();

    fireEvent.click(await screen.findByText('providerKeys.diagnostic.test'));

    // The verdict is COMPOSED from the catalog, carrying the machine status — the
    // server's raw English `error` string is deliberately not rendered, because a
    // zh/es/fr/de operator would otherwise get an English sentence in the middle of
    // their diagnostic. This asserted that raw string and so contradicted the rule
    // `probeVerdict` exists to keep.
    expect(await screen.findByText(/providerKeys\.diagnostic\.failedFallback/)).toBeInTheDocument();
    // The verdict is announced, not merely coloured.
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
  });

  it('repaints the grid card from the probe verdict, not just the drawer row', async () => {
    mockApi([connection()]);
    vi.spyOn(api.openRouterConnectionsApi, 'test').mockResolvedValue({
      ok: false, status: 'failed', ownKey: true, error: 'refused', authAlert: connectionAlert(),
    });
    render(<ProviderKeysSettings />);
    // Before the probe the card counts registrations and says nothing about health.
    expect(await screen.findByText(/providerKeys\.openRouter\.connectedCount/)).toBeInTheDocument();
    await openDrawer();

    fireEvent.click(await screen.findByText('providerKeys.diagnostic.test'));

    // A registration that was just refused must stop being counted as simply "connected".
    expect(await screen.findByText(/providerKeys\.status\.needsAttention/)).toBeInTheDocument();
    expect(screen.queryByText(/providerKeys\.openRouter\.connectedCount/)).not.toBeInTheDocument();
  });

  it('shows a stored rejection without anyone clicking Test', async () => {
    // The daily sweep and a live cascade both write this, which is the whole point: an
    // operator who never opens the drawer still learns the registration is not serving.
    mockApi([connection({ authAlert: connectionAlert({ reason: 'capacity', status: 429 }) })]);
    render(<ProviderKeysSettings />);

    expect(await screen.findByText(/providerKeys\.status\.needsAttention/)).toBeInTheDocument();
    await openDrawer();
    expect(await screen.findByText(/providerKeys\.authAlert\.capacity 429/)).toBeInTheDocument();
  });

  it('lets an operator choose which model is tried FIRST and persists that order', async () => {
    // Order is routing, not presentation: position 1 is what agents run and what the probe
    // tests, so an operator whose top model is having an outage must be able to demote it.
    mockApi([connection({ models: ['moonshotai/kimi-k3', 'deepseek/deepseek-v4-pro'] })]);
    const update = vi.spyOn(api.openRouterConnectionsApi, 'update')
      .mockResolvedValue(connection({ models: ['deepseek/deepseek-v4-pro', 'moonshotai/kimi-k3'] }));
    render(<ProviderKeysSettings />);
    await openDrawer();
    fireEvent.click(await screen.findByText('providerKeys.openRouter.edit'));

    // Promote the second model over the first.
    fireEvent.click(await screen.findByLabelText(/precedence\.moveUp.*deepseek\/deepseek-v4-pro/));
    fireEvent.click(screen.getByText('providerKeys.save'));

    await waitFor(() => expect(update).toHaveBeenCalledWith(1, expect.objectContaining({
      models: ['deepseek/deepseek-v4-pro', 'moonshotai/kimi-k3'],
    })));
  });

  it('drops a model from the registration without touching the rest of the order', async () => {
    mockApi([connection({ models: ['a/one', 'b/two', 'c/three'] })]);
    const update = vi.spyOn(api.openRouterConnectionsApi, 'update').mockResolvedValue(connection());
    render(<ProviderKeysSettings />);
    await openDrawer();
    fireEvent.click(await screen.findByText('providerKeys.openRouter.edit'));

    fireEvent.click(await screen.findByLabelText(/openRouter\.removeModel.*b\/two/));
    fireEvent.click(screen.getByText('providerKeys.save'));

    await waitFor(() => expect(update).toHaveBeenCalledWith(1, expect.objectContaining({
      models: ['a/one', 'c/three'],
    })));
  });

  it('reports what each registration consumed, and whose money paid for it', async () => {
    mockApi([connection({
      hasKey: true,
      usage: { requests: 42, tokens: 13500, costMillicents: 42_000, lastUsedAt: '2026-07-30T09:00:00.000Z' },
    })]);
    render(<ProviderKeysSettings />);
    await openDrawer();

    expect(await screen.findByText(/providerKeys\.diagnostic\.usage/)).toBeInTheDocument();
    // On the tenant's OWN key our ledger holds only the routing surcharge — saying so is
    // the difference between "$0.42 this month" and a number read as the whole bill.
    expect(screen.getByText(/providerKeys\.openRouter\.costOwnKey/)).toBeInTheDocument();
    expect(screen.queryByText(/providerKeys\.openRouter\.costManaged/)).not.toBeInTheDocument();
  });

  it('bills a managed-key registration as ours, not as the tenant\'s', async () => {
    mockApi([connection({
      hasKey: false,
      usage: { requests: 5, tokens: 900, costMillicents: 6_000, lastUsedAt: null },
    })]);
    render(<ProviderKeysSettings />);
    await openDrawer();

    expect(await screen.findByText(/providerKeys\.openRouter\.costManaged/)).toBeInTheDocument();
    expect(screen.queryByText(/providerKeys\.openRouter\.costOwnKey/)).not.toBeInTheDocument();
  });

  it('shows a registration that has served nothing as zero rather than blank', async () => {
    // "Healthy but unused" is a real state — a blank strip would read as "no data".
    mockApi([connection({ usage: { requests: 0, tokens: 0, costMillicents: 0, lastUsedAt: null } })]);
    render(<ProviderKeysSettings />);
    await openDrawer();

    expect(await screen.findByText(/providerKeys\.diagnostic\.usage/)).toBeInTheDocument();
  });

  it('shows nothing health-related for a working registration', async () => {
    mockApi([connection()]);
    render(<ProviderKeysSettings />);
    await waitFor(() => expect(api.openRouterConnectionsApi.list).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText('providerKeys.loading')).not.toBeInTheDocument());

    expect(screen.queryByText('providerKeys.authAlert.title')).not.toBeInTheDocument();
    expect(screen.getByText(/providerKeys\.openRouter\.connectedCount/)).toBeInTheDocument();
  });
});
