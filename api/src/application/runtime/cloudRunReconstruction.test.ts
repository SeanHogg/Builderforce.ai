/**
 * GAP-O1 / GAP-O2 — "validated" means a cloud run is fully RECONSTRUCTABLE from
 * telemetry alone, and that its two token ledgers AGREE.
 *
 * This is the core claim of the cloud-agent validation PRD (doc 09 §4.E): migrations
 * 0092/0096 make a run attributable by `cloud_agent_ref` + `execution_id` across
 *
 *   tool_audit_events   — every tool call the run made (the timeline)
 *   usage_snapshots     — the per-execution trace view of token usage
 *   llm_usage_log       — the canonical billing ledger
 *
 * …but nothing asserted it. A telemetry write that silently landed on the wrong
 * key (or not at all) would make a run invisible on the timeline and absent from
 * cost, without failing a single test.
 *
 * So: drive the REAL writers for a synthetic run, collect the rows a fake Db
 * captured, and then reconstruct the run the way a reader would — joining on
 * `execution_id` only. Same fake-Db style as `cloudTelemetry.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest';

// Catalog pricing off the network — cost prices to 0, irrelevant to reconstruction.
vi.mock('../llm/modelCatalog', () => ({ getCatalogCached: async () => [] }));

import { recordCloudToolEvent, recordCloudUsage } from './cloudAgentEngine';
import { toolAuditEvents, usageSnapshots, llmUsageLog } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

interface Insert { table: unknown; row: Record<string, unknown> }

function makeFakeDb() {
  const inserts: Insert[] = [];
  const db = {
    insert: (table: unknown) => ({
      values: async (row: Record<string, unknown>) => { inserts.push({ table, row }); },
    }),
  } as unknown as Db;
  return { db, rowsFor: (t: unknown) => inserts.filter((i) => i.table === t).map((i) => i.row) };
}

const env = {} as Env;

const EXECUTION_ID = 4242;
const OTHER_EXECUTION_ID = 4243;
const CLOUD_AGENT_REF = 'agent-cloud-1';
const TENANT_ID = 3;
const TASK_ID = 77;
const PROJECT_ID = 9;

/** The tool calls a representative cloud run makes, in order. */
const RUN_TOOL_CALLS = [
  { toolName: 'read_file',   category: 'tool',      args: { path: 'src/index.ts' } },
  { toolName: 'search_code', category: 'tool',      args: { query: 'createServer' } },
  { toolName: 'write_file',  category: 'code_edit', args: { path: 'src/index.ts' } },
  { toolName: 'steer.applied', category: 'message', args: { text: 'also update the README' } },
  { toolName: 'write_file',  category: 'code_edit', args: { path: 'README.md' } },
  { toolName: 'finish',      category: 'tool',      args: { summary: 'done' } },
] as const;

/** The per-turn usage the same run meters. */
const RUN_TURNS = [
  { model: 'anthropic/claude-sonnet-5', inputTokens: 1200, outputTokens: 300 },
  { model: 'anthropic/claude-sonnet-5', inputTokens: 1800, outputTokens: 450 },
  { model: 'anthropic/claude-sonnet-5', inputTokens: 2400, outputTokens: 120 },
] as const;

/** Drive the real writers for one synthetic cloud run (plus a second run, so the
 *  reconstruction has to actually FILTER rather than take everything it sees). */
async function recordSyntheticRun(db: Db): Promise<void> {
  for (const [i, call] of RUN_TOOL_CALLS.entries()) {
    await recordCloudToolEvent(db, {
      tenantId: TENANT_ID,
      cloudAgentRef: CLOUD_AGENT_REF,
      executionId: EXECUTION_ID,
      toolName: call.toolName,
      category: call.category,
      toolCallId: `call_${i}`,
      detail: call.args,
      result: 'ok',
      durationMs: 10 + i,
    });
  }
  for (const turn of RUN_TURNS) {
    await recordCloudUsage(env, db, {
      tenantId: TENANT_ID,
      cloudAgentRef: CLOUD_AGENT_REF,
      executionId: EXECUTION_ID,
      taskId: TASK_ID,
      projectId: PROJECT_ID,
      model: turn.model,
      inputTokens: turn.inputTokens,
      outputTokens: turn.outputTokens,
    });
  }
  // A DIFFERENT run on the same tenant/agent — its rows must not bleed in.
  await recordCloudToolEvent(db, {
    tenantId: TENANT_ID, cloudAgentRef: CLOUD_AGENT_REF, executionId: OTHER_EXECUTION_ID,
    toolName: 'write_file', category: 'code_edit', detail: { path: 'other.ts' },
  });
  await recordCloudUsage(env, db, {
    tenantId: TENANT_ID, cloudAgentRef: CLOUD_AGENT_REF, executionId: OTHER_EXECUTION_ID,
    taskId: 78, model: 'anthropic/claude-sonnet-5', inputTokens: 10, outputTokens: 5,
  });
}

