import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { ProviderKeysSettings } from './ProviderKeysSettings';
import * as api from '@/lib/builderforceApi';
import type { ByoPrecedenceEntry, ProviderDiagnostic } from '@/lib/builderforceApi';

vi.mock('@/components/ConfirmProvider', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => vi.fn() }));

/**
 * The precedence list interleaves TWO kinds of rankable account — connected providers and
 * named OpenRouter connections (0382). The toolbar chip on /settings/integrations reports
 * whichever LEADS it.
 *
 * The bug these lock out: the callback filtered connections out and emitted a provider-id
 * list, so a tenant whose #1 was an OpenRouter connection saw the chip name the account
 * ranked SECOND ("Priority · Anthropic") while the drawer showed OpenRouter at 1 — the
 * cosmetic half of "I set OpenRouter as primary but the UI shows Anthropic".
 */
const CONNECTION: ByoPrecedenceEntry = {
  ref: 'openrouter:12',
  kind: 'connection',
  connection: { id: 12, label: 'Kimi (open router)', models: ['moonshotai/kimi-k2', 'qwen/qwen3-coder'], hasKey: true, priority: 0 },
  priority: 0,
};
const ANTHROPIC: ByoPrecedenceEntry = { ref: 'anthropic', kind: 'provider', provider: 'anthropic', priority: 1 };

function mockApi(entries: ByoPrecedenceEntry[]) {
  const providers = entries.filter((e) => e.kind === 'provider');
  vi.spyOn(api.providerKeysApi, 'list').mockResolvedValue({
    providers: providers.map((p) => p.provider),
    details: providers.map((p) => ({ provider: p.provider, authType: 'oauth' as const, priority: p.priority })),
  } as Awaited<ReturnType<typeof api.providerKeysApi.list>>);
  vi.spyOn(api.providerKeysApi, 'status').mockResolvedValue({
    provider: 'anthropic', configured: true, usable: true, status: 'ready',
    usage: { periodDays: 30, requests: 0, tokens: 0, lastUsedAt: null },
  } as ProviderDiagnostic);
  vi.spyOn(api.llmApi, 'usage').mockResolvedValue(null as unknown as api.LlmUsageStats);
  vi.spyOn(api.openRouterConnectionsApi, 'list').mockResolvedValue({
    connections: entries.filter((e) => e.kind === 'connection').map((e) => e.connection),
  });
  vi.spyOn(api.openRouterConnectionsApi, 'precedence').mockResolvedValue({ entries });
}

describe('ProviderKeysSettings — precedence leader reported to the toolbar', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('names the OpenRouter connection when it leads, not the provider ranked below it', async () => {
    const onLeaderChange = vi.fn();
    mockApi([CONNECTION, ANTHROPIC]);
    render(<ProviderKeysSettings onLeaderChange={onLeaderChange} />);
    await waitFor(() => expect(onLeaderChange).toHaveBeenCalled());
    expect(onLeaderChange).toHaveBeenLastCalledWith('OpenRouter · Kimi (open router) (2)');
  });

  it('names the provider when a provider leads', async () => {
    const onLeaderChange = vi.fn();
    mockApi([{ ...ANTHROPIC, priority: 0 }, { ...CONNECTION, priority: 1 }]);
    render(<ProviderKeysSettings onLeaderChange={onLeaderChange} />);
    await waitFor(() => expect(onLeaderChange).toHaveBeenCalled());
    expect(onLeaderChange).toHaveBeenLastCalledWith('Anthropic (Claude)');
  });

  it('reports null when nothing is ranked', async () => {
    const onLeaderChange = vi.fn();
    mockApi([]);
    render(<ProviderKeysSettings onLeaderChange={onLeaderChange} />);
    await waitFor(() => expect(onLeaderChange).toHaveBeenCalledWith(null));
  });
});
