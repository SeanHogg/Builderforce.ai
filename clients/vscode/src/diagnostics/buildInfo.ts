/**
 * BUILD IDENTITY for the extension — the fact `package.json`'s `version` alone cannot
 * carry.
 *
 * `version` names a RELEASE, not an ARTIFACT. `npm run package` will happily emit a second
 * `builderforce-ai-<same version>.vsix` over an earlier one, so two installs can report the
 * identical version string while containing different code. That is not hypothetical: on
 * 2026-07-25 a `2026.7.104` VSIX was rebuilt with an agent-stall recovery fix that an
 * earlier `2026.7.104` build lacked, a user on the older one reported exactly the failure
 * the fix addressed, and the chat diagnostics (`UI 2026.7.104`) could not tell the two
 * apart. Every "did you actually get the fix?" question was unanswerable from the report.
 *
 * So the bundler stamps two more facts into the artifact:
 *
 *  - {@link BUILD_ID} — a short hash over the extension's SOURCE. Same source ⇒ same id;
 *    any change ⇒ a different id, regardless of whether the version was bumped. This is
 *    the one that answers "is this the build with the fix?".
 *  - {@link BUILT_AT} — when the artifact was produced, so two builds of the same source
 *    on different days are still orderable.
 *
 * Both are injected by esbuild `define` (see `esbuild.mjs`). When the module is loaded
 * OUTSIDE the bundle — unit tests, `tsc -p ./`, ts-node — the defines are absent and both
 * fall back to `"dev"`, which is itself informative: a report saying `dev` was not produced
 * by a packaged VSIX at all.
 */

// Injected by esbuild `define`. Declared (not imported) so the non-bundled path compiles.
declare const __BF_BUILD_ID__: string | undefined;
declare const __BF_BUILT_AT__: string | undefined;

/** Value used when the defines are absent (unbundled: tests, `tsc`, ts-node). */
export const UNSTAMPED_BUILD = "dev";

function stamped(value: string | undefined): string {
  return typeof value === "string" && value.length > 0 ? value : UNSTAMPED_BUILD;
}

/** Short source hash of THIS build — the artifact identity `version` cannot provide. */
export const BUILD_ID: string = stamped(
  typeof __BF_BUILD_ID__ === "string" ? __BF_BUILD_ID__ : undefined,
);

/** ISO timestamp the artifact was bundled, or `"dev"` when unbundled. */
export const BUILT_AT: string = stamped(
  typeof __BF_BUILT_AT__ === "string" ? __BF_BUILT_AT__ : undefined,
);

/** True when this code is running from a real bundled artifact (not a dev/tsc load). */
export function isStampedBuild(): boolean {
  return BUILD_ID !== UNSTAMPED_BUILD;
}

/**
 * The one-line build identity for a support report: `2026.8.130+a1b2c3d4e5f6
 * (2026-08-19T12:00:00.000Z)`.
 *
 * Version FIRST (it is what a user recognises), then the source hash that actually
 * distinguishes two artifacts sharing it.
 */
export function formatBuildIdentity(version: string): string {
  return `${version}+${BUILD_ID}${BUILT_AT !== UNSTAMPED_BUILD ? ` (${BUILT_AT})` : ""}`;
}
