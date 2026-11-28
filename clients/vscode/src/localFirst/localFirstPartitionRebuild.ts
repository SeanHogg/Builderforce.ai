/**
 * Rebuilding the partition half of a state from the partition FILES (AE-G031 "Recovery", a damaged main).
 *
 * The state a damaged main is rebuilt from (the cache, the sound prefix) names pointers that can be old: a
 * partition compaction since may have deleted the generation they name. So the files are the source:
 *   1. list the partition files and take the NEWEST generation of each partition;
 *   2. read its frames up to the first one whose `commitSeq` is above the rebuilt main's (the highest
 *      sequence its pointers hold) — a frame past it belongs to a commit the rebuilt main never saw, or to
 *      one that never reached the main journal;
 *   3. rebuild that partition's stubs and pointer from the rows it holds.
 * A partition whose file cannot be read keeps what the state said and is reported; the loader and the
 * damaged-partition recovery deal with it at the first read.
 */

import nodeFs from "node:fs";
import nodePath from "node:path";
import {
  crc32,
  partitionDeclarationOf,
  partitionIdOf,
  scanJournalStateAsync,
  stubOf,
  type AnyRecordPartition,
  type LocalEntityType,
  type LocalFirstSnapshot,
  type RecordPartition,
  type RecordStub,
} from "@builderforce/local-first";
import { yieldToEventLoop } from "./localFirstJournalIo";
import { listPartitionFiles } from "./localFirstPartitionFiles";
import { asVsixPointer, parsePartitionFileName, type VsixPartitionPointer } from "./localFirstPartitionNames";

const fs = nodeFs.promises;
const HEADER_BYTES = 13;
const COMMIT_SEQ = /^\{"commitSeq":(\d+)/;

/** The committed prefix of a partition file whose frames carry a `commitSeq` at or below `limit` (a base frame carries none: 0). */
export function prefixUpToCommitSeq(bytes: Uint8Array, limit: number): { length: number; lastSeq: number; frames: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  let lastSeq = 0;
  let frames = 0;
  while (offset + HEADER_BYTES <= bytes.byteLength) {
    const end = offset + HEADER_BYTES + view.getUint32(offset + 5, false);
    if (end > bytes.byteLength) break; // a torn tail
    const body = bytes.subarray(offset + HEADER_BYTES, end);
    if (crc32(body) !== view.getUint32(offset + 9, false)) break;
    const seq = Number(COMMIT_SEQ.exec(new TextDecoder().decode(body.subarray(0, 40)))?.[1] ?? 0);
    if (seq > limit) break;
    lastSeq = Math.max(lastSeq, seq);
    frames += 1;
    offset = end;
  }
  return { length: offset, lastSeq, frames };
}

export async function reconcilePartitions(
  directory: string,
  declared: readonly AnyRecordPartition[],
  snapshot: LocalFirstSnapshot,
  report: (error: unknown) => void,
): Promise<LocalFirstSnapshot> {
  const types = new Map(declared.map((partition) => [partition.index.entityType as string, partition as RecordPartition]));
  const pointers: Record<string, VsixPartitionPointer> = {};
  for (const [id, pointer] of Object.entries(snapshot.partitionPointers ?? {})) pointers[id] = asVsixPointer(pointer);
  const limit = Math.max(0, ...Object.values(pointers).map((pointer) => pointer.commitSeq));

  // The newest generation of each partition (by when it was last written).
  const newest = new Map<string, { file: string; generation: string; mtime: number }>();
  for (const file of await listPartitionFiles(directory)) {
    const parsed = parsePartitionFileName(nodePath.basename(file));
    if (!parsed || !types.has(parsed.entityType)) continue;
    const id = partitionIdOf(parsed.entityType as LocalEntityType, parsed.home);
    const mtime = (await fs.stat(nodePath.join(directory, file))).mtimeMs;
    if (!newest.has(id) || mtime > newest.get(id)!.mtime) newest.set(id, { file, generation: parsed.generation, mtime });
  }

  let stubs: RecordStub[] = [...(snapshot.stubs ?? [])];
  for (const [id, found] of newest) {
    try {
      const bytes = new Uint8Array(await fs.readFile(nodePath.join(directory, found.file)));
      const prefix = prefixUpToCommitSeq(bytes, limit);
      if (prefix.length === 0) continue;
      const scan = await scanJournalStateAsync(bytes.subarray(0, prefix.length), yieldToEventLoop);
      if (scan.corrupt || scan.committedBytes !== prefix.length || !scan.state) throw new Error(`frames end at ${scan.committedBytes} of ${prefix.length} bytes`);
      const type = id.slice(0, id.indexOf("\u0000"));
      const partition = types.get(type)!;
      stubs = stubs.filter((stub) => partitionIdOf(stub.entityType, stub.home) !== id);
      for (const row of scan.state.view().records) {
        const stub = stubOf(partition, row);
        if (stub) stubs.push(stub);
      }
      pointers[id] = { file: found.file, length: prefix.length, generation: found.generation, commitSeq: prefix.lastSeq, base: 0, tailFrames: prefix.frames };
    } catch (error) {
      report(new Error(`local-first: partition file ${found.file} could not be rebuilt from: ${(error as Error).message}`));
    }
  }
  const declarations = [...(snapshot.partitionDeclarations ?? [])];
  for (const partition of types.values()) {
    if (stubs.some((stub) => stub.entityType === partition.index.entityType) && !declarations.some((d) => d.entityType === partition.index.entityType)) {
      declarations.push(partitionDeclarationOf(partition));
    }
  }
  return { ...snapshot, stubs, partitionPointers: pointers, partitionDeclarations: declarations };
}
