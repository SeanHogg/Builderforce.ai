import { describe, expect, it, vi } from 'vitest';
import type { ModelRequest } from '@builderforce/agent-run';
import { canvasModelTransport } from './canvasModelPort';
import type { CanvasRun } from './canvasAiRun';

/** A canvas run with only what the transport's summary path reads. */
function runWith(text: string | undefined) {
  const stream = vi.fn(async (..._args: unknown[]) => ({ text }));
  const run = {
    options: { prompt: 'p', routingMode: 'hybrid', signal: undefined },
    stream,
    guestTurnId: 'turn-1',
  } as unknown as CanvasRun;
  return { run, stream };
}

const request = (over: Partial<ModelRequest> = {}): ModelRequest => ({
  messages: [{ role: 'system', content: 'summarise' }, { role: 'user', content: 'the middle' }],
  maxTokens: 700,
  ...over,
});

/** A canvas run with what `complete` reads and writes; the stream answers `turn`. */
function completingRun(turn: Record<string, unknown>) {
  const stream = vi.fn(async (..._args: unknown[]) => ({ text: 'ok', toolCalls: [], finishReason: 'stop', ...turn }));
  return {
    options: { prompt: 'p', routingMode: 'hybrid' },
    stream,
    guestTurnId: 'turn-1',
    finalText: '',
    loopKept: '',
    workspaceTurn: false,
    truncatedOnce: false,
    throwIfStopped: () => undefined,
  } as unknown as CanvasRun;
}

describe('canvasModelTransport.complete — what a turn cost', () => {
  const complete = (turn: Record<string, unknown>) => canvasModelTransport(completingRun(turn)).complete(request());

  it('reports a turn the on-device model served as a known cost of 0 — a priced zero, not an unreported cost', async () => {
    const completion = await complete({ localFirst: [{ target: 'local/ollama/qwen', outcome: 'served' }], usage: { prompt: 10, completion: 5 } });

    expect(completion.usage).toEqual({ inputTokens: 10, outputTokens: 5, costMc: 0 });
  });

  it('reports a turn answered after a local fallback by the gateway as unknown: it did not run on the device', async () => {
    const completion = await complete({
      localFirst: [{ target: 'local/ollama/qwen', outcome: 'failed' }, { target: 'vendor/model', outcome: 'served' }],
      usage: { prompt: 10, completion: 5 },
    });

    expect(completion.usage?.costMc).toBeUndefined();
  });

  it('reports the gateway turn’s cost as unknown: the gateway reports none here', async () => {
    const completion = await complete({ usage: { prompt: 10, completion: 5 } });

    expect(completion.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });
});

describe('canvasModelTransport.summarize', () => {
  it('rides the run’s routing: the pin, its strictness and the models routed around', async () => {
    const { run, stream } = runWith('A short memory.');

    const completion = await canvasModelTransport(run).summarize!(request({ model: 'vendor/pinned', strict: true, excludeModels: ['vendor/disabled'] }));

    expect(completion.content).toBe('A short memory.');
    expect(stream.mock.calls[0]?.[0]).toMatchObject({ model: 'vendor/pinned', excludeModels: ['vendor/disabled'] });
  });

  it('asks for nothing it was not given: no strictness without a pin, no exclusions without any', async () => {
    const { run, stream } = runWith('A short memory.');

    await canvasModelTransport(run).summarize!(request({ strict: true }));

    const sent = stream.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(sent.modelStrict).toBeUndefined();
    expect(sent.excludeModels).toBeUndefined();
  });

  it('forwards modelStrict the way a turn does', async () => {
    const { run, stream } = runWith('A short memory.');

    await canvasModelTransport(run).summarize!(request({ model: 'vendor/pinned', strict: true }));

    expect(stream.mock.calls[0]?.[0]).toMatchObject({ modelStrict: true });
  });

  it('throws when the summary model returns no note, so the policy takes its recall fallback', async () => {
    const { run } = runWith('');

    await expect(canvasModelTransport(run).summarize!(request())).rejects.toThrow('no note');
  });
});
