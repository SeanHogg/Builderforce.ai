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
