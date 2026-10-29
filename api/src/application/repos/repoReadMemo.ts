/**
 * repoReadMemo — a repo file read made ONCE per path for as long as the memo lives.
 *
 * A finish attempt reads the branch's files for more than one purpose: re-hashing what a
 * run's sub-agents committed (`absorbChildWrites`) and the static validation of the written
 * set (`verifyWrittenFiles`) both need the same bytes. They share one memo, so each path is
 * fetched once per attempt. A memo is NEVER kept across attempts: the model edits files
 * between a blocked finish and the next, so a later attempt must read afresh.
 */
import { readRepoFile, type ReadFileResult, type RepoReadContext } from './readRepoContents';

/** Reads one file of the repo the reader was built for. */
export type RepoFileReader = (path: string) => Promise<ReadFileResult>;

export function createRepoReadMemo(ctx: RepoReadContext, read: typeof readRepoFile = readRepoFile): RepoFileReader {
  const reads = new Map<string, Promise<ReadFileResult>>();
  return (path) => {
    let hit = reads.get(path);
    if (!hit) {
      hit = read(ctx, path);
      reads.set(path, hit);
    }
    return hit;
  };
}
