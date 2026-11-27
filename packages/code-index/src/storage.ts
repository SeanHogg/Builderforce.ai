import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { acquireReplicaLock } from "@builderforce/agent-tools/knowledge";
import { codeIndexPath, ensureLocalIndexDir, localIndexStem, readRegularFile, reportIndexFailure, type IndexFailureSink } from "@builderforce/agent-tools/node-index-layout";
import { sha256Hex } from "@seanhogg/builderforce-memory/knowledge";
import type { CodeChunk } from "./chunk.js";

export interface CodeFileRecord {
  path: string;
  stamp: string;
  hash: string;
  chunks: CodeChunk[];
}

export interface StoredCodeIndex {
  fingerprint: string;
  partial: boolean;
  records: CodeFileRecord[];
  index: Uint8Array;
}

const FORMAT_VERSION = 1;
const MAX_META_BYTES = 10 * 1024 * 1024;
const MAX_INDEX_BYTES = 160 * 1024 * 1024;

function validRecord(value: unknown): value is CodeFileRecord {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<CodeFileRecord>;
  return typeof entry.path === "string" && typeof entry.stamp === "string" && typeof entry.hash === "string"
    && Array.isArray(entry.chunks)
    && entry.chunks.every((chunk) => chunk && typeof chunk.kind === "string"
      && (chunk.symbol === undefined || typeof chunk.symbol === "string")
      && Number.isSafeInteger(chunk.startLine) && chunk.startLine > 0
      && Number.isSafeInteger(chunk.endLine) && chunk.endLine >= chunk.startLine);
}

const MAX_FILE_BYTES = MAX_META_BYTES + MAX_INDEX_BYTES + 4;

function parseStored(bytes: Buffer | undefined): StoredCodeIndex | undefined {
  if (!bytes || bytes.length < 4) return undefined;
  const length = bytes.readUInt32LE();
  if (length > MAX_META_BYTES || length + 4 >= bytes.length) return undefined;
  try {
    const meta = JSON.parse(bytes.toString("utf-8", 4, length + 4));
    if (meta?.version !== FORMAT_VERSION || typeof meta.fingerprint !== "string" || typeof meta.partial !== "boolean"
      || !Array.isArray(meta.records) || !meta.records.every(validRecord)) return undefined;
    return { fingerprint: meta.fingerprint, records: meta.records, index: bytes.subarray(length + 4), partial: meta.partial };
  } catch {
    return undefined;
  }
}

/**
 * Use one atomic file per real workspace root, named by the shared local-index layout
 * (`<root>/.builderforce/index/<stem>.idx`, `codeIndexPath`). `rootId` is the id the host's
 * knowledge index already uses; a caller without one gets the layout's default. Generated
 * source bodies stay gitignored. A file under the older realpath-hash name is read once,
 * rewritten under the new name, and deleted.
 */
export async function codeIndexStorage(root: string, rootId?: string, onFailure?: IndexFailureSink) {
  const directory = await ensureLocalIndexDir(root);
  const id = localIndexStem(root, rootId);
  const path = codeIndexPath(root, rootId);
  const legacyPath = join(directory, `${sha256Hex(root).slice(0, 24)}.idx`);
  const lockFiles = {
    async read(name: string) { return (await readRegularFile(join(directory, name), 1_024))?.toString("utf-8"); },
    async write(name: string, text: string) {
      // Replacing the lock by rename keeps readers from observing partial JSON.
      const target = join(directory, name);
      const temp = `${target}.${randomUUID()}.tmp`;
      try {
        await writeFile(temp, text, { flag: "wx", mode: 0o600 });
        await rename(temp, target);
      } finally {
        await rm(temp, { force: true }).catch(() => undefined);
      }
    },
    async createExclusive(name: string, text: string) {
      try {
        await writeFile(join(directory, name), text, { flag: "wx", mode: 0o600 });
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
        throw error;
      }
    },
    rename: (from: string, to: string) => rename(join(directory, from), join(directory, to)),
    remove: (name: string) => rm(join(directory, name), { force: true }),
  };
  /** Write the old file's bytes under the new name, then delete the old one; best-effort, the old file stays on any failure. */
  const migrate = async (bytes: Buffer): Promise<void> => {
    const temp = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, bytes, { flag: "wx", mode: 0o600 });
      await rename(temp, path);
      await rm(legacyPath, { force: true });
    } catch (error) {
      // Non-fatal (the old file stays, the next read migrates again) but never silent.
      reportIndexFailure("code index legacy migration failed", legacyPath, error, onFailure);
    } finally {
      await rm(temp, { force: true }).catch(() => undefined);
    }
  };
  return {
    lock: () => acquireReplicaLock(lockFiles, id),
    async read(): Promise<StoredCodeIndex | undefined> {
      const current = await readRegularFile(path, MAX_FILE_BYTES);
      if (current) return parseStored(current);
      const legacy = await readRegularFile(legacyPath, MAX_FILE_BYTES).catch(() => undefined);
      const stored = parseStored(legacy);
      if (legacy && stored) await migrate(legacy);
      return stored;
    },
    async write(snapshot: StoredCodeIndex, fresh: () => boolean): Promise<void> {
      const meta = Buffer.from(JSON.stringify({
        version: FORMAT_VERSION, fingerprint: snapshot.fingerprint, records: snapshot.records, partial: snapshot.partial,
      }));
      if (meta.length > MAX_META_BYTES || snapshot.index.length > MAX_INDEX_BYTES) return;
      const header = Buffer.alloc(4);
      header.writeUInt32LE(meta.length);
      const temp = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temp, Buffer.concat([header, meta, snapshot.index]), { flag: "wx", mode: 0o600 });
        if (fresh()) await rename(temp, path);
      } finally {
        await rm(temp, { force: true }).catch(() => undefined);
      }
    },
  };
}
