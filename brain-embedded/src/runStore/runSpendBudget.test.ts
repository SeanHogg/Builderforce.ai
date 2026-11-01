import { describe, expect, it, vi } from 'vitest';
import { usdBudget, runBudgetCapMillicents, type UsdBudget } from '@builderforce/agent-run';
import type { StreamChatResult } from '../streamChatCompletion';
import { priceBookFromPrices } from '@builderforce/model-catalog';
import { loopSpendMeter } from '../run/loopSpend';
import { brainEventSink } from '../run/eventSink';
import { turnPriceMc } from '../localChat/turnCost';
import { makeCell } from './runCell';
import { cells } from './runCells';
import type { RunLoopContext } from './runLoopContext';
import { persistBudgetStop } from './runSpendBudget';

/** A run with a USD cap, and the persistence its contained stop writes through. A
 *  `runKey` registers its cell (as `getCell` does); `ownerKey` makes it a sub-agent. */
function runWith(maxRunBudgetUsd: number | undefined, tree: { runKey?: number; ownerKey?: number } = {}) {
  const sendMessages = vi.fn(async (_chatId: number, rows: Array<{ role: string; content: string }>) =>
    rows.map((r, i) => ({ id: 900 + i, chatId: 1, role: r.role, content: r.content, createdAt: '' })));
  const c = makeCell();
  if (tree.runKey !== undefined) cells.set(tree.runKey, c);
  const lineage = tree.ownerKey !== undefined ? { rootChatId: 1, ownerKey: tree.ownerKey, ownerName: 'Owner', handle: 'a1', label: 'slice', agent: { ref: 'x', name: 'X' }, depth: 1 } : undefined;
  const run = {
    chatId: 1,
    c,
    req: { maxRunBudgetUsd, persistence: { sendMessages }, ...(lineage ? { lineage } : {}) },
  } as unknown as RunLoopContext;
  return { run, sendMessages };
}

/** $1 per million tokens, in and out. */
const BOOK = priceBookFromPrices([['openai/gpt-x', { input: 1e-6, output: 1e-6 }]]);

/**
 * The run's cap as the agent holds it: the Brain's tree meter (`run/loopSpend.ts`) under the agent's budget (`usdBudget`), each turn
 * priced by the device's one rule (`localChat/turnCost.ts`, here over `BOOK`) and the budget's events rendered on the run's trace by
 * the Brain's sink. Undefined when the run is uncapped.
 */
function capOf(run: RunLoopContext): { budget: UsdBudget; turn(result: Partial<StreamChatResult>, requested: string): void } | undefined {
  const meter = loopSpendMeter(run);
  const budget = meter ? usdBudget(run.req.maxRunBudgetUsd, meter) : undefined;
  if (!budget) return undefined;
  const sink = brainEventSink(run.c);
  return {
    budget,
    turn(result, requested) {
      const full = { text: '', toolCalls: [], ...result } as StreamChatResult;
      const unpriced = budget.afterTurn({ pricedMc: turnPriceMc(full, requested, BOOK) });
      if (unpriced) void sink.emit({ kind: 'budget.unpriced', step: 0, model: full.resolvedModel ?? requested });
    },
  };
}

/** A turn whose call used `prompt` + `completion` tokens on `model`. */
const turn = (model: string, prompt: number, completion = 0): [Partial<StreamChatResult>, string] =>
  [{ resolvedModel: model, usage: { prompt, completion } }, model];
/** A turn whose call reported NO usage at all. */
const noUsageTurn = (model: string): [Partial<StreamChatResult>, string] => [{ resolvedModel: model }, model];

const unpricedSteps = (run: RunLoopContext) => run.c.trace.filter((event) => event.label === 'run.budget_unpriced');

describe('runBudgetCapMillicents', () => {
  it('is null for no cap, 0 or nonsense; millicents otherwise', () => {
    expect(runBudgetCapMillicents(undefined)).toBeNull();
    expect(runBudgetCapMillicents(0)).toBeNull();
    expect(runBudgetCapMillicents(-2)).toBeNull();
    expect(runBudgetCapMillicents(Number.NaN)).toBeNull();
    expect(runBudgetCapMillicents(1.5)).toBe(150_000);
  });
});

