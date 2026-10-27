/**
 * WS-R — the run usage ledger records each call's role and its run's pipeline route,
 * score and run id (off the request the call already makes), and the route report folds
 * those rows into one priced record per run.
 */

import { describe, expect, it } from 'vitest';
import { createMemoryLocalFirstStore } from '@builderforce/local-first';
import { priceBookFromPrices } from '@builderforce/model-catalog';
import { createLocalBrainPersistence } from '../localFirstPersistence';
import type { BrainStreamFn } from '../runStore/runTypes';
import { callCostMillicents } from './callCost';
import { routeRunRecords, runOutcomesSince, usageRowsSince } from './routeLedger';
import { summarizeRouteRuns } from '@builderforce/pipeline-route';
import { createRunUsageLedger, ledgerSpend, withRunUsage, type RunUsageValue } from './usageLedger';

const DEVICE = 'device-1';
/** $1 / $2 per million tokens. */
const BOOK = priceBookFromPrices([['openai/gpt-x', { input: 1e-6, output: 2e-6 }]]);

function setup() {
  const store = createMemoryLocalFirstStore();
  const persistence = createLocalBrainPersistence({ store, deviceId: DEVICE, summarizeUnavailable: 'n/a', accountDestination: () => undefined, priceBook: () => BOOK });
  const ledger = createRunUsageLedger({ store, deviceId: DEVICE, book: () => BOOK });
  return { store, persistence, ledger };
}

const row = (over: Partial<RunUsageValue>): RunUsageValue => ({
  clientEventId: Math.random().toString(36).slice(2),
  clientChatId: 'chat-a',
  runKey: 1,
  model: 'openai/gpt-x',
  route: 'gateway',
  promptTokens: 1_000_000,
  completionTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  at: '2026-10-20T10:00:00.000Z',
  ...over,
});

describe('run usage ledger — role and pipeline route', () => {
  it('withRunUsage stamps the role, route, score and run id the call carried', async () => {
    const { ledger, persistence, store } = setup();
    const chat = await persistence.createChat({ title: 'x' });
    const inner: BrainStreamFn = async () => ({ text: 'ok', toolCalls: [], resolvedModel: 'openai/gpt-x', usage: { prompt: 10, completion: 5 } }) as never;
    const stream = withRunUsage(inner, ledger, { chatId: chat.id, runKey: chat.id, mode: 'work' });
    await stream({
      messages: [],
      role: 'code',
      metadata: { pipelineRoute: 'quick', routeScore: 0.31, guestTurnId: 'run-1' },
    }, {});
    // Recording is fire-and-forget; let it land.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const [stored] = await store.read((tx) => tx.list<RunUsageValue>('usage'));
    expect(stored?.payload).toMatchObject({ role: 'code', pipelineRoute: 'quick', routeScore: 0.31, runId: 'run-1', route: 'gateway' });
  });

  it('a call from an unrouted run carries none of them', async () => {
    const { ledger, persistence, store } = setup();
    const chat = await persistence.createChat({ title: 'x' });
    await ledger.record({ chatId: chat.id, runKey: 1, model: 'openai/gpt-x', route: 'gateway', usage: { prompt: 1, completion: 1 } });
    const [stored] = await store.read((tx) => tx.list<RunUsageValue>('usage'));
    expect(stored?.payload).not.toHaveProperty('pipelineRoute');
    expect(stored?.payload).not.toHaveProperty('role');
  });

  it('usageRowsSince reads the window, oldest first', async () => {
    const { ledger, persistence, store } = setup();
    const chat = await persistence.createChat({ title: 'x' });
    await ledger.record({ chatId: chat.id, runKey: 1, model: 'openai/gpt-x', route: 'gateway', usage: { prompt: 1, completion: 1 }, pipelineRoute: 'full', routeScore: 0.9 });
    expect(await usageRowsSince(store, DEVICE, new Date(Date.now() - 60_000))).toHaveLength(1);
    expect(await usageRowsSince(store, DEVICE, new Date(Date.now() + 60_000))).toHaveLength(0);
  });
});

