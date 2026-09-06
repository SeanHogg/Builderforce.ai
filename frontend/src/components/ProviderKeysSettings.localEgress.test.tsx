import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProviderKeysSettings } from './ProviderKeysSettings';
import * as api from '@/lib/builderforceApi';
import type { ProviderDiagnostic } from '@/lib/builderforceApi';

vi.mock('@/components/ConfirmProvider', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/components/ToastProvider', () => ({
  useToast: () => ({ error: vi.fn(), warning: vi.fn(), success: vi.fn(), info: vi.fn() }),
}));

/**
 * The production screenshot this locks: a connected Kimi Code subscription whose drawer
 * read "Current status: ready" in green one line above a Test button answering "needs a
 * runtime of your own — nothing was sent". The status read now reaches the probe's verdict
 * itself, and the page turns that verdict into the one action that resolves it — the
 * credential is fine, a runtime is what is missing, and the Agents page is where one is
 * connected. Copy is the passthrough key under the global next-intl mock.
 */
function mockApi(status: ProviderDiagnostic['status']) {
  vi.spyOn(api.providerKeysApi, 'list').mockResolvedValue({
    providers: ['kimi'],
    details: [{ provider: 'kimi', authType: 'oauth', priority: 0 }],
  } as Awaited<ReturnType<typeof api.providerKeysApi.list>>);
  vi.spyOn(api.providerKeysApi, 'status').mockImplementation(async (provider) => ({
    provider, configured: provider === 'kimi', usable: provider === 'kimi',
    status: provider === 'kimi' ? status : 'not_connected',
    usage: { periodDays: 30, requests: 0, tokens: 0, lastUsedAt: null },
  }));
  vi.spyOn(api.llmApi, 'usage').mockResolvedValue(null as unknown as api.LlmUsageStats);
}

describe('ProviderKeysSettings — a provider reachable only from the tenant\'s own runtime', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('names the runtime as the remedy and links to where one is connected', async () => {
    mockApi('local_egress_required');
    render(<ProviderKeysSettings />);
    fireEvent.click((await screen.findByText('Kimi')).closest('[role="button"]')!);

    // The status line carries the probe's own verdict, not a green "ready".
    expect(await screen.findByText(/providerKeys\.diagnostic\.currentStatus .*local_egress_required/)).toBeInTheDocument();
    expect(screen.getByText('providerKeys.diagnostic.localEgressRemedy')).toBeInTheDocument();
    const link = screen.getByText('providerKeys.diagnostic.localEgressRemedyLink').closest('a');
    expect(link).toHaveAttribute('href', '/agents');
  });

  it('offers no runtime remedy for an account the gateway reaches directly', async () => {
    mockApi('ready');
    render(<ProviderKeysSettings />);
    fireEvent.click((await screen.findByText('Kimi')).closest('[role="button"]')!);

    await waitFor(() => expect(screen.getByText(/providerKeys\.diagnostic\.currentStatus .*ready/)).toBeInTheDocument());
    expect(screen.queryByText('providerKeys.diagnostic.localEgressRemedy')).not.toBeInTheDocument();
  });
});
