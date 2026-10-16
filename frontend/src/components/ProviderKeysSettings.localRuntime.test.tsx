import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProviderKeysSettings } from './ProviderKeysSettings';
import * as api from '@/lib/builderforceApi';
import type { ProviderDiagnostic } from '@/lib/builderforceApi';

vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations'))
  .realCatalogIntlMock((await import('@/i18n/messages/en.json')).default as Record<string, unknown>));
vi.mock('@/components/ConfirmProvider', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/components/ToastProvider', () => ({
  useToast: () => ({ error: vi.fn(), warning: vi.fn(), success: vi.fn(), info: vi.fn() }),
}));

/**
 * Self-hosted runtimes are ONE form driven by the shared provider data: every provider
 * whose catalog entry says `credential: 'local_runtime'` gets a card and the same base
 * URL + model form. FreeToken had no surface at all — the gateway accepted it, the page
 * never offered it — so the cases worth pinning are that it renders, and that saving it
 * reaches the gateway under ITS id rather than Ollama's.
 */
function mockApi() {
  vi.spyOn(api.providerKeysApi, 'list').mockResolvedValue({
    providers: [],
    details: [],
  } as Awaited<ReturnType<typeof api.providerKeysApi.list>>);
  vi.spyOn(api.providerKeysApi, 'status').mockImplementation(async (provider) => ({
    provider, configured: false, usable: false, status: 'not_connected',
    usage: { periodDays: 30, requests: 0, tokens: 0, lastUsedAt: null },
  } as ProviderDiagnostic));
  vi.spyOn(api.llmApi, 'usage').mockResolvedValue(null as unknown as api.LlmUsageStats);
}

const cardFor = async (label: string) => (await screen.findByText(label)).closest('[role="button"]')!;

describe('ProviderKeysSettings — self-hosted runtimes', () => {
  beforeEach(() => { vi.restoreAllMocks(); mockApi(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('offers a card for every local runtime in the shared provider list', async () => {
    render(<ProviderKeysSettings />);
    expect(await screen.findByText('Ollama (self-hosted)')).toBeInTheDocument();
    expect(screen.getByText('FreeToken (self-hosted)')).toBeInTheDocument();
    expect(screen.getByText('Connect a self-hosted FreeToken instance running on your own machine or network.')).toBeInTheDocument();
  });

  it('saves FreeToken by base URL + model under its own provider id', async () => {
    const save = vi.spyOn(api.providerKeysApi, 'setLocalRuntime').mockResolvedValue({ ok: true, provider: 'freetoken' });
    render(<ProviderKeysSettings />);
    fireEvent.click(await cardFor('FreeToken (self-hosted)'));

    // The example address is FreeToken's own default, not Ollama's.
    const baseUrl = await screen.findByPlaceholderText('http://127.0.0.1:1919');
    fireEvent.change(baseUrl, { target: { value: 'http://127.0.0.1:1919' } });
    fireEvent.change(screen.getByPlaceholderText('The model id your FreeToken instance serves'), { target: { value: 'qwen3:8b' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(save).toHaveBeenCalledWith('freetoken', 'http://127.0.0.1:1919', 'qwen3:8b', undefined));
  });

  it('keeps Ollama on its own id and example model', async () => {
    const save = vi.spyOn(api.providerKeysApi, 'setLocalRuntime').mockResolvedValue({ ok: true, provider: 'ollama-local' });
    render(<ProviderKeysSettings />);
    fireEvent.click(await cardFor('Ollama (self-hosted)'));

    fireEvent.change(await screen.findByPlaceholderText('http://127.0.0.1:11434'), { target: { value: 'http://127.0.0.1:11434' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. llama3.1:8b'), { target: { value: 'llama3.1:8b' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(save).toHaveBeenCalledWith('ollama-local', 'http://127.0.0.1:11434', 'llama3.1:8b', undefined));
  });
});