describe('routeRunRecords', () => {
  it('folds a run\'s calls into one priced record, skipping unrouted calls', () => {
    const runs = routeRunRecords([
      row({ runId: 'r1', pipelineRoute: 'quick', routeScore: 0.3 }),
      row({ runId: 'r1', pipelineRoute: 'quick', routeScore: 0.3, at: '2026-10-20T10:01:00.000Z' }),
      row({ runId: 'r2', pipelineRoute: 'full', routeScore: 0.8, clientChatId: 'chat-b', model: 'local/ollama/q' }),
      row({}),
    ], BOOK);
    expect(runs).toEqual([
      { route: 'quick', score: 0.3, costMc: 200_000, conversation: 'chat-a', startedAt: '2026-10-20T10:00:00.000Z' },
      { route: 'full', score: 0.8, costMc: 0, conversation: 'chat-b', startedAt: '2026-10-20T10:00:00.000Z' },
    ]);
  });
});

describe("run outcomes — the misroute proxy's other half", () => {
  it("recordOutcome stores a run's end by its run id, read back by runOutcomesSince", async () => {
    const { ledger, persistence, store } = setup();
    const chat = await persistence.createChat({ title: 'x' });
    await ledger.recordOutcome({ chatId: chat.id, runId: 'run-9', outcome: 'failed' });
    await ledger.recordOutcome({ chatId: 99_999, runId: 'run-x', outcome: 'failed' });
    const outcomes = await runOutcomesSince(store, DEVICE, new Date(Date.now() - 60_000));
    expect([...outcomes]).toEqual([['run-9', 'failed']]);
    // Local only: an outcome is never journaled for sync.
    expect((await store.read((tx) => tx.pending())).filter((e) => e.entityType === 'run-outcome')).toEqual([]);
  });

  it('a quick run recorded as failed is a misroute in the report', () => {
    const rows = [
      row({ runId: 'q1', pipelineRoute: 'quick', routeScore: 0.3 }),
      row({ runId: 'q2', pipelineRoute: 'quick', routeScore: 0.4, clientChatId: 'chat-b' }),
    ];
    const outcomes = new Map([['q1', 'failed' as const], ['q2', 'succeeded' as const]]);
    const runs = routeRunRecords(rows, BOOK, outcomes);
    expect(runs.map((r) => r.failed)).toEqual([true, false]);
    expect(summarizeRouteRuns(runs).misroutes).toBe(1);
  });
});

describe('callCostMillicents', () => {
  it('prices a call at list, a local call at nothing', () => {
    expect(callCostMillicents('openai/gpt-x', { prompt: 1_000_000, completion: 500_000 }, BOOK)).toBe(200_000);
    expect(callCostMillicents('local/ollama/q', { prompt: 1_000_000, completion: 0 }, BOOK)).toBe(0);
    expect(callCostMillicents('unknown/model', { prompt: 1_000_000, completion: 0 }, BOOK)).toBe(0);
    expect(callCostMillicents(undefined, { prompt: 1, completion: 1 }, BOOK)).toBe(0);
  });

  it('is ONE rule by the row\'s transport route: local free, gateway billed, BYO counted at list', () => {
    const tokens = { prompt: 1_000_000, completion: 0 };
    expect(callCostMillicents('openai/gpt-x', tokens, BOOK, 'local')).toBe(0);
    expect(callCostMillicents('openai/gpt-x', tokens, BOOK, 'gateway')).toBe(100_000);
    // A direct-vendor id has no gateway price; it is the person's own money, valued at list.
    expect(callCostMillicents('direct/openai/gpt-x', tokens, BOOK, 'byo-direct')).toBe(100_000);
    expect(callCostMillicents('direct/openai/gpt-x', tokens, BOOK)).toBe(100_000);
  });

  it('the chat spend panel counts the same dollars — gateway as platform, BYO as your key', () => {
    const rows = [row({ route: 'gateway' }), row({ route: 'byo-direct', model: 'direct/openai/gpt-x' }), row({ route: 'local', model: 'local/ollama/q', savingsSource: 'local_model' })];
    const spend = ledgerSpend(rows, { excludeGateway: false, book: BOOK })!.spend;
    const rule = (r: RunUsageValue) => callCostMillicents(r.model, { prompt: r.promptTokens, completion: r.completionTokens }, BOOK, r.route);
    expect(spend.platformUsd).toBeCloseTo(rule(rows[0]!) / 100_000);
    expect(spend.yourKeyUsd).toBeCloseTo(rule(rows[1]!) / 100_000);
    expect(spend.totalUsd).toBeCloseTo(rows.reduce((sum, r) => sum + rule(r), 0) / 100_000);
    // And the route report prices the same rows the same way.
    const runs = routeRunRecords(rows.map((r) => ({ ...r, runId: 'r1', pipelineRoute: 'full' as const })), BOOK);
    expect(runs[0]!.costMc).toBe(rows.reduce((sum, r) => sum + rule(r), 0));
  });
});
