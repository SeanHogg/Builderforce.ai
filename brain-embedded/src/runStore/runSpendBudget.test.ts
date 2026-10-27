import { describe, expect, it, vi } from 'vitest';
import type { LoopTurn, TurnContext } from '@builderforce/agent-loop';
import type { ChatCompletionMessage } from '../streamChatCompletion';
import { priceBookFromPrices } from '@builderforce/model-catalog';
import { isVolatileTail } from '@seanhogg/builderforce-memory/handoff';
import { makeCell } from './runCell';
import { cells } from './runCells';
import type { RunLoopContext } from './runLoopContext';
import { budgetContainedReply, runBudgetCapMillicents, runSpendBudget } from './runSpendBudget';

/** A run with a USD cap, and the persistence its contained stop writes through. A
 *  `runKey` registers its cell (as `getCell` does); `ownerKey` makes it a sub-agent. */
function runWith(maxRunBudgetUsd: number | undefined, tree: { runKey?: number; ownerKey?: number } = {}) {
  const sendMessages = vi.fn(async (_chatId: number, rows: Array<{ role: string; content: string }>) =>
    rows.map((r, i) => ({ id: 900 + i, chatId: 1, role: r.role, content: r.content, createdAt: '' })));
  const convo: ChatCompletionMessage[] = [];
  const c = makeCell();
  if (tree.runKey !== undefined) cells.set(tree.runKey, c);
  const lineage = tree.ownerKey !== undefined ? { rootChatId: 1, ownerKey: tree.ownerKey, ownerName: 'Owner', handle: 'a1', label: 'slice', agent: { ref: 'x', name: 'X' }, depth: 1 } : undefined;
  const run = {
    chatId: 1,
    c,
    convo,
    req: { maxRunBudgetUsd, persistence: { sendMessages }, ...(lineage ? { lineage } : {}) },
  } as unknown as RunLoopContext;
  return { run, convo, sendMessages };
}

const ctx = {} as TurnContext<ChatCompletionMessage>;
/** $1 per million tokens, in and out. */
const BOOK = priceBookFromPrices([['openai/gpt-x', { input: 1e-6, output: 1e-6 }]]);
/** A turn whose call used `prompt` + `completion` tokens on `model`. */
const turn = (model: string, prompt: number, completion = 0): LoopTurn =>
  ({ content: '', toolCalls: [], meta: { result: { text: '', toolCalls: [], resolvedModel: model, usage: { prompt, completion } }, requested: model } }) as unknown as LoopTurn;

describe('runBudgetCapMillicents', () => {
  it('is null for no cap, 0 or nonsense; millicents otherwise', () => {
    expect(runBudgetCapMillicents(undefined)).toBeNull();
    expect(runBudgetCapMillicents(0)).toBeNull();
    expect(runBudgetCapMillicents(-2)).toBeNull();
    expect(runBudgetCapMillicents(Number.NaN)).toBeNull();
    expect(runBudgetCapMillicents(1.5)).toBe(150_000);
  });
});