/** Reconstruct a run the way a reader (Observability timeline / cost rollup) does:
 *  by `execution_id` alone, across all three tables. */
function reconstruct(
  rows: { audit: Record<string, unknown>[]; snapshots: Record<string, unknown>[]; ledger: Record<string, unknown>[] },
  executionId: number,
) {
  const byExecution = <T extends Record<string, unknown>>(list: T[]) =>
    list.filter((r) => r.executionId === executionId);
  const audit = byExecution(rows.audit);
  const snapshots = byExecution(rows.snapshots);
  const ledger = byExecution(rows.ledger);
  return {
    audit, snapshots, ledger,
    toolCalls: audit.map((r) => r.toolName as string),
    snapshotTotal: snapshots.reduce((n, r) => n + Number(r.contextTokens ?? 0), 0),
    ledgerTotal: ledger.reduce((n, r) => n + Number(r.totalTokens ?? 0), 0),
    snapshotInput: snapshots.reduce((n, r) => n + Number(r.inputTokens ?? 0), 0),
    snapshotOutput: snapshots.reduce((n, r) => n + Number(r.outputTokens ?? 0), 0),
    ledgerInput: ledger.reduce((n, r) => n + Number(r.promptTokens ?? 0), 0),
    ledgerOutput: ledger.reduce((n, r) => n + Number(r.completionTokens ?? 0), 0),
  };
}

async function runFixture() {
  const { db, rowsFor } = makeFakeDb();
  await recordSyntheticRun(db);
  const rows = {
    audit: rowsFor(toolAuditEvents),
    snapshots: rowsFor(usageSnapshots),
    ledger: rowsFor(llmUsageLog),
  };
  return { rows, run: reconstruct(rows, EXECUTION_ID) };
}

describe('GAP-O1 — a cloud run is fully reconstructable by execution_id', () => {
  it('recovers EVERY tool call the run made, in order, from tool_audit_events alone', async () => {
    const { run } = await runFixture();
    expect(run.toolCalls).toEqual(RUN_TOOL_CALLS.map((c) => c.toolName));
    // Nothing from the neighbouring run leaked into this one's timeline.
    expect(run.audit.every((r) => r.executionId === EXECUTION_ID)).toBe(true);
  });

  it('carries the join keys — cloud_agent_ref + execution_id — on every row of all three tables', async () => {
    const { run } = await runFixture();
    for (const row of [...run.audit, ...run.snapshots, ...run.ledger]) {
      expect(row.executionId).toBe(EXECUTION_ID);
      expect(row.cloudAgentRef).toBe(CLOUD_AGENT_REF);
      // A cloud run is never host-attributed — that is what makes the CLOUD/ON-PREM
      // split on the timeline correct.
      expect(row.agentHostId ?? null).toBeNull();
    }
  });

  it('joins the timeline to the trace view on the same session key (exec:<id>)', async () => {
    const { run } = await runFixture();
    const keys = new Set([...run.audit, ...run.snapshots].map((r) => r.sessionKey));
    expect([...keys]).toEqual([`exec:${EXECUTION_ID}`]);
  });

  it('rolls the run up to its ticket and project through the billing ledger', async () => {
    const { run } = await runFixture();
    expect(run.ledger).toHaveLength(RUN_TURNS.length);
    for (const row of run.ledger) {
      expect(row).toMatchObject({ tenantId: TENANT_ID, taskId: TASK_ID, projectId: PROJECT_ID });
      expect(row.metadata).toMatchObject({ engine: 'cloud', executionId: EXECUTION_ID, taskId: TASK_ID });
    }
  });

  it('records one usage pair per LLM turn, so the run\'s turn count is recoverable', async () => {
    const { run } = await runFixture();
    expect(run.snapshots).toHaveLength(RUN_TURNS.length);
    expect(run.ledger).toHaveLength(RUN_TURNS.length);
  });

  it('isolates a concurrent run on the same agent (the filter is the execution, not the agent)', async () => {
    const { rows } = await runFixture();
    const other = reconstruct(rows, OTHER_EXECUTION_ID);
    expect(other.toolCalls).toEqual(['write_file']);
    expect(other.ledgerTotal).toBe(15);
    // …and the primary run is unaffected by its neighbour.
    expect(reconstruct(rows, EXECUTION_ID).ledger).toHaveLength(RUN_TURNS.length);
  });
});

