/**
 * Cloud agent telemetry / log population — end-to-end-ish unit coverage.
 *
 * A cloud run is observable only if every telemetry write actually lands a row:
 *   • recordCloudToolEvent    → tool_audit_events (the Observability timeline)
 *   • recordCloudUsage        → usage_snapshots  AND  llm_usage_log (billing ledger)
 *   • emitModelSelection      → a `model.select`  planning event (why this model)
 *   • emitCodingModelDegraded → a `coding_model_degraded` llm event (only when degraded)
 *
 * These previously had no coverage, so a silent drop (wrong table, missing
 * cloud attribution, an unguarded throw) would make a run invisible on the
 * timeline and absent from the cost ledger without failing anything. We drive
 * the real telemetry functions against a tiny fake `Db` that captures every
 * insert and assert the rows are populated with the right shape + attribution.
 */
import { describe, expect, it, vi } from 'vitest';

// Keep recordUsageRow's catalog pricing read off the network — cost prices to 0,
// which is irrelevant to "did the row get written with the right attribution".
vi.mock('../llm/modelCatalog', () => ({ getCatalogCached: async () => [] }));

import {
  recordCloudToolEvent,
  recordCloudUsage,
  emitModelSelection,
  emitCodingModelDegraded,
} from './cloudAgentEngine';
import { CODING_MODEL_POOL, CODING_BACKSTOP_MODELS } from '../llm/LlmProxyService';
import { toolAuditEvents, usageSnapshots, llmUsageLog } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

interface Insert {
  table: unknown;
  row: Record<string, unknown>;
}

/** Fake Db that records every `db.insert(table).values(row)` so a test can assert
 *  which table got which row. Matches the drizzle insert(...).values(...) chain. */
function makeFakeDb() {
  const inserts: Insert[] = [];
  const db = {
    insert: (table: unknown) => ({
      values: async (row: Record<string, unknown>) => {
        inserts.push({ table, row });
      },
    }),
  } as unknown as Db;
  const rowsFor = (table: unknown) => inserts.filter((i) => i.table === table).map((i) => i.row);
  return { db, inserts, rowsFor };
}

const env = {} as Env;

describe('recordCloudToolEvent → tool_audit_events', () => {
  it('lands one timeline row keyed to the execution with full attribution', async () => {
    const { db, rowsFor } = makeFakeDb();

    await recordCloudToolEvent(db, {
      tenantId: 1,
      cloudAgentRef: 'agent-x',
      executionId: 42,
      toolName: 'write_file',
      category: 'code_edit',
      toolCallId: 'call_1',
      detail: { path: 'src/a.ts' },
      result: 'ok',
      durationMs: 12,
    });

    const rows = rowsFor(toolAuditEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenantId: 1,
      agentHostId: null,               // cloud runs are NOT host-attributed
      cloudAgentRef: 'agent-x',
      executionId: 42,
      sessionKey: 'exec:42',           // the per-run timeline correlation key
      toolCallId: 'call_1',
      toolName: 'write_file',
      category: 'code_edit',
      result: 'ok',
      durationMs: 12,
    });
    // detail is JSON-serialized into the args column.
    expect(JSON.parse(rows[0]!.args as string)).toEqual({ path: 'src/a.ts' });
    expect(rows[0]!.ts).toBeInstanceOf(Date);
  });

  it('is best-effort: a DB failure never throws (telemetry must not break the run)', async () => {
    const db = {
      insert: () => ({ values: async () => { throw new Error('db down'); } }),
    } as unknown as Db;

    await expect(
      recordCloudToolEvent(db, { tenantId: 1, executionId: 7, toolName: 'finish', category: 'tool' }),
    ).resolves.toBeUndefined();
  });
});

