import { describe, expect, it, vi } from 'vitest';
import { chatDiagnosticsReads, type ChatDiagnosticsReadAdapter } from './chatDiagnosticsReads';

/**
 * The chat-scoped half of a diagnostics capture.
 *
 * This exists because two hosts hand-wired the same three reads over two different
 * clients, so these tests assert the two things that made that duplication expensive:
 * every reader goes through the ADAPTER (one client), and a chat that does not exist yet
 * answers with the empty shape instead of a rejection the capture has to catch.
 */

function adapter(over: Partial<ChatDiagnosticsReadAdapter> = {}): ChatDiagnosticsReadAdapter {
  return {
    listAgents: vi.fn().mockResolvedValue([{ id: 'x', agentRef: 'bob-1', role: 'participant', name: 'Bob' }]),
    listTickets: vi.fn().mockResolvedValue([]),
    listRuns: vi.fn().mockResolvedValue({ linkedRunnableTickets: 2, runs: [], dispatchers: [] }),
    ...over,
  } as ChatDiagnosticsReadAdapter;
}

describe('chatDiagnosticsReads', () => {
  it('routes all three reads through the one adapter', async () => {
    const a = adapter();
    const reads = chatDiagnosticsReads(a, 103);
    await Promise.all([reads.readAgents!(), reads.readTickets!(), reads.readRuns!()]);
    expect(a.listAgents).toHaveBeenCalledWith(103);
    expect(a.listTickets).toHaveBeenCalledWith(103);
    expect(a.listRuns).toHaveBeenCalledWith(103);
  });

  it('carries the agent NAME through, so the report stops printing uuids', async () => {
    const reads = chatDiagnosticsReads(adapter(), 103);
    await expect(reads.readAgents!()).resolves.toEqual([
      { id: 'x', agentRef: 'bob-1', role: 'participant', name: 'Bob' },
    ]);
  });

  it('answers a not-yet-created chat with the empty shape, touching nothing', async () => {
    // A capture on a brand-new chat is still a capture. Rejecting here would force every
    // host back into the per-read try/catch this module exists to remove — and calling
    // the endpoints with a null id is what the VS Code surface was doing.
    const a = adapter();
    const reads = chatDiagnosticsReads(a, null);
    await expect(reads.readAgents!()).resolves.toEqual([]);
    await expect(reads.readTickets!()).resolves.toEqual([]);
    // `null`, NOT an empty history: "not gathered" and "nothing ran" are opposite
    // findings, and the report words them differently.
    await expect(reads.readRuns!()).resolves.toBeNull();
    expect(a.listAgents).not.toHaveBeenCalled();
    expect(a.listRuns).not.toHaveBeenCalled();
  });
});
