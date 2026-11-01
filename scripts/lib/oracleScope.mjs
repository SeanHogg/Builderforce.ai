/**
 * Which files are the PRD 35 program's oracle (§5.1), decided by PATH. Pure, so `oracleScope.test.mjs` can pin it and
 * `check-tests-unchanged.mjs` (the guard) and the approvals list share ONE answer.
 */

/** The Brain's run-store oracle: one list for every package (`runOracle.mjs <pkg>` filters it by prefix). */
export const ORACLE_LIST = 'brain-embedded/src/run/parity/oracle.files.txt';

/**
 * The rest of the program's oracle, by path. Anything matching is held to §5.1 whoever committed it and whatever the subject says.
 * Every file under the agent-run test tree counts (fixtures and helpers too, not only `*.test.ts`), as does the whole Brain parity
 * directory (its snapshots, scenarios and normaliser decide what the snapshots prove) and the Brain's run harnesses. The oracle list
 * itself is guarded by `isGuarded` (a dropped line would free its test).
 */
export const GUARDED = [
  /^packages\/agent-run\/test\//,
  /^packages\/agent-loop\/.*\.test\.[cm]?[jt]sx?$/,
  /^agent-runtime\/src\/run\/[^/]+\.test\.[cm]?[jt]sx?$/,
  /^agent-runtime\/src\/conformance\//,
  /^api\/src\/application\/runtime\/cloudAdapter\.(?:conformance|sharedTask)\.test\.ts$/,
  /^brain-embedded\/src\/run\/parity\//,
  /^brain-embedded\/src\/test\/(?:brainRunHarness|continueHarness|draftHost|engineKit)\.tsx?$/,
  // The Area R scenarios' harness and the tool-selection suite (with its testkit) that moved onto the agent's selection.
  /^brain-embedded\/src\/run\/areaR\/harness\.tsx?$/,
  /^brain-embedded\/src\/selectTools(?:\.pins\.test|\.test|\.testkit)\.tsx?$/,
];

/** Stored records, not code: any difference at all (an inserted key, a changed value) fails unless approved. */
export const EXACT = /^brain-embedded\/src\/run\/parity\/snapshots\//;

/** The repo-relative paths an `oracle.files.txt` names (blank lines and `#` comments dropped). */
export function parseOracleList(text) {
  return (text ?? '').split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
}

/** True when `path` (repo-relative, forward slashes) is held to §5.1. `listed` is the Set of paths the oracle list names. */
export function isGuarded(path, listed) {
  return path === ORACLE_LIST || listed.has(path) || GUARDED.some((pattern) => pattern.test(path));
}
