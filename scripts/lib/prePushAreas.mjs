/**
 * The pre-push check's area table: ONE data row per area, no per-area branches in the runner.
 *
 *   id          label printed in front of each check
 *   dir         working directory, relative to the repo root
 *   flag        the `affectedBuilds` output (.github/scripts/affected-builds.mjs) that must be true; omit when none exists
 *   watch       path tokens of which at least one changed file is also required (omit: the flag alone decides)
 *   relatedFrom path tokens whose changed source files feed the related-test selection (default ['@self'])
 *   related     'vitest' (default): `vitest related <files>`. 'nearby': `vitest run` over the tests that import a changed
 *               file within two hops, found by scanning imports — `related` transforms EVERY test file's import graph
 *               before choosing (see lib/prePushRelated.mjs), which took 16 to 19 minutes on api's ~520 files.
 *   vitest      argv prefix of the runner (default `vitest` from <dir>/node_modules); vitestArgs: extra args
 *   needsInstall dirs whose pnpm install should be current (default [dir]); a stale or missing install is a WARNING and the
 *               area's tasks become `soft` (their failures warn instead of blocking)
 *   testTimeout seconds for this area's vitest tasks (default 150); hitting it is a warning
 *   timeout     seconds per task (default 240); a timed-out task is a warning, not a failure
 *   guards      argv of the guard suite
 *   typecheck   { script } (a package.json script, split on `&&`) or { steps } (argv list), optional { before } steps,
 *               { advisory: true } when CI does not run it: a failure prints WARN and leaves the exit code alone
 *   extras      { name, cmd, when?, optIn? } more checks. `when`: regex over dir-relative changed non-test source paths;
 *               `optIn`: a CLI flag (e.g. 'lint', 'perf') that must be present; `--tests` never enables an opt-in extra
 *
 * Path tokens: '@self' = dir, '@shared' = the source-linked packages (packages/*, webdit/torch), '@upstream' = the
 * packages this one links or aliases (transitively, from package.json links and tsconfig paths), '*' = every changed file,
 * anything else = a repo-relative path prefix. Commands are argv arrays run WITHOUT a shell; `node` is this node, other
 * names resolve through <dir>/node_modules (tsc, vitest, next, ...). Each row mirrors the CI job named beside it.
 */
const FRONTEND_NODE = (script, ...args) => ['node', `../../frontend/node_modules/${script}`, ...args];
const FRONTEND_TSC = { steps: [FRONTEND_NODE('typescript/lib/tsc.js', '--noEmit', '-p', 'tsconfig.json')], advisory: true };
const FRONTEND_VITEST = FRONTEND_NODE('vitest/vitest.mjs');
const RUN_CHECKS = ['node', '../scripts/run-checks.mjs', 'scripts/checks.manifest.mjs'];
const kernel = (id, typecheck) => ({
  id, dir: `packages/${id}`, flag: 'kernel', watch: ['@self', '@upstream'], relatedFrom: ['@self', '@upstream'], typecheck,
});

export const AREAS = [
  // Verify API (guard matrix + type-check + vitest)
  {
    id: 'api', dir: 'api', flag: 'api', relatedFrom: ['@self', '@shared'], related: 'nearby',
    guards: RUN_CHECKS, typecheck: { script: 'type-check' },
  },
  // Verify frontend (type-check after `next typegen`, lint, guards)
  {
    id: 'frontend', dir: 'frontend', flag: 'frontend', relatedFrom: ['@self', '@shared'],
    guards: RUN_CHECKS, typecheck: { before: [['next', 'typegen']], script: 'type-check' },
    extras: [{ name: 'lint', cmd: ['next', 'lint'], optIn: 'lint' }],
  },
  // Verify VS Code extension (type-check, test). Bundles shared packages from source: every changed file feeds `related`.
  { id: 'vscode', dir: 'clients/vscode', flag: 'extension', relatedFrom: ['@self', '*'], typecheck: { script: 'type-check' } },
  // Verify frontend > "guards + brain-ui + knowledge-graph-view": CI runs the suite only, so the typecheck is advisory.
  {
    id: 'knowledge-graph-view', dir: 'packages/knowledge-graph-view', watch: ['@self'], needsInstall: ['frontend'],
    typecheck: FRONTEND_TSC, vitest: FRONTEND_VITEST, vitestArgs: ['--config', 'vitest.config.ts'],
    // The deterministic perf gate: any non-test source change under src/ can move it.
    extras: [{ name: 'perf gate', optIn: 'perf', when: /^src\//, cmd: [...FRONTEND_VITEST, 'run', '--config', 'vitest.config.ts', 'src/perf/deterministic/deterministic.test.ts'] }],
  },
  { id: 'brain-ui', dir: 'packages/brain-ui', flag: 'verify-frontend', watch: ['@self'], typecheck: { script: 'typecheck', advisory: true } },
  // Verify kernel package (matrix). CI typechecks only run-delta there.
  kernel('agent-run', { script: 'typecheck', advisory: true }),
  kernel('agent-tools', { script: 'typecheck', advisory: true }),
  kernel('run-delta', { script: 'typecheck' }),
  kernel('run-guards'), // no typecheck script and no local tsc: CI runs its tests only
  kernel('agent-loop'),
];
