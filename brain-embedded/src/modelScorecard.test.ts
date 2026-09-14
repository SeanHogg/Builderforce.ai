import { describe, it, expect } from 'vitest';
import { formatModelScorecard, formatModelTurnLog, modelScorecard, modelTurnLog } from './modelScorecard';
import type { BrainTraceEvent } from './brainTriage';

function turn(
  model: string,
  toolCalls: number,
  opts: {
    unliftedCallMarkup?: boolean;
    upstream?: { calls: number; recovered?: number };
    requestedModel?: string;
    durationMs?: number;
  } = {},
): BrainTraceEvent {
  return {
    ts: new Date(0).toISOString(),
    category: 'llm',
    label: 'llm.complete',
    args: {
      model,
      toolCalls,
      ...(opts.requestedModel ? { requestedModel: opts.requestedModel } : {}),
      ...(opts.unliftedCallMarkup ? { unliftedCallMarkup: true } : {}),
      ...(opts.upstream ? { upstreamFunctionCalls: opts.upstream.calls, upstreamRecovered: opts.upstream.recovered ?? 0 } : {}),
    },
    textChars: toolCalls ? 0 : 60,
    ...(opts.durationMs != null ? { durationMs: opts.durationMs } : {}),
  };
}

/** The raw-response fields of a score for a vendor that reported nothing. */
const NO_UPSTREAM = { upstreamReportedTurns: 0, upstreamFunctionCalls: 0, upstreamRecovered: 0, adapterLossTurns: 0 };

describe('modelScorecard', () => {
  it('scores each model on the turns it served, first-seen order', () => {
    const scores = modelScorecard([
      turn('direct/qwen/qwen3.8-max', 2),
      turn('xai-oauth/grok-4.5', 0),
      turn('direct/qwen/qwen3.8-max', 1),
    ]);
    expect(scores).toEqual([
      { model: 'direct/qwen/qwen3.8-max', turns: 2, toolCalls: 3, textOnlyTurns: 0, unliftedMarkupTurns: 0, failures: 0, stopped: 0, ...NO_UPSTREAM },
      { model: 'xai-oauth/grok-4.5', turns: 1, toolCalls: 0, textOnlyTurns: 1, unliftedMarkupTurns: 0, failures: 0, stopped: 0, ...NO_UPSTREAM },
    ]);
  });

  it('counts a failed completion against a named model and ignores the auto-select placeholder', () => {
    const scores = modelScorecard([
      { ts: '', category: 'error', label: 'llm.complete', args: { model: 'xai-oauth/grok-4.5' }, isError: true },
      { ts: '', category: 'error', label: 'llm.complete', args: { model: 'default' }, isError: true },
    ]);
    expect(scores).toEqual([
      { model: 'xai-oauth/grok-4.5', turns: 0, toolCalls: 0, textOnlyTurns: 0, unliftedMarkupTurns: 0, failures: 1, stopped: 0, ...NO_UPSTREAM },
    ]);
  });

  it('adds up what the vendor\'s raw responses carried, and counts a turn that lost a returned call', () => {
    const [score] = modelScorecard([
      turn('xai-oauth/grok-4.6', 1, { upstream: { calls: 1, recovered: 1 } }),
      turn('xai-oauth/grok-4.6', 0, { upstream: { calls: 2 } }),
      turn('xai-oauth/grok-4.6', 0),
    ]);
    expect(score).toMatchObject({ turns: 3, upstreamReportedTurns: 2, upstreamFunctionCalls: 3, upstreamRecovered: 1, adapterLossTurns: 1 });
  });

  it('counts a user Stop against the model that was streaming, even one that never completed a turn', () => {
    const scores = modelScorecard([
      turn('direct/qwen/qwen3.8-max', 2),
      { ts: '', category: 'message', label: 'agent.stopped', args: { model: 'direct/minimax/MiniMax-M2.7' }, textChars: 1400 },
      { ts: '', category: 'message', label: 'agent.stopped' },
    ]);
    expect(scores.find((s) => s.model === 'direct/minimax/MiniMax-M2.7')).toMatchObject({ turns: 0, stopped: 1 });
    expect(scores).toHaveLength(2);
  });
});

