import { describe, expect, it, vi } from 'vitest';
import { utilityUsageObserver } from './utilityUsage';

const run = { chatId: 7, runKey: 7, mode: 'chat' as const };

describe('utilityUsageObserver', () => {
  it('writes one local utility row per SERVED call', () => {
    const record = vi.fn(async () => undefined);
    utilityUsageObserver({ record }, run)({ kind: 'summarize', engine: 'synapse', model: 'qwen', outcome: 'served', ms: 5, promptTokens: 120, completionTokens: 30 });
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith({
      chatId: 7, runKey: 7, model: 'local/synapse/qwen', route: 'local', role: 'utility',
      usage: { prompt: 120, completion: 30 }, mode: 'chat',
    });
  });

  it('books nothing for a declined or replaced call', () => {
    const record = vi.fn(async () => undefined);
    const observe = utilityUsageObserver({ record }, run);
    observe({ kind: 'json', engine: null, model: null, outcome: 'declined', ms: 1 });
    observe({ kind: 'json', engine: 'bfi', model: 'm', outcome: 'replaced', ms: 0 });
    expect(record).not.toHaveBeenCalled();
  });

  it('routes a failed write to onError and never throws', async () => {
    const onError = vi.fn();
    const record = vi.fn(async () => { throw new Error('disk'); });
    utilityUsageObserver({ record }, run, onError)({ kind: 'write', engine: 'synapse', model: 'm', outcome: 'served', ms: 1, promptTokens: 1, completionTokens: 1 });
    await new Promise((r) => setTimeout(r, 0));
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
