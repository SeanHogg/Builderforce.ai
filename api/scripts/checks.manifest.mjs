/**
 * The guards `npm test` runs before vitest, as [reporting name, script, ...args].
 * Paths are relative to this file. Run by `../scripts/run-checks.mjs`, which owns
 * the concurrency and the exit contract.
 *
 * This is the ONLY list — `npm test` calls the runner rather than restating the
 * chain, so adding a guard is one line here.
 */
export default [
  ['check:schema', 'check-schema-drift.mjs'],
  ['check:db-access', 'check-db-access.mjs'],
  ['check:migrations', 'check-migrations.mjs'],
  ['check:signature-duplication', 'check-signature-duplication.mjs'],
  ['check:shape-lint', 'check-shape-lint.mjs'],
  ['check:tenant-column', 'check-tenant-column.mjs'],
  ['check:polymorphic-fk', 'check-polymorphic-fk.mjs'],
  ['check:domain-boundary', 'check-domain-boundary.mjs'],
  ['check:model-coverage', 'check-model-coverage.mjs'],
  ['check:table-adoption', 'check-table-adoption.mjs'],
  ['check:layering', 'check-layering.mjs'],
  ['check:tenant-scope', 'check-tenant-scope.mjs'],
  ['check:tracks', 'check-track-manifest.mjs', '--check'],
  ['check:source', 'check-source-text.mjs'],
  ['check:silent-catches', 'check-silent-catches.mjs'],
  ['check:dispatch-budget', 'check-dispatch-budget.mjs'],
  ['check:pinned-defects', 'check-pinned-defects.mjs'],
  ['check:prompt-tools', 'check-prompt-tool-names.mjs'],
  ['check:canvas-tools', 'check-canvas-tool-contract.mjs'],
  ['check:no-burnrate-runtime', 'check-no-burnrate-runtime.mjs'],
  ['check:burnrate-policy', 'check-burnrate-cutover-policy.mjs'],
  ['audit:burnrate-cutover', 'audit-burnrate-cutover.mjs', '--validate-only'],
  ['audit:burnrate-tenancy', 'audit-burnrate-tenancy.mjs', '--validate-only'],
];
