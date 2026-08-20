/**
 * The pause half of cloud pause/resume.
 *
 * Two things are worth pinning down here, because both were guesses before:
 *
 *   • WHERE a paused ticket goes. `boards.needs_attention_lane` is a POINTER that
 *     nothing consumed and that the default board seed does not create a lane for,
 *     so honouring it blindly writes a ticket status no column can render. The
 *     resolver must prove the lane exists and otherwise fall back to `blocked`.
 *   • WHAT a redispatch surface is allowed to hand back. The container image is a
 *     separately deployed artifact, so its payload is untrusted in shape; an old
 *     image that sends nothing must degrade to "no resume state", never crash the op.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const findCanonicalBoard = vi.fn();
vi.mock('../swimlane/canonicalBoard', () => ({
  findCanonicalBoard: (...args: unknown[]) => findCanonicalBoard(...args),
}));

import {
  coercePausedLoopState, resolveNeedsAttentionLane, withPausedToolResults,
  DEFAULT_RESUME_ANSWER, PAUSED_TOOL_RESULT_NOTE,
} from './executionPause';
import type { Db } from '../../infrastructure/database/connection';

/** Minimal Drizzle-shaped select whose terminal `limit()` yields `rows`. */
function dbReturning(rows: unknown[]): Db {
  return {
    select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }) }),
  } as unknown as Db;
}

describe('resolveNeedsAttentionLane', () => {
  beforeEach(() => { findCanonicalBoard.mockReset(); });

  it('honours the board pointer when a swimlane with that key really exists', async () => {
    findCanonicalBoard.mockResolvedValue({ id: 'board-1', needsAttentionLane: 'needs-attention' });
    const lane = await resolveNeedsAttentionLane(dbReturning([{ key: 'needs-attention' }]), { tenantId: 7, projectId: 3 });
    expect(lane).toBe('needs-attention');
  });

  it('falls back to `blocked` when the configured lane does not exist as a swimlane', async () => {
    // The default seed (backlog/todo/ready/in_progress/in_review/blocked/done) has no
    // `needs-attention` lane, so this is the COMMON case, not an edge one.
    findCanonicalBoard.mockResolvedValue({ id: 'board-1', needsAttentionLane: 'needs-attention' });
    const lane = await resolveNeedsAttentionLane(dbReturning([]), { tenantId: 7, projectId: 3 });
    expect(lane).toBe('blocked');
  });

  it('falls back to `blocked` when the board carries no pointer at all', async () => {
    findCanonicalBoard.mockResolvedValue({ id: 'board-1', needsAttentionLane: '   ' });
    const lane = await resolveNeedsAttentionLane(dbReturning([]), { tenantId: 7, projectId: 3 });
    expect(lane).toBe('blocked');
  });

  it('routes nowhere when the project has no board (nothing to route into)', async () => {
    findCanonicalBoard.mockResolvedValue(null);
    const lane = await resolveNeedsAttentionLane(dbReturning([]), { tenantId: 7, projectId: 3 });
    expect(lane).toBeNull();
  });

  it('scopes the lane lookup to the tenant AND the board it resolved', async () => {
    findCanonicalBoard.mockResolvedValue({ id: 'board-1', needsAttentionLane: 'triage' });
    let seenWhere: unknown = null;
    const db = {
      select: () => ({ from: () => ({ where: (w: unknown) => { seenWhere = w; return { limit: () => Promise.resolve([{ key: 'triage' }]) }; } }) }),
    } as unknown as Db;
    await resolveNeedsAttentionLane(db, { tenantId: 7, projectId: 3 });
    expect(seenWhere).not.toBeNull();
    expect(findCanonicalBoard).toHaveBeenCalledWith(db, 3, 7);
  });
});

describe('coercePausedLoopState', () => {
  it('carries the conversation, the written paths and the spent step budget', () => {
    const state = coercePausedLoopState({
      messages: [{ role: 'user', content: 'go' }],
      writtenPaths: ['a.ts', 42, 'b.ts'],
      step: 12,
    });
    expect(state).toEqual({ messages: [{ role: 'user', content: 'go' }], writtenPaths: ['a.ts', 'b.ts'], step: 12 });
  });

  it('degrades to null for an image that sends no conversation (older deploy)', () => {
    expect(coercePausedLoopState({})).toBeNull();
    expect(coercePausedLoopState({ messages: [] })).toBeNull();
    expect(coercePausedLoopState({ messages: 'nope' })).toBeNull();
  });

  it('defaults a missing/garbage step to 0 rather than NaN-ing the budget maths', () => {
    expect(coercePausedLoopState({ messages: [{ role: 'user' }] })?.step).toBe(0);
    expect(coercePausedLoopState({ messages: [{ role: 'user' }], step: Number.NaN })?.step).toBe(0);
  });
});

describe('DEFAULT_RESUME_ANSWER', () => {
  it('is a real instruction, not an empty string', () => {
    // Resuming without an answer still has to SAY something: a blank user turn makes
    // the resumed loop ask the same question again.
    expect(DEFAULT_RESUME_ANSWER.trim().length).toBeGreaterThan(20);
  });
});

describe('withPausedToolResults', () => {
  const assistantTurn = [
    { role: 'user', content: 'go' },
    { role: 'assistant', content: '', tool_calls: [{ id: 'c1' }, { id: 'c2' }] },
  ];

  it("answers the ask_human call itself — the image posts the op BEFORE pushing its result", () => {
    const out = withPausedToolResults(assistantTurn, { askToolCallId: 'c1', toolCallIds: ['c1'] });
    expect(out).toHaveLength(3);
    const last = out[2] as { role: string; tool_call_id: string; content: string };
    expect(last.role).toBe('tool');
    expect(last.tool_call_id).toBe('c1');
    expect(JSON.parse(last.content)).toEqual({ ok: true, paused: true, note: PAUSED_TOOL_RESULT_NOTE });
  });

  it('answers a SIBLING call that never ran, so no tool_call is left dangling', () => {
    // The loop stops at ask_human, so `c2` is never executed — but the vendor still
    // requires a result for it, and the resumed run is where that 400 would land.
    const out = withPausedToolResults(assistantTurn, { askToolCallId: 'c1', toolCallIds: ['c1', 'c2'] });
    const ids = out.filter((m) => m.role === 'tool').map((m) => m.tool_call_id);
    expect(ids).toEqual(['c1', 'c2']);
    const sibling = JSON.parse((out[3] as { content: string }).content) as { ok: boolean; error: string };
    expect(sibling.ok).toBe(false);
    expect(sibling.error).toMatch(/Not executed/);
  });

  it('leaves an already-answered call alone (a tool that ran BEFORE ask_human in the same turn)', () => {
    const withResult = [
      ...assistantTurn,
      { role: 'tool', tool_call_id: 'c1', content: '{"ok":true}' },
    ];
    const out = withPausedToolResults(withResult, { askToolCallId: 'c2', toolCallIds: ['c1', 'c2'] });
    expect(out.filter((m) => m.role === 'tool').map((m) => m.tool_call_id)).toEqual(['c1', 'c2']);
    expect((out[2] as { content: string }).content).toBe('{"ok":true}');
  });

  it('is a no-op for an image that sends no ids (older deploy) rather than inventing pairings', () => {
    expect(withPausedToolResults(assistantTurn, {})).toBe(assistantTurn);
  });
});
