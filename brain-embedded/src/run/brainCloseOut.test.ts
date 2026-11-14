import { describe, expect, it } from 'vitest';
import type { BrainTraceEvent } from '../brainTriage';
import type { BackstopRun } from '../runStore/runBackstops';
import type { BrainRunContext } from '../runStore/brainRunContext';
import { createEvidenceLedger, type ReviewVerdict } from '@builderforce/run-guards';
import { deterministicFinish } from '../runStore/deterministicFinish';
import { REVIEW_RECORD_TOOL, reviewedThisRun, verificationOf, type CloseOutInput } from './brainCloseOut';

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

/** An evidence ledger holding `checks` against `path` (as the host verifier records them). */
function evidence(path: string, outcomes: Array<'pass' | 'fail' | 'unavailable'>) {
  const ledger = createEvidenceLedger();
  outcomes.forEach((outcome, i) => ledger.record(path, 'h1', { kind: 'test', name: `check-${i}`, outcome, exitCode: outcome === 'pass' ? 0 : 1, findings: [], at: 1 }));
  return ledger;
}

/** The run context the finish reads the chat id from (the ticket list it closes against). */
const run = { c: { runUsage: {}, trace: [], authorModels: new Set<string>(), shipReviews: [] }, req: {}, serverChatId: 7, recalled: null } as unknown as BrainRunContext;

type FinishInput = CloseOutInput & { verified: boolean; hasTicket: boolean };

/**
 * The close-out input as `startRun`'s settle builds it: `verified` is the run's evidence read by
 * `verificationOf`, `hasTicket` is the ticket the run minted (overridable for a device-filed ticket).
 */
function input(tools: ReturnType<typeof fakeTools>, over: Partial<FinishInput> = {}): FinishInput {
  const base: CloseOutInput = {
    serverChatId: 7, view: view(), req: { runTool: tools.runTool, projectId: 3 }, needsTicket: true, shipped: true,
    reviewedInPreview: [], openPlaceholders: 0, trace: [], evidence: evidence('/repo/src/a.ts', ['pass']), ...over,
  };
  return {
    ...base,
    verified: verificationOf(base.evidence, base.view.touchedFiles).verified,
    hasTicket: base.view.deltaTicketId != null,
    ...over,
  };
}

const reviewed = (tools: ReturnType<typeof fakeTools>) => tools.calls.some((c) => c.name === REVIEW_RECORD_TOOL);
const movedToDone = (tools: ReturnType<typeof fakeTools>) => tools.calls.some((c) => c.name === 'builtin_tasks_update' && c.args.status === 'done');

/** An approved independent review of `diffHash` (what the push gate remembers on `run.c.shipReviews`). */
const APPROVED_REVIEW = (diffHash: string): ReviewVerdict => ({ reviewerModel: 'reviewer-model', verdict: 'approved', diffHash, findings: [] });