describe('GAP-O2 — usage_snapshots and llm_usage_log agree (no double-count, no drift)', () => {
  const expectedInput = RUN_TURNS.reduce((n, t) => n + t.inputTokens, 0);
  const expectedOutput = RUN_TURNS.reduce((n, t) => n + t.outputTokens, 0);

  it('ledger total === snapshot total for the execution', async () => {
    const { run } = await runFixture();
    expect(run.snapshotTotal).toBe(expectedInput + expectedOutput);
    expect(run.ledgerTotal).toBe(run.snapshotTotal);
  });

  it('agrees on the input/output SPLIT, not just the total', async () => {
    const { run } = await runFixture();
    expect(run.snapshotInput).toBe(expectedInput);
    expect(run.ledgerInput).toBe(expectedInput);
    expect(run.snapshotOutput).toBe(expectedOutput);
    expect(run.ledgerOutput).toBe(expectedOutput);
  });

  it('writes exactly ONE row per ledger per turn — a second write would double the bill', async () => {
    const { run } = await runFixture();
    expect(run.snapshots).toHaveLength(run.ledger.length);
    for (const [i, turn] of RUN_TURNS.entries()) {
      expect(run.snapshots[i]).toMatchObject({ inputTokens: turn.inputTokens, outputTokens: turn.outputTokens });
      expect(run.ledger[i]).toMatchObject({ promptTokens: turn.inputTokens, completionTokens: turn.outputTokens });
    }
  });

  it('holds under a bad-usage turn: BOTH ledgers clamp identically, so they cannot drift apart', async () => {
    const { db, rowsFor } = makeFakeDb();
    await recordCloudUsage(env, db, {
      tenantId: TENANT_ID, cloudAgentRef: CLOUD_AGENT_REF, executionId: EXECUTION_ID, taskId: TASK_ID,
      model: 'm', inputTokens: Number.NaN, outputTokens: -50,
    });
    await recordCloudUsage(env, db, {
      tenantId: TENANT_ID, cloudAgentRef: CLOUD_AGENT_REF, executionId: EXECUTION_ID, taskId: TASK_ID,
      model: 'm', inputTokens: 100, outputTokens: 20,
    });
    const run = reconstruct({
      audit: rowsFor(toolAuditEvents),
      snapshots: rowsFor(usageSnapshots),
      ledger: rowsFor(llmUsageLog),
    }, EXECUTION_ID);
    expect(run.snapshotTotal).toBe(120);
    expect(run.ledgerTotal).toBe(run.snapshotTotal);
  });

  it('a snapshot write that fails does NOT leave the ledger silently ahead of nothing — both are attempted', async () => {
    // The two writes are independent (telemetry is best-effort), so the invariant a
    // reader can rely on is "same inputs, same clamp, same attribution" — asserted
    // above. Here we pin the weaker but load-bearing guarantee: a failing snapshot
    // never takes the billing ledger down with it, and vice versa.
    const attempted: string[] = [];
    const db = {
      insert: (table: unknown) => ({
        values: async () => {
          attempted.push(table === usageSnapshots ? 'snapshot' : table === llmUsageLog ? 'ledger' : 'other');
          throw new Error('db down');
        },
      }),
    } as unknown as Db;
    await expect(recordCloudUsage(env, db, {
      tenantId: TENANT_ID, executionId: EXECUTION_ID, taskId: TASK_ID, model: 'm',
      inputTokens: 10, outputTokens: 5,
    })).resolves.toBeUndefined();
    expect(attempted).toEqual(['snapshot', 'ledger']);
  });
});
