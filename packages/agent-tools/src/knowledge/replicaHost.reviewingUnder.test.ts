import { afterEach, describe, expect, it } from "vitest";
import type { KnowledgeFiles } from "./fileManifest.js";
import { createReplicaHost } from "./replicaHost.js";

/**
 * PRD 41 B6 (WS3): a folder's background indexer must not start a pass while a review of a sub-folder root of it
 * (`<folder root id>:<rel>`) runs — that pass would cover the same files. `isReviewingUnder` answers it.
 */

function memoryFiles(): KnowledgeFiles {
  const data = new Map<string, string>();
  return { read: async (n) => data.get(n), write: async (n, t) => { data.set(n, t); } };
}

const host = createReplicaHost();
afterEach(async () => { await host.disposeReplicas(); });

describe("isReviewingUnder", () => {
  it("sees the root's own review and its sub-folder roots' reviews, never a sibling's", () => {
    const files = memoryFiles();
    expect(host.isReviewingUnder("vscode:repo")).toBe(false);

    host.setRootReviewing("vscode:repo:packages/api", files, true);
    expect(host.isReviewingUnder("vscode:repo")).toBe(true);
    expect(host.isRootReviewing("vscode:repo")).toBe(false); // the old question missed it
    expect(host.isReviewingUnder("vscode:repo:packages/web")).toBe(false);
    expect(host.isReviewingUnder("vscode:repository")).toBe(false); // a prefix that is not a sub-folder root
    host.setRootReviewing("vscode:repo:packages/api", files, false);
    expect(host.isReviewingUnder("vscode:repo")).toBe(false);

    host.setRootReviewing("vscode:repo", files, true);
    expect(host.isReviewingUnder("vscode:repo")).toBe(true);
    host.setRootReviewing("vscode:repo", files, false);
  });
});
