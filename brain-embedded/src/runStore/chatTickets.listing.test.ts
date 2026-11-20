import { describe, expect, it } from 'vitest';
import type { BrainTraceEvent } from '../brainTriage';
import { linkedTicketsToComplete } from '../chatWorkLinking';
import { forgetChatTicketListing, listChatTickets, listingScopeOf, type ListingReport } from './chatTickets';
import { holdsLinkedTicket } from './deterministicFinish';
import { settleView, updateLinkedTickets } from './runBackstops';
import type { RunCell } from './runCell';
import { pushTrace } from './runCells';
import type { BrainRunRequest } from './runTypes';

const REPORT: ListingReport = { label: 'ticket.links_unreadable', consequence: 'nothing moved.' };
const page = (ref: string, status = 'in_review') => ({ tickets: [{ kind: 'task', ref, status, exists: true }], total: 1, matched: 1, hasMore: false });
const LISTING = { type: 'function', function: { name: 'builtin_chats_list_tickets' } };

/** A runner whose listing answers the queued results in order (an Error is thrown), counting the calls. */
function runner(...answers: unknown[]) {
  const calls: string[] = [];
  const runTool = async (name: string): Promise<unknown> => {
    calls.push(name);
    const next = answers.length > 1 ? answers.shift() : answers[0];
    if (next instanceof Error) throw next;
    return next;
  };
  return { req: { runTool }, calls };
}

const step = (label: string, over: Partial<BrainTraceEvent> = {}): BrainTraceEvent =>
  ({ ts: 't', category: 'tool', label, args: {}, result: { ok: true }, ...over });

/** A cell whose run has already recorded one step (a listing read on an empty run trace is never memoised). */
const cellOf = (runId = 'r1'): RunCell =>
  ({ trace: [step('edit_file')], runTraceFrom: 0, listeners: new Set(), runId }) as unknown as RunCell;

