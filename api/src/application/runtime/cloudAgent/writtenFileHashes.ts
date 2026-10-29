/**
 * writtenFileHashes — the content hash of every file a run wrote, as it left them (PRD 38
 * §4.10). A run-end fact anchored to a written file carries that hash (via `commitRunMemory`'s
 * `writtenFileHashes`), so it goes stale the moment the file changes. The hash is the SAME
 * `sha256Hex` of the file's text that host directory indexes record, so a later comparison
 * against `hostDirectoryHashReader` is like-for-like.
 */
import { sha256Hex } from '../../../domain/shared/hash';

/** path → content hash, live for the run (mutated by write/edit/delete). */
export type WrittenFileHashes = Map<string, string>;

export async function recordWrittenHash(hashes: WrittenFileHashes, path: string, content: string): Promise<void> {
  hashes.set(path, await sha256Hex(content));
}
