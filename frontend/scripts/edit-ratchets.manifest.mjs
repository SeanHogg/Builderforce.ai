/**
 * The ratchets ONE edited file can break, as [reporting name, script, ...args].
 *
 * ── WHY THIS IS ITS OWN LIST ──────────────────────────────────────────────────
 * These guards have a property the rest of `checks.manifest.mjs` does not:
 * a single edit to a single component can move them, and each one answers in
 * about a second. That makes them the set worth running the moment a file is
 * written rather than at `npm test` — and the set that, in practice, is what CI
 * keeps failing on. A literal hex, a raw `localStorage`, an empty catch and an
 * off-scale radius each reached `main` and each red-lit a deploy, one per push,
 * when the local run that would have caught them takes four seconds.
 *
 * `.claude/hooks/frontend-ratchets.mjs` runs exactly this list after any write
 * under `frontend/src`, so the feedback arrives while the change is still in
 * hand. This file is the ONE declaration of the set: `checks.manifest.mjs`
 * imports and spreads it rather than restating the entries, so a guard
 * added here is picked up by both without a second edit — and neither list can
 * drift into disagreeing about which ratchets are the fast, file-local ones.
 *
 * A guard belongs here only if BOTH hold. Something slow (the React Compiler
 * rules, ~17s for one component) or repo-shaped (the source-package graph, which
 * no single frontend file can break) stays in `checks.manifest.mjs` alone.
 */
export default [
  ['check:design-tokens', 'check-design-tokens.mjs'],
  ['check:design-scale', 'check-design-scale.mjs'],
  // Raw localStorage/sessionStorage sites may only shrink — see lib/storage.ts.
  ['check:raw-storage', 'check-raw-storage.mjs'],
  // window.confirm/prompt/alert: zero, not a ratchet — the app has its own doors.
  ['check:native-dialogs', 'check-native-dialogs.mjs'],
  // English catch fallbacks: zero — useErrorMessage() for a person, toolErrorMessage() for the model.
  ['check:error-fallbacks', 'check-error-fallbacks.mjs'],
  // The repo-wide silent-catch ratchet, narrowed to this package's tree so the
  // cost stays local. The full sweep runs in api's chain.
  ['check:silent-catches', '../../scripts/check-silent-catches.mjs', '--target', 'frontend/src'],
];
