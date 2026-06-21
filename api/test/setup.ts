/**
 * Shared Vitest setup (T9 · Platform · DB · CI steward — test isolation).
 *
 * The read-through cache's L1 layer is a module-global `Map` that lives for the
 * life of the isolate (see `infrastructure/cache/readThroughCache.ts`). Within a
 * single Vitest worker that means a key populated by one test can leak a stale hit
 * into a later test — the order-dependent failure seen in `cloudMemory.test.ts`
 * (an `am:recall:…` `[]` entry masked a later test's failing loader with `ok:true`).
 *
 * Resetting the L1 Map before every test makes cache-backed tests order-independent,
 * so they no longer have to hand-pick collision-free tenant/query/limit keys.
 *
 * Wired via `setupFiles` in `vitest.config.ts` — runs in every test file.
 */
import { beforeEach } from 'vitest';
import { __clearL1CacheForTests } from '../src/infrastructure/cache/readThroughCache';

beforeEach(() => {
  __clearL1CacheForTests();
});
