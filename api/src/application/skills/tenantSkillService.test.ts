import { beforeEach, describe, expect, it } from 'vitest';
import { fakeDb, whereColumns } from '../../../test/fakeDb';
import { __clearL1CacheForTests } from '../../infrastructure/cache/readThroughCache';
import {
  buildSkillAuthoringCapability,
  proposeSkill,
  renderSkillBlock,
  reviewSkill,
  type TenantSkill,
} from './tenantSkillService';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

const env = {} as Env;
const proposal = {
  slug: 'Ship A Schema Change',
  name: 'Ship a schema change',
  description: 'When a change needs a new column.',
  body: '1. Declare it. 2. Write the migration. 3. Run the guards.',
};

beforeEach(() => __clearL1CacheForTests());

/**
 * GAP C1 — the invariant that makes agent-authored skills safe: an agent proposes,
 * a human disposes. These pin the write side of that.
 */
describe('proposeSkill', () => {
  it('creates a DRAFT, tenant-scoped, with the run stamped on it', async () => {
    const db = fakeDb([[], []]);
    const r = await proposeSkill(env, db as unknown as Db, 7, { ...proposal, originExecutionId: 42, originTaskId: 9 });
    expect(r).toMatchObject({ ok: true, slug: 'ship-a-schema-change', outcome: 'created' });
    const insert = db.calls.find((c) => c.kind === 'insert');
    expect(insert?.payload).toMatchObject({
      tenantId: 7,
      status: 'draft',
      authorKind: 'agent',
      originExecutionId: 42,
      originTaskId: 9,
    });
    expect(whereColumns(db.calls[0]?.where)).toContain('tenant_id');
  });

  it('revises an existing draft rather than accumulating near-duplicates', async () => {
    const db = fakeDb([[{ id: 'abc', status: 'draft' }], []]);
    const r = await proposeSkill(env, db as unknown as Db, 7, proposal);
    expect(r).toMatchObject({ ok: true, outcome: 'revised' });
    const update = db.calls.find((c) => c.kind === 'update');
    // A revision clears the prior review, so a reviewed-then-rewritten skill is not
    // still wearing someone's approval of different content.
    expect(update?.payload).toMatchObject({ status: 'draft', reviewedBy: null, reviewedAt: null });
  });

  it('refuses to reopen an APPROVED skill — that path is human-only', async () => {
    const db = fakeDb([[{ id: 'abc', status: 'approved' }]]);
    const r = await proposeSkill(env, db as unknown as Db, 7, proposal);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('already an approved skill');
    expect(db.calls.some((c) => c.kind === 'update' || c.kind === 'insert')).toBe(false);
  });

  it('rejects an incomplete proposal without touching the database', async () => {
    const db = fakeDb([]);
    const r = await proposeSkill(env, db as unknown as Db, 7, { ...proposal, body: '   ' });
    expect(r).toEqual({ ok: false, error: 'slug, name, description and body are all required' });
    expect(db.calls).toHaveLength(0);
  });
});

describe('reviewSkill', () => {
  it('is the writer that sets approved, and records who did it', async () => {
    const db = fakeDb([[{ id: 'abc', projectId: null, status: 'approved', slug: 's', name: 'n', description: 'd', body: 'b', authorKind: 'agent', authorLabel: null, evidence: null, originExecutionId: null, originTaskId: null, reviewedAt: new Date(), reviewNote: null, updatedAt: new Date() }]]);
    const r = await reviewSkill(env, db as unknown as Db, 7, 'abc', 'approved', { userId: 'u1', note: 'good' });
    expect(r.ok).toBe(true);
    expect(db.calls[0]?.payload).toMatchObject({ status: 'approved', reviewedBy: 'u1', reviewNote: 'good' });
  });

  it('reports a miss rather than pretending it approved something', async () => {
    const db = fakeDb([[]]);
    expect(await reviewSkill(env, db as unknown as Db, 7, 'nope', 'approved', { userId: 'u1' })).toEqual({
      ok: false,
      error: 'Skill not found',
    });
  });
});

describe('buildSkillAuthoringCapability', () => {
  it('stamps the run identity the model never supplies', async () => {
    const db = fakeDb([[], []]);
    const caps = buildSkillAuthoringCapability({
      env, db: db as unknown as Db, tenantId: 7, projectId: 3, executionId: 42, taskId: 9, agentLabel: 'Builder',
    });
    await caps.propose({ slug: 'x-y', name: 'X', description: 'd', body: 'b' });
    expect(db.calls.find((c) => c.kind === 'insert')?.payload).toMatchObject({
      tenantId: 7, projectId: 3, originExecutionId: 42, originTaskId: 9, authorLabel: 'Builder', status: 'draft',
    });
  });
});

describe('renderSkillBlock', () => {
  it('is empty with no approved skills, so callers inject unconditionally', () => {
    expect(renderSkillBlock([])).toBe('');
  });

  it('renders each approved skill with its name, slug and body', () => {
    const skill = { slug: 'ship-it', name: 'Ship it', description: 'When shipping.', body: 'Steps.' } as TenantSkill;
    const block = renderSkillBlock([skill]);
    expect(block).toContain('## Workspace Skills (approved procedures)');
    expect(block).toContain('### Ship it (ship-it)');
    expect(block).toContain('Steps.');
  });
});
