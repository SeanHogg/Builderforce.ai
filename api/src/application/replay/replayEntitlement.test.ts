/**
 * THE entitlement function (PRD 33 §6), both clauses: the Insights licence, and
 * (S4d, §5.3.1) a hosted site whose project carries a live, measured proof — which
 * is recorded with no install. The real `isProofSite` runs against a fake db.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_REPLAY_SITE_SETTINGS } from '@builderforce/interaction-contract';
import { fakeDb } from '../../../test/fakeDb';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import type { ReplaySiteRecord } from './replaySites';

const mocks = vi.hoisted(() => ({ licensed: false }));
vi.mock('../tenant/featureEntitlements', () => ({ tenantHasFeature: vi.fn(async () => mocks.licensed) }));

const { replayEntitledForSite } = await import('./replayEntitlement');

const env = {} as Env;

function site(over: Partial<ReplaySiteRecord> = {}): ReplaySiteRecord {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    tenantId: 7,
    kind: 'hosted',
    projectId: 42,
    label: 'Proof',
    apiKeyId: null,
    settings: { ...DEFAULT_REPLAY_SITE_SETTINGS },
    status: 'active',
    createdAt: '2026-10-01T00:00:00.000Z',
    ...over,
  };
}

beforeEach(() => { mocks.licensed = false; });

describe('replayEntitledForSite', () => {
  it('a licensed workspace is entitled without asking about proofs', async () => {
    mocks.licensed = true;
    const db = fakeDb([]);
    expect(await replayEntitledForSite(env, db as unknown as Db, site())).toBe(true);
    expect(db.calls).toHaveLength(0);
  });

  it('a proof site without a licence IS entitled — the project carries a live realization', async () => {
    const db = fakeDb([[{ id: 'real-1' }]]);
    expect(await replayEntitledForSite(env, db as unknown as Db, site({ id: '22222222-2222-4222-8222-222222222222' }))).toBe(true);
    expect(db.calls.map((c) => c.kind)).toEqual(['select']);
  });

  it('a hosted site whose project has no live proof, without a licence, is not entitled', async () => {
    const db = fakeDb([[]]);
    expect(await replayEntitledForSite(env, db as unknown as Db, site({ id: '33333333-3333-4333-8333-333333333333' }))).toBe(false);
  });

  it('an external site without a licence is never a proof site, and costs no query', async () => {
    const db = fakeDb([]);
    expect(await replayEntitledForSite(env, db as unknown as Db, site({ kind: 'external', projectId: null }))).toBe(false);
    expect(db.calls).toHaveLength(0);
  });

  it('caches the proof lookup per site', async () => {
    const id = '44444444-4444-4444-8444-444444444444';
    const db = fakeDb([[{ id: 'real-1' }]]);
    expect(await replayEntitledForSite(env, db as unknown as Db, site({ id }))).toBe(true);
    expect(await replayEntitledForSite(env, db as unknown as Db, site({ id }))).toBe(true);
    expect(db.calls).toHaveLength(1);
  });
});