describe('recordCloudUsage → usage_snapshots AND llm_usage_log', () => {
  it('writes BOTH ledgers so the trace view and the billing log reconcile', async () => {
    const { db, rowsFor } = makeFakeDb();

    await recordCloudUsage(env, db, {
      tenantId: 1,
      cloudAgentRef: 'agent-x',
      executionId: 42,
      taskId: 7,
      projectId: 3,
      model: 'anthropic/claude-sonnet-4-6',
      inputTokens: 100,
      outputTokens: 40,
    });

    // 1) Per-execution trace snapshot.
    const snap = rowsFor(usageSnapshots);
    expect(snap).toHaveLength(1);
    expect(snap[0]).toMatchObject({
      tenantId: 1,
      agentHostId: null,
      cloudAgentRef: 'agent-x',
      executionId: 42,
      sessionKey: 'exec:42',
      inputTokens: 100,
      outputTokens: 40,
      contextTokens: 140,            // input + output
    });

    // 2) Canonical billing ledger row, tagged with the cloud dimensions so cost
    //    can be split cloud-vs-on-prem and rolled up ticket → project → account.
    const usage = rowsFor(llmUsageLog);
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({
      tenantId: 1,
      model: 'anthropic/claude-sonnet-4-6',
      promptTokens: 100,
      completionTokens: 40,
      totalTokens: 140,
      agentHostId: null,
      cloudAgentRef: 'agent-x',
      executionId: 42,
      taskId: 7,
      projectId: 3,
    });
    // engine marker lets a query distinguish cloud spend from web/SDK spend.
    expect(JSON.parse(usage[0]!.metadata as string)).toMatchObject({
      engine: 'cloud',
      executionId: 42,
      taskId: 7,
      projectId: 3,
    });
  });

  it('attributes gateway-default runs (no named cloud agent) with a null ref, still logged', async () => {
    const { db, rowsFor } = makeFakeDb();

    await recordCloudUsage(env, db, {
      tenantId: 1,
      executionId: 9,
      taskId: 4,
      model: 'google/gemini-2.0-flash',
      inputTokens: 10,
      outputTokens: 5,
    });

    expect(rowsFor(usageSnapshots)[0]).toMatchObject({ cloudAgentRef: null, executionId: 9 });
    expect(rowsFor(llmUsageLog)[0]).toMatchObject({ cloudAgentRef: null, executionId: 9, taskId: 4, projectId: null });
  });
});

describe('emitModelSelection → model.select planning event', () => {
  it('records WHY a run is on its model (strict pin)', async () => {
    const { db, rowsFor } = makeFakeDb();
    const seed = CODING_MODEL_POOL[0]!;

    await emitModelSelection(db, {
      tenantId: 1,
      cloudAgentRef: 'agent-x',
      executionId: 42,
      requested: seed,
      pick: { model: seed, strict: true },
      plan: 'pro',
      premium: true,
    });

    const rows = rowsFor(toolAuditEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      executionId: 42,
      toolName: 'model.select',
      category: 'planning',
      sessionKey: 'exec:42',
    });
    const detail = JSON.parse(rows[0]!.args as string);
    expect(detail).toMatchObject({ pin: 'strict', seed, seedIsCoder: true, plan: 'pro' });
    expect(rows[0]!.result).toContain('Pinned');
  });

  it('flags a soft seed onto a non-coder so triage can see a weak run coming', async () => {
    const { db, rowsFor } = makeFakeDb();

    await emitModelSelection(db, {
      tenantId: 1,
      executionId: 11,
      requested: undefined,                          // dispatched as gateway-default
      pick: { model: 'google/gemini-2.0-flash', strict: false },
      plan: 'free',
      premium: false,
    });

    const detail = JSON.parse(rowsFor(toolAuditEvents)[0]!.args as string);
    expect(detail).toMatchObject({ pin: 'soft', seedIsCoder: false });
  });
});

describe('emitCodingModelDegraded → coding_model_degraded llm event', () => {
  it('emits a degradation event when a coding turn fell through to a non-coder backstop', async () => {
    const { db, rowsFor } = makeFakeDb();
    const backstop = CODING_BACKSTOP_MODELS[CODING_BACKSTOP_MODELS.length - 1]!;

    await emitCodingModelDegraded(db, {
      tenantId: 1,
      cloudAgentRef: 'agent-x',
      executionId: 42,
      resolvedModel: backstop,
      requestedModel: CODING_MODEL_POOL[0],
    });

    const rows = rowsFor(toolAuditEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      executionId: 42,
      toolName: 'coding_model_degraded',
      category: 'llm',
    });
    expect(JSON.parse(rows[0]!.args as string)).toMatchObject({ resolvedModel: backstop });
  });

  it('is a no-op when the run was served by a curated coder (nothing to flag)', async () => {
    const { db, rowsFor } = makeFakeDb();

    await emitCodingModelDegraded(db, {
      tenantId: 1,
      executionId: 42,
      resolvedModel: CODING_MODEL_POOL[0],
      requestedModel: CODING_MODEL_POOL[0],
    });

    expect(rowsFor(toolAuditEvents)).toHaveLength(0);
  });
});

