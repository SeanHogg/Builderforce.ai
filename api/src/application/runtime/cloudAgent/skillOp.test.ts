/**
 * The `skill` container-op is how an image surface reaches skill authoring. What must
 * hold is that it is the SAME path the durable surface takes — the same tool
 * validation, the same `proposeSkill` writer, a draft stamped with THIS run's identity
 * — and that the relay module both images run actually maps the two tools onto it.
 *
 * The authoring service is deliberately NOT mocked: the proof that the op delegates to
 * it is the draft row it writes, observed through the database double.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fakeDb } from '../../../../test/fakeDb';
import { __clearL1CacheForTests } from '../../../infrastructure/cache/readThroughCache';
import type { Db } from '../../../infrastructure/database/connection';
import type { Env } from '../../../env';
import { OP_HANDLERS, type ContainerOpDeps } from './containerOps';
import { skillOp } from './skillOp';

const recordCloudToolEvent = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock('../cloudToolEvents', () => ({ recordCloudToolEvent: (...args: unknown[]) => recordCloudToolEvent(...args) }));
const reportCaughtError = vi.fn();
vi.mock('../../observability/caughtErrorReporter', () => ({ reportCaughtError: (...args: unknown[]) => reportCaughtError(...args) }));

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

const proposal = {
  slug: 'Add A Schema Column',
  name: 'Add a schema column',
  description: 'When a change needs a new column.',
  body: '1. Declare it. 2. Migrate. 3. Run the guards.',
  evidence: 'PR #12 merged green',
};

function depsFor(db: unknown, args: Record<string, unknown>): ContainerOpDeps {
  return {
    env: {} as Env, db: db as Db, args, executionId: 42, tenantId: 7, taskId: 9, projectId: 3,
    cloudAgentRef: 'agent-1', agentLabel: 'Builder', surface: 'container',
  } as unknown as ContainerOpDeps;
}

beforeEach(() => {
  __clearL1CacheForTests();
  recordCloudToolEvent.mockClear();
  reportCaughtError.mockClear();
});

describe('the `skill` container-op', () => {
  it('is registered in the op table the images post to', () => {
    expect(OP_HANDLERS.skill).toBe(skillOp);
  });

  it('proposes through the durable authoring service — a DRAFT stamped with this run', async () => {
    const db = fakeDb([[], []]);
    const r = await OP_HANDLERS.skill!(depsFor(db, { action: 'propose', ...proposal }));
    expect(r).toEqual({ status: 200, body: { ok: true, slug: 'add-a-schema-column', outcome: 'created' } });
    expect(db.calls.find((c) => c.kind === 'insert')?.payload).toMatchObject({
      tenantId: 7, projectId: 3, originExecutionId: 42, originTaskId: 9, authorLabel: 'Builder',
      status: 'draft', authorKind: 'agent', evidence: 'PR #12 merged green',
    });
    expect(recordCloudToolEvent).toHaveBeenCalledWith(db, expect.objectContaining({
      tenantId: 7, executionId: 42, toolName: 'skill_propose',
    }));
  });

  it('never lets the payload re-attribute the draft to another run or project', async () => {
    const db = fakeDb([[], []]);
    await skillOp(depsFor(db, {
      action: 'propose', ...proposal, projectId: 999, originExecutionId: 1, tenantId: 1, authorLabel: 'Someone',
    }));
    expect(db.calls.find((c) => c.kind === 'insert')?.payload).toMatchObject({
      tenantId: 7, projectId: 3, originExecutionId: 42, authorLabel: 'Builder',
    });
  });

  it('refuses an incomplete proposal with the tool\'s own error, without touching the database', async () => {
    const db = fakeDb([]);
    const r = await skillOp(depsFor(db, { action: 'propose', ...proposal, body: '   ' }));
    expect(r.body).toEqual({ ok: false, error: 'slug, name, description and body are all required' });
    expect(db.calls).toHaveLength(0);
  });

  it('refuses a non-string field rather than crashing the writer', async () => {
    const db = fakeDb([]);
    const r = await skillOp(depsFor(db, { action: 'propose', ...proposal, name: 42 }));
    expect(r.body).toMatchObject({ ok: false });
    expect(db.calls).toHaveLength(0);
  });

  it('refuses an unknown action before building anything', async () => {
    const db = fakeDb([]);
    const r = await skillOp(depsFor(db, { action: 'approve' }));
    expect(r.body).toEqual({ ok: false, error: "unknown skill action 'approve' (expected 'propose' or 'list')" });
    expect(db.calls).toHaveLength(0);
    expect(recordCloudToolEvent).not.toHaveBeenCalled();
  });

  it('lists the workspace skills through the same service, tenant-scoped', async () => {
    const row = {
      id: 's1', slug: 'ship-it', name: 'Ship it', description: 'When shipping.', body: 'Steps.', status: 'draft',
      projectId: null, authorKind: 'agent', authorLabel: null, evidence: null, originExecutionId: null,
      originTaskId: null, reviewedAt: null, reviewNote: null, updatedAt: new Date('2026-09-01T00:00:00Z'),
    };
    const db = fakeDb([[row]]);
    const r = await skillOp(depsFor(db, { action: 'list' }));
    expect(r.body).toEqual({
      ok: true, skills: [{ slug: 'ship-it', name: 'Ship it', description: 'When shipping.', status: 'draft' }],
    });
    expect(recordCloudToolEvent).toHaveBeenCalledWith(db, expect.objectContaining({ toolName: 'skill_list' }));
  });

  it('reports a failing write and answers the image with an ordinary tool failure', async () => {
    const db = fakeDb([new Error('db down')]);
    const r = await skillOp(depsFor(db, { action: 'propose', ...proposal }));
    expect(r).toEqual({ status: 200, body: { ok: false, error: 'db down' } });
    expect(reportCaughtError).toHaveBeenCalledTimes(1);
  });
});

describe('container/agentRelay.mjs — the skill arms both images run', () => {
  type Relay = { execRelayTool: (op: unknown, name: string, parsed: Record<string, unknown>, loop?: unknown) => Promise<unknown> };
  const loadRelay = async (): Promise<Relay> =>
    (await import(pathToFileURL(resolve(apiRoot, 'container/agentRelay.mjs')).href)) as Relay;

  it('maps skill_propose onto the `skill` op with action propose', async () => {
    const { execRelayTool } = await loadRelay();
    const op = vi.fn(async () => ({ ok: true, slug: 'add-a-schema-column', outcome: 'created' }));
    const r = await execRelayTool(op, 'skill_propose', { ...proposal });
    expect(op).toHaveBeenCalledWith('skill', { action: 'propose', ...proposal });
    expect(r).toEqual({ ok: true, slug: 'add-a-schema-column', outcome: 'created' });
  });

  it('maps skill_list onto the `skill` op with action list', async () => {
    const { execRelayTool } = await loadRelay();
    const op = vi.fn(async () => ({ ok: true, skills: [] }));
    await execRelayTool(op, 'skill_list', {});
    expect(op).toHaveBeenCalledWith('skill', { action: 'list' });
  });
});
