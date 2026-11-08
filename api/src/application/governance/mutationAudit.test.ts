import { beforeEach, describe, expect, it, vi } from 'vitest';

const recordActivity = vi.fn(async () => undefined);
vi.mock('../activity/activityLog', () => ({ recordActivity: (...a: unknown[]) => recordActivity(...(a as [])) }));

import { buildMutationAuditEnvelope, canonicalJson, mutationVerb, recordGovernanceMutation, rowDigest } from './mutationAudit';

const actor = { type: 'human' as const, ref: 'u1', name: 'Ada' };

beforeEach(() => recordActivity.mockClear());

describe('mutation audit envelope', () => {
  it('has exactly the one shared shape', async () => {
    const at = new Date('2026-11-08T10:00:00Z');
    const env = await buildMutationAuditEnvelope({
      actor, tenantId: 7, segmentId: 'seg-1', entity: 'vuln-scans', entityId: 'abc',
      action: 'update', before: { status: 'queued' }, after: { status: 'completed' }, at,
    });
    expect(Object.keys(env).sort()).toEqual(
      ['action', 'actor', 'after', 'at', 'before', 'entity', 'entityId', 'segmentId', 'tenantId'],
    );
    expect(env.at).toBe('2026-11-08T10:00:00.000Z');
    expect(env.before).toMatch(/^[0-9a-f]{64}$/);
    expect(env.after).toMatch(/^[0-9a-f]{64}$/);
    expect(env.before).not.toBe(env.after);
  });

  it('digests are key-order independent and null for an absent row', async () => {
    expect(canonicalJson({ b: 1, a: { d: 1, c: 2 } })).toBe(canonicalJson({ a: { c: 2, d: 1 }, b: 1 }));
    expect(await rowDigest({ a: 1, b: 2 })).toBe(await rowDigest({ b: 2, a: 1 }));
    expect(await rowDigest(null)).toBeNull();
  });

  it('create has no before digest, delete has no after digest', async () => {
    const c = await buildMutationAuditEnvelope({ actor, tenantId: 1, segmentId: null, entity: 'dsr', entityId: 1, action: 'create', after: { x: 1 } });
    const d = await buildMutationAuditEnvelope({ actor, tenantId: 1, segmentId: null, entity: 'dsr', entityId: 1, action: 'delete', before: { x: 1 } });
    expect(c.before).toBeNull();
    expect(c.entityId).toBe('1');
    expect(d.after).toBeNull();
  });

  it('is written to the audit store under governance.<entity>.<action> with the envelope in metadata', async () => {
    await recordGovernanceMutation(undefined, {} as never, {
      actor, tenantId: 7, segmentId: 'seg-1', entity: 'soc2-control', entityId: 'c1', action: 'update', before: { a: 1 }, after: { a: 2 },
    });
    expect(recordActivity).toHaveBeenCalledTimes(1);
    const input = (recordActivity.mock.calls[0] as unknown as [unknown, unknown, Record<string, any>])[2];
    expect(input.verb).toBe(mutationVerb('soc2-control', 'update'));
    expect(input.tenantId).toBe(7);
    expect(input.segmentId).toBe('seg-1');
    expect(input.metadata.envelope.entity).toBe('soc2-control');
  });

  it('never throws when the audit store does', async () => {
    recordActivity.mockRejectedValueOnce(new Error('db down'));
    await expect(recordGovernanceMutation(undefined, {} as never, {
      actor, tenantId: 1, segmentId: null, entity: 'x', entityId: 1, action: 'create',
    })).resolves.toBeUndefined();
  });
});
