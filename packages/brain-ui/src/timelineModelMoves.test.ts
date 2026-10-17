import { describe, expect, it } from 'vitest';
import type { BrainMessage, BrainTraceEvent } from '@seanhogg/builderforce-brain-embedded';
import { DEFAULT_MODEL_MOVE_LABELS, modelMoveLine, modelMoveOf } from './timelineModelMoves';
import { buildSettledTimeline } from './timelineModel';
import { timelineCatalogLookup, timelineLabelsFrom } from './timelineCatalog';

const packed = { step: 3, from: 'direct/anthropic/claude-opus', to: 'direct/cloudflare/llama', dropped: 7, summarized: true, recalled: false, estimatedTokens: 3_100, fits: true };

describe('model moves in the transcript', () => {
  it('reads a window fit and a local fallback from their structured args', () => {
    expect(modelMoveOf('llm.handoff', packed)).toEqual({ kind: 'packed', from: packed.from, to: packed.to, dropped: 7, how: 'summarized', tokens: 3_100, fits: true });
    expect(modelMoveOf('llm.handoff', { to: 'local/webllm/x', dropped: 0, estimatedTokens: 900 })).toEqual({ kind: 'verbatim', to: 'local/webllm/x', tokens: 900 });
    expect(modelMoveOf('llm.local_fallback', { step: 1, from: 'local/ollama/qwen', to: 'gateway' })).toEqual({ kind: 'localFallback', from: 'local/ollama/qwen', to: 'gateway' });
    expect(modelMoveOf('llm.role_handoff', packed)).toBeNull();
    expect(modelMoveOf('llm.handoff', null)).toBeNull();
  });

  it('composes the line from the catalog, not from the English diagnostics sentence', () => {
    const labels = timelineLabelsFrom(timelineCatalogLookup({
      modelMovePacked: 'Unterhaltung an {models} angepasst — {dropped} frühere Nachrichten {how}, ~{tokens} Tokens',
      modelMoveHowSummarized: 'zusammengefasst',
      modelMoveOverWindow: 'Weiterhin zu groß.',
    }));
    const move = modelMoveOf('llm.handoff', { ...packed, fits: false })!;
    expect(modelMoveLine(move, labels)).toBe('Unterhaltung an direct/anthropic/claude-opus → direct/cloudflare/llama angepasst — 7 frühere Nachrichten zusammengefasst, ~3100 Tokens. Weiterhin zu groß.');
    expect(modelMoveLine(modelMoveOf('llm.local_fallback', { from: 'local/a/b', to: 'gateway' })!, DEFAULT_MODEL_MOVE_LABELS)).toContain('local/a/b');
  });

  it('renders a live move once, and a reloaded one from its persisted step', () => {
    const ev: BrainTraceEvent = { ts: '2026-10-17T10:00:00.000Z', category: 'message', label: 'llm.handoff', args: packed, result: 'Packed the transcript…' };
    const narration: BrainTraceEvent = { ts: '2026-10-17T10:00:01.000Z', category: 'message', label: 'agent.message', result: 'hello' };
    const persisted: BrainMessage = {
      id: 9, seq: 1, role: 'tool', content: '', createdAt: ev.ts,
      metadata: JSON.stringify({ kind: 'step', category: 'message', label: 'llm.handoff', args: packed, result: 'Packed…', isError: false, ts: ev.ts }),
    };
    const live = buildSettledTimeline([persisted], [ev, narration]).filter((n) => n.kind === 'modelMove');
    expect(live).toHaveLength(1);
    const reloaded = buildSettledTimeline([persisted], []).filter((n) => n.kind === 'modelMove');
    expect(reloaded).toHaveLength(1);
  });
});
