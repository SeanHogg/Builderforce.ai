import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

/**
 * A COLUMN MISSING FROM AN UPDATE `set` IS INVISIBLE TO EVERY OTHER KIND OF TEST.
 *
 * `executions.produced` (0385) is the autonomy breaker's productivity signal: without it
 * a run that completes and ships nothing resets the streak, and the executor's only
 * stopping condition is failure again (measured: 5,931 completed runs, 10 failures, 3
 * finished tickets in one day).
 *
 * It reached the domain, the repository's row→entity mapper and `markProduced()` — and
 * NOT the `set` in `update()`. That is a silent no-op: the value round-trips through the
 * aggregate, every other column is written, and `toDomain(updated)` reads the unchanged
 * database value straight back. Nothing catches it:
 *   • the type checker cannot — drizzle's `set` takes a Partial, so an absent key is legal;
 *   • the service tests cannot — they inject a fake repository (`update: async (e) => e`),
 *     which is exactly the shape that makes the round-trip look successful.
 *
 * So the guard has to read the source of the write itself.
 */
describe('ExecutionRepository.update persists the fields the domain can change', () => {
  const source = readFileSync(
    fileURLToPath(new URL('./ExecutionRepository.ts', import.meta.url).href),
    'utf8',
  );
  const updateSet = source.slice(source.indexOf('async update('), source.indexOf('.where(eq(executionsTable.id, plain.id))'));

  it('writes `produced` — the autonomy breaker reads nothing else', () => {
    expect(updateSet, 'produced must be in the update set, or markProduced() is a no-op')
      .toMatch(/produced:\s*plain\.produced/);
  });

  /**
   * `?? undefined` is load-bearing in BOTH directions: drizzle omits an undefined key, so
   * `null` (not judged) must never overwrite a verdict `finalizeCloudRun` already wrote —
   * while `false` (a real "this run shipped nothing") must still be persisted, which it
   * is, because `false ?? undefined` is `false`.
   */
  it('does not let an UNJUDGED run erase a verdict that was already stamped', () => {
    expect(updateSet).toMatch(/produced:\s*plain\.produced \?\? undefined/);
    // The coalesce is what makes that true, and it must stay a coalesce: a plain
    // `plain.produced` would send `null` to drizzle as an explicit NULL write and erase
    // the verdict finalize stamped, while `plain.produced || undefined` would swallow
    // `false` — the one value that actually arms the breaker.
    const coalesce = (produced: boolean | null): boolean | undefined => produced ?? undefined;
    expect(coalesce(false), 'a run that shipped nothing must be persisted').toBe(false);
    expect(coalesce(null), 'an unjudged run must be omitted from the write').toBeUndefined();
    expect(coalesce(true)).toBe(true);
  });

  it('still writes the terminal fields it always did', () => {
    for (const field of ['status', 'result', 'errorMessage', 'startedAt', 'completedAt']) {
      expect(updateSet, `${field} must stay in the update set`).toContain(`${field}:`);
    }
  });
});
