import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PolicyGate } from '@builderforce/agent-run';
import type { StreamChatResult } from '../streamChatCompletion';
import { beginRun } from '../runStore/beginRun';
import { getCell } from '../runStore/runCells';
import { resolveRunConfirm, resetBrainRunStore, stopRun } from '../runStore/runControl';
import type { BrainRunRequest } from '../runStore/runTypes';
import { queueRunSteering, resetRunSteering } from '../runSteering';
import { brainEventSink, traceStepFor } from './eventSink';
import { brainHumanChannel } from './humanChannel';
import { brainModelTransport, toCompletion, toStreamMessage } from './modelTransport';
import { cellRunStore } from './runStorePort';
import { runViaAgent } from './runViaAgent';
import type { BrainEntryPoint } from './webAdapter';

/** A scripted completion in the stream's own result shape. */
function result(over: Partial<StreamChatResult> = {}): StreamChatResult {
  return { text: '', toolCalls: [], finishReason: 'stop', resolvedModel: 'fake-model', usage: { prompt: 10, completion: 4 }, ...over };
}

/** A stream that replays `turns` and records what it was asked. */
function scripted(turns: Array<(opts: Parameters<BrainRunRequest['stream']>[0]) => StreamChatResult | Promise<StreamChatResult>>) {
  const asked: Array<Parameters<BrainRunRequest['stream']>[0]> = [];
  let n = 0;
  const stream: BrainRunRequest['stream'] = async (opts) => {
    asked.push(opts);
    const turn = turns[n];
    n += 1;
    if (!turn) throw new Error('script exhausted');
    return turn(opts);
  };
  return { stream, asked };
}

const persistence = { sendMessages: async () => [] } as BrainRunRequest['persistence'];

function binding(runKey: number, stream: BrainRunRequest['stream'], entryPoint: BrainEntryPoint = 'web', extra: Partial<BrainRunRequest> = {}) {
  const cell = getCell(runKey);
  beginRun(cell, runKey);
  const req: BrainRunRequest = { resolvedSystemPrompt: 'sys', stream, persistence, ...extra };
  const rows: unknown[] = [];
  return { cell, rows, binding: { entryPoint, cell, runKey, req, request: 'Say hello, then finish.', capabilities: { capabilities: new Set<never>() }, reportOutcome: (row: unknown) => void rows.push(row) } };
}

beforeEach(() => {
  resetBrainRunStore();
  resetRunSteering();
});

describe('the Brain runs through the one agent', () => {
  it('finishes a scripted task, appends the run to the cell and reports the outcome row under the surface label', async () => {
    for (const [i, entryPoint] of (['web', 'rovr', 'vscode'] as const).entries()) {
      const { stream } = scripted([() => result({ text: 'Hello! Done.' })]);
      const b = binding(8100 + i, stream, entryPoint);
      const outcome = await runViaAgent(b.binding);
      expect(outcome.kind).toBe('finished');
      expect(b.cell.transcript.at(-1)).toMatchObject({ role: 'assistant' });
      expect(b.rows).toHaveLength(1);
      expect(b.rows[0]).toMatchObject({ entryPoint, terminalStatus: expect.any(String) });
    }
  });

  it('says on the trace, before the first turn, which connected account cannot serve the run', async () => {
    const { stream } = scripted([() => result({ text: 'Done.' })]);
    const b = binding(8110, stream, 'web', { modelPreflight: async () => ({ byoUnresolved: ['anthropic:expired'], fallback: 'free-model' }) });
    await runViaAgent(b.binding);
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
    const run = runViaAgent(b.binding);
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
    await runViaAgent(b.binding);
    expect(b.cell.trace.some((e) => e.label === 'steer.applied')).toBe(true);
    expect(asked[1]?.messages.map((m) => m.content)).toContain('write the update now');
  });
});

describe('the Brain\'s ports', () => {
  it('the model transport hands the stream the agent\'s transcript and lifts the result back', async () => {
    const { stream, asked } = scripted([() => result({ text: 'hi', toolCalls: [{ id: 'c9', name: 'read_file', args: '{"path":"a"}' }], usage: { prompt: 7, completion: 3, cacheRead: 5 } })]);
    const model = brainModelTransport({ stream, call: { routingMode: 'byo_pool' } });
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

  it('answers the window from what the host knows, and the preflight from its health check', async () => {
    const preflight = vi.fn(async () => ({ byoUnresolved: ['xai:revoked'] }));
    const model = brainModelTransport({ stream: scripted([]).stream, windows: { cloud: (ref) => (ref === 'big' ? 200_000 : undefined) }, preflight });
    expect(model.window?.('big')).toBe(200_000);
    expect(model.window?.('unknown')).toBeUndefined();
    await expect(model.preflight?.('big')).resolves.toEqual({ byoUnresolved: ['xai:revoked'] });
  });

  it('maps rows and results without losing a tool call', () => {
    expect(toStreamMessage({ role: 'user', content: 'u' })).toEqual({ role: 'user', content: 'u' });
    expect(toCompletion(result({ text: 't' }))).toEqual({ content: 't', toolCalls: [], usage: { inputTokens: 10, outputTokens: 4 }, model: 'fake-model' });
  });

  it('the run store appends only what the run added, and never replaces the rows the cell holds', () => {
    const c = getCell(8140);
    const first = { role: 'user' as const, content: 'earlier' };
    c.transcript.push(first);
    const store = cellRunStore(c, { seeded: 1 });
    const state = { messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'earlier' }, { role: 'assistant', content: 'now' }] } as never;
    store.save(state);
    store.save(state);
    expect(c.transcript).toHaveLength(2);
    expect(c.transcript[0]).toBe(first);
    expect(c.transcript[1]).toMatchObject({ role: 'assistant', content: 'now' });
  });

  it('the human channel raises the confirm gate on the cell and a Stop declines it', async () => {
    const gate: PolicyGate = { id: 'g1', tool: 'delete_file', effect: 'require-approval', reason: 'destructive' };
    const c = getCell(8150);
    beginRun(c, 8150);
    const human = brainHumanChannel(8150);
    const approved = human.approve?.(gate);
    expect(c.pendingConfirm).toMatchObject({ name: 'delete_file' });
    resolveRunConfirm(8150, true);
    await expect(approved).resolves.toEqual({ kind: 'answered', answer: 'approved' });

    const declined = human.approve?.(gate);
    stopRun(8150);
    await expect(declined).resolves.toEqual({ kind: 'answered', answer: 'declined' });
    await expect(human.ask('which?')).resolves.toEqual({ kind: 'paused' });
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
