import { describe, expect, it } from 'vitest';
import type { BrainTraceEvent } from '../brainTriage';
import { recordCodeChangeTicket, type BackstopRun } from './runBackstops';
import type { BrainRunRequest } from './runTypes';

/** A MINT in a bound chat files under the chat's ONE open linked epic (`parentTaskId`), so the epic's progress counts it. */
function state(): BackstopRun & { notes: BrainTraceEvent[] } {
  const notes: BrainTraceEvent[] = [];
  return { touchedFiles: ['src/a.ts'], deltaRecordedFiles: [], deltaTicketId: null, ticketRecorded: false, deltaCaptureRefused: false, note: (ev) => notes.push(ev), notes };
}

function relay(listed: unknown) {
  const deltas: Array<Record<string, unknown>> = [];
  const runTool = async (name: string, args: unknown): Promise<unknown> => {
    if (name === 'builtin_chats_list_tickets') {
      if (listed instanceof Error) throw listed;
      return listed;
    }
    deltas.push(args as Record<string, unknown>);
    return { deltaId: 1, taskId: 7001 };
  };
  return { deltas, req: { projectId: 1, runTool, tools: [{ type: 'function', function: { name: 'builtin_chats_list_tickets' } }] } as unknown as BrainRunRequest };
}

const epic = (ref: string, status = 'in_progress') => ({ kind: 'epic', ref, status, exists: true, label: `Epic ${ref}` });
const page = (tickets: unknown[]) => ({ tickets, total: tickets.length, matched: tickets.length, hasMore: false });

describe('recordCodeChangeTicket · the parent epic', () => {
  it('passes parentTaskId when exactly one open epic is linked', async () => {
    const { deltas, req } = relay(page([epic('6902'), { kind: 'task', ref: '6903', status: 'in_review', exists: true }]));
    await recordCodeChangeTicket(276, state(), req, 'open');
    expect(deltas[0]).toMatchObject({ chatId: 276, parentTaskId: 6902 });
  });

  it('passes no parent with zero or two open epics, or only a closed one', async () => {
    for (const listed of [page([]), page([epic('1'), epic('2')]), page([epic('3', 'done')])]) {
      const { deltas, req } = relay(listed);
      await recordCodeChangeTicket(276, state(), req, 'open');
      expect(deltas[0]).not.toHaveProperty('parentTaskId');
    }
  });

  it('never looks up a parent for an attach or an unbound chat', async () => {
    const attach = relay(page([epic('6902')]));
    const c = state();
    c.deltaTicketId = 7001;
    await recordCodeChangeTicket(276, c, attach.req, 'settle');
    expect(attach.deltas[0]).toMatchObject({ taskId: 7001 });
    expect(attach.deltas[0]).not.toHaveProperty('parentTaskId');
    const unbound = relay(page([epic('6902')]));
    await recordCodeChangeTicket(null, state(), unbound.req, 'open');
    expect(unbound.deltas[0]).not.toHaveProperty('parentTaskId');
  });

  it('regression: an epic in another project refuses the parent — the mint retries once without it, so the change still gets its ticket', async () => {
    const deltas: Array<Record<string, unknown>> = [];
    const runTool = async (name: string, args: unknown): Promise<unknown> => {
      if (name === 'builtin_chats_list_tickets') return page([epic('6902')]);
      const a = { ...(args as Record<string, unknown>) };
      deltas.push(a);
      return a.parentTaskId != null ? { ok: false, error: 'parent task is not in this project' } : { deltaId: 1, taskId: 7001 };
    };
    const req = { projectId: 1, runTool, tools: [{ type: 'function', function: { name: 'builtin_chats_list_tickets' } }] } as unknown as BrainRunRequest;
    const c = state();
    await recordCodeChangeTicket(276, c, req, 'open');
    expect(deltas).toHaveLength(2);
    expect(deltas[0]).toMatchObject({ parentTaskId: 6902 });
    expect(deltas[1]).not.toHaveProperty('parentTaskId');
    expect(c.deltaTicketId).toBe(7001);
    expect(c.ticketRecorded).toBe(true);
    expect(c.notes.map((n) => n.label)).toContain('ticket.parent_epic_refused');
  });

  it('a THROWN mint (transport failure / timeout) is not retried: the server may have minted already', async () => {
    const deltas: unknown[] = [];
    const runTool = async (name: string, args: unknown): Promise<unknown> => {
      if (name === 'builtin_chats_list_tickets') return page([epic('6902')]);
      deltas.push(args);
      throw new Error('timed out');
    };
    const req = { projectId: 1, runTool, tools: [{ type: 'function', function: { name: 'builtin_chats_list_tickets' } }] } as unknown as BrainRunRequest;
    const c = state();
    await recordCodeChangeTicket(276, c, req, 'open');
    expect(deltas).toHaveLength(1);
    expect(c.notes.map((n) => n.label)).not.toContain('ticket.parent_epic_refused');
  });

  it('a role refusal is not retried without the parent (it would 403 the same way)', async () => {
    const deltas: unknown[] = [];
    const runTool = async (name: string, args: unknown): Promise<unknown> => {
      if (name === 'builtin_chats_list_tickets') return page([epic('6902')]);
      deltas.push(args);
      return { ok: false, error: 'tickets.from_delta requires at least the member role' };
    };
    const req = { projectId: 1, runTool, tools: [{ type: 'function', function: { name: 'builtin_chats_list_tickets' } }] } as unknown as BrainRunRequest;
    const c = state();
    await recordCodeChangeTicket(276, c, req, 'open');
    expect(deltas).toHaveLength(1);
    expect(c.deltaCaptureRefused).toBe(true);
  });

  it('a listing failure is noted and the ticket is minted without a parent', async () => {
    const { deltas, req } = relay(new Error('relay down'));
    const c = state();
    await recordCodeChangeTicket(276, c, req, 'open');
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).not.toHaveProperty('parentTaskId');
    expect(c.notes[0]).toMatchObject({ label: 'ticket.parent_epic_unreadable' });
  });
});