describe('the run\'s USD cap', () => {
  it('an uncapped run gets no cap at all', () => {
    expect(capOf(runWith(undefined).run)).toBeUndefined();
    expect(capOf(runWith(0).run)).toBeUndefined();
  });

  it('a call to a model on this machine costs nothing and never trips the cap', () => {
    const { run } = runWith(0.01);
    const cap = capOf(run)!;
    cap.turn(...turn('local/ollama/qwen3:8b', 50_000_000, 50_000_000));
    expect(cap.budget.beforeTurn()).toBeUndefined();
  });

  it('a call to a hosted local-grammar runtime (Kimi Code) is the person’s own spend and counts against the cap', () => {
    const { run } = runWith(0.01);
    const meter = loopSpendMeter(run)!;
    const budget = usdBudget(run.req.maxRunBudgetUsd, meter)!;
    const price = turnPriceMc({ text: '', toolCalls: [], resolvedModel: 'local/kimi-code/k2', usage: { prompt: 50_000_000, completion: 50_000_000 } } as StreamChatResult, 'local/kimi-code/k2', priceBookFromPrices([['moonshotai/kimi-k2', { input: 1e-6, output: 1e-6 }]]));
    budget.afterTurn({ pricedMc: price });
    expect(budget.beforeTurn()).toMatchObject({ kind: 'contain' });
  });

  it('counts a call with no known price as UNPRICED — flagged in the trace, never read as free', () => {
    const { run } = runWith(0.01);
    const cap = capOf(run)!;
    cap.turn(...turn('vendor/not-in-the-book', 50_000_000, 50_000_000));
    // Nothing priced was spent, so the cap does not trip — but the tree says it is under-counted.
    expect(cap.budget.beforeTurn()).toBeUndefined();
    // …and the run says so, once, in its trace.
    expect(unpricedSteps(run)).toHaveLength(1);
    cap.turn(...turn('vendor/not-in-the-book', 1_000));
    expect(unpricedSteps(run)).toHaveLength(1);
  });

  it('a call that reported no usage OFF the device is counted unpriced and traced; the contained reply says the spend is a floor', () => {
    const { run } = runWith(1);
    const cap = capOf(run)!;
    cap.turn(...noUsageTurn('openai/gpt-x'));
    expect(unpricedSteps(run)).toHaveLength(1);
    cap.turn(...turn('openai/gpt-x', 1_000_000));
    const decision = cap.budget.beforeTurn();
    expect(decision && decision.text).toContain('at least $1.00 spent — 1 call had no known price');
  });

  it('a call that reported no usage ON the device counts nothing and traces nothing', () => {
    const { run } = runWith(1);
    const cap = capOf(run)!;
    cap.turn(...noUsageTurn('local/ollama/qwen3:8b'));
    expect(unpricedSteps(run)).toHaveLength(0);
    cap.turn(...turn('openai/gpt-x', 1_000_000));
    const decision = cap.budget.beforeTurn();
    expect(decision && decision.text).toContain('($1.00 spent)');
    expect(decision && decision.text).not.toContain('no known price');
  });

  it('warns once past 80%, then stops with a contained reply at the cap, saved as a plain assistant message', async () => {
    // $1 cap; the model is $1 per million tokens either way.
    const { run, sendMessages } = runWith(1);
    const cap = capOf(run)!;
    expect(cap.budget.beforeTurn()).toBeUndefined();
    cap.turn(...turn('openai/gpt-x', 850_000));
    const warning = cap.budget.beforeTurn();
    expect(warning).toMatchObject({ kind: 'warn' });
    expect(String(warning?.text)).toContain('over 80%');
    // The warning is said once.
    expect(cap.budget.beforeTurn()).toBeUndefined();
    cap.turn(...turn('openai/gpt-x', 150_000));
    const decision = cap.budget.beforeTurn();
    expect(decision).toMatchObject({ kind: 'contain' });
    expect(decision && decision.text).toContain('Run stopped');
    await persistBudgetStop(run, decision!.text);
    expect(sendMessages).toHaveBeenCalledTimes(1);
    expect(sendMessages.mock.calls[0]![1]).toEqual([{ role: 'assistant', content: decision!.text }]);
  });

  it('a call a local-first serve answered on this machine costs nothing, whatever model it names', () => {
    const { run } = runWith(0.01);
    const cap = capOf(run)!;
    cap.turn({ resolvedModel: 'openai/gpt-x', usage: { prompt: 50_000_000, completion: 0 }, localFirst: [{ target: 'local/ollama/q', outcome: 'served' }] } as Partial<StreamChatResult>, 'openai/gpt-x');
    expect(cap.budget.beforeTurn()).toBeUndefined();
  });

  it('an owner and its sub-agents (at any depth) share ONE cap', () => {
    try {
      const owner = capOf(runWith(1, { runKey: 7001 }).run)!;
      const child = capOf(runWith(1, { runKey: 7002, ownerKey: 7001 }).run)!;
      const grandchild = capOf(runWith(1, { runKey: 7003, ownerKey: 7002 }).run)!;
      // Each spends 45% of the cap: alone none would stop, together they pass it.
      owner.turn(...turn('openai/gpt-x', 450_000));
      child.turn(...turn('openai/gpt-x', 450_000));
      expect(grandchild.budget.beforeTurn()).toMatchObject({ kind: 'warn' });
      grandchild.turn(...turn('openai/gpt-x', 450_000));
      // The owner's total includes what its children spent.
      expect(owner.budget.beforeTurn()).toMatchObject({ kind: 'contain' });
      expect(child.budget.beforeTurn()).toMatchObject({ kind: 'contain' });
    } finally {
      for (const k of [7001, 7002, 7003]) cells.delete(k);
    }
  });

  it('a new top-level run on the same chat starts a fresh total', () => {
    try {
      const first = runWith(1, { runKey: 7101 });
      capOf(first.run)!.turn(...turn('openai/gpt-x', 900_000));
      expect(capOf(first.run)!.budget.beforeTurn()).toBeUndefined();
    } finally {
      cells.delete(7101);
    }
  });
});
