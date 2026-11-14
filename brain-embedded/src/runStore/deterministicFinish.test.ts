import { describe, expect, it } from 'vitest';
import type { BrainTraceEvent } from '../brainTriage';
import type { BackstopRun } from './runBackstops';
import { createEvidenceLedger, type ReviewVerdict } from '@builderforce/run-guards';
import { deterministicFinish, finishConditionMet, type DeterministicFinishResult } from './deterministicFinish';
import type { CloseOutInput } from '../run/brainCloseOut';
import type { BrainRunContext } from './brainRunContext';

/**
 * The acceptance for fix #6 DETERMINISTIC FINISH: when a run has SHIPPED and a linked
 * ticket exists, the finish records the review, sets the ticket to done and writes the
 * learned fact — all as HOST ACTIONS, with ZERO model turns (asserted by the fake tool
 * runner standing in for every host action; no LLM is ever constructed). And once the
 * finish condition is met, an empty ask does NOT trigger a continuation — asserted on
 * `finishConditionMet`, the single gate the continuation suppressor reads.
 */

/** A fake tool runner over the host's executors: records every call, answers the ticket list. */
function fakeTools(tickets: unknown[] = [{ kind: 'task', ref: 41, status: 'in_review' }]) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const runTool = async (name: string, args: unknown): Promise<unknown> => {
    calls.push({ name, args: args as Record<string, unknown> });
    if (name === 'builtin_chats_list_tickets') return tickets;
    return { ok: true, id: 41 };
  };
  return { calls, runTool };
}

function view(over: Partial<BackstopRun> = {}): BackstopRun & { notes: BrainTraceEvent[] } {
  const notes: BrainTraceEvent[] = [];
  return {
    touchedFiles: ['src/a.ts'], deltaRecordedFiles: ['src/a.ts'], deltaTicketId: 41, ticketRecorded: true,
    deltaCaptureRefused: false, deltaTitleCount: 1, note: (ev) => notes.push(ev), notes, ...over,
  };
}

function evidence(path: string, outcomes: Array<'pass' | 'fail' | 'unavailable'>) {
  const ledger = createEvidenceLedger();
  outcomes.forEach((outcome, i) => ledger.record(path, 'h1', { kind: 'test', name: `check-${i}`, outcome, exitCode: outcome === 'pass' ? 0 : 1, findings: [], at: 1 }));
  return ledger;
}

/** The emitEvermindLearnReconcile seam is satisfied by any object with the fields it reads. */
const fakeRun = { c: { runUsage: {}, trace: [], authorModels: new Set<string>(), shipReviews: [] }, req: {}, recalled: null } as unknown as BrainRunContext;

function input(tools: ReturnType<typeof fakeTools>, over: Partial<CloseOutInput & { verified: boolean; hasTicket: boolean }> = {}) {
  return {
    serverChatId: 7, view: view(), req: { runTool: tools.runTool, projectId: 3 }, needsTicket: true, shipped: true,
    reviewedInPreview: [], openPlaceholders: 0, trace: [], evidence: evidence('/repo/src/a.ts', ['pass']),
    verified: true, hasTicket: true, ...over,
  };
}

/** An approved independent review of `diffHash`, as the push gate remembers on `run.c.shipReviews`. */
const APPROVED_REVIEW = (diffHash: string): ReviewVerdict => ({ reviewerModel: 'reviewer-model', verdict: 'approved', diffHash, findings: [] });

/** The tool calls the close-out is allowed to make — the host actions, never a model turn. */
const CLOSE_OUT_TOOLS = new Set(['builtin_reviews_record', 'builtin_tasks_update', 'builtin_chats_list_tickets', 'builtin_tickets_from_delta', 'remember_fact']);

