import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ProviderKeysSettings } from './ProviderKeysSettings';
import * as api from '@/lib/builderforceApi';
import type { ByoPrecedenceEntry, ProviderDiagnostic } from '@/lib/builderforceApi';

vi.mock('@/components/ToastProvider', () => ({ useToast: () => vi.fn() }));

/**
 * Provider priority is drag-orderable, not only ↑/↓-orderable.
 *
 * The rows interleave connected providers and named OpenRouter connections, and BOTH are
 * ranked by the same list — so a drag has to commit the whole ref order (`setPriority`),
 * insert-at-target (not swap-with-target), and keep the OpenRouter connection's `openrouter:N`
 * ref intact. A swap-based commit silently produces a different order than the one the
 * operator dropped as soon as the drag spans more than one row.
 */
const ANTHROPIC: ByoPrecedenceEntry = { ref: 'anthropic', kind: 'provider', provider: 'anthropic', priority: 0 };
const OPENAI: ByoPrecedenceEntry = { ref: 'openai', kind: 'provider', provider: 'openai', priority: 1 };
const CONNECTION: ByoPrecedenceEntry = {
  ref: 'openrouter:12',
  kind: 'connection',
  connection: { id: 12, label: 'Coders', models: ['moonshotai/kimi-k2'], hasKey: true, priority: 2 },
  priority: 2,
};

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
  return vi.spyOn(api.providerKeysApi, 'setPriority').mockResolvedValue(undefined as never);
}

/** jsdom has no DataTransfer; supply the two methods the handlers touch. */
function dataTransfer() {
  const store: Record<string, string> = {};
  return {
    effectAllowed: '',
    dropEffect: '',
    setData: (type: string, value: string) => { store[type] = value; },
    getData: (type: string) => store[type] ?? '',
  };
}

/** Row by its position-labelled accessible name (`precedence.rowLabel <label> <position>`).
 *  The i18n test stub echoes `<namespace>.<key> <…values>`, so position is asserted too — a
 *  row queried by label alone would still be found after a reorder silently did nothing. */
const row = (label: string, position: number) =>
  screen.getByLabelText(new RegExp(`^providerKeys\\.precedence\\.rowLabel .*${label}.* ${position}$`));

describe('ProviderKeysSettings — drag to reorder provider priority', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('persists the dropped order, inserting the dragged account at the target position', async () => {
    const setPriority = mockApi([ANTHROPIC, OPENAI, CONNECTION]);
    render(<ProviderKeysSettings priorityOpen />);
    await waitFor(() => expect(row('Anthropic', 1)).toBeInTheDocument());

    const dt = dataTransfer();
    fireEvent.dragStart(row('Anthropic', 1), { dataTransfer: dt });
    fireEvent.dragOver(row('OpenRouter', 3), { dataTransfer: dt });
    fireEvent.drop(row('OpenRouter', 3), { dataTransfer: dt });

    // Slide, not swap: OpenAI and the connection each move up one.
    await waitFor(() => expect(setPriority).toHaveBeenCalledWith(['openai', 'openrouter:12', 'anthropic']));
  });

  it('reports the dropped account as the new leader to the toolbar chip', async () => {
    const onLeaderChange = vi.fn();
    mockApi([ANTHROPIC, OPENAI, CONNECTION]);
    render(<ProviderKeysSettings priorityOpen onLeaderChange={onLeaderChange} />);
    await waitFor(() => expect(row('Anthropic', 1)).toBeInTheDocument());

    const dt = dataTransfer();
    fireEvent.dragStart(row('OpenRouter', 3), { dataTransfer: dt });
    fireEvent.dragOver(row('Anthropic', 1), { dataTransfer: dt });
    fireEvent.drop(row('Anthropic', 1), { dataTransfer: dt });

    await waitFor(() => expect(onLeaderChange).toHaveBeenLastCalledWith('OpenRouter · Coders (1)'));
  });

  it('does not persist when an account is dropped back onto itself', async () => {
    const setPriority = mockApi([ANTHROPIC, OPENAI]);
    render(<ProviderKeysSettings priorityOpen />);
    await waitFor(() => expect(row('Anthropic', 1)).toBeInTheDocument());

    const dt = dataTransfer();
    fireEvent.dragStart(row('Anthropic', 1), { dataTransfer: dt });
    fireEvent.drop(row('Anthropic', 1), { dataTransfer: dt });

    expect(setPriority).not.toHaveBeenCalled();
  });

  it('still reorders with the ↑/↓ buttons — the keyboard and touch path', async () => {
    const setPriority = mockApi([ANTHROPIC, OPENAI]);
    render(<ProviderKeysSettings priorityOpen />);
    await waitFor(() => expect(row('Anthropic', 1)).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText(/precedence\.moveUp OpenAI$/));
    await waitFor(() => expect(setPriority).toHaveBeenCalledWith(['openai', 'anthropic']));
  });
});
