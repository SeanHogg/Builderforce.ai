/**
 * The LLM decomposer must be BOUNDED.
 *
 * `llmEpicDecomposer.assess` walks the whole `FREE_MODEL_POOL` through `ideProxy`,
 * and every candidate carries its own 15s per-attempt budget. With no ceiling that
 * cascade is unbounded on the caller's clock — the measured production incident had
 * candidates returning 200 OK with no content (`embedded:empty`), others 429ing, and
 * cerebras returning 402. One `assess()` could occupy minutes.
 *
 * These tests pin the two properties that matter:
 *   1. `assess()` supplies an `AbortSignal` that actually fires, so the walk is cut off.
 *   2. An aborted/hanging dispatch degrades to {@link heuristicEpicDecomposer} and
 *      NEVER throws — the caller keeps producing a defensible plan either way.
 *
 * The signal is asserted as a real `AbortSignal` rather than a mocked constant so the
 * test proves the deadline is wired to the request, not merely present in the options.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * A vendor dispatch that never answers, and refuses to settle until aborted — the
 * exact shape of a free-pool cascade walking a pool of dead candidates. Typed
 * loosely (`ProxyResult`-shaped) so a test can hand it a settled reply too.
 */
const ideComplete = vi.fn((_body: unknown, _headers?: unknown, _traceId?: unknown, signal?: AbortSignal) =>
  new Promise<Record<string, unknown>>((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('aborted before dispatch')); return; }
    signal?.addEventListener('abort', () => reject(new Error('aborted mid-cascade')));
  }));

vi.mock('../llm/LlmProxyService', async (importActual) => {
  const actual = await importActual<typeof import('../llm/LlmProxyService')>();
  return { ...actual, ideProxy: () => ({ complete: ideComplete }) };
});

import { llmEpicDecomposer, heuristicEpicDecomposer, LLM_DECOMPOSITION_BUDGET_MS } from './EpicDecomposer';
import { Task } from '../../domain/task/Task';

const env = {} as never;

/** A task with enough shape for both decomposers to reach a decision. */
function sampleTask(): Task {
  return Task.create({
    projectId: 7 as never,
    title: 'Build the reporting pipeline',
    description: 'Ingest events, transform them, and publish daily reports.',
    status: 'backlog' as never,
    priority: 'medium' as never,
    taskType: 'task' as never,
    projectKey: 'PRJ',
    lastKeySeq: 1,
  } as never);
}

describe('llmEpicDecomposer — deadline', () => {
  beforeEach(() => { vi.useRealTimers(); ideComplete.mockClear(); });

  it('hands completeJson a real abort signal (the deadline is wired, not declared)', async () => {
    // Return promptly so we are inspecting the wiring, not racing the clock.
    ideComplete.mockResolvedValueOnce({
      response: new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '{"isEpic":false,"children":[]}' } }] }), { status: 200, headers: { 'content-type': 'application/json' } }),
      resolvedModel: 'free/model',
      resolvedVendor: 'free',
      retries: 0,
      failovers: [],
    });
    await llmEpicDecomposer(env).assess(sampleTask());
    const signal = ideComplete.mock.calls[0]?.[3] as AbortSignal | undefined;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);
  });

  it('aborts a hanging cascade and falls back to the heuristic plan instead of throwing', async () => {
    // `AbortSignal.timeout` is host-owned, so fake timers cannot advance it and a real
    // test would have to burn the full 45s. Stub the timer to hand back a controller
    // and fire it on demand: production still calls `AbortSignal.timeout(BUDGET)`, and
    // the abort below is the same event the ceiling raises — so this exercises the real
    // cancellation path against a dispatcher that never answers.
    const controller = new AbortController();
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    try {
      const pending = llmEpicDecomposer(env).assess(sampleTask());
      // Let `completeJson` reach the dispatch and register its abort listener.
      await new Promise((resolve) => { setTimeout(resolve, 0); });
      expect(ideComplete).toHaveBeenCalled();
      controller.abort(new Error('decomposition deadline exceeded'));
      const plan = await pending;
      // The abort lands as a `gateway` failure inside completeJson, which hands the
      // task to the heuristic — a defensible plan, and NO throw out of assess().
      expect(plan.source).toBe('heuristic');
      expect(plan).toEqual(await heuristicEpicDecomposer.assess(sampleTask()));
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  it('the production budget leaves room for a healthy free attempt + failover', () => {
    // One slow free attempt is 15s; a vendor may declare up to 90s. The budget must
    // comfortably exceed a single healthy attempt plus one failover, yet stay far
    // below a Worker request budget. These assertions keep the number deliberate.
    expect(LLM_DECOMPOSITION_BUDGET_MS).toBeGreaterThanOrEqual(45_000);
    expect(LLM_DECOMPOSITION_BUDGET_MS).toBeLessThan(90_000);
  });
});

describe('llmEpicDecomposer — heuristic parity on failure', () => {
  beforeEach(() => { vi.useRealTimers(); ideComplete.mockClear(); });

  it('yields exactly the heuristic plan when the dispatch rejects', async () => {
    ideComplete.mockRejectedValueOnce(new Error('cerebras 402 payment_required'));
    const plan = await llmEpicDecomposer(env).assess(sampleTask());
    const heuristic = await heuristicEpicDecomposer.assess(sampleTask());
    expect(plan).toEqual(heuristic);
    expect(plan.source).toBe('heuristic');
  });
});