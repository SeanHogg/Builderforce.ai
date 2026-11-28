/**
 * Where the v4 store's files live and what they are called (AE-G031). Names only — no I/O.
 *
 *   local-first-v4.journal                                        the main journal
 *   local-first-v4.partitions/<entityType>.<key>.<generation>.journal   one standard journal per partition
 *   <that name>.tmp-<generation>                                  a partition being written (compaction, migration)
 *
 * `<entityType>` and `<key>` are encoded with `encodeKeyPart`: only `a-z 0-9 - _` stay as they are,
 * every other byte becomes `%XX`. That is reversible, never contains a `.` (the separator), and is safe
 * on a case-insensitive file system (an upper-case letter is encoded, so two keys never collide).
 */

import type { PartitionPointer, RecordIndexKey } from "@builderforce/local-first";

export const V4_JOURNAL_FILE = "local-first-v4.journal";
export const PARTITIONS_DIR = "local-first-v4.partitions";
/** The sidecar that records where the v3 journal stood when v4 was cut from it (`localFirstV4Merge.ts`). */
export const V4_IMPORT_SIDECAR_FILE = "local-first-v4.import.json";

/**
 * What this store puts in `PartitionPointer` beyond file, length and generation. All of it is derived from
 * the partition's own frames, so a pointer from another build that lacks it reads as zero.
 */
export interface VsixPartitionPointer extends PartitionPointer {
  /** The main commit sequence of the last frame in the file. Every partition frame carries its commit's. */
  commitSeq: number;
  /** Bytes of the base (the compacted prefix); the commit frames after it are the TAIL the policy measures. */
  base: number;
  /** Commit frames after the base. */
  tailFrames: number;
}

export const asVsixPointer = (pointer: PartitionPointer): VsixPartitionPointer => {
  const wide = pointer as Partial<VsixPartitionPointer> & PartitionPointer;
  return { ...pointer, commitSeq: wide.commitSeq ?? 0, base: wide.base ?? 0, tailFrames: wide.tailFrames ?? 0 };
};

const KEEP = /[a-z0-9_-]/;

export function encodeKeyPart(text: string): string {
  let out = "";
  for (const char of text) {
    if (KEEP.test(char)) out += char;
    else for (const byte of new TextEncoder().encode(char)) out += `%${byte.toString(16).padStart(2, "0")}`;
  }
  return out;
}

export function decodeKeyPart(encoded: string): string {
  const bytes: number[] = [];
  for (let index = 0; index < encoded.length; index += 1) {
    if (encoded[index] === "%") {
      bytes.push(Number.parseInt(encoded.slice(index + 1, index + 3), 16));
      index += 2;
    } else bytes.push(encoded.charCodeAt(index));
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/** A partition file's base name for a partition and a generation. */
export const partitionFileName = (entityType: string, home: RecordIndexKey, generation: string): string =>
  `${encodeKeyPart(entityType)}.${encodeKeyPart(String(home))}.${encodeKeyPart(generation)}.journal`;

/** The pointer's `file`: relative to the store directory, with `/` on every platform. */
export const partitionRelativePath = (name: string): string => `${PARTITIONS_DIR}/${name}`;

export interface ParsedPartitionName {
  entityType: string;
  home: string;
  generation: string;
}

export function parsePartitionFileName(name: string): ParsedPartitionName | undefined {
  const parts = /^([^.]+)\.([^.]+)\.([^.]+)\.journal$/.exec(name);
  if (!parts) return undefined;
  return { entityType: decodeKeyPart(parts[1]!), home: decodeKeyPart(parts[2]!), generation: decodeKeyPart(parts[3]!) };
}

/** The temp a partition is streamed into before it is renamed to `finalName`. */
export const partitionTempName = (finalName: string, generation: string): string => `${finalName}.tmp-${encodeKeyPart(generation)}`;

/** Matches the temp names above (orphan cleanup). */
export const PARTITION_TEMP_PATTERN = /^[^.]+\.[^.]+\.[^.]+\.journal\.tmp-[^.]+$/;
