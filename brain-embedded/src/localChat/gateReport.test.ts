import { describe, expect, it } from 'vitest';
import { summarizeGateRuns } from './routeLedger';
import type { RunUsageValue } from './usageLedger';

const row = (over: Partial<RunUsageValue>): RunUsageValue => ({
  clientEventId: Math.random().toString(36),
  clientChatId: 'c1',
  runKey: 1,
  model: 'anthropic/claude-sonnet',
  route: 'gateway',
  promptTokens: 100,
  completionTokens: 10,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  at: '2026-10-28T00:00:00.000Z',
  ...over,
});

describe('the route report gate column', () => {
  it('splits the gated runs into answer / prefetch / llm, one per run, with accuracy from the gate readings', () => {
    const rows = [
      // Two ANSWERED runs: their avoided-call rows.
      row({ runId: 'a1', route: 'local', promptTokens: 0, completionTokens: 0, savingsSource: 'deterministic', answeredBy: 'dup.check', savedCostMc: 3000 }),
      row({ runId: 'a2', route: 'local', promptTokens: 0, completionTokens: 0, savingsSource: 'deterministic', answeredBy: 'symbols.where-defined', savedCostMc: 2000 }),
      // A PREFETCH run that made three calls — one run.
      row({ runId: 'p1', gateRoute: 'prefetch' }),
      row({ runId: 'p1', gateRoute: 'prefetch' }),
      row({ runId: 'p1', gateRoute: 'prefetch' }),
      // Two LLM runs.
      row({ runId: 'l1', gateRoute: 'llm' }),
      row({ runId: 'l2', gateRoute: 'llm' }),
      // A run from before the gate existed: not counted.
      row({ runId: 'old' }),
    ];
    const accepted = new Map([['a1', true], ['a2', false], ['p1', true]]);
    const report = summarizeGateRuns(rows, accepted);
    expect(report.runs).toBe(5);
    expect(report.answer).toEqual({ runs: 2, judged: 2, accepted: 1 });
    expect(report.prefetch).toEqual({ runs: 1, judged: 1, accepted: 1 });
    expect(report.llm).toEqual({ runs: 2 });
    expect(report.answeredBy).toEqual([{ actionId: 'dup.check', runs: 1 }, { actionId: 'symbols.where-defined', runs: 1 }]);
    expect(report.savedCostMc).toBe(5000);
  });

  it('an empty ledger is an empty column', () => {
    expect(summarizeGateRuns([])).toEqual({ runs: 0, answer: { runs: 0, judged: 0, accepted: 0 }, prefetch: { runs: 0, judged: 0, accepted: 0 }, llm: { runs: 0 }, answeredBy: [], savedCostMc: 0 });
  });
});
