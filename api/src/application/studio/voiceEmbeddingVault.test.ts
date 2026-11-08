import { describe, expect, it } from 'vitest';
import {
  getOwnerEmbedding,
  openEmbedding,
  parseEmbedding,
  sealEmbedding,
  storeOwnerEmbeddingIfMissing,
} from './voiceEmbeddingVault';
import { VoiceCloneForbidden, VoiceCloneNotFound } from './voiceCloneService';
import { credentialSecret, encryptCredentials } from '../integrations/credentialCrypto';
import type { Env } from '../../env';

const env = { JWT_SECRET: 'test-secret' } as unknown as Env;
const EMB = [0.1, 0.2, 0.3];

type Row = Record<string, unknown>;

/**
 * Fake db: clone select → the row; membership select → `member` rows (keyed by the
 * table having a `role` column); update.set.where → merged into the row, and
 * `.returning()` yields a row only when the row is still empty (the conditional UPDATE).
 */
function fakeDb(row: Row | undefined, member: Row | undefined = undefined) {
  const updates: Row[] = [];
  const db = {
    select: () => {
      let isMember = false;
      const chain: Record<string, unknown> = {};
      chain.from = (t: object) => { isMember = 'role' in t; return chain; };
      chain.where = () => chain;
      chain.limit = () => Promise.resolve(isMember ? (member ? [member] : []) : (row ? [row] : []));
      return chain;
    },
    update: () => ({
      set: (v: Row) => ({
        where: () => {
          const wasEmpty = row ? !row.embeddingEnc && !row.embedding : false;
          if (row) updates.push(v);
          const apply = () => { if (row) Object.assign(row, v); };
          const result = {
            returning: () => {
              if (!wasEmpty) return Promise.resolve([]);
              apply();
              return Promise.resolve([{ id: row!.id }]);
            },
            then: (res: (x: unknown) => unknown) => { apply(); return Promise.resolve().then(() => res(undefined)); },
          };
          return result;
        },
      }),
    }),
  };
  return { db: db as never, updates };
}

async function sealedRow(over: Row = {}): Promise<Row> {
  const s = await sealEmbedding(env, 1, 7, EMB);
  return { id: 7, tenantId: 1, userId: 'owner', embedding: null, embeddingEnc: s.enc, embeddingIv: s.iv, ...over };
}

