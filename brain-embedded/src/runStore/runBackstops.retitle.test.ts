import { describe, expect, it, vi } from 'vitest';
import { retitleShippedDeltaTicket, type BackstopRun } from './runBackstops';
import type { BrainRunRequest } from './runTypes';

/** A run that minted its delta ticket on the first edit (count remembered), then grew. */
function state(overrides: Partial<BackstopRun> = {}): BackstopRun {
  return {
    touchedFiles: ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts', 'src/f.ts', 'src/g.ts', 'src/h.ts'],
    deltaRecordedFiles: ['src/a.ts'],
    deltaTicketId: 42,
    ticketRecorded: true,
    deltaCaptureRefused: false,
    deltaTitleCount: 1, // minted as "Code change (1 file)"
    note: () => {},
    ...overrides,
  };
}

function req(runTool: ReturnType<typeof vi.fn>): BrainRunRequest {
  return { projectId: 1, runTool } as unknown as BrainRunRequest;
}

describe('retitleShippedDeltaTicket — ticket title from the real diff (PRD 45 §4.7 B9)', () => {
  it('re-titles a "Code change (1 file)" ticket when the final diff touches 8 files', async () => {
    const c = state(); // minted at 1 file, final diff is 8 files
    const runTool = vi.fn(async () => ({ ok: true }));
    await retitleShippedDeltaTicket(c, req(runTool));
    expect(runTool).toHaveBeenCalledTimes(1);
    expect(runTool).toHaveBeenCalledWith('builtin_tasks_update', {
      id: 42,
      title: 'Code change (8 files)',
    });
  });

  it('spends no call when the count already matches the minted title', async () => {
    const c = state({ touchedFiles: ['src/a.ts'] }); // still 1 file
    const runTool = vi.fn(async () => ({ ok: true }));
    await retitleShippedDeltaTicket(c, req(runTool));
    expect(runTool).not.toHaveBeenCalled();
  });

  it('spends no call when no ticket was minted with files this run', async () => {
    const c = state({ deltaTicketId: null, deltaTitleCount: null });
    const runTool = vi.fn(async () => ({ ok: true }));
    await retitleShippedDeltaTicket(c, req(runTool));
    expect(runTool).not.toHaveBeenCalled();
  });

  it('spends no call when there is no runTool on the request', async () => {
    const c = state();
    const runTool = vi.fn(async () => ({ ok: true }));
    await retitleShippedDeltaTicket(c, { projectId: 1 } as unknown as BrainRunRequest);
    expect(runTool).not.toHaveBeenCalled();
  });

  it('singular title when the final diff shrank to one file', async () => {
    const c = state({ touchedFiles: ['src/a.ts'], deltaTitleCount: 5 });
    const runTool = vi.fn(async () => ({ ok: true }));
    await retitleShippedDeltaTicket(c, req(runTool));
    expect(runTool).toHaveBeenCalledWith('builtin_tasks_update', {
      id: 42,
      title: 'Code change (1 file)',
    });
  });
});
