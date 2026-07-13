/**
 * Atomic single-PR claim — race-free finalize (ROADMAP #26, migration 0140).
 *
 * Two finalize paths (the inline run-end finalize in runCloudToolLoop and the
 * Done-transition finalize in taskRoutes) can fire at the same instant for the
 * same ticket branch. The old guard was a read-time `github_pr_url IS NULL` check,
 * but the URL only exists AFTER the external PR-create returns — so both readers
 * saw NULL and both opened a PR (a DUPLICATE). `claimTaskPrOpen` is an atomic
 * conditional UPDATE that exactly ONE concurrent caller wins; the loser must not
 * call the provider. `releaseTaskPrClaim` clears the claim on a failed create so a
 * retry can re-attempt.
 *
 * We drive the real claim helpers against a tiny fake `tasks` table that models the
 * conditional-update WHERE semantics (claim only when prOpeningAt IS NULL AND
 * github_pr_url IS NULL) and assert the single-winner / release behavior.
 */
import { describe, expect, it } from 'vitest';
import { claimTaskPrOpen, releaseTaskPrClaim } from './openTaskPullRequest';
import type { Db } from '../../infrastructure/database/connection';

interface TaskRow {
  id: number;
  prOpeningAt: Date | null;
  githubPrUrl: string | null;
}

/**
 * Fake Db that supports the two update shapes the claim helpers use:
 *   db.update(tasks).set({ prOpeningAt }).where(...).returning(...)   (claim)
 *   db.update(tasks).set({ prOpeningAt: null }).where(...)            (release)
 * The WHERE predicate is opaque drizzle SQL we can't introspect, so we encode the
 * helpers' KNOWN predicates by inspecting the `set` payload: a non-null prOpeningAt
 * means "claim" (gate on both columns null), a null prOpeningAt means "release"
 * (gate on github_pr_url null). One row store keyed by the single task under test.
 */
function makeFakeDb(initial: TaskRow) {
  const row: TaskRow = { ...initial };
  const db = {
    update: () => ({
      set: (vals: Partial<TaskRow>) => {
        const isClaim = vals.prOpeningAt instanceof Date;
        const chain = {
          where: () => {
            if (isClaim) {
              // claim: gate on prOpeningAt IS NULL AND github_pr_url IS NULL
              const won = row.prOpeningAt == null && row.githubPrUrl == null;
              if (won) row.prOpeningAt = vals.prOpeningAt as Date;
              return {
                returning: async () => (won ? [{ id: row.id }] : []),
              };
            }
            // release: gate on github_pr_url IS NULL
            const released = row.githubPrUrl == null;
            if (released) row.prOpeningAt = null;
            return { catch: async () => undefined } as unknown as Promise<unknown>;
          },
        };
        return chain;
      },
    }),
  } as unknown as Db;
  return { db, row };
}

describe('claimTaskPrOpen', () => {
  it('grants the claim once, then denies a second concurrent caller', async () => {
    const { db, row } = makeFakeDb({ id: 7, prOpeningAt: null, githubPrUrl: null });

    const first = await claimTaskPrOpen(db, 7);
    expect(first).toBe(true);
    expect(row.prOpeningAt).toBeInstanceOf(Date); // claim stamped

    // A racing finalize path now finds the claim taken → must NOT open a PR.
    const second = await claimTaskPrOpen(db, 7);
    expect(second).toBe(false);
  });

  it('denies the claim when a PR URL already exists (PR already opened)', async () => {
    const { db } = makeFakeDb({ id: 9, prOpeningAt: null, githubPrUrl: 'https://x/pr/1' });
    expect(await claimTaskPrOpen(db, 9)).toBe(false);
  });
});

describe('releaseTaskPrClaim', () => {
  it('clears the claim after a failed create so a retry can re-claim', async () => {
    const { db, row } = makeFakeDb({ id: 7, prOpeningAt: null, githubPrUrl: null });

    expect(await claimTaskPrOpen(db, 7)).toBe(true);
    await releaseTaskPrClaim(db, 7);
    expect(row.prOpeningAt).toBeNull();

    // After release a fresh attempt can win the claim again.
    expect(await claimTaskPrOpen(db, 7)).toBe(true);
  });

  it('does not clear the claim once the PR is permanent (github_pr_url set)', async () => {
    const { db, row } = makeFakeDb({ id: 7, prOpeningAt: new Date(), githubPrUrl: 'https://x/pr/1' });
    await releaseTaskPrClaim(db, 7);
    expect(row.prOpeningAt).not.toBeNull(); // success is permanent — claim untouched
  });
});
