import { describe, expect, it } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { shipDirective, shipPolicyOf } from '@builderforce/run-guards';
import { TenantRole } from '../../domain/shared/types';
import { PR_MERGE_MIN_ROLE } from '../repos/prMergeAuthority';
import { claimMergeGrant, grantedShipPolicy, mergeGrantRefusal } from './mergeGrants';

describe('mergeGrantRefusal — PRD 48 §4.6: a merge grant is a PERSON\'s, with the in-product merge role', () => {
  it('refuses a call made on an agent\'s behalf', () => {
    expect(mergeGrantRefusal({ role: TenantRole.OWNER, agentActorRef: 'agent-1' })).toMatch(/only be given by a person/);
  });

  it('refuses a machine caller (an agent host, a run principal)', () => {
    expect(mergeGrantRefusal({ role: TenantRole.OWNER, machineActor: { agentHostId: 3 } })).toMatch(/only be given by a person/);
  });

  it('refuses a person below the in-product merge role', () => {
    expect(mergeGrantRefusal({ role: TenantRole.CONTRIBUTOR })).toMatch(/at least/);
    expect(mergeGrantRefusal({ role: TenantRole.VIEWER })).toMatch(/at least/);
  });

  it('accepts a person with the in-product merge role (the SAME tier as POST /pull-requests/:id/merge)', () => {
    expect(PR_MERGE_MIN_ROLE).toBe(TenantRole.DEVELOPER);
    expect(mergeGrantRefusal({ role: TenantRole.DEVELOPER })).toBeNull();
    expect(mergeGrantRefusal({ role: TenantRole.OWNER })).toBeNull();
  });
});

describe('claimMergeGrant — ONE merge per grant, atomically', () => {
  const dialect = new PgDialect();
  const updating = (returned: unknown[]) => {
    const seen: { where?: string; set?: unknown } = {};
    const db = {
      update: () => ({
        set: (s: unknown) => { seen.set = s; return { where: (w: SQL) => { seen.where = dialect.sqlToQuery(w).sql; return { returning: async () => returned }; } }; },
      }),
    } as never;
    return { db, seen };
  };

  it('claims only a grant that is neither consumed nor voided, in the UPDATE itself', async () => {
    const { db, seen } = updating([{ id: 'g-1' }]);
    expect(await claimMergeGrant(db, 4, 'g-1')).toBe(true);
    expect(seen.where).toContain('"merge_grants"."consumed_at" is null');
    expect(seen.where).toContain('"merge_grants"."voided_at" is null');
    expect(seen.where).toContain('"merge_grants"."tenant_id" = $');
  });

  it('a grant someone else already claimed is not claimed again', async () => {
    const { db } = updating([]);
    expect(await claimMergeGrant(db, 4, 'g-1')).toBe(false);
  });
});

describe('the run knows — grantedShipPolicy', () => {
  const base = { ...shipPolicyOf('pull_request', 'project_settings'), merge: 'never' as const };

  it('a granted run merges on green by a person\'s authority', () => {
    expect(grantedShipPolicy(base)).toMatchObject({ mode: 'pull_request', merge: 'on_green', source: 'person_grant' });
  });

  it('its cloud directive says a person authorized the merge, the platform merges on green, and the run must not merge or push', () => {
    const d = shipDirective(grantedShipPolicy(base), { host: 'cloud' });
    expect(d).toContain('A person authorized merging this pull request into main');
    expect(d).toContain('the platform merges it once the security scan and CI pass');
    expect(d).toContain('Never merge or push the base branch yourself');
    expect(d).toContain("a person's merge grant for this run");
    expect(d).not.toContain('open_pull_request');
  });
});
