/**
 * The guards `npm test` runs before vitest, as [reporting name, script, ...args].
 * Paths are relative to this file. Run by `../scripts/run-checks.mjs`, which owns
 * the concurrency and the exit contract.
 *
 * This is the ONLY list — `npm test` calls the runner rather than restating the
 * chain, so adding a guard is one line here.
 */
export default [
  // Repo-level rather than api's own: the source-only package graph spans every
  // toolchain in the repository, and this is the gate every change goes through.
  // The guard derives its own repo root, so the cwd it runs from does not matter.
  ['check:source-package-graph', '../../scripts/check-source-package-graph.mjs'],
  // Also repo-level: a package nobody depends on directly is held at one version by
  // an `overrides` entry per project, and the version itself lives in exactly one
  // file. Without this, the number is copied into a manifest per project and the
  // projects that carry the package transitively — with no entry at all — are
  // invisible. See scripts/pinnedDependencies.mjs.
  ['check:pinned-deps', '../../scripts/check-pinned-deps.mjs'],
  ['check:schema', 'check-schema-drift.mjs'],
  ['check:db-access', 'check-db-access.mjs'],
  ['check:migrations', 'check-migrations.mjs'],
  ['check:swept-tables', 'check-swept-tables.mjs'],
  ['check:signature-duplication', 'check-signature-duplication.mjs'],
  ['check:shape-lint', 'check-shape-lint.mjs'],
  ['check:tenant-column', 'check-tenant-column.mjs'],
  ['check:polymorphic-fk', 'check-polymorphic-fk.mjs'],
  ['check:domain-boundary', 'check-domain-boundary.mjs'],
  // Two at-rest credential chains, one owner each. Using the wrong one does not
  // throw — it derives a different key and the row will not open — so it is a guard.
  ['check:credential-secret', 'check-credential-secret.mjs'],
  ['check:domain-root-table', 'check-domain-root-table.mjs'],
  ['check:model-coverage', 'check-model-coverage.mjs'],
  ['check:table-adoption', 'check-table-adoption.mjs'],
  ['check:layering', 'check-layering.mjs'],
  ['check:application-layering', 'check-application-layering.mjs'],
  // ONE wire format, declared twice on purpose (agent-runtime takes no runtime
  // dependency on the Worker package). This fails the build the moment the two
  // hand-written declarations disagree.
  ['check:api-contract-mirror', 'check-api-contract-mirror.mjs'],
  ['check:project-ownership', 'check-project-ownership.mjs'],
  ['check:tenant-scope', 'check-tenant-scope.mjs'],
  ['check:source', 'check-source-text.mjs'],
  // Repo-level: ONE silent-catch guard scans every package's source tree against
  // the shared baseline in scripts/silent-catches.baseline.json. api's chain runs
  // the full sweep; frontend's runs only its own tree for fast local feedback.
  ['check:silent-catches', '../../scripts/check-silent-catches.mjs'],
  // Per-file ratchet over raw `c.req.json` reads; parseBody (requestBody.ts) is the
  // one validated read. Seeded 2026-09-06; the counts can only fall.
  ['check:unvalidated-bodies', 'check-unvalidated-bodies.mjs'],
  ['check:dispatch-budget', 'check-dispatch-budget.mjs'],
  ['check:pinned-defects', 'check-pinned-defects.mjs'],
  ['check:prompt-tools', 'check-prompt-tool-names.mjs'],
  ['check:canvas-tools', 'check-canvas-tool-contract.mjs'],
  // The Actions runner inlines a COPY of container/agentRelay.mjs (a Worker has no
  // filesystem to read it from at request time). This fails the build the moment that
  // copy drifts, so the "one dispatch table, every image" rule is enforced, not hoped for.
  ['check:agent-relay', 'gen-agent-relay-source.mjs', '--check'],
  ['check:trigger-palette', 'check-trigger-palette-parity.mjs'],
  ['check:no-burnrate-runtime', 'check-no-burnrate-runtime.mjs'],
  ['check:burnrate-policy', 'check-burnrate-cutover-policy.mjs'],
  ['check:burnrate-parity', 'check-burnrate-parity.mjs'],
  ['audit:burnrate-cutover', 'audit-burnrate-cutover.mjs', '--validate-only'],
  ['audit:burnrate-tenancy', 'audit-burnrate-tenancy.mjs', '--validate-only'],
];