describe('runSpendBudget', () => {
  it('an uncapped run gets no hooks at all', () => {
    expect(runSpendBudget(runWith(undefined).run)).toEqual({});
    expect(runSpendBudget(runWith(0).run)).toEqual({});
  });

  it('a call to a model on this machine costs nothing and never trips the cap', async () => {
    const { run } = runWith(0.01);
    const hooks = runSpendBudget(run, BOOK);
    await hooks.afterTurn!(ctx, turn('local/ollama/qwen3:8b', 50_000_000, 50_000_000));
    expect(await hooks.beforeTurn!(ctx)).toBeUndefined();
  });

  it('warns once past 80%, then stops with a contained reply at the cap', async () => {
    // $1 cap; the model is $1 per million tokens either way.
    const { run, convo, sendMessages } = runWith(1);
    const hooks = runSpendBudget(run, BOOK);
    expect(await hooks.beforeTurn!(ctx)).toBeUndefined();
    await hooks.afterTurn!(ctx, turn('openai/gpt-x', 850_000));
    expect(await hooks.beforeTurn!(ctx)).toBeUndefined();
    expect(convo).toHaveLength(1);
    expect(convo[0]).toMatchObject({ role: 'user' });
    expect(String(convo[0]!.content)).toContain('over 80%');
    // The warning is said once.
    expect(await hooks.beforeTurn!(ctx)).toBeUndefined();
    expect(convo).toHaveLength(1);
    await hooks.afterTurn!(ctx, turn('openai/gpt-x', 150_000));
    const decision = await hooks.beforeTurn!(ctx);
    expect(decision).toMatchObject({ action: 'stop', ok: true, finished: true });
    expect(decision && decision.output).toContain('Run stopped');
    expect(sendMessages).toHaveBeenCalledTimes(1);
    expect(convo.at(-1)).toMatchObject({ role: 'assistant' });
  });

  it('the 80% warning is a tagged <run-state> block, never an untagged user turn', async () => {
    const { run, convo } = runWith(1);
    const hooks = runSpendBudget(run, BOOK);
    await hooks.afterTurn!(ctx, turn('openai/gpt-x', 850_000));
    await hooks.beforeTurn!(ctx);
    expect(isVolatileTail(convo[0] as never)).toBe(true);
  });

  it('a call a local-first serve answered on this machine costs nothing, whatever model it names', async () => {
    const { run } = runWith(0.01);
    const hooks = runSpendBudget(run, BOOK);
    const served = ({ content: '', toolCalls: [], meta: { result: { text: '', toolCalls: [], resolvedModel: 'openai/gpt-x', usage: { prompt: 50_000_000, completion: 0 }, localFirst: [{ target: 'local/ollama/q', outcome: 'served' }] }, requested: 'openai/gpt-x' } }) as unknown as LoopTurn;
    await hooks.afterTurn!(ctx, served);
    expect(await hooks.beforeTurn!(ctx)).toBeUndefined();
  });

  it('an owner and its sub-agents (at any depth) share ONE cap', async () => {
    try {
      const owner = runWith(1, { runKey: 7001 });
      const child = runWith(1, { runKey: 7002, ownerKey: 7001 });
      const grandchild = runWith(1, { runKey: 7003, ownerKey: 7002 });
      const ownerHooks = runSpendBudget(owner.run, BOOK);
      const childHooks = runSpendBudget(child.run, BOOK);
      const grandHooks = runSpendBudget(grandchild.run, BOOK);
      // Each spends 45% of the cap: alone none would stop, together they pass it.
      await ownerHooks.afterTurn!(ctx, turn('openai/gpt-x', 450_000));
      await childHooks.afterTurn!(ctx, turn('openai/gpt-x', 450_000));
      expect(await grandHooks.beforeTurn!(ctx)).toBeUndefined();
      expect(String(grandchild.convo[0]?.content)).toContain('over 80%');
      await grandHooks.afterTurn!(ctx, turn('openai/gpt-x', 450_000));
      // The owner's total includes what its children spent.
      expect(await ownerHooks.beforeTurn!(ctx)).toMatchObject({ action: 'stop' });
      expect(await childHooks.beforeTurn!(ctx)).toMatchObject({ action: 'stop' });
    } finally {
      for (const k of [7001, 7002, 7003]) cells.delete(k);
    }
  });

  it('a new top-level run on the same chat starts a fresh total', async () => {
    try {
      const first = runWith(1, { runKey: 7101 });
      const firstHooks = runSpendBudget(first.run, BOOK);
      await firstHooks.afterTurn!(ctx, turn('openai/gpt-x', 900_000));
      const again = { ...first.run, convo: [] } as unknown as RunLoopContext;
      expect(await runSpendBudget(again, BOOK).beforeTurn!(ctx)).toBeUndefined();
    } finally {
      cells.delete(7101);
    }
  });

  it('the contained reply names the cap and the setting', () => {
    const text = budgetContainedReply(260_000, 250_000);
    expect(text).toContain('$2.50');
    expect(text).toContain('$2.60');
    expect(text).toContain('builderforce.maxRunBudgetUsd');
  });
});
