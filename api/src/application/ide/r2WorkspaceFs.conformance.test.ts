/**
 * The R2 IDE workspace against the shared WorkspaceFs conformance suite: the same cases every
 * adapter under the ONE coding provider answers, with writes landing through the real
 * `applyTaskWorkspaceChanges` path (path + content contract, history, change record).
 *
 * Where R2 legitimately differs: it has no directory objects, so listing a directory that holds no
 * key is an EMPTY listing (`missingDirListing: 'empty'`), not `not_found`.
 */
import { runWorkspaceConformance } from '@builderforce/agent-tools/workspace-conformance';
import type { Db } from '../../infrastructure/database/connection';
import { writeWorkspaceFile } from './workspaceStore';
import { applyTaskWorkspaceChanges } from './taskWorkspaceTarget';
import { r2WorkspaceFs } from './r2WorkspaceFs';

const PROJECT_ID = 34;

/** An in-memory R2 bucket: get / put / delete / list by prefix (the operations the workspace store uses). */
function fakeBucket(): R2Bucket {
  const store = new Map<string, string>();
  return {
    async get(key: string) {
      if (!store.has(key)) return null;
      const value = store.get(key)!;
      return { text: async () => value, body: value };
    },
    async put(key: string, value: string) { store.set(key, value); },
    async delete(key: string) { store.delete(key); },
    async list({ prefix }: { prefix: string }) {
      return { objects: [...store.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, v]) => ({ key, size: v.length })) };
    },
  } as unknown as R2Bucket;
}

const fakeDb = { insert: () => ({ values: async () => undefined }) } as unknown as Db;

runWorkspaceConformance(
  'r2WorkspaceFs (fake bucket + applyTaskWorkspaceChanges)',
  async () => {
    const bucket = fakeBucket();
    return {
      fs: r2WorkspaceFs(bucket, PROJECT_ID, {
        applyChanges: (changes) =>
          applyTaskWorkspaceChanges(fakeDb, bucket, { tenantId: 1, taskId: 7, executionId: 9, agent: 'coder', projectId: PROJECT_ID, changes }),
      }),
      async seed(files) {
        for (const [path, content] of Object.entries(files)) await writeWorkspaceFile(bucket, PROJECT_ID, path, content);
      },
    };
  },
  { missingDirListing: 'empty' },
);