describe('formatModelScorecard', () => {
  /** The reported run: Qwen did every tool call, Grok answered turns and called nothing,
   *  and the report could only say "Models used: qwen, grok". */
  it('flags the model that never called a tool while another one did', () => {
    const lines = formatModelScorecard(modelScorecard([
      ...Array.from({ length: 4 }, () => turn('direct/qwen/qwen3.8-max', 2)),
      ...Array.from({ length: 5 }, () => turn('xai-oauth/grok-4.5', 0)),
    ]));
    expect(lines[0]).toBe('Per model:');
    expect(lines[1]).toContain('direct/qwen/qwen3.8-max: 4 turn(s) · 8 tool call(s)');
    expect(lines[1]).not.toContain('⚠');
    expect(lines[2]).toContain('xai-oauth/grok-4.5: 5 turn(s) · 0 tool call(s) · 5 text-only');
    expect(lines[2]).toContain('made NO tool calls while another model in this run did');
  });

  it('names a parser gap, not a refusal, when call markup went unlifted', () => {
    const lines = formatModelScorecard(modelScorecard([turn('xai-oauth/grok-4.5', 0, { unliftedCallMarkup: true })]));
    expect(lines.join('\n')).toContain('1 turn(s) wrote a tool call as MARKUP that no parser lifted');
  });

  it('names the model a user Stop cut off, even in a single-model run', () => {
    const lines = formatModelScorecard(modelScorecard([
      turn('xai-oauth/grok-4.6', 0),
      { ts: '', category: 'message', label: 'agent.stopped', args: { model: 'xai-oauth/grok-4.6' } },
    ]));
    expect(lines.join('\n')).toContain('xai-oauth/grok-4.6: 1 turn(s) · 0 tool call(s) · 1 text-only · 1 stopped by the user mid-stream');
  });

  it('says the MODEL did not call when its raw responses carried no structured call (chat #104)', () => {
    const lines = formatModelScorecard(modelScorecard([
      ...Array.from({ length: 4 }, () => turn('direct/qwen/qwen3.8-max', 2)),
      ...Array.from({ length: 3 }, () => turn('xai-oauth/grok-4.6', 0, { upstream: { calls: 0 } })),
    ]));
    const grok = lines.find((l) => l.includes('grok-4.6'))!;
    expect(grok).toContain('raw response: 0 structured call(s) over 3 reported turn(s)');
    expect(grok).toContain('so the MODEL did not call — nothing was lost on the way');
  });

  it('names an adapter loss when the vendor returned a call that never reached the loop, even single-model', () => {
    const lines = formatModelScorecard(modelScorecard([turn('xai-oauth/grok-4.6', 0, { upstream: { calls: 1 } })]));
    expect(lines.join('\n')).toContain('the calls were lost in translation, so this is an adapter defect, not the model');
  });

  it('keeps the unproven wording when the route did not report its raw response', () => {
    const lines = formatModelScorecard(modelScorecard([
      ...Array.from({ length: 2 }, () => turn('direct/qwen/qwen3.8-max', 2)),
      ...Array.from({ length: 3 }, () => turn('nvidia/some-model', 0)),
    ]));
    expect(lines.join('\n')).toContain('this model is not emitting structured calls on its route');
  });

  it('stays silent for a single-model run with nothing to flag', () => {
    expect(formatModelScorecard(modelScorecard([turn('anthropic/claude-sonnet-5', 3)]))).toEqual([]);
  });
});

describe('modelTurnLog / formatModelTurnLog', () => {
  it('lists each llm.complete in order with model, toolCalls, text-only, upstream, duration', () => {
    const turns = modelTurnLog([
      turn('xai-oauth/grok-4.6', 0, { upstream: { calls: 0 }, durationMs: 1200 }),
      turn('direct/qwen/qwen3.8-max', 2, { durationMs: 800 }),
      turn('xai-oauth/grok-4.6', 0, { requestedModel: 'anthropic/claude-opus-5', upstream: { calls: 0 } }),
    ]);
    expect(turns).toEqual([
      { index: 1, model: 'xai-oauth/grok-4.6', toolCalls: 0, textOnly: true, upstreamFunctionCalls: 0, upstreamRecovered: 0, durationMs: 1200 },
      { index: 2, model: 'direct/qwen/qwen3.8-max', toolCalls: 2, textOnly: false, durationMs: 800 },
      { index: 3, model: 'xai-oauth/grok-4.6', requestedModel: 'anthropic/claude-opus-5', toolCalls: 0, textOnly: true, upstreamFunctionCalls: 0, upstreamRecovered: 0 },
    ]);
    const lines = formatModelTurnLog(turns);
    expect(lines[0]).toBe('Turn log:');
    expect(lines[1]).toBe('  1. xai-oauth/grok-4.6 · 0 tool call(s) · text-only · raw response: 0 structured call(s) · 1200ms');
    expect(lines[2]).toBe('  2. direct/qwen/qwen3.8-max · 2 tool call(s) · 800ms');
    expect(lines[3]).toBe('  3. xai-oauth/grok-4.6 (requested anthropic/claude-opus-5) · 0 tool call(s) · text-only · raw response: 0 structured call(s)');
  });

  it('includes a failed completion and stays empty when nothing ran', () => {
    expect(formatModelTurnLog([])).toEqual([]);
    const lines = formatModelTurnLog(modelTurnLog([
      { ts: '', category: 'error', label: 'llm.complete', args: { model: 'xai-oauth/grok-4.6' }, isError: true },
    ]));
    expect(lines[1]).toContain('FAILED');
    expect(lines[1]).toContain('xai-oauth/grok-4.6');
  });
});