describe('voice embedding vault', () => {
  it('seals per tenant and per clone: round-trips only for the same tenant + clone', async () => {
    const s = await sealEmbedding(env, 1, 7, EMB);
    expect(s.enc.startsWith('v2:')).toBe(true);
    expect(s.enc).not.toContain('0.1');
    expect(await openEmbedding(env, 1, 7, s)).toEqual({ embedding: EMB, sampleRate: null });
    expect(await openEmbedding(env, 2, 7, s)).toBeNull();
  });

  it('a blob swapped onto another clone fails to open', async () => {
    const s = await sealEmbedding(env, 1, 7, EMB);
    expect(await openEmbedding(env, 1, 8, s)).toBeNull();
    // clone 8's row carrying clone 7's blob: neither the bound nor the unbound read opens it
    const { db } = fakeDb({ id: 8, tenantId: 1, userId: 'owner', embedding: null, embeddingEnc: s.enc, embeddingIv: s.iv });
    expect(await getOwnerEmbedding(db, env, { cloneId: 8, tenantId: 1, userId: 'owner' })).toBeNull();
  });

  it('refuses a non-v2 blob', async () => {
    expect(await openEmbedding(env, 1, 7, { enc: 'v1:AAAA', iv: '00' })).toBeNull();
  });

  it('owner gets the embedding', async () => {
    const { db } = fakeDb(await sealedRow());
    expect(await getOwnerEmbedding(db, env, { cloneId: 7, tenantId: 1, userId: 'owner' })).toEqual({ embedding: EMB, sampleRate: null });
  });

  it('does NOT open a blob sealed without the clone binding or with the raw credential secret', async () => {
    const old = await encryptCredentials({ embedding: EMB, sampleRate: null }, credentialSecret(env), 1);
    const { db, updates } = fakeDb({ id: 7, tenantId: 1, userId: 'owner', embedding: null, embeddingEnc: old.enc, embeddingIv: old.iv });
    expect(await getOwnerEmbedding(db, env, { cloneId: 7, tenantId: 1, userId: 'owner' })).toBeNull();
    expect(updates).toHaveLength(0);
  });

  it('parseEmbedding caps the length at 4096 and rejects NaN / Infinity / non-numeric entries', () => {
    expect(parseEmbedding(new Array(4096).fill(0.5))).toHaveLength(4096);
    expect(parseEmbedding(new Array(4097).fill(0.5))).toBeNull();
    expect(parseEmbedding([0.1, Number.NaN])).toBeNull();
    expect(parseEmbedding([0.1, Infinity])).toBeNull();
    expect(parseEmbedding([0.1, -Infinity])).toBeNull();
    expect(parseEmbedding([0.1, 'x'])).toBeNull();
    expect(parseEmbedding([0.1, null])).toBeNull();
    expect(parseEmbedding([])).toBeNull();
    expect(parseEmbedding([0.1, 0.2])).toEqual([0.1, 0.2]);
  });

  it('non-owner is refused (other tenant, other user) and missing clone is 404', async () => {
    const { db } = fakeDb(await sealedRow());
    await expect(getOwnerEmbedding(db, env, { cloneId: 7, tenantId: 2, userId: 'owner' })).rejects.toBeInstanceOf(VoiceCloneForbidden);
    await expect(getOwnerEmbedding(db, env, { cloneId: 7, tenantId: 1, userId: 'teammate' })).rejects.toBeInstanceOf(VoiceCloneForbidden);
    const { db: empty } = fakeDb(undefined);
    await expect(getOwnerEmbedding(empty, env, { cloneId: 7, tenantId: 1, userId: 'owner' })).rejects.toBeInstanceOf(VoiceCloneNotFound);
  });

  it('a clone with no owner user needs a tenant owner/manager, not any member', async () => {
    const row = await sealedRow({ userId: null });
    await expect(getOwnerEmbedding(fakeDb(row, undefined).db, env, { cloneId: 7, tenantId: 1, userId: 'member' }))
      .rejects.toBeInstanceOf(VoiceCloneForbidden);
    await expect(getOwnerEmbedding(fakeDb(row, undefined).db, env, { cloneId: 7, tenantId: 1, userId: null }))
      .rejects.toBeInstanceOf(VoiceCloneForbidden);
    expect(await getOwnerEmbedding(fakeDb(row, { id: 1, role: 'owner' }).db, env, { cloneId: 7, tenantId: 1, userId: 'boss' }))
      .toEqual({ embedding: EMB, sampleRate: null });
  });

  it('seals + nulls a legacy plaintext embedding on first owner fetch', async () => {
    const { db, updates } = fakeDb({ id: 7, tenantId: 1, userId: 'owner', embedding: EMB, embeddingEnc: null, embeddingIv: null });
    expect(await getOwnerEmbedding(db, env, { cloneId: 7, tenantId: 1, userId: 'owner' })).toEqual({ embedding: EMB, sampleRate: null });
    expect(updates[0]).toMatchObject({ embedding: null });
    expect(String(updates[0]?.embeddingEnc).startsWith('v2:')).toBe(true);
  });

  it('upload stores only when the server lacks one (atomic), never overwrites', async () => {
    const { db } = fakeDb({ id: 7, tenantId: 1, userId: 'owner', embedding: null, embeddingEnc: null, embeddingIv: null });
    expect(await storeOwnerEmbeddingIfMissing(db, env, { cloneId: 7, tenantId: 1, userId: 'owner', embedding: EMB })).toBe(true);
    expect(await storeOwnerEmbeddingIfMissing(db, env, { cloneId: 7, tenantId: 1, userId: 'owner', embedding: [9] })).toBe(false);
  });
});
