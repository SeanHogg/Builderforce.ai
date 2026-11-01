import { beforeEach, describe, expect, it } from 'vitest';
import { resetRunSteering } from '@builderforce/agent-run';
import { resetBrainRunStore, stopRun } from '../runStore/runControl';
import { getCell } from '../runStore/runCells';
import type { StreamChatResult } from '../streamChatCompletion';
import { binding, plainTurn, result, runBound, scripted } from '../test/brainRunHarness';
import { queueRunSteering } from '../runSteering';
import { brainEventSink, traceStepFor } from './eventSink';
import { brainHumanChannel } from './humanChannel';
import { brainModelTransport, toCompletion, toStreamMessage } from './modelTransport';

beforeEach(() => {
  resetBrainRunStore();
  resetRunSteering();
});

describe('the Brain runs through the one agent', () => {
  it('finishes a scripted task, appends the run to the cell and reports the outcome row under the surface label', async () => {
    for (const [i, entryPoint] of (['web', 'rovr', 'vscode'] as const).entries()) {
      const { stream } = scripted([() => result({ text: 'Hello! Done.' })]);
      const b = binding(8100 + i, stream, entryPoint);
      const outcome = await runBound(b);
      expect(outcome.kind).toBe('finished');
      expect(b.cell.transcript.at(-1)).toMatchObject({ role: 'assistant' });
      expect(b.rows).toHaveLength(1);
      expect(b.rows[0]).toMatchObject({ entryPoint, terminalStatus: expect.any(String) });
    }
  });

  it('says on the trace, before the first turn, which connected account cannot serve the run', async () => {
    const { stream } = scripted([() => result({ text: 'Done.' })]);
    const b = binding(8110, stream, 'web', { modelPreflight: async () => ({ byoUnresolved: ['anthropic:expired'], fallback: 'free-model' }) });
    await runBound(b);
    const step = b.cell.trace.find((e) => e.label === 'model.preflight');
    expect(step).toBeDefined();
    expect(String(step?.result)).toContain('anthropic');
  });

  it('a Stop on the cell settles the run cancelled', async () => {
    const started = Promise.withResolvers<void>();
    const { stream } = scripted([
      (opts) => new Promise<StreamChatResult>((_resolve, reject) => {
        opts.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        started.resolve();
      }),
    ]);
    const b = binding(8120, stream);
    const run = runBound(b);
    await started.promise;
    stopRun(8120);
    await expect(run).resolves.toMatchObject({ kind: 'failed', reason: 'cancelled' });
  });

  it('a message steered into the run reaches its next model call and is recorded as steer.applied', async () => {
    const { stream, asked } = scripted([
      () => {
        queueRunSteering(8130, 'write the update now', { interrupt: true, fromPerson: true });
        return result({ toolCalls: [{ id: 'c1', name: 'list_files', args: '{}' }] });
      },
      () => result({ text: 'Done.' }),
    ]);
    const b = binding(8130, stream);
    await runBound(b);
    expect(b.cell.trace.some((e) => e.label === 'steer.applied')).toBe(true);
    expect(asked[1]?.messages.map((m) => m.content)).toContain('write the update now');
  });
});

describe('the Brain\'s ports', () => {
  it('the model transport hands the stream the agent\'s transcript and lifts the result back', async () => {
    const { stream, asked } = scripted([() => result({ text: 'hi', toolCalls: [{ id: 'c9', name: 'read_file', args: '{"path":"a"}' }], usage: { prompt: 7, completion: 3, cacheRead: 5 } })]);
    const model = brainModelTransport({ stream, turn: plainTurn, call: { routingMode: 'byo_pool' } });
    const completion = await model.complete({
      messages: [
        { role: 'system', content: 's' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'x', arguments: '{}' }] },
        { role: 'tool', content: '{}', toolCallId: 'c1' },
      ],
      model: 'm',
      maxTokens: 99,
    });
    expect(asked[0]).toMatchObject({ model: 'm', maxTokens: 99, routingMode: 'byo_pool' });
    expect(asked[0]?.messages[1]).toMatchObject({ role: 'assistant', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'x', arguments: '{}' } }] });
    expect(asked[0]?.messages[2]).toMatchObject({ role: 'tool', tool_call_id: 'c1' });
    expect(completion).toMatchObject({ content: 'hi', model: 'fake-model', usage: { inputTokens: 7, outputTokens: 3, cacheReadTokens: 5 } });
    expect(completion.toolCalls).toEqual([{ id: 'c9', name: 'read_file', arguments: '{"path":"a"}' }]);
  });

  it('answers the window from what the host knows', () => {
    const model = brainModelTransport({ stream: scripted([]).stream, turn: plainTurn, windows: { cloud: (ref) => (ref === 'big' ? 200_000 : undefined) } });
    expect(model.window?.('big')).toBe(200_000);
    expect(model.window?.('unknown')).toBeUndefined();
  });

  it('maps rows and results without losing a tool call', () => {
    expect(toStreamMessage({ role: 'user', content: 'u' })).toEqual({ role: 'user', content: 'u' });
    expect(toCompletion(result({ text: 't' }))).toEqual({ content: 't', toolCalls: [], usage: { inputTokens: 10, outputTokens: 4 }, model: 'fake-model' });
  });

  it('the human channel answers a question as paused: the question is the reply of the run', async () => {
    await expect(brainHumanChannel().ask('which?')).resolves.toEqual({ kind: 'paused' });
  });

  it('the event sink renders the labelled steps diagnostics read, and nothing for lifecycle events', () => {
    const c = getCell(8160);
    expect(traceStepFor({ kind: 'run.started', step: 0 }, 't')).toBeNull();
    expect(traceStepFor({ kind: 'llm.model_downgrade', step: 2, requestedModel: 'a', model: 'b', reason: 'failover' }, 't')).toMatchObject({ label: 'llm.model_downgrade', args: { requestedModel: 'a', model: 'b', step: 2 } });
    const sink = brainEventSink(c);
    sink.emit({ kind: 'steer.applied', step: 1 });
    expect(c.trace.map((e) => e.label)).toEqual(['steer.applied']);
  });
});
