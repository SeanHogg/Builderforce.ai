/**
 * The fixtures the diff-parsing and change-graph tests share (`diffModel.test.ts`,
 * `changeGraph.test.ts`): one repository, its pending changes built the way the host
 * builds them, and diff text joined the way git writes it.
 */

import type { PendingChangeSet, PendingChangeStatus } from '../../../src/gitChangeModel';

export const ROOT = 'C:/repo';

/** A node id — the knowledge graph's `NodeRef` — in the fixture repository (`name: 'repo'`). */
export const ref = (path: string, rootId = 'repo') => `src:${rootId}::${path}` as const;

/** A pending-change set for one repo, built the way the host builds it. */
export function changeSet(...changes: Array<[string, PendingChangeStatus, boolean]>): PendingChangeSet {
  const repo = {
    root: ROOT,
    name: 'repo',
    changes: changes.map(([file, status, staged]) => ({
      path: `${ROOT}/${file}`,
      relativePath: file,
      repoRoot: ROOT,
      status,
      staged,
    })),
  };
  return { total: repo.changes.length, repos: [repo] };
}

/** Join diff lines with newlines the way git does — including the trailing one. */
export const diff = (...lines: string[]): string => `${lines.join('\n')}\n`;

/** A one-file modification, the shape every other fixture edits. */
export const MODIFIED = diff(
  'diff --git a/src/app/run.ts b/src/app/run.ts',
  'index 1234567..89abcde 100644',
  '--- a/src/app/run.ts',
  '+++ b/src/app/run.ts',
  '@@ -10,4 +10,5 @@ export function run() {',
  ' const started = Date.now();',
  '-  const done = false;',
  '+  const done = await settle();',
  '+  const elapsed = Date.now() - started;',
  ' return done;',
);
