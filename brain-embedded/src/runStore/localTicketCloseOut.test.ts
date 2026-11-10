import { describe, expect, it } from 'vitest';
import { createEvidenceLedger } from '@builderforce/run-guards';
import type { BrainTraceEvent } from '../brainTriage';
import type { BrainRunContext } from './brainRunContext';
import { deterministicFinish } from './deterministicFinish';
import { localTicketsFiledInRun, updateRunLocalTickets, type BackstopRun } from './runBackstops';

/**
 * Regression (VS Code chat #70776): the hand-off filed four device-local tickets and they stayed
 * `backlog` / 0% forever — every close-out path listed the ACCOUNT's chat tickets and skipped any
 * non-integer ref. The run's own record is where its local tickets are read from.
 */

const U1 = '0b1c2d3e-0000-4000-8000-000000000001';
const U2 = '0b1c2d3e-0000-4000-8000-000000000002';
/** A ticket the model filed mid-run (a follow-up), not one the hand-off filed: the close-out never moves it. */
const FOLLOW_UP = '0b1c2d3e-0000-4000-8000-000000000003';
const step = (label: string, args: Record<string, unknown>, result: unknown, isError = false): BrainTraceEvent =>
  ({ ts: 't', category: 'tool', label, args, result, isError }) as BrainTraceEvent;

const TRACE: BrainTraceEvent[] = [
  step('ticket-create', { title: 'A', auto: true, reason: 'hand_off' }, JSON.stringify({ kind: 'local', id: U1 })),
  step('ticket-create', { title: 'B', auto: true, reason: 'hand_off' }, { id: U2 }),
  step('ticket-create', { title: 'Follow-up bug' }, { id: FOLLOW_UP }),
  step('ticket-create', { title: 'C' }, { ok: false, error: 'nope' }, true),
  step('ticket-create', { title: 'A again' }, JSON.stringify({ id: U1 })),
  step('ticket-move', { id: U1, status: 'in_progress', auto: true, reason: 'hand_off' }, JSON.stringify({ ok: true })),
];

function view(): BackstopRun & { notes: BrainTraceEvent[] } {
  const notes: BrainTraceEvent[] = [];
  return { touchedFiles: ['src/a.ts'], deltaRecordedFiles: ['src/a.ts'], deltaTicketId: null, ticketRecorded: true, deltaCaptureRefused: false, deltaTitleCount: null, note: (ev) => notes.push(ev), notes };
}

function tools() {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return { calls, runTool: async (name: string, args: unknown) => { calls.push({ name, args: args as Record<string, unknown> }); return name === 'builtin_chats_list_tickets' ? [] : JSON.stringify({ ok: true }); } };
}

describe('the run\'s local tickets at close-out', () => {
  it('reads the successful ticket-create steps, the hand-off\'s included, once each', () => {
    expect(localTicketsFiledInRun(TRACE)).toEqual([U1, U2]);
  });

  it('advances only the ones not already moved, through ticket-move, recording the reason', async () => {
    const t = tools();
    const v = view();
    const moved = await updateRunLocalTickets(TRACE, v, { runTool: t.runTool }, 'in_progress', 'worked-ticket-off-backlog');
    expect(moved).toBe(1);
    expect(t.calls).toEqual([{ name: 'ticket-move', args: { id: U2, status: 'in_progress' } }]);
    expect(v.notes[0]).toMatchObject({ label: 'ticket-move', args: { id: U2, status: 'in_progress', auto: true, reason: 'worked-ticket-off-backlog' } });
  });

  it('closes them on the shipped + verified finish, and never on an unverified one', async () => {
    const ledger = createEvidenceLedger();
    ledger.record('/repo/src/a.ts', 'h1', { kind: 'test', name: 'c', outcome: 'pass', exitCode: 0, findings: [], at: 1 });
    const base = { serverChatId: null, req: {}, needsTicket: true, shipped: true, reviewedInPreview: [], openPlaceholders: 0, trace: TRACE, evidence: ledger, hasTicket: true };
    const run = { c: { runUsage: {}, trace: [] }, req: {}, serverChatId: null, recalled: null } as unknown as BrainRunContext;

    const t = tools();
    const res = await deterministicFinish({ ...base, view: view(), req: { runTool: t.runTool, projectId: 3 }, verified: true }, run);
    expect(res.ticketClosed).toBe(true);
    const done = t.calls.filter((c) => c.name === 'ticket-move' && c.args.status === 'done').map((c) => c.args.id);
    expect(done).toEqual([U1, U2]);
    // No account update for a local ticket.
    expect(t.calls.some((c) => c.name === 'builtin_tasks_update')).toBe(false);

    const held = tools();
    await deterministicFinish({ ...base, view: view(), req: { runTool: held.runTool, projectId: 3 }, verified: false }, run);
    expect(held.calls.some((c) => c.args.status === 'done')).toBe(false);
  });
});

