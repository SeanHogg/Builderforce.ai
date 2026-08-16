/**
 * The CACHED read of the public salary guide.
 *
 * ── WHY THIS IS A SEPARATE MODULE FROM `salaryDirectory.ts` ──────────────────
 * Everything else in `application/career/` is pure — no database, no network, no
 * clock, no Worker env — and `index.ts` re-exports the whole folder on that
 * promise. Caching needs `env`, so putting it in `salaryDirectory.ts` would have
 * broken the property the domain's own header states, and folding it into the
 * route instead is what the layering ratchet caught: a route may not reach into
 * `infrastructure/`.
 *
 * So the impure edge lives here, beside the pure functions it composes, and is
 * deliberately NOT part of `index.ts`'s barrel — importing `application/career`
 * still gets you only pure things.
 *
 * ── WHY IT IS CACHED AT ALL ─────────────────────────────────────────────────
 * The keyspace is BOUNDED and declared as data: sixteen roles × fourteen cities.
 * Every address is hit repeatedly by crawlers and readers, and the answer moves
 * only when the compensation anchors in `salaryDirectory.ts` are edited — which
 * is a deploy. A day's TTL is therefore longer than the data's real half-life,
 * not shorter, and there is nothing to invalidate on write because there are no
 * writes.
 */
import type { Env } from '../../env';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import {
  salaryCityGuide,
  salaryDirectory,
  salaryRoleGuide,
  type SalaryCity,
  type SalaryCityGuide,
  type SalaryRole,
  type SalaryRoleGuide,
} from './salaryDirectory';

/** A day: the anchors are edited in code, so a deploy is what actually moves these. */
const GUIDE_TTL_SECONDS = 86_400;

export function readSalaryDirectory(env: Env): Promise<{ roles: SalaryRole[]; cities: SalaryCity[] }> {
  return getOrSetCached(env, 'salary:directory', async () => salaryDirectory(), {
    kvTtlSeconds: GUIDE_TTL_SECONDS,
  });
}

export function readSalaryRoleGuide(env: Env, roleSlug: string): Promise<SalaryRoleGuide | null> {
  return getOrSetCached(env, `salary:role:${roleSlug}`, async () => salaryRoleGuide(roleSlug), {
    kvTtlSeconds: GUIDE_TTL_SECONDS,
  });
}

export function readSalaryCityGuide(env: Env, roleSlug: string, citySlug: string): Promise<SalaryCityGuide | null> {
  return getOrSetCached(env, `salary:city:${roleSlug}:${citySlug}`, async () => salaryCityGuide(roleSlug, citySlug), {
    kvTtlSeconds: GUIDE_TTL_SECONDS,
  });
}
