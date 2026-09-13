import { describe, it, expect } from 'vitest';
import { formatModelScorecard, modelScorecard } from './modelScorecard';
import type { BrainTraceEvent } from './brainTriage';

function turn(model: string, toolCalls: number, opts: { unliftedCallMarkup?: boolean } = {}): BrainTraceEvent {
  return {
    ts: new Date(0).toISOString(),
    category: 'llm',
    label: 'llm.complete',
    args: { model, toolCalls, ...(opts.unliftedCallMarkup ? { unliftedCallMarkup: true } : {}) },
    textChars: toolCalls ? 0 : 60,
  };
}

describe('modelScorecard', () => {
  it('scores each model on the turns it served, first-seen order', () => {
    const scores = modelScorecard([
      turn('direct/qwen/qwen3.8-max', 2),
      turn('xai-oauth/grok-4.5', 0),
      turn('direct/qwen/qwen3.8-max', 1),
    ]);
    expect(scores).toEqual([
      { model: 'direct/qwen/qwen3.8-max', turns: 2, toolCalls: 3, textOnlyTurns: 0, unliftedMarkupTurns: 0, failures: 0, stopped: 0 },
      { model: 'xai-oauth/grok-4.5', turns: 1, toolCalls: 0, textOnlyTurns: 1, unliftedMarkupTurns: 0, failures: 0, stopped: 0 },
    ]);
  });

  it('counts a failed completion against a named model and ignores the auto-select placeholder', () => {
    const scores = modelScorecard([
      { ts: '', category: 'error', label: 'llm.complete', args: { model: 'xai-oauth/grok-4.5' }, isError: true },
      { ts: '', category: 'error', label: 'llm.complete', args: { model: 'default' }, isError: true },
    ]);
    expect(scores).toEqual([
      { model: 'xai-oauth/grok-4.5', turns: 0, toolCalls: 0, textOnlyTurns: 0, unliftedMarkupTurns: 0, failures: 1, stopped: 0 },
    ]);
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

  it('stays silent for a single-model run with nothing to flag', () => {
    expect(formatModelScorecard(modelScorecard([turn('anthropic/claude-sonnet-5', 3)]))).toEqual([]);
  });
});
