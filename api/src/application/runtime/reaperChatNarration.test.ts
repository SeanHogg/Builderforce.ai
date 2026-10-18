import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createReaperFakeDb, newReaperFakeDbScript, type ReaperFakeDbScript } from './__fixtures__/staleExecutionReaperDb';

/**
 * Cron-reaper → chat narration. The stale-execution reaper fails runs with bulk
 * UPDATEs, bypassing RuntimeService.update and therefore every chat-awareness hook —
 * so a run that died silently (hung host, evicted cloud isolate, dropped queue,
 * abandoned ask_human) previously NEVER reached the humans driving the linked Brain
 * chats: the conversation showed "started working on…" and then nothing, forever.
 *
 * These tests prove every reaped failure now fans out through
 * ChatTicketService.postRunMilestone (phase `failed`, per-execution idempotent) with
 * the ticket kind resolved from ONE batched `tasks` read.
 */

const h = vi.hoisted(() => ({
  milestones: [] as Array<{ tenantId: number; input: Record<string, unknown> }>,
  reapedRunningRows: [] as Array<Record<string, unknown>>,
  reapedQueuedRows: [] as Array<Record<string, unknown>>,
  reapedPausedRows: [] as Array<Record<string, unknown>>,
}));

let script: ReaperFakeDbScript;

function newScript(): ReaperFakeDbScript {
  return newReaperFakeDbScript({
    // The idle probe flags exactly the sweeps that have rows, as the real EXISTS arms do.
    probe: () => ({
      host_running: h.reapedRunningRows.length > 0,
      cloud_running: false, // stale cloud candidates — none in these tests
      queued: h.reapedQueuedRows.length > 0,
      paused: h.reapedPausedRows.length > 0,
      park_age: false,
    }),
    // Each batched sweep binds its own status value first; the principal revocation
    // (status 'revoked') binds execution ids and reaps nothing.
    onUpdate: (set, params) => {
      if (set.status !== 'failed') return [];
      if (params[0] === 'paused') return h.reapedPausedRows;
      if (params.includes('submitted')) return h.reapedQueuedRows;
      if (params[0] === 'running') return h.reapedRunningRows;
      return [];
    },
  });
}

vi.mock('../../infrastructure/database/connection', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../infrastructure/database/connection')>()),
  buildDatabase: () => createReaperFakeDb(script),
}));
vi.mock('../maintenance/parkAgeTimeout', async (importOriginal) => ({
  // Keep the real cutoff resolver (the reaper reads it for the probe); stub only the sweep.
  ...(await importOriginal<typeof import('../maintenance/parkAgeTimeout')>()),
  runParkAgeTimeoutSweep: async () => ({ stale: 0, unparked: 0 }),
}));
vi.mock('../brain/ChatTicketService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../brain/ChatTicketService')>();
  return {
    ...actual,
    ChatTicketService: class {
      async postRunMilestone(tenantId: number, input: Record<string, unknown>) {
        h.milestones.push({ tenantId, input });
      }
    },
  };
});

import { reapStaleExecutions } from './staleExecutionReaper';
import { PAUSED_ORPHAN_REASON } from './orphanReasons';

const env = { NEON_DATABASE_URL: 'postgres://fake' } as unknown as Parameters<typeof reapStaleExecutions>[0];
const NOW = Date.parse('2026-07-24T12:00:00.000Z');

beforeEach(() => {
  h.milestones.length = 0;
  h.reapedRunningRows.length = 0;
  h.reapedQueuedRows.length = 0;
  h.reapedPausedRows.length = 0;
  script = newScript();
});

describe('reapStaleExecutions — chat narration of silent deaths', () => {
  it('narrates a reaped hung run as a `failed` milestone into the linked chats', async () => {
    h.reapedRunningRows.push({
      id: 301, tenant_id: 4, agent_host_id: 9, payload: '{"cloudAgentRef":"agent-x"}',
      error_message: 'Execution timed out — the agent did not report completion.', task_id: 55,
    });
    script.taskKinds.push({ id: 55, task_type: 'epic' });

    await reapStaleExecutions(env, NOW);

    expect(h.milestones).toHaveLength(1);
    expect(h.milestones[0]!.tenantId).toBe(4);
    expect(h.milestones[0]!.input).toMatchObject({
      kind: 'epic', ref: '55', phase: 'failed', executionId: 301,
      agentRef: 'agent-x',
      errorMessage: 'Execution timed out — the agent did not report completion.',
    });
  });

  it('narrates an abandoned ask_human pause with its actionable release reason', async () => {
    h.reapedPausedRows.push({
      id: 77, tenant_id: 1, agent_host_id: null, payload: null,
      error_message: PAUSED_ORPHAN_REASON, task_id: 12,
    });
    script.taskKinds.push({ id: 12, task_type: 'task' });

    await reapStaleExecutions(env, NOW);

    expect(h.milestones).toHaveLength(1);
    expect(h.milestones[0]!.input).toMatchObject({
      kind: 'task', ref: '12', phase: 'failed', executionId: 77, errorMessage: PAUSED_ORPHAN_REASON,
    });
  });

  it('narrates dropped-queue runs (never picked up) too', async () => {
    h.reapedQueuedRows.push({
      id: 88, tenant_id: 2, agent_host_id: null, payload: null,
      error_message: 'Execution was never picked up by an agent within the dispatch window.', task_id: 30,
    });
    script.taskKinds.push({ id: 30, task_type: 'gap' });

    await reapStaleExecutions(env, NOW);

    expect(h.milestones).toHaveLength(1);
    expect(h.milestones[0]!.input).toMatchObject({ kind: 'gap', ref: '30', phase: 'failed', executionId: 88 });
  });

  it('resolves ticket kinds with ONE batched tasks read across many reaped rows (no N+1)', async () => {
    h.reapedRunningRows.push(
      { id: 1, tenant_id: 1, agent_host_id: 9, payload: null, error_message: 'x', task_id: 10 },
      { id: 2, tenant_id: 1, agent_host_id: 9, payload: null, error_message: 'x', task_id: 11 },
    );
    h.reapedPausedRows.push({ id: 3, tenant_id: 1, agent_host_id: null, payload: null, error_message: 'x', task_id: 12 });
    script.taskKinds.push({ id: 10, task_type: 'task' }, { id: 11, task_type: 'epic' }, { id: 12, task_type: 'task' });

    await reapStaleExecutions(env, NOW);

    expect(script.taskKindReads).toBe(1);
    expect(h.milestones).toHaveLength(3);
  });

  it('posts nothing (and skips the tasks read) when the sweep reaped nothing', async () => {
    await reapStaleExecutions(env, NOW);
    expect(h.milestones).toHaveLength(0);
    expect(script.taskKindReads).toBe(0);
  });
});
