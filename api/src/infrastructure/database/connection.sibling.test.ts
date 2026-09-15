/**
 * The sibling-database resolution rules — see the module header on
 * `siblingDatabase`/`siblingDatabaseOf` for the full contract. Three facts
 * matter enough to pin here without a real Postgres:
 *
 *   • a sibling whose URL is UNBOUND is served by the core database — the
 *     rollout-in-progress / local / test default;
 *   • a sibling whose URL IS bound gets its own client, and the SAME one on
 *     every subsequent call for that core handle + role (memoised, so a
 *     sweep grouping work by database gets one statement per database rather
 *     than a fresh, ungroupable client per call);
 *   • a handle `buildDatabase` never built (a test double, or a sibling
 *     handle itself) is not in the env map at all, and resolves to itself —
 *     `siblingDatabaseOf` degrades to a no-op rather than throwing.
 *
 * No query ever runs — `buildDatabase`/`buildSibling` only construct the
 * Neon HTTP client, so this needs no database and no network.
 */
import { describe, expect, it } from 'vitest';
import { buildDatabase, siblingDatabase, siblingDatabaseOf } from './connection';
import type { Env } from '../../env';

const BASE_ENV = {
  NEON_DATABASE_URL: 'postgres://user:pass@core.neon.tech/core',
  CORS_ORIGINS: '',
  ENVIRONMENT: 'test',
} as unknown as Env;

describe('siblingDatabase / siblingDatabaseOf', () => {
  it('an unbound sibling URL resolves to the core handle', () => {
    const core = buildDatabase(BASE_ENV);
    expect(siblingDatabase(BASE_ENV, core, 'apps')).toBe(core);
    expect(siblingDatabaseOf(core, 'apps')).toBe(core); // same, through the env-lookup form
  });

  it('a bound sibling URL gives its own client, memoised across repeat calls', () => {
    const env = { ...BASE_ENV, NEON_APPS_DATABASE_URL: 'postgres://user:pass@apps.neon.tech/apps' } as Env;
    const core = buildDatabase(env);

    const first = siblingDatabase(env, core, 'apps');
    const second = siblingDatabase(env, core, 'apps');
    expect(first).not.toBe(core); // its own endpoint, not the core one
    expect(first).toBe(second); // memoised per core handle + role

    // `siblingDatabaseOf` reaches the same memoised handle through the env the
    // core handle remembers, with no env threaded in by the caller.
    expect(siblingDatabaseOf(core, 'apps')).toBe(first);
  });

  it('two roles bound on the same core handle get two DISTINCT sibling clients', () => {
    const env = {
      ...BASE_ENV,
      NEON_APPS_DATABASE_URL: 'postgres://user:pass@apps.neon.tech/apps',
      NEON_TRANSACTIONAL_DATABASE_URL: 'postgres://user:pass@ops.neon.tech/ops',
    } as Env;
    const core = buildDatabase(env);
    const apps = siblingDatabaseOf(core, 'apps');
    const operational = siblingDatabaseOf(core, 'operational');
    expect(apps).not.toBe(operational);
    expect(apps).not.toBe(core);
    expect(operational).not.toBe(core);
  });

  it('a handle buildDatabase never built resolves to itself — a test double degrades to a no-op', () => {
    const double = { select: () => undefined } as unknown as ReturnType<typeof buildDatabase>;
    expect(siblingDatabaseOf(double, 'apps')).toBe(double);
    expect(siblingDatabaseOf(double, 'operational')).toBe(double);
  });

  it('siblingDatabase with no env at all resolves to the core handle it was given', () => {
    const core = buildDatabase(BASE_ENV);
    expect(siblingDatabase(undefined, core, 'apps')).toBe(core);
  });
});
