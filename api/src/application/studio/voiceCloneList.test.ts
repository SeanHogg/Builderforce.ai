import { describe, expect, it } from 'vitest';
import { listUsableClones } from './voiceCloneList';
import { toPublicClone } from '../../presentation/routes/studioVoiceCloneRoutes';
import { studioVoiceCloneLicenses, studioVoiceClones } from '../../infrastructure/database/schema';

/** Fake db: records each where() predicate so the test can see what filtered the clones. */
function fakeDb(rows: Map<unknown, unknown[]>) {
  const wheres: Array<{ table: unknown; where: unknown }> = [];
  const db = {
    select: () => {
      let table: unknown;
      let seen: unknown;
      const chain: Record<string, unknown> = {};
      chain.from = (t: unknown) => { table = t; return chain; };
      chain.where = (w: unknown) => { seen = w; wheres.push({ table, where: w }); return chain; };
      chain.orderBy = () => chain;
      chain.limit = () => chain;
      (chain as { then: unknown }).then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve(rows.get(table) ?? []).then(res, rej);
      void seen;
      return chain;
    },
  };
  return { db: db as never, wheres };
}

const foreign = {
  id: 50, tenantId: 999, userId: 'seller', ideProjectId: null, name: 'Seller voice', description: null,
  provider: 'p', referenceKey: 'k.wav', embedding: [1, 2], embeddingEnc: 'v2:secret', embeddingIv: 'ab',
  visibility: 'marketplace', status: 'published', priceMillicents: 5000, consentAttestedAt: new Date(),
  createdAt: new Date(), updatedAt: new Date(),
};

describe('listUsableClones', () => {
  it("regression: a voice licensed from ANOTHER tenant appears in the buyer's list, without its embedding", async () => {
    const { db, wheres } = fakeDb(new Map<unknown, unknown[]>([
      [studioVoiceClones, [foreign]],
      [studioVoiceCloneLicenses, [{ cloneId: 50 }]],
    ]));
    const list = await listUsableClones(db, 7);
    expect(list.map((c) => c.id)).toContain(50);
    // The licensed lookup is by license ids (acrossTenants), not by the buyer's tenant.
    expect(wheres.filter((w) => w.table === studioVoiceClones)).toHaveLength(2);

    const json = JSON.stringify(list.map(toPublicClone));
    expect(json).toContain('Seller voice');
    expect(json).not.toMatch(/embedding|v2:secret|k\.wav/);
  });

  it('skips the licensed lookup when the buyer holds no licenses', async () => {
    const { db, wheres } = fakeDb(new Map<unknown, unknown[]>([[studioVoiceClones, []]]));
    expect(await listUsableClones(db, 7)).toEqual([]);
    expect(wheres.filter((w) => w.table === studioVoiceClones)).toHaveLength(1);
  });
});
