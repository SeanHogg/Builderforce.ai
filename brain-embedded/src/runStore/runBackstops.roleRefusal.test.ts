import { describe, expect, it, vi } from 'vitest';
import { recordCodeChangeTicket, type BackstopRun } from './runBackstops';
import type { BrainRunRequest } from './runTypes';

/** A role that cannot mint a ticket is told so ONCE. The settle pass must not retry a
 *  `from_delta` mint the open pass was refused for — a contributor's run otherwise
 *  traces the identical 403 twice ("requires at least the 'developer' role"). */
describe('recordCodeChangeTicket — a terminal role refusal is learned for the run', () => {
  const REFUSAL =
    "'tickets.from_delta' changes workspace data and requires at least the 'developer' role (caller has 'contributor') (HTTP 403)";

  function state(): BackstopRun {
    return {
      touchedFiles: ['src/a.ts'],
      deltaRecordedFiles: [],
      deltaTicketId: null,
      ticketRecorded: false,
      deltaCaptureRefused: false,
      note: () => {},
    };
  }

  it('marks the run refused when the capture 403s on role, and the settle pass then spends no call', async () => {
    const c = state();
    const runTool = vi.fn(async () => ({ ok: false, error: REFUSAL }));
    const req = { projectId: 1, runTool } as unknown as BrainRunRequest;

    await recordCodeChangeTicket(null, c, req, 'open');
    expect(c.deltaCaptureRefused).toBe(true);
    expect(c.ticketRecorded).toBe(false);

    runTool.mockClear();
    await recordCodeChangeTicket(null, c, req, 'settle');
    expect(runTool).not.toHaveBeenCalled();
  });

  it('retries at settle after a refusal that is NOT terminal (the relay, not the role)', async () => {
    const c = state();
    const runTool = vi.fn(async () => ({ ok: false, error: 'MCP call failed (HTTP 502)' }));
    const req = { projectId: 1, runTool } as unknown as BrainRunRequest;

    await recordCodeChangeTicket(null, c, req, 'open');
    expect(c.deltaCaptureRefused).toBe(false);

    runTool.mockClear();
    await recordCodeChangeTicket(null, c, req, 'settle');
    expect(runTool).toHaveBeenCalledTimes(1);
  });

  it('a successful capture still records the ticket and never sets the refusal flag', async () => {
    const c = state();
    const runTool = vi.fn(async () => ({ ok: true, id: 42 }));
    const req = { projectId: 1, runTool } as unknown as BrainRunRequest;

    await recordCodeChangeTicket(null, c, req, 'open');
    expect(c.deltaTicketId).toBe(42);
    expect(c.ticketRecorded).toBe(true);
    expect(c.deltaCaptureRefused).toBe(false);
    expect(c.deltaRecordedFiles).toEqual(['src/a.ts']);
  });
});
