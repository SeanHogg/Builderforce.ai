import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { acquireReplicaLock } from "@builderforce/agent-tools/knowledge";
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
const CACHE_IGNORE = "*\n";

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

async function regularFile(path: string, maxSize: number): Promise<Buffer | undefined> {
  try {
    const info = await lstat(path);
    return info.isFile() && info.size <= maxSize ? await readFile(path) : undefined;
  } catch (error) {
    if (missing(error)) return undefined;
    throw error;
  }
}

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

/** Use one atomic file per real workspace root. Generated source bodies stay gitignored. */
export async function codeIndexStorage(root: string) {
  const parent = join(root, ".builderforce");
  const directory = join(parent, "index");
  for (const path of [parent, directory]) {
    await mkdir(path, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    if (!(await lstat(path)).isDirectory()) throw new Error("Code index cache directory is unavailable");
  }
  const ignore = join(directory, ".gitignore");
  await writeFile(ignore, CACHE_IGNORE, { flag: "wx", mode: 0o600 }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });
  if ((await regularFile(ignore, 1_024))?.toString("utf-8").trim() !== "*") {
    throw new Error("Code index cache directory is not gitignored");
  }

  const id = sha256Hex(root).slice(0, 24);
  const path = join(directory, `${id}.idx`);
  const lockFiles = {
    async read(name: string) { return (await regularFile(join(directory, name), 1_024))?.toString("utf-8"); },
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
  return {
    lock: () => acquireReplicaLock(lockFiles, id),
    async read(): Promise<StoredCodeIndex | undefined> {
      const bytes = await regularFile(path, MAX_META_BYTES + MAX_INDEX_BYTES + 4);
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
