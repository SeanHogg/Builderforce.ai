import { describe, expect, it } from 'vitest';
import { parseStepMessage, stepSig, traceWithPersistedSteps } from './persistedSteps';
import { computeBrainDiagnostics, type BrainTraceEvent } from './brainTriage';
import type { BrainMessage } from './types';

let seq = 0;
function stepRow(over: Partial<{ category: string; label: string; ts: string; result: unknown; isError: boolean; resultBytes: number; truncated: boolean }> = {}): BrainMessage {
  seq += 1;
  return {
    id: seq,
    role: 'tool',
    content: '',
    seq,
    createdAt: over.ts ?? '2026-07-12T13:37:00.000Z',
    metadata: JSON.stringify({
      kind: 'step',
      category: over.category ?? 'tool',
      label: over.label ?? 'builtin_tasks_update',
      args: { id: 322 },
      result: over.result ?? { ok: true },
      isError: over.isError ?? false,
      ...(over.resultBytes != null ? { resultBytes: over.resultBytes } : {}),
      ...(over.truncated ? { truncated: true } : {}),
      ts: over.ts ?? '2026-07-12T13:37:00.000Z',
    }),
  };
}

function turn(role: 'user' | 'assistant', content: string): BrainMessage {
  seq += 1;
  return { id: seq, role, content, metadata: null, seq, createdAt: '2026-07-12T13:36:00.000Z' };
}

const llmEvent: BrainTraceEvent = {
  ts: '2026-07-12T13:36:30.000Z',
  category: 'llm',
  label: 'llm.complete',
  args: { model: 'xai-oauth/grok-4.3', step: 0, toolCalls: 2 },
  textChars: 120,
};

describe('parseStepMessage', () => {
  it('reads a well-formed step row', () => {
    const parsed = parseStepMessage(stepRow({ label: 'builtin_tasks_list' }).metadata);
    expect(parsed?.step.category).toBe('tool');
    expect(parsed?.step.label).toBe('builtin_tasks_list');
    expect(parsed?.tsIso).toBe('2026-07-12T13:37:00.000Z');
  });

  it('rejects non-step and malformed metadata', () => {
    expect(parseStepMessage(null)).toBeNull();
    expect(parseStepMessage('not json')).toBeNull();
    expect(parseStepMessage(JSON.stringify({ kind: 'provenance', model: 'x' }))).toBeNull();
  });
});

