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
  ['check:schema', 'check-schema-drift.mjs'],
  ['check:db-access', 'check-db-access.mjs'],
  ['check:migrations', 'check-migrations.mjs'],
  ['check:swept-tables', 'check-swept-tables.mjs'],
  ['check:signature-duplication', 'check-signature-duplication.mjs'],
  ['check:shape-lint', 'check-shape-lint.mjs'],
  ['check:tenant-column', 'check-tenant-column.mjs'],
  ['check:polymorphic-fk', 'check-polymorphic-fk.mjs'],
  ['check:domain-boundary', 'check-domain-boundary.mjs'],
  ['check:domain-root-table', 'check-domain-root-table.mjs'],
  ['check:model-coverage', 'check-model-coverage.mjs'],
  ['check:table-adoption', 'check-table-adoption.mjs'],
  ['check:layering', 'check-layering.mjs'],
  ['check:tenant-scope', 'check-tenant-scope.mjs'],
  ['check:source', 'check-source-text.mjs'],
  // Repo-level: ONE silent-catch guard scans every package's source tree against
  // the shared baseline in scripts/silent-catches.baseline.json. api's chain runs
  // the full sweep; frontend's runs only its own tree for fast local feedback.
  ['check:silent-catches', '../../scripts/check-silent-catches.mjs'],
  ['check:dispatch-budget', 'check-dispatch-budget.mjs'],
  ['check:pinned-defects', 'check-pinned-defects.mjs'],
  ['check:prompt-tools', 'check-prompt-tool-names.mjs'],
  ['check:canvas-tools', 'check-canvas-tool-contract.mjs'],
  ['check:trigger-palette', 'check-trigger-palette-parity.mjs'],
  ['check:no-burnrate-runtime', 'check-no-burnrate-runtime.mjs'],
  ['check:burnrate-policy', 'check-burnrate-cutover-policy.mjs'],
  ['check:burnrate-parity', 'check-burnrate-parity.mjs'],
  ['audit:burnrate-cutover', 'audit-burnrate-cutover.mjs', '--validate-only'],
  ['audit:burnrate-tenancy', 'audit-burnrate-tenancy.mjs', '--validate-only'],
];
