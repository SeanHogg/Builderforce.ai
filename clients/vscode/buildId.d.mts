/**
 * Types for `buildId.mjs`.
 *
 * The module itself is plain ESM because esbuild's config imports it before any TypeScript
 * has been compiled — it computes the source hash that is then `define`d into the bundle,
 * so it cannot depend on the build it feeds. This declaration is what lets
 * `src/buildInfo.test.ts` assert its behaviour under `tsc`.
 */

/** Directories (relative to the extension root) whose contents identify a build. */
export declare const BUILD_HASH_ROOTS: readonly string[];

/**
 * Short (12 hex char) content hash of everything that ships in the artifact built from
 * `here`. Deterministic: an unchanged tree hashes the same, any shipped change does not,
 * and test files are excluded because they never reach the artifact.
 */
export declare function computeBuildId(here: string): string;