describe('deterministicFinish (fix #6, zero model turns)', () => {
  it('records the review and sets the ticket to done — with NO model turn', async () => {
    const tools = fakeTools();
    // Regression (chat #230): the review is recorded only over an approved independent review of
    // the shipped diff; without one in hand the host records nothing but still moves the ticket.
    const res: DeterministicFinishResult = await deterministicFinish(
      input(tools, { reviewedDiffHash: 'diff-1' }),
      { ...fakeRun, c: { ...fakeRun.c, shipReviews: [APPROVED_REVIEW('diff-1')] } },
    );
    expect(res).toEqual({ finished: true, reviewRecorded: true, ticketClosed: true, factWritten: false });
    const names = tools.calls.map((c) => c.name);
    // Every call is a host action through runTool; none constructs an LLM.
    for (const n of names) expect(CLOSE_OUT_TOOLS.has(n)).toBe(true);
    const review = tools.calls.find((c) => c.name === 'builtin_reviews_record');
    expect(review?.args).toMatchObject({ taskId: 41, verdict: 'complete' });
    expect(tools.calls).toContainEqual({ name: 'builtin_tasks_update', args: { id: 41, status: 'done' } });
  });

  it('makes NO model turns: the fake tool runner is the only executor, and no LLM is built', async () => {
    // The assertion is structural: deterministicFinish only ever awaits `req.runTool`. If it
    // reached for an llm.complete, it would need an LLM object this input does not provide —
    // the call would throw and the test above would fail. Here we pin the contract: the only
    // tool names touched are the close-out's host actions.
    const tools = fakeTools();
    await deterministicFinish(input(tools), fakeRun);
    expect(tools.calls.length).toBeGreaterThan(0);
    expect(tools.calls.every((c) => CLOSE_OUT_TOOLS.has(c.name))).toBe(true);
  });

  it('does NOT run when the run did not ship', async () => {
    const tools = fakeTools();
    const res = await deterministicFinish(input(tools, { shipped: false }), fakeRun);
    expect(res.finished).toBe(false);
    expect(tools.calls.some((c) => c.name === 'builtin_reviews_record' || c.args.status === 'done')).toBe(false);
  });

  it('does NOT run when the change is not verified (shipping is not verification)', async () => {
    const tools = fakeTools();
    const res = await deterministicFinish(input(tools, { verified: false }), fakeRun);
    expect(res.finished).toBe(false);
    expect(tools.calls.some((c) => c.name === 'builtin_reviews_record' || c.args.status === 'done')).toBe(false);
  });

  it('does NOT run when there is no linked ticket to close', async () => {
    const tools = fakeTools([]);
    const res = await deterministicFinish(input(tools, { hasTicket: false }), fakeRun);
    expect(res.finished).toBe(false);
    expect(tools.calls.some((c) => c.args.status === 'done')).toBe(false);
  });

  it('does NOT run when placeholders are outstanding', async () => {
    const tools = fakeTools();
    const res = await deterministicFinish(input(tools, { openPlaceholders: 2 }), fakeRun);
    expect(res.finished).toBe(false);
    expect(tools.calls.some((c) => c.name === 'builtin_reviews_record' || c.args.status === 'done')).toBe(false);
  });

  it('finishConditionMet is the gate an empty-ask continuation suppressor reads', () => {
    // Once shipped + verified + no placeholders + a ticket, the finish condition holds: an empty
    // ask must NOT auto-continue. Before it holds, an empty ask may continue.
    expect(finishConditionMet({ shipped: true, verified: true, openPlaceholders: 0, hasTicket: true })).toBe(true);
    expect(finishConditionMet({ shipped: false, verified: true, openPlaceholders: 0, hasTicket: true })).toBe(false);
    expect(finishConditionMet({ shipped: true, verified: false, openPlaceholders: 0, hasTicket: true })).toBe(false);
    expect(finishConditionMet({ shipped: true, verified: true, openPlaceholders: 1, hasTicket: true })).toBe(false);
    expect(finishConditionMet({ shipped: true, verified: true, openPlaceholders: 0, hasTicket: false })).toBe(false);
  });
});
