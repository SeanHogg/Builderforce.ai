import { describe, expect, it, vi } from 'vitest';
import type { BuiltInAdapter } from '../builtInAi/taskSession';
import { completionOnDeviceTasks } from './completionOnDeviceTasks';
import { pageOnDeviceTasks } from './pageOnDeviceTasks';
import { ON_DEVICE_TASK_ROUTES } from './taskRoutes';

const adapter = (id: BuiltInAdapter['id'], answer: string | null, calls: string[]): BuiltInAdapter => ({
  id,
  kinds: ['summarize'],
  ready: async () => answer !== null,
  summarize: async () => { calls.push(id); return answer; },
});

describe('ON_DEVICE_TASK_ROUTES', () => {
  it('has no generic fallback for translate; detectLanguage tails into the heuristic', () => {
    expect(ON_DEVICE_TASK_ROUTES.translate).toEqual(['translator']);
    expect(ON_DEVICE_TASK_ROUTES.detectLanguage).toEqual(['languageDetector', 'pageEngine']);
  });
});

describe('summarize failure containment', () => {
  it('a rejecting measure is a decline (null), not a throw', async () => {
    const a: BuiltInAdapter = {
      id: 'summarizer', kinds: ['summarize'], ready: async () => true, summarize: async () => 's',
      budget: async () => ({ limit: 10, measure: async () => { throw new Error('boom'); }, release: () => {} }),
    };
    const tasks = pageOnDeviceTasks({ pageCompletion: null, adapters: [a] });
    expect(await tasks.summarize('x'.repeat(100), { kind: 'tldr' })).toBeNull();
  });
});

describe('pageOnDeviceTasks', () => {
  it('walks the route in order and stops at the first answer', async () => {
    const calls: string[] = [];
    const tasks = pageOnDeviceTasks({
      pageCompletion: null,
      adapters: [adapter('summarizer', null, calls), adapter('prompt', 'from prompt', calls)],
    });
    expect(await tasks.summarize('t', { kind: 'tldr' })).toBe('from prompt');
    expect(calls).toEqual(['summarizer', 'prompt']);
  });

  it('falls back to the page engine when the built-in API is absent', async () => {
    const complete = vi.fn(async () => 'page engine summary');
    const tasks = pageOnDeviceTasks({ pageCompletion: complete, adapters: [] });
    expect(await tasks.summarize('text', { kind: 'tldr' })).toBe('page engine summary');
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('returns null when nothing can answer, and translate never uses the page engine', async () => {
    const complete = vi.fn(async () => 'x');
    const tasks = pageOnDeviceTasks({ pageCompletion: complete, adapters: [] });
    expect(await tasks.translate('hola', { from: 'es', to: 'en' })).toBeNull();
    expect(await tasks.detectLanguage('hola')).toBeNull();
    expect(complete).not.toHaveBeenCalled();
  });

  it('detectLanguage falls to the deterministic heuristic without the model', async () => {
    const complete = vi.fn(async () => 'x');
    const tasks = pageOnDeviceTasks({ pageCompletion: complete, adapters: [] });
    expect((await tasks.detectLanguage('Der Hund ist nicht in dem Haus und die Katze sitzt auf dem Tisch mit einer Maus.'))?.lang).toBe('de');
    expect((await completionOnDeviceTasks({ complete, available: async () => true }).detectLanguage('今天天气很好，我们一起去公园散步吧。'))?.lang).toBe('zh');
    expect(complete).not.toHaveBeenCalled();
  });

  it('json: an invalid built-in answer falls through to the page engine, which is validated too', async () => {
    const schema = { type: 'object', required: ['n'], properties: { n: { type: 'number' } } };
    const bad: BuiltInAdapter = { id: 'prompt', kinds: ['json'], ready: async () => true, json: async () => ({ n: 'no' }) };
    const tasks = pageOnDeviceTasks({ pageCompletion: async () => '{"n":2}', adapters: [bad] });
    expect(await tasks.json({ system: 's', user: 'u', schema })).toEqual({ n: 2 });
    const tasksBad = pageOnDeviceTasks({ pageCompletion: async () => '{"n":"x"}', adapters: [bad] });
    expect(await tasksBad.json({ system: 's', user: 'u', schema })).toBeNull();
  });

  it('available() reflects ready adapters and the page engine', async () => {
    const tasks = pageOnDeviceTasks({ pageCompletion: async () => 'x', pageAvailable: async () => true, adapters: [] });
    const kinds = await tasks.available();
    expect(kinds.has('summarize')).toBe(true);
    expect(kinds.has('translate')).toBe(false);
  });
});

describe('completionOnDeviceTasks', () => {
  const schema = { type: 'object', required: ['verdict'], properties: { verdict: { enum: ['keep', 'drop'] } } };
  const make = (reply: string | null) =>
    completionOnDeviceTasks({ complete: async () => reply, available: async () => true });

  it('json returns a schema-valid reply (fenced or not)', async () => {
    expect(await make('```json\n{"verdict":"keep"}\n```').json({ system: 's', user: 'u', schema })).toEqual({ verdict: 'keep' });
  });

  it('json: invalid output or a refusal is null', async () => {
    expect(await make('{"verdict":"maybe"}').json({ system: 's', user: 'u', schema })).toBeNull();
    expect(await make('not json').json({ system: 's', user: 'u', schema })).toBeNull();
    expect(await make(null).json({ system: 's', user: 'u', schema })).toBeNull();
  });

  it('a completion that throws is null; only an abort propagates', async () => {
    const boom = completionOnDeviceTasks({ complete: async () => { throw new Error('x'); }, available: async () => true });
    expect(await boom.proofread('t')).toBeNull();
    const controller = new AbortController();
    controller.abort();
    await expect(boom.rewrite('t', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('translate is null; a short detectLanguage is null (no model, heuristic only)', async () => {
    const tasks = make('x');
    expect(await tasks.translate('a', { to: 'en' })).toBeNull();
    expect(await tasks.detectLanguage('a')).toBeNull();
  });

  it('summarize chunks a transcript past its window', async () => {
    const complete = vi.fn(async () => 'short');
    const tasks = completionOnDeviceTasks({ complete, available: async () => true, contextTokens: 400 });
    const text = Array.from({ length: 12 }, (_, i) => `message ${i} `.padEnd(100, 'y')).join('\n\n');
    expect(await tasks.summarize(text, { kind: 'transcript' })).toBe('short');
    expect(complete.mock.calls.length).toBeGreaterThan(2);
  });
});
