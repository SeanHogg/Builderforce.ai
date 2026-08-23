/**
 * Types for the frontend source reader. Same reason as `tsSource.d.mts`: the module is
 * `.mjs` so unbuilt CI guards can run it, but `src/**\/*.test.ts` imports it too, and an
 * untyped import would make those parity assertions read as `any`.
 */

/** Absolute path of a repo-relative frontend source file. */
export function frontendSourcePath(relPath: string): string;

/**
 * The text of a repo-relative frontend source file. Throws an error naming `contract`
 * — and the file's new location, if it can be found — when the path has moved.
 */
export function readFrontendSource(relPath: string, contract: string): string;