describe('the close-out moves only the run\'s own tickets, and never over a status the run set', () => {
  const ledger = () => {
    const l = createEvidenceLedger();
    l.record('/repo/src/a.ts', 'h1', { kind: 'test', name: 'c', outcome: 'pass', exitCode: 0, findings: [], at: 1 });
    return l;
  };
  const unbound = { c: { runUsage: {}, trace: [] }, req: {}, serverChatId: null, recalled: null } as unknown as BrainRunContext;
  const finishOn = (trace: BrainTraceEvent[], t: ReturnType<typeof tools>, v = view()) => deterministicFinish({
    serverChatId: null, view: v, req: { runTool: t.runTool, projectId: 3 }, needsTicket: true, shipped: true, reviewedInPreview: [],
    openPlaceholders: 0, trace, evidence: ledger(), verified: true, hasTicket: true,
  }, unbound);
  const movedTo = (t: ReturnType<typeof tools>, status: string) => t.calls.filter((c) => c.args.status === status).map((c) => c.args.id);

  it('a follow-up ticket the model filed mid-run is never advanced nor closed', async () => {
    expect(localTicketsFiledInRun(TRACE)).not.toContain(FOLLOW_UP);
    const t = tools();
    await finishOn(TRACE, t);
    expect(movedTo(t, 'in_progress')).not.toContain(FOLLOW_UP);
    expect(movedTo(t, 'done')).not.toContain(FOLLOW_UP);
  });

  it('never overrides blocked, cancelled, review or done to done; closes in_progress and not-started ones', async () => {
    const ids = ['blocked', 'cancelled', 'review', 'done', 'in_progress', 'backlog'].map((s, i) => [s, `0b1c2d3e-0000-4000-8000-00000000010${i}`] as const);
    const trace = ids.flatMap(([status, id]) => [
      step('ticket-create', { title: status, auto: true, reason: 'hand_off' }, { id }),
      step('ticket-move', { id, status }, { ok: true }),
    ]);
    const t = tools();
    await finishOn(trace, t);
    const byStatus = new Map(ids);
    expect(movedTo(t, 'done')).toEqual([byStatus.get('in_progress'), byStatus.get('backlog')]);
    // The advance never moves a ticket out of a lane the run put it in, either.
    expect(movedTo(t, 'in_progress')).toEqual([byStatus.get('backlog')]);
  });

  it('closes the run\'s delta ticket on an unbound chat — and never one the run moved to review', async () => {
    const t = tools();
    await finishOn([], t, { ...view(), deltaTicketId: 41 });
    expect(t.calls).toContainEqual({ name: 'builtin_tasks_update', args: { id: 41, status: 'done' } });

    const reviewed = tools();
    await finishOn([step('builtin_tasks_update', { id: 41, status: 'in_review' }, { ok: true })], reviewed, { ...view(), deltaTicketId: 41 });
    expect(reviewed.calls.some((c) => c.name === 'builtin_tasks_update' && c.args.status === 'done')).toBe(false);
  });

  it('an unbound chat never lists server tickets with a null chat id; its local tickets still close', async () => {
    const t = tools();
    const res = await finishOn(TRACE, t);
    expect(t.calls.some((c) => c.name === 'builtin_chats_list_tickets')).toBe(false);
    expect(res.ticketClosed).toBe(true);
    expect(movedTo(t, 'done')).toEqual([U1, U2]);
  });
});
