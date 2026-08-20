import { describe, it, expect } from 'vitest';
import { evaluateWorkflowRunApprovalGate } from './workflowRunApproval';
import { approvalSubjectRef } from '../approval/approvalGate';
import type { Db } from '../../infrastructure/database/connection';

/**
 * Minimal Drizzle chain stub. The gate does exactly one read
 * (select→from→where→orderBy→limit) and at most one insert, so those are the only
 * two shapes it needs.
 */
function stubDb(rows: unknown[]) {
  const inserted: Array<Record<string, unknown>> = [];
  const db = {
    select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: () => Promise.resolve(rows) }) }) }) }),
    insert: () => ({ values: (v: Record<string, unknown>) => { inserted.push(v); return Promise.resolve(); } }),
  } as unknown as Db;
  return { db, inserted };
}

const definition = (approvalMode: string) => ({
  id: 'def-1',
  name: 'Publish the launch campaign',
  approvalMode,
  runTargetCloudAgentRef: 'cmo-t7',
});

const approval = (over: Record<string, unknown> = {}) => ({
  id: 'ap-1',
  status: 'pending',
  metadata: JSON.stringify({ workflowDefinitionId: 'def-1' }),
  expiresAt: new Date(Date.now() + 60_000),
  createdAt: new Date(),
  ...over,
});

describe('evaluateWorkflowRunApprovalGate', () => {
  /**
   * THE regression this whole slice exists for: the canvas offered
   * "Approval required" on every workflow card, nothing carried it to the server,
   * and the run started anyway. A gated definition must not start a run.
   */
  it('does not allow an unapproved run of a definition whose mode is required', async () => {
    const { db, inserted } = stubDb([]);
    const verdict = await evaluateWorkflowRunApprovalGate(db, 7, 'user-1', definition('required'));
    expect(verdict.allowed).toBe(false);
    // …and it opened a REAL approval, in the one approvals table, not a canvas-only marker.
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ actionType: 'workflow.run', status: 'pending', tenantId: 7 });
    expect(approvalSubjectRef(String(inserted[0]!.metadata), 'workflowDefinitionId')).toBe('def-1');
  });

  /** Without an expiry the sweep can never escalate it, so a gated workflow would
   *  block in silence forever. */
  it('gives the request an expiry so a forgotten approval escalates', async () => {
    const { db, inserted } = stubDb([]);
    await evaluateWorkflowRunApprovalGate(db, 7, 'user-1', definition('required'));
    expect(inserted[0]!.expiresAt).toBeInstanceOf(Date);
    expect((inserted[0]!.expiresAt as Date).getTime()).toBeGreaterThan(Date.now());
  });

  it('reuses an outstanding request rather than stacking duplicates', async () => {
    const { db, inserted } = stubDb([approval()]);
    const verdict = await evaluateWorkflowRunApprovalGate(db, 7, 'user-1', definition('required'));
    expect(verdict).toMatchObject({ allowed: false, approvalId: 'ap-1', opened: false });
    expect(inserted).toHaveLength(0);
  });

  it('allows the run once a human has approved it', async () => {
    const { db, inserted } = stubDb([approval({ status: 'approved' })]);
    const verdict = await evaluateWorkflowRunApprovalGate(db, 7, 'user-1', definition('required'));
    expect(verdict).toEqual({ allowed: true });
    expect(inserted).toHaveLength(0);
  });

  it('re-gates once the approval has expired', async () => {
    const { db, inserted } = stubDb([approval({ status: 'approved', expiresAt: new Date(Date.now() - 60_000) })]);
    const verdict = await evaluateWorkflowRunApprovalGate(db, 7, 'user-1', definition('required'));
    expect(verdict.allowed).toBe(false);
    expect(inserted).toHaveLength(1);
  });

  it('ignores an approval granted for a DIFFERENT definition', async () => {
    const other = approval({ status: 'approved', metadata: JSON.stringify({ workflowDefinitionId: 'def-2' }) });
    const { db, inserted } = stubDb([other]);
    const verdict = await evaluateWorkflowRunApprovalGate(db, 7, 'user-1', definition('required'));
    expect(verdict.allowed).toBe(false);
    expect(inserted).toHaveLength(1);
  });

  /**
   * 'autonomous' is the default and what every definition written before migration
   * 1092 has always meant, so it must not read the approvals table at all — a gate
   * on the ungated majority would be a query on every dispatch.
   */
  it('does not gate an autonomous definition, and does not query for one', async () => {
    const { db, inserted } = stubDb([approval()]);
    expect(await evaluateWorkflowRunApprovalGate(db, 7, 'user-1', definition('autonomous'))).toEqual({ allowed: true });
    expect(await evaluateWorkflowRunApprovalGate(db, 7, 'user-1', definition(''))).toEqual({ allowed: true });
    expect(inserted).toHaveLength(0);
  });
});
