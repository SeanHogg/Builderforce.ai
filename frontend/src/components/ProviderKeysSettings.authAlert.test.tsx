import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ProviderKeysSettings } from './ProviderKeysSettings';
import * as api from '@/lib/builderforceApi';
import type { ProviderAuthAlert, ProviderDiagnostic } from '@/lib/builderforceApi';

vi.mock('@/components/ConfirmProvider', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => vi.fn() }));

/**
 * The reconnect prompt exists because "● connected" and a resolvable credential are
 * BOTH true for an account the upstream refuses on every call — a lapsed ChatGPT plan
 * being the case that motivated it. Previously the gateway cooled the vendor, failed
 * over, and told nobody, so the account sat connected and unused indefinitely.
 *
 * So the states that matter are: the prompt appears on the GRID (not only inside a
 * drawer nobody opens), it distinguishes "your plan doesn't cover this" from "this
 * credential was refused", and a healthy account shows nothing at all.
 *
 * Copy is the passthrough key under the global next-intl mock (see src/test/setup.ts).
 */
const alert = (over: Partial<ProviderAuthAlert> = {}): ProviderAuthAlert => ({
  provider: 'openai',
  reason: 'not_entitled',
  status: 403,
  vendor: 'openai-codex',
  at: Date.now(),
  ...over,
});

function mockApi(details: Array<Parameters<typeof api.providerKeysApi.list> extends never ? never : {
  provider: api.LlmProvider; authType: api.ProviderAuthType; priority: number | null; authAlert?: ProviderAuthAlert;
}>) {
  vi.spyOn(api.providerKeysApi, 'list').mockResolvedValue({
    providers: details.map((d) => d.provider),
    details,
  } as Awaited<ReturnType<typeof api.providerKeysApi.list>>);
  vi.spyOn(api.providerKeysApi, 'status').mockResolvedValue({
    provider: 'openai', configured: true, usable: true, status: 'ready',
    usage: { periodDays: 30, requests: 0, tokens: 0, lastUsedAt: null },
  } as ProviderDiagnostic);
  vi.spyOn(api.llmApi, 'usage').mockResolvedValue(null as unknown as api.LlmUsageStats);
}

describe('ProviderKeysSettings — rejected-account prompt', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('surfaces an entitlement rejection on the provider grid', async () => {
    mockApi([{ provider: 'openai', authType: 'oauth', priority: 0, authAlert: alert() }]);
    render(<ProviderKeysSettings />);
    // The title is what an operator scanning the grid sees; the body names the fix.
    expect(await screen.findByText('providerKeys.authAlert.title')).toBeInTheDocument();
    expect(screen.getByText(/providerKeys.authAlert.notEntitled 403/)).toBeInTheDocument();
  });

  it('distinguishes a refused credential from an unentitled plan', async () => {
    mockApi([{ provider: 'anthropic', authType: 'oauth', priority: 0, authAlert: alert({ provider: 'anthropic', reason: 'rejected', status: 401, vendor: 'anthropic' }) }]);
    render(<ProviderKeysSettings />);
    expect(await screen.findByText(/providerKeys.authAlert.rejected 401/)).toBeInTheDocument();
    expect(screen.queryByText(/providerKeys.authAlert.notEntitled/)).not.toBeInTheDocument();
  });

  it('shows nothing for a healthy connected account', async () => {
    mockApi([{ provider: 'openai', authType: 'oauth', priority: 0 }]);
    render(<ProviderKeysSettings />);
    // Wait for the load to settle so this is a real absence, not a pre-fetch one.
    await waitFor(() => expect(api.providerKeysApi.list).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText('providerKeys.loading')).not.toBeInTheDocument());
    expect(screen.queryByText('providerKeys.authAlert.title')).not.toBeInTheDocument();
  });

  it('is announced to assistive tech rather than being colour-only', async () => {
    mockApi([{ provider: 'openai', authType: 'oauth', priority: 0, authAlert: alert() }]);
    render(<ProviderKeysSettings />);
    await screen.findByText('providerKeys.authAlert.title');
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
  });
});
