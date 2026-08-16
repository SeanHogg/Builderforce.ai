/**
 * The guards `npm test` runs before vitest, as [reporting name, script, ...args].
 * Paths are relative to this file. Run by `../scripts/run-checks.mjs`, which owns
 * the concurrency and the exit contract.
 *
 * This is the ONLY list — `npm test` calls the runner rather than restating the
 * chain, so adding a guard is one line here.
 */
export default [
  ['check:api-transport', 'check-api-transport.mjs'],
  ['check:architecture', 'check-frontend-architecture.mjs'],
  ['check:design-tokens', 'check-design-tokens.mjs'],
  ['check:destinations', 'check-destinations.mjs'],
  ['check:design-scale', 'check-design-scale.mjs'],
  ['check:edge-runtime', 'check-edge-runtime.mjs'],
  ['check:i18n-keys', 'check-i18n-keys.mjs'],
  ['check:declared-deps', 'check-declared-deps.mjs'],
  ['check:methodology', 'check-methodology.mjs'],
];
