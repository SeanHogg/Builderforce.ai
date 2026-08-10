import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Locks the cache keys a marketplace hire/unhire must bust.
 *
 * The regression this guards: the two hire handlers hand-rolled their own
 * invalidation list, which had drifted from the agent create/delete one and
 * omitted `kanban:assignable:t:<tenant>`. A freshly-hired agent was therefore
 * missing from the role/ticket assignment picker until that key's TTL expired —
 * hire, then wait to assign. Both paths now share `invalidateHireCaches`, so
 * this asserts the KEY SET rather than any one call site.
 */

const invalidateCached = vi.fn(async () => {});
vi.mock('../../infrastructure/cache/readThroughCache', () => ({
  invalidateCached,
  getOrSetCached: vi.fn(async (_e: unknown, _k: string, _t: number, fn: () => unknown) => fn()),
}));

const { invalidateHireCaches } = await import('./workforceRoutes');

const env = {} as never;

beforeEach(() => invalidateCached.mockClear());

/** The keys passed to invalidateCached during ONE call (cleared first, so a test
 *  may invoke this twice and compare the two key sets independently). */
async function keysBustedBy(publicListing: boolean): Promise<string[]> {
  invalidateCached.mockClear();
  await invalidateHireCaches(env, 42, { publicListing });
  return invalidateCached.mock.calls.map((c) => (c as unknown as [unknown, string])[1]);
}

describe('invalidateHireCaches', () => {
  it('busts the assignable-workforce key so a hired agent is immediately pickable', async () => {
    expect(await keysBustedBy(true)).toContain('kanban:assignable:t:42');
  });

  it('busts every tenant-scoped roster read a hire changes', async () => {
    const keys = await keysBustedBy(true);
    expect(keys).toEqual(expect.arrayContaining([
      'wf:purchased:42',            // the buyer's purchased list
      'kanban:assignable:t:42',     // the role/ticket assignment picker
    ]));
    // The hovercard profiles the picker reads must go too, else a newly
    // pickable agent renders with no profile behind it.
    expect(keys.some((k) => k.includes('42'))).toBe(true);
    expect(keys.length).toBeGreaterThanOrEqual(4);
  });

  it('busts the shared public listing only on a real hire-count transition', async () => {
    // hire_count drives the public listing's ordering and only moves on a true
    // inactive→active hire. A redundant re-hire (or any unhire, since hire_count
    // is cumulative) must NOT bust a cache every tenant shares.
    expect(await keysBustedBy(true)).toContain('wf:public:agents');
    expect(await keysBustedBy(false)).not.toContain('wf:public:agents');
  });
});
