import { describe, expect, it } from 'vitest';
import type { BrainTraceEvent } from '../brainTriage';
import type { BackstopRun } from '../runStore/runBackstops';
import { createEvidenceLedger } from '@builderforce/run-guards';
import { closeOutRun, REVIEW_RECORD_TOOL, reviewedThisRun, verificationOf, type CloseOutInput } from './brainCloseOut';

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

function input(tools: ReturnType<typeof fakeTools>, over: Partial<CloseOutInput> = {}): CloseOutInput {
  return {
    serverChatId: 7, view: view(), req: { runTool: tools.runTool, projectId: 3 }, needsTicket: true, shipped: true,
    reviewedInPreview: [], openPlaceholders: 0, trace: [], evidence: evidence('/repo/src/a.ts', ['pass']), ...over,
  };
}

describe('the host close-out of a shipped run (zero model turns)', () => {
  it('records the review on the ticket THIS run created, then moves the linked in_review ticket to done', async () => {
    const tools = fakeTools();
    await closeOutRun(input(tools));
    const names = tools.calls.map((c) => c.name);
    const review = tools.calls.find((c) => c.name === REVIEW_RECORD_TOOL);
    expect(review?.args).toMatchObject({ taskId: 41, verdict: 'complete' });
    expect(String(review?.args.summary)).toContain('src/a.ts');
    // The review comes before the move to done.
    expect(names.indexOf(REVIEW_RECORD_TOOL)).toBeLessThan(names.lastIndexOf('builtin_tasks_update'));
    expect(tools.calls).toContainEqual({ name: 'builtin_tasks_update', args: { id: 41, status: 'done' } });
  });

  it('never records a second review when the run recorded its own', async () => {
    const tools = fakeTools();
    const own: BrainTraceEvent = { ts: '', category: 'tool', label: REVIEW_RECORD_TOOL, args: { taskId: 41, verdict: 'complete' }, result: { ok: true } };
    await closeOutRun(input(tools, { trace: [own] }));
    expect(tools.calls.filter((c) => c.name === REVIEW_RECORD_TOOL)).toHaveLength(0);
    expect(tools.calls).toContainEqual({ name: 'builtin_tasks_update', args: { id: 41, status: 'done' } });
  });

  it('holds the close-out when placeholders are outstanding: no review, never done', async () => {
    const tools = fakeTools();
    const v = view();
    await closeOutRun(input(tools, { view: v, openPlaceholders: 2 }));
    expect(tools.calls.some((c) => c.name === REVIEW_RECORD_TOOL)).toBe(false);
    expect(tools.calls.some((c) => c.name === 'builtin_tasks_update' && c.args.status === 'done')).toBe(false);
    expect(v.notes.some((n) => n.label === 'run.close_out_held')).toBe(true);
  });

  it('does nothing toward done when the run did not ship', async () => {
    const tools = fakeTools();
    await closeOutRun(input(tools, { shipped: false }));
    expect(tools.calls.some((c) => c.name === REVIEW_RECORD_TOOL)).toBe(false);
    expect(tools.calls.some((c) => c.args.status === 'done')).toBe(false);
  });

  it('records no review when the run created no ticket of its own', async () => {
    const tools = fakeTools();
    await closeOutRun(input(tools, { view: view({ deltaTicketId: null }) }));
    expect(tools.calls.some((c) => c.name === REVIEW_RECORD_TOOL)).toBe(false);
  });

  it('regression: chat #60338 close-out never records a "complete" review nobody performed — shipped with no verification stays in review', async () => {
    const tools = fakeTools();
    const v = view();
    await closeOutRun(input(tools, { view: v, evidence: undefined }));
    expect(tools.calls.some((c) => c.name === REVIEW_RECORD_TOOL)).toBe(false);
    expect(tools.calls.some((c) => c.args.status === 'done')).toBe(false);
    const held = v.notes.find((n) => n.label === 'run.close_out_held');
    expect(held?.args).toMatchObject({ reason: 'unverified' });
  });

  it('holds on a failing check, and on a changed file no passing check covers', async () => {
    for (const ev of [evidence('/repo/src/a.ts', ['pass', 'fail']), evidence('/repo/src/other.ts', ['pass']), evidence('/repo/src/a.ts', ['unavailable'])]) {
      const tools = fakeTools();
      const v = view();
      await closeOutRun(input(tools, { view: v, evidence: ev }));
      expect(tools.calls.some((c) => c.name === REVIEW_RECORD_TOOL || c.args.status === 'done')).toBe(false);
      expect(v.notes.some((n) => n.label === 'run.close_out_held')).toBe(true);
    }
  });

  it('a verified close-out names the passing checks in the review', async () => {
    const tools = fakeTools();
    await closeOutRun(input(tools));
    expect(String(tools.calls.find((c) => c.name === REVIEW_RECORD_TOOL)?.args.summary)).toContain('/repo/src/a.ts test "check-0"');
    expect(verificationOf(undefined, ['src/a.ts'])).toMatchObject({ verified: false });
  });

  it('reads only SUCCESSFUL reviews as recorded', () => {
    const failed: BrainTraceEvent = { ts: '', category: 'tool', label: REVIEW_RECORD_TOOL, args: { taskId: 9 }, result: { ok: false, error: 'x' }, isError: true };
    const ok: BrainTraceEvent = { ts: '', category: 'tool', label: REVIEW_RECORD_TOOL, args: { taskId: 5 }, result: { ok: true } };
    expect([...reviewedThisRun([failed, ok])]).toEqual([5]);
  });
});
