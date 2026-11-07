import { describe, expect, it, vi } from 'vitest';
import type { BuiltInAdapter } from '../builtInAi/taskSession';
import { capturingServed, jsonClientResult, textClientResult, withClientResult, type ClientFirstHost } from './clientFirst';
import { completionOnDeviceTasks } from './completionOnDeviceTasks';
import type { OnDeviceTaskEvent, OnDeviceTasks, ServedBy } from './onDeviceTasks';
import { pageOnDeviceTasks } from './pageOnDeviceTasks';

const summarizer = (answer: string | null): BuiltInAdapter => ({
  id: 'summarizer', kinds: ['summarize'], ready: async () => answer !== null, summarize: async () => answer,
});

/** A page engine completion that reports `ref` as its server, like `pageEngineCompletion` does. */
const servedBy = (ref: string, reply: string) =>
  async (_m: unknown, _s?: AbortSignal, onServed?: (ref: string) => void) => { onServed?.(ref); return reply; };

describe('page port: observe + per-call provenance', () => {
  it('a built-in API answer is served by the browser', async () => {
    const events: OnDeviceTaskEvent[] = [];
    const tasks = pageOnDeviceTasks({ pageCompletion: null, adapters: [summarizer('ok')], observe: (e) => events.push(e) });
    expect(await tasks.summarize('some text', { kind: 'tldr' })).toBe('ok');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'summarize', engine: 'browser', outcome: 'served' });
    expect(events[0]!.promptTokens).toBeGreaterThan(0);
  });

  it('a call a bfi page engine served is bfi, and onServed says so for THAT call', async () => {
    const events: OnDeviceTaskEvent[] = [];
    const tasks = pageOnDeviceTasks({ pageCompletion: servedBy('local/bfi/qwen-0.5b', 'bfi text'), adapters: [], observe: (e) => events.push(e) });
    const seen: ServedBy[] = [];
    expect(await tasks.summarize('t', { kind: 'tldr', onServed: (by) => seen.push(by) })).toBe('bfi text');
    expect(seen).toEqual([{ kind: 'summarize', engine: 'bfi', model: 'qwen-0.5b' }]);
    expect(events[0]).toMatchObject({ outcome: 'served', engine: 'bfi', model: 'qwen-0.5b' });
  });

  it('concurrent calls served by different engines never cross', async () => {
    const complete = async (_m: unknown, _s?: AbortSignal, onServed?: (ref: string) => void) => {
      await new Promise((r) => setTimeout(r, 1));
      onServed?.('local/webllm/phi');
      return 'w';
    };
    const tasks = pageOnDeviceTasks({ pageCompletion: complete, adapters: [summarizer('b')] });
    const a: ServedBy[] = [];
    const b: ServedBy[] = [];
    await Promise.all([
      tasks.rewrite('x', { onServed: (by) => b.push(by) }),
      tasks.summarize('x', { kind: 'tldr', onServed: (by) => a.push(by) }),
    ]);
    expect(a[0]!.engine).toBe('browser');
    expect(b[0]!.engine).toBe('webllm');
  });

  it('a null answer is declined with no engine, and an abort is not reported', async () => {
    const events: OnDeviceTaskEvent[] = [];
    const tasks = pageOnDeviceTasks({ pageCompletion: null, adapters: [summarizer(null)], observe: (e) => events.push(e) });
    expect(await tasks.summarize('t', { kind: 'tldr' })).toBeNull();
    expect(events).toEqual([expect.objectContaining({ kind: 'summarize', outcome: 'declined', engine: null, model: null })]);
    const abort = Object.assign(new Error('a'), { name: 'AbortError' });
    const thrower = pageOnDeviceTasks({
      pageCompletion: null,
      observe: (e) => events.push(e),
      adapters: [{ ...summarizer('x'), summarize: async () => { throw abort; } }],
    });
    await expect(thrower.summarize('t', { kind: 'tldr' })).rejects.toBe(abort);
    expect(events).toHaveLength(1);
  });

  it('an observer that throws never fails the call', async () => {
    const tasks = pageOnDeviceTasks({ pageCompletion: null, adapters: [summarizer('ok')], observe: () => { throw new Error('boom'); } });
    expect(await tasks.summarize('t', { kind: 'tldr' })).toBe('ok');
  });
});

describe('completion port: observe', () => {
  it('reports a served json call with the serving engine and model', async () => {
    const events: OnDeviceTaskEvent[] = [];
    const tasks = completionOnDeviceTasks({
      complete: servedBy('local/synapse/qwen2.5-3b', '{"v":1}'), available: async () => true, observe: (e) => events.push(e),
    });
    const out = await tasks.json<{ v: number }>({ system: 's', user: 'u', schema: { type: 'object', required: ['v'] } });
    expect(out).toEqual({ v: 1 });
    expect(events).toEqual([expect.objectContaining({ kind: 'json', engine: 'synapse', model: 'qwen2.5-3b', outcome: 'served' })]);
  });

  it('reports a declined call when the output fails validation', async () => {
    const events: OnDeviceTaskEvent[] = [];
    const tasks = completionOnDeviceTasks({ complete: servedBy('local/synapse/m', '{"v":"x"}'), available: async () => true, observe: (e) => events.push(e) });
    expect(await tasks.json({ system: 's', user: 'u', schema: { type: 'object', properties: { v: { type: 'number' } } } })).toBeNull();
    expect(events).toEqual([expect.objectContaining({ outcome: 'declined' })]);
  });
});

describe('client-first provenance and the replaced signal', () => {
  const host = (events: OnDeviceTaskEvent[]): ClientFirstHost => ({
    tasks: {} as OnDeviceTasks,
    provenance: () => ({ engine: 'browser', model: 'gemini-nano' }),
    observe: (e) => events.push(e),
  });

  it('stamps the engine that served the call, not the built-in model', async () => {
    const tasks = pageOnDeviceTasks({ pageCompletion: servedBy('local/bfi/qwen-0.5b', 'hello'), adapters: [] });
    const capture = capturingServed();
    const text = await tasks.rewrite('x', { onServed: capture.onServed });
    const result = textClientResult(text, host([]), capture.served());
    expect(result?.provenance).toEqual({ engine: 'bfi', model: 'qwen-0.5b' });
    expect(JSON.parse(JSON.stringify(result))).toEqual({ text: 'hello', provenance: { engine: 'bfi', model: 'qwen-0.5b' } });
  });

  it('falls back to the host stamp with no trace', () => {
    expect(textClientResult('hi', host([]))?.provenance).toEqual({ engine: 'browser', model: 'gemini-nano' });
  });

  it('emits replaced when the server refuses the device result', async () => {
    const events: OnDeviceTaskEvent[] = [];
    const h = host(events);
    const send = vi.fn(async (cr?: unknown) => {
      if (cr) throw Object.assign(new Error('invalid_client_result'), { status: 400 });
      return 'server';
    });
    const served: ServedBy = { kind: 'json', engine: 'webllm', model: 'phi' };
    expect(await withClientResult(async () => jsonClientResult({ a: 1 }, h, served), send)).toBe('server');
    expect(events).toEqual([expect.objectContaining({ kind: 'json', engine: 'webllm', model: 'phi', outcome: 'replaced' })]);
  });

  it('emits nothing when the server accepts the result', async () => {
    const events: OnDeviceTaskEvent[] = [];
    await withClientResult(async () => textClientResult('ok', host(events), { kind: 'summarize', engine: 'bfi', model: 'm' }), async () => 1);
    expect(events).toEqual([]);
  });
});
