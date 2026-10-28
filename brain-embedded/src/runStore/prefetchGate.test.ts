import { describe, expect, it, vi } from 'vitest';
import { defineRegistry, type PrefetchAction, type PrefetchPort } from '@builderforce/prefetch';
import { makeCell } from './runCell';
import { answerDeterministically } from './prefetchGate';
import type { BrainRunRequest } from './runTypes';

const row = (over: Partial<PrefetchAction> & Pick<PrefetchAction, 'id'>): PrefetchAction => ({
  kind: 'answer',
  sideEffect: 'read',
  surfaces: ['vscode'],
  examples: [],
  budgetMs: 1000,
  labelKey: `prefetch.action.${over.id}`,
  ...over,
});

function setup(port: PrefetchPort, text: string) {
  const c = makeCell();
  c.transcript.push({ role: 'user', content: text });
  const sendMessages = vi.fn(async (_chatId: number, messages: Array<{ role: string; content: string }>) =>
    messages.map((m, i) => ({ id: i + 1, role: m.role, content: m.content }) as never));
  const recordAvoidedCall = vi.fn();
  const req = { prefetch: port, persistence: { sendMessages }, recordAvoidedCall, model: 'anthropic/claude-sonnet' } as unknown as BrainRunRequest;
  return { c, req, sendMessages, recordAvoidedCall };
}

describe('the PreFetch gate in the preamble', () => {
  it('ANSWER settles the run with no model, traces the decision and records the avoided call', async () => {
    const port: PrefetchPort = {
      registry: defineRegistry([row({ id: 'symbols.where-defined', patterns: [/^where is/i] })]),
      executors: { 'symbols.where-defined': { run: async () => ({ actionId: 'symbols.where-defined', text: '`Widget` is at src/widget.ts:12' }) } },
      ports: { surface: 'vscode' },
    };
    const { c, req, sendMessages, recordAvoidedCall } = setup(port, 'where is Widget defined?');
    const gate = await answerDeterministically(1, c, req, 'run-1');
    expect(gate.answered).toBe(true);
    expect(sendMessages).toHaveBeenCalledTimes(1);
    const answer = c.trace.find((e) => e.label === 'symbols.where-defined');
    expect(answer?.result).toMatchObject({ source: 'symbols.where-defined', p: 1, tier: 1, route: 'answer', skippedLlm: true });
    expect(c.trace.find((e) => e.label === 'prefetch.decision')?.result).toMatchObject({ settled: 'answer' });
    expect(recordAvoidedCall).toHaveBeenCalledWith(expect.objectContaining({ source: 'deterministic', actionId: 'symbols.where-defined', runId: 'run-1', model: 'anthropic/claude-sonnet' }));
  });

  it('a write action never runs without the confirm chip', async () => {
    const run = vi.fn(async () => ({ actionId: 'format.apply', text: 'formatted' }));
    const port: PrefetchPort = {
      registry: defineRegistry([row({ id: 'format.apply', sideEffect: 'write', slash: '/format' })]),
      executors: { 'format.apply': { run } },
      ports: { surface: 'vscode' },
      confirm: async () => false,
    };
    const { c, req } = setup(port, '/format');
    expect((await answerDeterministically(1, c, req)).answered).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it('PREFETCH output goes to the volatile tail, not the transcript', async () => {
    const port: PrefetchPort = {
      registry: defineRegistry([row({ id: 'tests.related', kind: 'prefetch', slash: '/related' })]),
      executors: { 'tests.related': { run: async () => ({ actionId: 'tests.related', text: 'RELATED: a.test.ts' }) } },
      ports: { surface: 'vscode' },
    };
    const { c, req, sendMessages } = setup(port, '/related');
    const gate = await answerDeterministically(1, c, req);
    expect(gate).toEqual({ answered: false, tail: ['RELATED: a.test.ts'] });
    expect(sendMessages).not.toHaveBeenCalled();
  });

  it('the next request settles the outcome: a re-ask is not accepted', async () => {
    const record = vi.fn();
    const port: PrefetchPort = {
      registry: defineRegistry([row({ id: 'symbols.where-defined', patterns: [/^where is/i] })]),
      executors: { 'symbols.where-defined': { run: async () => ({ actionId: 'symbols.where-defined', text: 'at src/a.ts:1' }) } },
      ports: { surface: 'vscode' },
      record,
    };
    const { c, req } = setup(port, 'where is fooBar defined?');
    await answerDeterministically(1, c, req);
    c.transcript.push({ role: 'user', content: 'where is fooBar defined' });
    await answerDeterministically(1, c, req);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ actionId: 'symbols.where-defined', accepted: false }));
  });
});
