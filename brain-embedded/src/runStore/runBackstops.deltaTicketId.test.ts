import { describe, expect, it } from 'vitest';
import { recordCodeChangeTicket, type BackstopRun } from './runBackstops';
import type { BrainRunRequest } from './runTypes';

/** `builtin_tickets_from_delta` answers `{ deltaId, kind, taskId, deduped }`: the ticket is `taskId`. */
function state(touched: string[]): BackstopRun {
  return { touchedFiles: touched, deltaRecordedFiles: [], deltaTicketId: null, ticketRecorded: false, deltaCaptureRefused: false, note: () => {} };
}

function relay(shape: (taskId: number) => unknown) {
  const calls: Array<Record<string, unknown>> = [];
  let next = 6522;
  const runTool = async (_name: string, args: unknown): Promise<unknown> => {
    const a = args as Record<string, unknown>;
    calls.push(a);
    const taskId = typeof a.taskId === 'number' ? a.taskId : (next += 1);
    return shape(taskId);
  };
  return { calls, req: { projectId: 1, runTool } as unknown as BrainRunRequest };
}

describe('recordCodeChangeTicket reads the ticket off from_delta\'s real answer', () => {
  it('regression: second capture attaches to the first delta ticket (chat #61651, 17 duplicates)', async () => {
    const c = state(['src/a.ts']);
    const { calls, req } = relay((taskId) => ({ deltaId: 1161, kind: 'improvement', taskId, deduped: false }));
    await recordCodeChangeTicket(7, c, req, 'open');
    expect(c.deltaTicketId).toBe(6523);
    c.touchedFiles = ['src/a.ts', 'src/b.ts'];
    await recordCodeChangeTicket(7, c, req, 'settle');
    expect(calls).toHaveLength(2);
    expect(calls.filter((a) => a.taskId === undefined)).toHaveLength(1); // ONE mint
    expect(calls[1]!.taskId).toBe(6523);
  });

  it('reads a JSON-text result and a numeric-string taskId', async () => {
    const c = state(['src/a.ts']);
    const { req } = relay((taskId) => JSON.stringify({ deltaId: 1, taskId: String(taskId) }));
    await recordCodeChangeTicket(7, c, req, 'open');
    expect(c.deltaTicketId).toBe(6523);
  });
});
