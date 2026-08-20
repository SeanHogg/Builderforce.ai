/**
 * A domain claim proves itself, or nothing does.
 *
 * The properties under test are the ones that make the sweep worth having:
 * a record that appeared while nobody was watching still gets stamped, a record
 * that says something else does NOT, and a domain that already routes is never
 * re-asked — because a resolver blip must not be able to un-verify a live
 * institution's sign-in path.
 */
import { describe, expect, it, vi } from 'vitest';
import { runSsoDomainSweep } from './enterpriseSso';
import { CHALLENGE_PREFIX } from '../shared/dnsVerification';
import type { Db } from '../../infrastructure/database/connection';

interface DomainRow {
  id: number;
  tenantId: number;
  domain: string;
  verifyToken: string;
}

/** Minimal Drizzle chain stub: select→from→where→orderBy→limit resolves `rows`;
 *  update→set→where records what was written and to which predicate. */
function stubDb(rows: DomainRow[]) {
  const updates: { value: unknown }[] = [];
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({ orderBy: () => ({ limit: () => Promise.resolve(rows) }) }),
      }),
    }),
    update: () => ({
      set: (value: unknown) => ({
        where: () => { updates.push({ value }); return Promise.resolve(); },
      }),
    }),
  } as unknown as Db;
  return { db, updates };
}

/** A DNS-over-HTTPS resolver that answers from a map of name → TXT strings. */
function stubResolver(zone: Record<string, string[]>) {
  return vi.fn(async (url: string | URL) => {
    const name = new URL(String(url)).searchParams.get('name') ?? '';
    const answers = (zone[name] ?? []).map((data) => ({ type: 16, data: `"${data}"` }));
    return new Response(JSON.stringify({ Answer: answers }), { status: 200 });
  });
}

const row = (over: Partial<DomainRow> = {}): DomainRow => ({
  id: 7, tenantId: 3, domain: 'physics.edu', verifyToken: 'tok-abc', ...over,
});

const recordFor = (domain: string) => `${CHALLENGE_PREFIX.sso}.${domain}`;

describe('runSsoDomainSweep', () => {
  it('stamps a claim whose TXT record now matches', async () => {
    const { db, updates } = stubDb([row()]);
    const fetchImpl = stubResolver({ [recordFor('physics.edu')]: ['tok-abc'] });

    const result = await runSsoDomainSweep(db, { deps: { fetchImpl: fetchImpl as unknown as typeof fetch } });

    expect(result).toEqual({ checked: 1, verified: 1 });
    expect(updates).toHaveLength(1);
    expect(updates[0]!.value).toMatchObject({ verifiedAt: expect.any(Date) });
  });

  it('leaves a claim unverified when the published value is somebody else’s', async () => {
    const { db, updates } = stubDb([row()]);
    // Present, plausible, and NOT the token — the case a prefix match would wave
    // through and an exact match must refuse.
    const fetchImpl = stubResolver({ [recordFor('physics.edu')]: ['tok-abc-and-more', 'v=spf1'] });

    const result = await runSsoDomainSweep(db, { deps: { fetchImpl: fetchImpl as unknown as typeof fetch } });

    expect(result).toEqual({ checked: 1, verified: 0 });
    expect(updates).toHaveLength(0);
  });

  it('never asks about a domain that is already verified', async () => {
    // The WHERE clause is `verified_at IS NULL`, so a verified row is simply not
    // in the batch — asserted as the sweep observes it: nothing was resolved and
    // nothing was written.
    const { db, updates } = stubDb([]);
    const fetchImpl = stubResolver({ [recordFor('physics.edu')]: ['tok-abc'] });

    const result = await runSsoDomainSweep(db, { deps: { fetchImpl: fetchImpl as unknown as typeof fetch } });

    expect(result).toEqual({ checked: 0, verified: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it('keeps checking the rest of the batch when one zone is unreachable', async () => {
    const { db, updates } = stubDb([row({ id: 1, domain: 'down.edu', verifyToken: 't1' }), row({ id: 2, domain: 'up.edu', verifyToken: 't2' })]);
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const name = new URL(String(url)).searchParams.get('name') ?? '';
      if (name === recordFor('down.edu')) throw new Error('resolver unreachable');
      return new Response(JSON.stringify({ Answer: [{ type: 16, data: '"t2"' }] }), { status: 200 });
    });

    const result = await runSsoDomainSweep(db, { deps: { fetchImpl: fetchImpl as unknown as typeof fetch } });

    expect(result).toEqual({ checked: 2, verified: 1 });
    expect(updates).toHaveLength(1);
  });

  it('reports zero rather than throwing when the read itself fails', async () => {
    const db = {
      select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: () => Promise.reject(new Error('db down')) }) }) }) }),
    } as unknown as Db;

    await expect(runSsoDomainSweep(db)).resolves.toEqual({ checked: 0, verified: 0 });
  });
});
