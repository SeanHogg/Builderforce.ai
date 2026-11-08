import { describe, expect, it } from 'vitest';
import { acquireFreeVoiceLicense, VoiceCloneLicensePaymentRequired } from './voiceLicenseService';
import { VoiceCloneNotFound } from './voiceCloneService';

function fakeDb(row: Record<string, unknown> | undefined) {
  const inserts: unknown[] = [];
  const db = {
    select: () => {
      const chain: Record<string, unknown> = {};
      chain.from = () => chain;
      chain.where = () => chain;
      chain.limit = () => Promise.resolve(row ? [row] : []);
      return chain;
    },
    insert: () => ({
      values: (v: unknown) => { inserts.push(v); return { onConflictDoNothing: () => Promise.resolve() }; },
    }),
  };
  return { db: db as never, inserts };
}

const listed = { id: 9, tenantId: 1, visibility: 'marketplace', status: 'published', priceMillicents: 0 };

describe('acquireFreeVoiceLicense', () => {
  it('grants a license on a free published marketplace voice', async () => {
    const { db, inserts } = fakeDb(listed);
    await acquireFreeVoiceLicense(db, { cloneId: 9, tenantId: 2, userId: 'u' });
    expect(inserts).toHaveLength(1);
  });

  it('refuses a priced voice, an unlisted one, and a missing one', async () => {
    await expect(acquireFreeVoiceLicense(fakeDb({ ...listed, priceMillicents: 500 }).db, { cloneId: 9, tenantId: 2, userId: 'u' }))
      .rejects.toBeInstanceOf(VoiceCloneLicensePaymentRequired);
    await expect(acquireFreeVoiceLicense(fakeDb({ ...listed, visibility: 'private' }).db, { cloneId: 9, tenantId: 2, userId: 'u' }))
      .rejects.toBeInstanceOf(VoiceCloneNotFound);
    await expect(acquireFreeVoiceLicense(fakeDb(undefined).db, { cloneId: 9, tenantId: 2, userId: 'u' }))
      .rejects.toBeInstanceOf(VoiceCloneNotFound);
  });

  it('a re-acquire over a REVOKED license reports license_revoked instead of a grant', async () => {
    let call = 0;
    const db = {
      select: () => {
        const chain: Record<string, unknown> = {};
        chain.from = () => chain;
        chain.where = () => chain;
        // 1st select = the clone, 2nd = the license row left behind by the revocation.
        chain.limit = () => Promise.resolve([call++ === 0 ? listed : { status: 'revoked' }]);
        return chain;
      },
      insert: () => ({ values: () => ({ onConflictDoNothing: () => Promise.resolve() }) }),
    };
    expect(await acquireFreeVoiceLicense(db as never, { cloneId: 9, tenantId: 2, userId: 'u' }))
      .toEqual({ applied: false, reason: 'license_revoked' });
  });

  it("is a no-op for the owner's own voice", async () => {
    const { db, inserts } = fakeDb(listed);
    await acquireFreeVoiceLicense(db, { cloneId: 9, tenantId: 1, userId: 'u' });
    expect(inserts).toHaveLength(0);
  });
});
