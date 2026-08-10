import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProviderKeysSettings } from './ProviderKeysSettings';
import * as api from '@/lib/builderforceApi';
import type { ProviderAuthAlert, ProviderDiagnostic } from '@/lib/builderforceApi';

vi.mock('@/components/ConfirmProvider', () => ({ useConfirm: () => vi.fn() }));
// The real hook returns a dispatcher OBJECT — `useToast()` alone type-checks as a function
// here, so a test that actually clicks Test used to blow up inside the handler rather than
// assert anything. Mock the shape, not just the call.
vi.mock('@/components/ToastProvider', () => ({
  useToast: () => ({ error: vi.fn(), warning: vi.fn(), success: vi.fn(), info: vi.fn() }),
}));

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
  usage?: { periodDays: number; requests: number; tokens: number; lastUsedAt: string | null };
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

  it('names an out-of-budget account as CAPACITY, not as a credential to reconnect', async () => {
    // The remediation differs: telling an owner whose key is fine to "reconnect" sends
    // them to redo work that cannot fix anything.
    mockApi([{ provider: 'openai', authType: 'api_key', priority: 0, authAlert: alert({ reason: 'capacity', status: 429, vendor: 'openai' }) }]);
    render(<ProviderKeysSettings />);
    expect(await screen.findByText(/providerKeys.authAlert.capacity 429/)).toBeInTheDocument();
    expect(screen.queryByText(/providerKeys.authAlert.rejected/)).not.toBeInTheDocument();
  });

  it('explains MiniMax window depletion as automatically retryable', async () => {
    mockApi([{
      provider: 'minimax', authType: 'api_key', priority: 0,
      authAlert: alert({ provider: 'minimax', reason: 'capacity', status: 429, vendor: 'minimax' }),
    }]);
    render(<ProviderKeysSettings />);
    expect(await screen.findByText(/providerKeys\.authAlert\.minimaxCapacity 429/)).toBeInTheDocument();
    expect(screen.queryByText(/providerKeys\.authAlert\.capacity 429/)).not.toBeInTheDocument();
  });

  it('renders provider-scoped BuilderForce usage from the provider list read', async () => {
    mockApi([{
      provider: 'minimax', authType: 'api_key', priority: 0,
      usage: { periodDays: 30, requests: 9_041, tokens: 311_034_403, lastUsedAt: '2026-08-03T08:05:48Z' },
    }]);
    render(<ProviderKeysSettings />);
    expect(await screen.findByText('311.0M')).toBeInTheDocument();
    expect(screen.getByText('providerKeys.diagnostic.builderforceTokens')).toBeInTheDocument();
  });

  it('gives depleted SuperGrok usage its own reset/credits remediation', async () => {
    mockApi([{
      provider: 'xai', authType: 'oauth', priority: 0,
      authAlert: alert({ provider: 'xai', reason: 'capacity', status: 403, vendor: 'xai-oauth' }),
    }]);
    vi.spyOn(api.providerKeysApi, 'status').mockImplementation(async (provider) => ({
      provider, configured: provider === 'xai', usable: provider === 'xai',
      status: provider === 'xai' ? 'capacity' : 'not_connected',
      ...(provider === 'xai' ? {
        authAlert: alert({ provider: 'xai', reason: 'capacity', status: 403, vendor: 'xai-oauth' }),
      } : {}),
      usage: { periodDays: 30, requests: 0, tokens: 0, lastUsedAt: null },
    }));
    render(<ProviderKeysSettings />);
    expect(await screen.findByText(/providerKeys\.authAlert\.xaiCapacity 403/)).toBeInTheDocument();
    expect(screen.getByText(/providerKeys\.status\.usageDepleted/)).toBeInTheDocument();
    expect(screen.queryByText(/providerKeys\.authAlert\.xaiNotEntitled/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('xAI (Grok)').closest('[role="button"]')!);
    expect(await screen.findByText(/providerKeys\.diagnostic\.currentStatus providerKeys\.diagnostic\.state\.capacity/)).toBeInTheDocument();
  });

  it('gives a Kimi Code rejection Kimi remediation, never SuperGrok copy', async () => {
    mockApi([{
      provider: 'kimi', authType: 'api_key', priority: 0,
      authAlert: alert({ provider: 'kimi', reason: 'not_entitled', vendor: 'kimi-code' }),
    }]);
    render(<ProviderKeysSettings />);
    expect(await screen.findByText(/providerKeys\.authAlert\.kimiNotEntitled 403/)).toBeInTheDocument();
    expect(screen.queryByText(/providerKeys\.authAlert\.xaiNotEntitled/)).not.toBeInTheDocument();
  });

  // An operator escalating a Kimi hosted 403 to the provider previously had nothing to
  // send but our own prose about the failure — which is what stalled the integration
  // request in docs/partnerships/kimi-code-hosted-integration-request.md. A failed test
  // now offers the redacted trace, and the summary says an EDGE refused the call so the
  // owner does not go re-enter a key that was never read.
  it('offers the redacted trace after a failed test, naming the edge as the blocker', async () => {
    mockApi([{ provider: 'kimi', authType: 'api_key', priority: 0 }]);
    vi.spyOn(api.providerKeysApi, 'status').mockImplementation(async (provider) => ({
      provider, configured: provider === 'kimi', usable: provider === 'kimi',
      status: provider === 'kimi' ? 'needs_attention' : 'not_connected',
      usage: { periodDays: 30, requests: 0, tokens: 0, lastUsedAt: null },
    }));
    vi.spyOn(api.providerKeysApi, 'test').mockResolvedValue({
      ok: false,
      status: 'failed',
      error: "Kimi's edge blocked the hosted Builderforce gateway.",
      diagnostic: {
        endpoint: 'https://api.kimi.com/coding/v1/chat/completions',
        status: 403,
        headers: { 'cf-ray': 'ray-1' },
        edgeBlocked: true,
        observedAt: '2026-08-02T10:00:00.000Z',
        traceId: 'llm-abc',
        model: 'kimi-for-coding',
      },
    } as Awaited<ReturnType<typeof api.providerKeysApi.test>>);

    render(<ProviderKeysSettings />);
    fireEvent.click((await screen.findByText('Kimi')).closest('[role="button"]')!);
    fireEvent.click(await screen.findByText('providerKeys.diagnostic.test'));

    expect(await screen.findByText('providerKeys.diagnostic.copyTrace')).toBeInTheDocument();
    // The edge-block wording, not the generic "here are the request ids" hint.
    expect(screen.getByText(/providerKeys\.diagnostic\.traceEdgeBlocked/)).toBeInTheDocument();
    expect(screen.queryByText(/providerKeys\.diagnostic\.traceHint/)).not.toBeInTheDocument();
  });

  it('offers no trace when the test never reached the provider', async () => {
    // No response, no evidence — a copy button that yields nothing is worse than absent.
    mockApi([{ provider: 'kimi', authType: 'api_key', priority: 0 }]);
    vi.spyOn(api.providerKeysApi, 'status').mockImplementation(async (provider) => ({
      provider, configured: provider === 'kimi', usable: provider === 'kimi',
      status: provider === 'kimi' ? 'needs_attention' : 'not_connected',
      usage: { periodDays: 30, requests: 0, tokens: 0, lastUsedAt: null },
    }));
    vi.spyOn(api.providerKeysApi, 'test').mockResolvedValue({
      ok: false, status: 'revoked', error: 'Stored credential could not be used (revoked).',
    } as Awaited<ReturnType<typeof api.providerKeysApi.test>>);

    render(<ProviderKeysSettings />);
    fireEvent.click((await screen.findByText('Kimi')).closest('[role="button"]')!);
    fireEvent.click(await screen.findByText('providerKeys.diagnostic.test'));

    await screen.findByText(/providerKeys\.diagnostic\.failedFallback/);
    expect(screen.queryByText('providerKeys.diagnostic.copyTrace')).not.toBeInTheDocument();
  });

  it('does NOT report a broken account as connected — the chip follows health, not storage', async () => {
    // The whole reason this page could show five green cards next to a failing Test
    // connection: the chip coloured itself off "a credential is stored", which stays true
    // for a lapsed subscription. An outstanding alert must downgrade the chip itself, not
    // merely add a notice below it.
    mockApi([{ provider: 'openai', authType: 'oauth', priority: 0, authAlert: alert() }]);
    render(<ProviderKeysSettings />);
    expect(await screen.findByText(/providerKeys.status.needsAttention/)).toBeInTheDocument();
    expect(screen.queryByText(/providerKeys.status.connected/)).not.toBeInTheDocument();
  });

  it('does NOT report a rejected account diagnostic as ready', async () => {
    mockApi([{ provider: 'xai', authType: 'oauth', priority: 0, authAlert: alert({ provider: 'xai', vendor: 'xai-oauth' }) }]);
    vi.spyOn(api.providerKeysApi, 'status').mockImplementation(async (provider) => ({
      provider, configured: provider === 'xai', usable: provider === 'xai',
      status: provider === 'xai' ? 'needs_attention' : 'not_connected',
      ...(provider === 'xai' ? { authAlert: alert({ provider: 'xai', vendor: 'xai-oauth' }) } : {}),
      usage: { periodDays: 30, requests: 0, tokens: 0, lastUsedAt: null },
    }));
    render(<ProviderKeysSettings />);
    fireEvent.click((await screen.findByText('xAI (Grok)')).closest('[role="button"]')!);
    expect(await screen.findByText(/providerKeys\.diagnostic\.currentStatus providerKeys\.diagnostic\.state\.needs_attention/)).toBeInTheDocument();
    expect(screen.getAllByText(/providerKeys\.authAlert\.xaiNotEntitled 403/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/providerKeys\.diagnostic\.currentStatus providerKeys\.diagnostic\.state\.ready/)).not.toBeInTheDocument();
  });

  it('still reports a healthy connected account as connected', async () => {
    mockApi([{ provider: 'openai', authType: 'oauth', priority: 0 }]);
    render(<ProviderKeysSettings />);
    expect(await screen.findByText(/providerKeys.status.connected/)).toBeInTheDocument();
    expect(screen.queryByText(/providerKeys.status.needsAttention/)).not.toBeInTheDocument();
  });

  it('is announced to assistive tech rather than being colour-only', async () => {
    mockApi([{ provider: 'openai', authType: 'oauth', priority: 0, authAlert: alert() }]);
    render(<ProviderKeysSettings />);
    await screen.findByText('providerKeys.authAlert.title');
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
  });
});
