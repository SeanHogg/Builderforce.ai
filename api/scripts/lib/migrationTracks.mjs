/**
 * THE migration tracks — one per Postgres database the API writes, declared ONCE.
 *
 * Every script that reads migrations (the runner, the migration guard, the
 * schema-drift guard, the prompt-tool-name guard) iterates this list, so a new
 * database is one entry here rather than a directory each script has to be taught
 * about separately — which is how the transactional track was added, file by file.
 *
 * A `sibling` track is a database split out of the primary. The Worker resolves it
 * through `src/infrastructure/database/connection.ts` and falls back to the primary
 * when its URL is unbound — which is why an `optional` track with no URL is SKIPPED
 * by the runner instead of applied to the primary: its tables already exist there,
 * and re-creating them would fail the deploy.
 *
 * `dir` is relative to `api/`. `label` is how the guards name the track in their
 * findings — the grandfathered drift allowlist matches those messages verbatim.
 */
export const MIGRATION_TRACKS = [
  { name: 'primary', label: 'PRIMARY', flag: null, env: 'NEON_DATABASE_URL', dir: 'migrations', sibling: false, optional: false },
  { name: 'transactional', label: 'OPERATIONAL', flag: '--transactional', env: 'NEON_TRANSACTIONAL_DATABASE_URL', dir: 'transactional-migrations', sibling: true, optional: false },
  { name: 'apps', label: 'APPS', flag: '--apps', env: 'NEON_APPS_DATABASE_URL', dir: 'apps-migrations', sibling: true, optional: true },
];

/** The track a runner invocation selects from its argv (no flag = primary). */
export function trackForArgv(argv) {
  return MIGRATION_TRACKS.find((t) => t.flag && argv.includes(t.flag)) ?? MIGRATION_TRACKS[0];
}

/** The split-out databases — every track but the primary. */
export const SIBLING_TRACKS = MIGRATION_TRACKS.filter((t) => t.sibling);