describe('the host close-out of a shipped run (zero model turns)', () => {
  it('records the review on the ticket THIS run created, then moves the linked in_review ticket to done', async () => {
    // Regression (chat #230): the review is recorded ONLY when an approved independent review of
    // the shipped diff is in hand; the move to done follows either way.
    const tools = fakeTools();
    await deterministicFinish(input(tools, { reviewedDiffHash: 'diff-1' }), { ...run, c: { ...run.c, shipReviews: [APPROVED_REVIEW('diff-1')] } });
    const names = tools.calls.map((c) => c.name);
    const review = tools.calls.find((c) => c.name === REVIEW_RECORD_TOOL);
    expect(review?.args).toMatchObject({ taskId: 41, verdict: 'complete' });
    expect(String(review?.args.summary)).toContain('src/a.ts');
    expect(String(review?.args.summary)).toContain('reviewer-model approved');
    // The review comes before the move to done.
    expect(names.indexOf(REVIEW_RECORD_TOOL)).toBeLessThan(names.lastIndexOf('builtin_tasks_update'));
    expect(tools.calls).toContainEqual({ name: 'builtin_tasks_update', args: { id: 41, status: 'done' } });
  });

  it('records NO review when the host holds no approved review of the shipped diff, but still moves to done (chat #230)', async () => {
    // The re-record used to be refused by the review gate (no NEW independent review), deadlocking
    // the finish and leaving the ticket at in_review forever. Now it records nothing instead.
    const tools = fakeTools();
    const res = await deterministicFinish(input(tools), run); // no reviewedDiffHash, no shipReviews
    expect(res).toMatchObject({ finished: true, reviewRecorded: false, ticketClosed: true });
    expect(reviewed(tools)).toBe(false);
    expect(movedToDone(tools)).toBe(true);
  });

  it('records NO review when the only remembered review approved a DIFFERENT diff', async () => {
    const tools = fakeTools();
    const res = await deterministicFinish(input(tools, { reviewedDiffHash: 'diff-2' }), { ...run, c: { ...run.c, shipReviews: [APPROVED_REVIEW('diff-1')] } });
    expect(res.reviewRecorded).toBe(false);
    expect(reviewed(tools)).toBe(false);
    expect(movedToDone(tools)).toBe(true);
  });

  it('never records a second review when the run recorded its own', async () => {
    const tools = fakeTools();
    const own: BrainTraceEvent = { ts: '', category: 'tool', label: REVIEW_RECORD_TOOL, args: { taskId: 41, verdict: 'complete' }, result: { ok: true } };
    await deterministicFinish(input(tools, { trace: [own] }), run);
    expect(tools.calls.filter((c) => c.name === REVIEW_RECORD_TOOL)).toHaveLength(0);
    expect(tools.calls).toContainEqual({ name: 'builtin_tasks_update', args: { id: 41, status: 'done' } });
  });

  it('holds the close-out when placeholders are outstanding: no review, never done', async () => {
    const tools = fakeTools();
    const v = view();
    const res = await deterministicFinish(input(tools, { view: v, openPlaceholders: 2 }), run);
    expect(res.finished).toBe(false);
    expect(reviewed(tools)).toBe(false);
    expect(movedToDone(tools)).toBe(false);
    expect(v.notes.some((n) => n.label === 'run.close_out_held')).toBe(true);
  });

  it('does nothing toward done when the run did not ship', async () => {
    const tools = fakeTools();
    await deterministicFinish(input(tools, { shipped: false }), run);
    expect(reviewed(tools)).toBe(false);
    expect(tools.calls.some((c) => c.args.status === 'done')).toBe(false);
  });

  it('records no review when the run created no ticket of its own', async () => {
    // It still holds a ticket (one filed on the device), so the finish runs — but the review is
    // only ever recorded on a ticket THIS run minted.
    const tools = fakeTools();
    const res = await deterministicFinish(input(tools, { view: view({ deltaTicketId: null }), hasTicket: true }), run);
    expect(res.finished).toBe(true);
    expect(reviewed(tools)).toBe(false);
  });

  it('regression: chat #60338 close-out never records a "complete" review nobody performed — shipped with no verification stays in review', async () => {
    const tools = fakeTools();
    const v = view();
    const finish = input(tools, { view: v, evidence: undefined });
    expect(finish.verified).toBe(false);
    const res = await deterministicFinish(finish, run);
    expect(res.finished).toBe(false);
    expect(reviewed(tools)).toBe(false);
    expect(tools.calls.some((c) => c.args.status === 'done')).toBe(false);
    const held = v.notes.find((n) => n.label === 'run.close_out_held');
    expect(held?.args).toMatchObject({ reason: 'unverified' });
  });

  it('holds on a failing check, and on a changed file no passing check covers', async () => {
    for (const ev of [evidence('/repo/src/a.ts', ['pass', 'fail']), evidence('/repo/src/other.ts', ['pass']), evidence('/repo/src/a.ts', ['unavailable'])]) {
      const tools = fakeTools();
      const v = view();
      const finish = input(tools, { view: v, evidence: ev });
      expect(finish.verified).toBe(false);
      const res = await deterministicFinish(finish, run);
      expect(res.finished).toBe(false);
      expect(tools.calls.some((c) => c.name === REVIEW_RECORD_TOOL || c.args.status === 'done')).toBe(false);
      expect(v.notes.some((n) => n.label === 'run.close_out_held')).toBe(true);
    }
  });

  it('a verified close-out names the passing checks and the approving reviewer in the review', async () => {
    const tools = fakeTools();
    await deterministicFinish(input(tools, { reviewedDiffHash: 'diff-1' }), { ...run, c: { ...run.c, shipReviews: [APPROVED_REVIEW('diff-1')] } });
    expect(String(tools.calls.find((c) => c.name === REVIEW_RECORD_TOOL)?.args.summary)).toContain('/repo/src/a.ts test "check-0"');
    expect(verificationOf(undefined, ['src/a.ts'])).toMatchObject({ verified: false });
  });

  it('regression: an unshipped run still advances its tickets to in_progress at settle (chat #70776)', async () => {
    const LOCAL = '0b1c2d3e-0000-4000-8000-000000000001';
    const filedLocally: BrainTraceEvent = { ts: '', category: 'tool', label: 'ticket-create', args: { title: 'A', auto: true, reason: 'hand_off' }, result: { id: LOCAL } };
    // The chat links a server ticket still in the backlog.
    const tools = fakeTools([{ kind: 'task', ref: 41, status: 'backlog' }]);
    const res = await deterministicFinish(input(tools, { shipped: false, trace: [filedLocally] }), run);
    expect(res.finished).toBe(false);
    // The server linked ticket advances through builtin_tasks_update…
    expect(tools.calls).toContainEqual({ name: 'builtin_tasks_update', args: { id: 41, status: 'in_progress' } });
    // …and the device-filed one through ticket-move.
    expect(tools.calls.some((c) => c.name === 'ticket-move' && c.args.id === LOCAL && c.args.status === 'in_progress')).toBe(true);
    expect(movedToDone(tools)).toBe(false);
    expect(tools.calls.some((c) => c.name === 'ticket-move' && c.args.status === 'done')).toBe(false);
  });

  it('an unshipped run still attaches its later-touched files to its delta ticket', async () => {
    const tools = fakeTools();
    const v = view({ touchedFiles: ['src/a.ts', 'src/b.ts'], deltaRecordedFiles: ['src/a.ts'] });
    await deterministicFinish(input(tools, { view: v, shipped: false }), run);
    const attach = tools.calls.find((c) => c.name === 'builtin_tickets_from_delta');
    expect(attach?.args).toMatchObject({ files: ['src/b.ts'] });
    expect(reviewed(tools)).toBe(false);
  });

  it('nothing moves to done when the gate fails, whichever condition fails it', async () => {
    const LOCAL = '0b1c2d3e-0000-4000-8000-000000000002';
    const filedLocally: BrainTraceEvent = { ts: '', category: 'tool', label: 'ticket-create', args: { title: 'A', auto: true, reason: 'hand_off' }, result: { id: LOCAL } };
    const fails: Array<Partial<FinishInput>> = [{ shipped: false }, { verified: false }, { openPlaceholders: 1 }, { hasTicket: false }];
    for (const over of fails) {
      const tools = fakeTools();
      const res = await deterministicFinish(input(tools, { trace: [filedLocally], ...over }), run);
      expect(res).toMatchObject({ finished: false, reviewRecorded: false, ticketClosed: false });
      expect(tools.calls.some((c) => c.args.status === 'done')).toBe(false);
      expect(reviewed(tools)).toBe(false);
    }
  });

  it('reads only SUCCESSFUL reviews as recorded', () => {
    const failed: BrainTraceEvent = { ts: '', category: 'tool', label: REVIEW_RECORD_TOOL, args: { taskId: 9 }, result: { ok: false, error: 'x' }, isError: true };
    const ok: BrainTraceEvent = { ts: '', category: 'tool', label: REVIEW_RECORD_TOOL, args: { taskId: 5 }, result: { ok: true } };
    expect([...reviewedThisRun([failed, ok])]).toEqual([5]);
  });
});
