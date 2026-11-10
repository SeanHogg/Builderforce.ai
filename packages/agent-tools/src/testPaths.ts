/**
 * testPaths.ts — THE rule for "is this a test file" (one rule for the code pack's routes, the callback owners, the repo
 * map's ranking and the run notes): a file in a test directory (`__tests__/`, `test/`, `tests/`, `spec/`, `e2e/`), a
 * file named `test.*` / `spec.*`, or one whose name ends in `.test.*`, `.spec.*`, `.e2e.*` or `.e2e-spec.*`. Pure.
 */

const TEST_SOURCE_PATH = /(?:^|\/)(?:__tests__|tests?|spec|e2e)\/|(?:^|\/)(?:test|spec)\.[^/]+$|\.(?:test|spec|e2e|e2e-spec)\.[^/]+$/i;

/** Whether a (root-relative, `/` or `\` separated) path is a test file. */
export function isTestSourcePath(path: string): boolean {
  return TEST_SOURCE_PATH.test(path.replace(/\\/g, "/"));
}
