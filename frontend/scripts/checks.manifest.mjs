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
  ['check:route-exports', 'check-route-exports.mjs'],
  ['check:root-layout-providers', 'check-root-layout-providers.mjs'],
  ['check:declared-deps', 'check-declared-deps.mjs'],
  ['check:methodology', 'check-methodology.mjs'],
  ['check:canvas-glossary', 'check-canvas-glossary.mjs'],
  ['check:canvas-kind-labels', 'check-canvas-kind-labels.mjs'],
  ['check:layering', 'check-layering.mjs'],
  ['check:primitives', 'check-primitive-duplication.mjs'],
  // The repo-wide silent-catch ratchet, narrowed to this package's tree so the
  // cost stays local. The full sweep runs in api's chain.
  ['check:silent-catches', '../../scripts/check-silent-catches.mjs', '--target', 'frontend/src'],
  // `--changed`, not a full sweep: four of the six rules run the React Compiler,
  // so all 2,071 files cost ~10 minutes and a single component costs ~17s. The
  // cost here is proportional to the diff, and a change touching no component
  // costs nothing. See scripts/check-react-hooks-ratchet.mjs.
  ['check:react-hooks', 'check-react-hooks-ratchet.mjs', '--changed'],
];