// ── Defensive boundaries: inject wrong/hostile values, prove a run never breaks ──
// Telemetry is best-effort: a malformed input or a dead DB must degrade to "no
// row" or "verbatim row", NEVER a throw that aborts the agent run it instruments.
describe('cloud telemetry — defensive boundaries', () => {
  it('recordCloudToolEvent swallows a non-serializable detail (circular ref) — no row, no throw', async () => {
    const { db, rowsFor } = makeFakeDb();
    const circular: Record<string, unknown> = {};
    circular.self = circular; // JSON.stringify will throw on this

    await expect(
      recordCloudToolEvent(db, { tenantId: 1, executionId: 5, toolName: 'x', category: 'tool', detail: circular }),
    ).resolves.toBeUndefined();
    // The stringify throw happens INSIDE the guarded insert, so nothing lands —
    // but the run is not taken down with it.
    expect(rowsFor(toolAuditEvents)).toHaveLength(0);
  });

  it('recordCloudToolEvent tolerates a hostile/degenerate executionId without throwing', async () => {
    const { db, rowsFor } = makeFakeDb();
    await expect(
      recordCloudToolEvent(db, { tenantId: 1, executionId: Number.NaN, toolName: 'x', category: 'tool' }),
    ).resolves.toBeUndefined();
    // Defensive contract is "never throw"; the key is still derived deterministically.
    expect(rowsFor(toolAuditEvents)[0]).toMatchObject({ sessionKey: 'exec:NaN' });
  });

  it('recordCloudUsage never throws even when BOTH ledger inserts fail', async () => {
    const db = { insert: () => ({ values: async () => { throw new Error('db down'); } }) } as unknown as Db;
    await expect(
      recordCloudUsage(env, db, { tenantId: 1, executionId: 9, taskId: 1, model: 'm', inputTokens: 10, outputTokens: 5 }),
    ).resolves.toBeUndefined();
  });

  it('recordCloudUsage tolerates non-finite / negative token counts (best-effort, no crash)', async () => {
    const { db, rowsFor } = makeFakeDb();
    await expect(
      recordCloudUsage(env, db, {
        tenantId: 1, executionId: 9, taskId: 1, model: 'm',
        inputTokens: Number.NaN, outputTokens: -3,
      }),
    ).resolves.toBeUndefined();
    // The run is never blocked on bad usage numbers — both ledgers are still attempted.
    expect(rowsFor(usageSnapshots)).toHaveLength(1);
    expect(rowsFor(llmUsageLog)).toHaveLength(1);
  });

  it('emitModelSelection does not throw on an unknown plan + blank model', async () => {
    const { db, rowsFor } = makeFakeDb();
    await expect(
      emitModelSelection(db, {
        tenantId: 1, executionId: 9,
        requested: undefined,
        pick: { model: '', strict: false },
        plan: 'garbage-plan' as never, // wrong value injected past the type system
        premium: false,
      }),
    ).resolves.toBeUndefined();
    // A blank seed is NOT a curated coder, and the planning row is still emitted.
    const detail = JSON.parse(rowsFor(toolAuditEvents)[0]!.args as string);
    expect(detail.seedIsCoder).toBe(false);
  });

  it('emitCodingModelDegraded is a strict no-op for junk/sentinel resolved models (no false alarm)', async () => {
    const { db, rowsFor } = makeFakeDb();
    for (const m of [undefined, '', 'default', 'default'] as Array<string | undefined>) {
      await emitCodingModelDegraded(db, { tenantId: 1, executionId: 9, resolvedModel: m, requestedModel: undefined });
    }
    // "unknown" must never be reported as "degraded" — that would be a false alarm.
    expect(rowsFor(toolAuditEvents)).toHaveLength(0);
  });
});
