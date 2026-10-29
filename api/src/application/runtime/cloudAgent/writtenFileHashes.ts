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

/** path → content hash, live for the run (mutated by write/edit/delete). */
export type WrittenFileHashes = Map<string, string>;

export async function recordWrittenHash(hashes: WrittenFileHashes, path: string, content: string): Promise<void> {
  hashes.set(path, await sha256Hex(content));
}

/** The run's hash map as the durable state stores it (JSON-safe). */
export function snapshotWrittenHashes(hashes: ReadonlyMap<string, string>): Record<string, string> {
  return Object.fromEntries(hashes);
}

/** A hash map seeded from a resumed run's persisted record (empty on the first tick). */
export function seedWrittenHashes(persisted: Readonly<Record<string, string>> | undefined | null): WrittenFileHashes {
  return new Map(Object.entries(persisted ?? {}));
}