describe('traceWithPersistedSteps', () => {
  it('recovers steps the in-memory trace no longer holds', () => {
    const messages = [turn('user', 'Review the PR builds'), stepRow(), stepRow({ label: 'builtin_tasks_list' })];
    const merged = traceWithPersistedSteps(messages, []);

    expect(merged.map((e) => e.label)).toEqual(['builtin_tasks_update', 'builtin_tasks_list']);
    expect(merged.every((e) => e.category === 'tool')).toBe(true);
  });

  it('does not double-count a step present in BOTH the trace and the messages', () => {
    const ts = '2026-07-12T13:37:00.000Z';
    const live: BrainTraceEvent = { ts, category: 'tool', label: 'builtin_tasks_update', args: { id: 322 }, result: { ok: true } };
    const merged = traceWithPersistedSteps([stepRow({ ts })], [live]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toBe(live);
  });

  it('orders the merged events by timestamp', () => {
    const merged = traceWithPersistedSteps(
      [stepRow({ ts: '2026-07-12T13:37:00.000Z' }), stepRow({ label: 'builtin_tasks_get', ts: '2026-07-12T13:35:00.000Z' })],
      [llmEvent],
    );
    expect(merged.map((e) => e.label)).toEqual(['builtin_tasks_get', 'llm.complete', 'builtin_tasks_update']);
  });

  it('returns the trace untouched when there is nothing to recover', () => {
    const trace = [llmEvent];
    expect(traceWithPersistedSteps([turn('assistant', 'done')], trace)).toBe(trace);
  });

  it('preserves the error flag on a recovered failed step', () => {
    const [recovered] = traceWithPersistedSteps([stepRow({ isError: true, result: { ok: false, error: '401 Token revoked' } })], []);
    expect(recovered.isError).toBe(true);
  });
});

/** A persisted `llm` turn row, as `persistStep` now writes one. */
function llmRow(over: Partial<{ ts: string; prompt: number; completion: number; finishReason: string; textChars: number }> = {}): BrainMessage {
  seq += 1;
  const ts = over.ts ?? '2026-07-12T13:36:30.000Z';
  return {
    id: seq,
    role: 'tool',
    content: '',
    seq,
    createdAt: ts,
    metadata: JSON.stringify({
      kind: 'step',
      category: 'llm',
      label: 'llm.complete',
      args: { model: 'xai-oauth/grok-4.3', step: 0, toolCalls: 2 },
      result: '2 tool call(s)',
      usage: { prompt: over.prompt ?? 41_233, completion: over.completion ?? 620 },
      finishReason: over.finishReason ?? 'tool_calls',
      textChars: over.textChars ?? 120,
      ts,
    }),
  };
}

describe('computeBrainDiagnostics over a reopened chat', () => {
  it('counts the tool calls a reload left only in the messages', () => {
    const messages = [
      turn('user', 'Review all the tasks with a successful PR build'),
      stepRow({ label: 'builtin_repos_list_pull_requests' }),
      stepRow({ label: 'builtin_tasks_list' }),
      stepRow({ label: 'builtin_tasks_update' }),
    ];

    // What the block used to report: the bare trace, with the steps gone.
    expect(computeBrainDiagnostics([llmEvent]).toolCalls).toBe(0);
    // What it reports now.
    const merged = computeBrainDiagnostics(traceWithPersistedSteps(messages, [llmEvent]));
    expect(merged.toolCalls).toBe(3);
    expect(merged.toolResultBytes).toBeGreaterThan(0);
  });

  it('recovers turns and token usage from persisted llm rows', () => {
    const messages = [turn('user', 'go'), llmRow(), llmRow({ ts: '2026-07-12T13:38:00.000Z', prompt: 58_000, completion: 90 })];

    // Nothing in memory — the exact "copied after a reload" case.
    const d = computeBrainDiagnostics(traceWithPersistedSteps(messages, []));
    expect(d.turns).toBe(2);
    expect(d.tokensMeasured).toBe(true);
    expect(d.promptTokenPeak).toBe(58_000);
    expect(d.completionTokenTotal).toBe(710);
    expect(d.lastPromptTokens).toBe(58_000);
  });

  it('recovers the pre-trim payload size and truncation flag of a capped step', () => {
    const messages = [stepRow({ resultBytes: 48_000, truncated: true })];
    const d = computeBrainDiagnostics(traceWithPersistedSteps(messages, []));

    expect(d.toolResultBytes).toBe(48_000);
    expect(d.truncatedToolResults).toBe(1);
    expect(d.largestToolResult?.bytes).toBe(48_000);
    // With the real numbers restored the verdict can finally be reached.
    expect(d.likelyCause).toBe('context-exhaustion');
  });

  it('does not double-count an llm turn present live AND persisted', () => {
    const ts = '2026-07-12T13:36:30.000Z';
    const live: BrainTraceEvent = { ts, category: 'llm', label: 'llm.complete', usage: { prompt: 100 } };
    expect(computeBrainDiagnostics(traceWithPersistedSteps([llmRow({ ts })], [live])).turns).toBe(1);
  });
});

describe('stepSig', () => {
  it('keys on category, label and timestamp together', () => {
    expect(stepSig('tool', 'a', '2026-01-01')).toBe(stepSig('tool', 'a', '2026-01-01'));
    expect(stepSig('tool', 'a', '2026-01-01')).not.toBe(stepSig('tool', 'a', '2026-01-02'));
    expect(stepSig('tool', 'a', undefined)).not.toBe(stepSig('recall', 'a', undefined));
  });
});