describe('listChatTickets — memoised per run', () => {
  it('two reads in one settle make one listing call', async () => {
    const { req, calls } = runner(page('1'));
    const scope = listingScopeOf(cellOf());
    expect(await listChatTickets(req, 7, REPORT, scope)).toEqual(page('1'));
    expect(await listChatTickets(req, 7, REPORT, scope)).toEqual(page('1'));
    expect(calls).toEqual(['builtin_chats_list_tickets']);
  });

  it('a read-only step or a note in between keeps the listing', async () => {
    const { req, calls } = runner(page('1'));
    const cell = cellOf();
    await listChatTickets(req, 7, REPORT, listingScopeOf(cell));
    pushTrace(cell, step('git_push'));
    pushTrace(cell, step('builtin_chats_list_tickets'));
    pushTrace(cell, { ts: 't', category: 'message', label: 'run.close_out_held', result: 'held' });
    await listChatTickets(req, 7, REPORT, listingScopeOf(cell));
    expect(calls).toHaveLength(1);
  });

  it.each([
    ['the account create', step('builtin_tasks_create')],
    ['a status move', step('builtin_tasks_update', { args: { id: 1, status: 'done' } })],
    ['a delta record', step('builtin_tickets_from_delta')],
    ['a chat link', step('builtin_chats_link_ticket')],
    ['the device create', step('ticket-create')],
    ['the device move', step('ticket-move')],
    ['a refused write', step('builtin_tickets_from_delta', { isError: true, result: { ok: false, error: 'unknown tool' } })],
    ['a timed-out write (it may still have landed)', step('builtin_tasks_update', { isError: true, result: { ok: false, error: 'timed out after 8000ms' } })],
    ['a thrown write', step('ticket-move', { isError: true, result: { ok: false, error: 'socket hang up' } })],
    ['a new model turn', { ts: 't', category: 'llm', label: 'llm.complete' } as BrainTraceEvent],
  ])('%s in between reads the listing again — the next read sees the state after it', async (_why, ev) => {
    const { req, calls } = runner(page('1'), page('2'));
    const cell = cellOf();
    await listChatTickets(req, 7, REPORT, listingScopeOf(cell));
    pushTrace(cell, ev);
    expect(await listChatTickets(req, 7, REPORT, listingScopeOf(cell))).toEqual(page('2'));
    expect(calls).toHaveLength(2);
  });

  it('a write recorded while the listing was in flight invalidates it', async () => {
    const cell = cellOf();
    const calls: string[] = [];
    const runTool = async (name: string): Promise<unknown> => {
      calls.push(name);
      if (calls.length === 1) pushTrace(cell, step('builtin_tasks_update'));
      return page(String(calls.length));
    };
    await listChatTickets({ runTool }, 7, REPORT, listingScopeOf(cell));
    expect(await listChatTickets({ runTool }, 7, REPORT, listingScopeOf(cell))).toEqual(page('2'));
  });

  it('the read point scrolled out of the bounded trace window: the listing is read again', async () => {
    const { req, calls } = runner(page('1'), page('2'));
    const cell = cellOf();
    await listChatTickets(req, 7, REPORT, listingScopeOf(cell));
    // The window slid past the mark (pushTrace drops from the front once it is full).
    cell.trace = [step('git_status'), step('git_diff')];
    expect(await listChatTickets(req, 7, REPORT, listingScopeOf(cell))).toEqual(page('2'));
    expect(calls).toHaveLength(2);
  });

  it('a trace reset under the same runId (a mirrored snapshot, an engine restart) is never read through', async () => {
    const { req, calls } = runner(page('1'), page('2'), page('3'));
    const cell = cellOf();
    const mark = cell.trace[0]!;
    await listChatTickets(req, 7, REPORT, listingScopeOf(cell));
    // Replaced wholesale with a trace that still carries the mark, but BEFORE this run's start.
    cell.trace = [mark, step('edit_file')];
    cell.runTraceFrom = 1;
    expect(await listChatTickets(req, 7, REPORT, listingScopeOf(cell))).toEqual(page('2'));
    // Replaced with an empty trace: nothing to read the listing against.
    cell.trace = [];
    cell.runTraceFrom = 0;
    expect(await listChatTickets(req, 7, REPORT, listingScopeOf(cell))).toEqual(page('3'));
    expect(calls).toHaveLength(3);
  });

  it('a listing read on an empty run trace is not memoised', async () => {
    const { req, calls } = runner(page('1'));
    const cell = { ...cellOf(), trace: [] } as unknown as RunCell;
    await listChatTickets(req, 7, REPORT, listingScopeOf(cell));
    await listChatTickets(req, 7, REPORT, listingScopeOf(cell));
    expect(calls).toHaveLength(2);
  });

  it('a failed listing is not memoised: the next read retries', async () => {
    const notes: BrainTraceEvent[] = [];
    const { req, calls } = runner(new Error('gateway down'), page('1'));
    const cell = cellOf();
    expect(await listChatTickets(req, 7, { ...REPORT, note: (ev) => notes.push(ev) }, listingScopeOf(cell))).toBeNull();
    expect(notes.map((n) => n.label)).toEqual(['ticket.links_unreadable']);
    expect(await listChatTickets(req, 7, REPORT, listingScopeOf(cell))).toEqual(page('1'));
    expect(calls).toHaveLength(2);
  });

  it('a failed result (not thrown) is not memoised either', async () => {
    const { req, calls } = runner({ ok: false, error: 'denied' }, page('1'));
    const cell = cellOf();
    expect(await listChatTickets(req, 7, REPORT, listingScopeOf(cell))).toBeNull();
    expect(await listChatTickets(req, 7, REPORT, listingScopeOf(cell))).toEqual(page('1'));
    expect(calls).toHaveLength(2);
  });

  it("separate runs don't share a listing — not the chat's next run on the same cell, nor another chat's cell", async () => {
    const { req, calls } = runner(page('1'), page('2'), page('3'));
    const cell = cellOf('r1');
    await listChatTickets(req, 7, REPORT, listingScopeOf(cell));
    cell.runId = 'r2';
    expect(await listChatTickets(req, 7, REPORT, listingScopeOf(cell))).toEqual(page('2'));
    expect(await listChatTickets(req, 7, REPORT, listingScopeOf(cellOf('r2')))).toEqual(page('3'));
    expect(calls).toHaveLength(3);
  });

  it("a settle's late work after the next run began neither reads nor writes the memo", async () => {
    const { req, calls } = runner(page('1'), page('2'), page('3'));
    const cell = cellOf('r1');
    const settling = { cell, runId: 'r1' };
    await listChatTickets(req, 7, REPORT, settling);
    cell.runId = 'r2';
    expect(await listChatTickets(req, 7, REPORT, settling)).toEqual(page('2'));
    expect(await listChatTickets(req, 7, REPORT, listingScopeOf(cell))).toEqual(page('3'));
    expect(calls).toHaveLength(3);
  });

  it('a settled run forgets its listing', async () => {
    const { req, calls } = runner(page('1'), page('2'));
    const cell = cellOf();
    await listChatTickets(req, 7, REPORT, listingScopeOf(cell));
    forgetChatTicketListing(cell);
    expect(await listChatTickets(req, 7, REPORT, listingScopeOf(cell))).toEqual(page('2'));
    expect(calls).toHaveLength(2);
  });

  it('another chat id is listed for itself', async () => {
    const { req, calls } = runner(page('1'), page('2'));
    const cell = cellOf();
    await listChatTickets(req, 7, REPORT, listingScopeOf(cell));
    expect(await listChatTickets(req, 8, REPORT, listingScopeOf(cell))).toEqual(page('2'));
    expect(calls).toHaveLength(2);
  });

  it('without a scope every read lists', async () => {
    const { req, calls } = runner(page('1'));
    await listChatTickets(req, 7, REPORT);
    await listChatTickets(req, 7, REPORT);
    expect(calls).toHaveLength(2);
  });
});

describe('a ticket MOVE never acts on a memoised listing', () => {
  it('a memoised #812 in_review that the board moved back to in_progress is NOT moved to done by the close-out', async () => {
    const cell = Object.assign(cellOf(), { touchedFiles: ['src/a.ts'], deltaRecordedFiles: ['src/a.ts'], deltaTicketId: 812 });
    const calls: { name: string; args: unknown }[] = [];
    let board = page('812', 'in_review');
    const runTool = async (name: string, args: unknown): Promise<unknown> => {
      calls.push({ name, args });
      return name === 'builtin_chats_list_tickets' ? board : { ok: true };
    };
    const req = { runTool, tools: [LISTING] } as unknown as BrainRunRequest;
    const view = settleView(cell, cell.runId);
    // The read-only question memoises the listing: #812 is in review and the run owns it.
    expect(await holdsLinkedTicket([], 7, req, { deltaTicketId: 812, listing: view.listing })).toBe(true);
    // Someone moves #812 back to in_progress on the board; nothing on the run's trace says so.
    board = page('812', 'in_progress');
    const moved = await updateLinkedTickets(7, view, req, linkedTicketsToComplete, 'done', 'shipped-to-base-branch', new Set(['812']));
    expect(moved).toBe(0);
    expect(calls.map((c) => c.name)).toEqual(['builtin_chats_list_tickets', 'builtin_chats_list_tickets']);
  });
});
