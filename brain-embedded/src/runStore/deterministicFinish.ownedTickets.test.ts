import { describe, expect, it } from 'vitest';
import { createEvidenceLedger } from '@builderforce/run-guards';
import type { BrainTraceEvent } from '../brainTriage';
import type { BrainRunContext } from './brainRunContext';
import { deterministicFinish, holdsLinkedTicket } from './deterministicFinish';
import type { BackstopRun } from './runBackstops';

/**
 * The close-out acts only on the tickets THIS run owns (`runOwnedTicketRefs`): a chat collects every ticket anyone linked to it,
 * and the real `chats.list_tickets` page is now read (it was a `{ tickets }` envelope the selectors silently ignored).
 */

/** The host's catalog carries the linked-ticket listing. */
const TOOLS = [{ type: 'function' as const, function: { name: 'builtin_chats_list_tickets', description: '', parameters: { type: 'object' as const } } }];

const page = (tickets: unknown[]) => ({ tickets, total: tickets.length, matched: tickets.length, hasMore: false });

function tools(listed: unknown) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const runTool = async (name: string, args: unknown): Promise<unknown> => {
    calls.push({ name, args: args as Record<string, unknown> });
    return name === 'builtin_chats_list_tickets' ? listed : { ok: true };
  };
  return { calls, runTool };
}

function view(deltaTicketId: number | null): BackstopRun & { notes: BrainTraceEvent[] } {
  const notes: BrainTraceEvent[] = [];
  return { touchedFiles: ['src/a.ts'], deltaRecordedFiles: ['src/a.ts'], deltaTicketId, ticketRecorded: true, deltaCaptureRefused: false, deltaTitleCount: 1, note: (ev) => notes.push(ev), notes };
}

const run = { c: { runUsage: {}, trace: [], authorModels: new Set<string>(), shipReviews: [] }, req: {}, serverChatId: 7, recalled: null } as unknown as BrainRunContext;

function input(t: ReturnType<typeof tools>, deltaTicketId: number | null) {
  const ledger = createEvidenceLedger();
  ledger.record('/repo/src/a.ts', 'h1', { kind: 'test', name: 'c', outcome: 'pass', exitCode: 0, findings: [], at: 1 });
  return {
    serverChatId: 7, view: view(deltaTicketId), req: { runTool: t.runTool, projectId: 3, tools: TOOLS }, needsTicket: true, shipped: true,
    reviewedInPreview: [], openPlaceholders: 0, trace: [] as BrainTraceEvent[], evidence: ledger, verified: true, hasTicket: true,
  };
}

const moves = (t: ReturnType<typeof tools>) => t.calls.filter((c) => c.name === 'builtin_tasks_update').map((c) => c.args);

describe('the close-out moves only the tickets the run owns', () => {
  it('regression: a shipped run leaves another conversation\'s in_review ticket linked to the chat alone', async () => {
    const t = tools(page([
      { kind: 'task', ref: '41', status: 'in_review', exists: true },
      { kind: 'task', ref: '99', status: 'in_review', exists: true },
    ]));
    await deterministicFinish(input(t, 41), run);
    expect(moves(t)).toContainEqual({ id: 41, status: 'done' });
    expect(moves(t).some((m) => String(m.id) === '99')).toBe(false);
  });

  it('regression: a code-changing settle does not advance an untouched backlog child of the epic', async () => {
    const t = tools(page([
      { kind: 'epic', ref: '6902', status: 'in_progress', exists: true },
      { kind: 'task', ref: '6905', status: 'backlog', exists: true },
    ]));
    await deterministicFinish({ ...input(t, 41), shipped: false, verified: false }, run);
    expect(moves(t).some((m) => String(m.id) === '6905')).toBe(false);
  });

  it('holdsLinkedTicket counts a completable link only when the run owns it', async () => {
    const listed = page([{ kind: 'task', ref: '99', status: 'in_review', exists: true }]);
    expect(await holdsLinkedTicket([], 7, { runTool: tools(listed).runTool, tools: TOOLS })).toBe(false);
    expect(await holdsLinkedTicket([], 7, { runTool: tools(listed).runTool, tools: TOOLS }, { deltaTicketId: 99 })).toBe(true);
  });

  it('reads no listing on a host whose catalog has none (no unreadable-note spam)', async () => {
    const notes: BrainTraceEvent[] = [];
    const runTool = async () => { throw new Error('unknown tool'); };
    expect(await holdsLinkedTicket([], 7, { runTool, tools: [] }, { note: (ev) => notes.push(ev) })).toBe(false);
    expect(notes).toEqual([]);
  });

  it('a listing failure is reported on the run, never skipped silently', async () => {
    const notes: BrainTraceEvent[] = [];
    const runTool = async () => { throw new Error('relay down'); };
    expect(await holdsLinkedTicket([], 7, { runTool, tools: TOOLS }, { note: (ev) => notes.push(ev) })).toBe(false);
    expect(notes[0]).toMatchObject({ label: 'ticket.links_unreadable' });
    expect(String(notes[0]!.result)).toContain('relay down');
  });
});
