/**
 * writtenFileHashes — the content hash of every file a run wrote, as it left them (PRD 38
 * §4.10). A run-end fact anchored to a written file carries that hash (via `commitRunMemory`'s
 * `writtenFileHashes`), so recall can tell the fact has gone stale the moment the file
 * changes. (The hash makes MODEL facts stale in the knowledge graph; for an agent run's
 * facts it drives recall staleness.) The hash is the SAME `sha256Hex` of the file's text
 * that host directory indexes record, so a later comparison against
 * `hostDirectoryHashReader` is like-for-like.
 *
 * A durable run spans many ticks: the map is persisted in `CloudLoopState` as a plain
 * record ({@link snapshotWrittenHashes}) and re-seeded on resume ({@link seedWrittenHashes}),
 * so a file written on tick 1 is still anchored to its hash when the run ends on tick 5.
 */
import { sha256Hex } from '../../../domain/shared/hash';
import { reportedFallback } from '../../observability/caughtErrorReporter';

/** path → content hash, live for the run (mutated by write/edit/delete). */
export type WrittenFileHashes = Map<string, string>;

export async function recordWrittenHash(hashes: WrittenFileHashes, path: string, content: string): Promise<void> {
  hashes.set(path, await sha256Hex(content));
}

/** Reads per batch when re-hashing — a child tree can leave up to a diff-page of files. */
const REHASH_BATCH = 8;

/**
 * Re-hash files other writers (a run's sub-agents) left on the branch: each path's entry
 * becomes the sha256 of its FINAL content, read through `read` (null = unreadable or too
 * large to hash whole). A removed or unreadable path drops its entry — an unhashed anchor
 * is merely never stale, where a hash of text a child replaced would mark the fact stale
 * on the first recall.
 */
export async function rehashPaths(
  hashes: WrittenFileHashes,
  files: ReadonlyArray<{ path: string; status?: string }>,
  read: (path: string) => Promise<string | null>,
): Promise<void> {
  for (let i = 0; i < files.length; i += REHASH_BATCH) {
    await Promise.all(files.slice(i, i + REHASH_BATCH).map(async (f) => {
      const content = f.status === 'removed' ? null : await read(f.path).catch(reportedFallback<string | null>(null, { source: 'application/runtime/cloudAgent/writtenFileHashes.ts', operation: 'rehashRead', context: { path: f.path } }));
      if (content === null) hashes.delete(f.path);
      else await recordWrittenHash(hashes, f.path, content);
    }));
  }
}

/** The run's hash map as the durable state stores it (JSON-safe). */
export function snapshotWrittenHashes(hashes: ReadonlyMap<string, string>): Record<string, string> {
  return Object.fromEntries(hashes);
}

/** A hash map seeded from a resumed run's persisted record (empty on the first tick). */
export function seedWrittenHashes(persisted: Readonly<Record<string, string>> | undefined | null): WrittenFileHashes {
  return new Map(Object.entries(persisted ?? {}));
}
