/**
 * The Knowledge view's "last seen" file (the view package's `KnowledgeGraphSource.lastSeen`):
 * the scopes and the graph of the last FULL load, one JSON file per workspace under the
 * extension's global storage, so a reopened panel paints its first frame from disk while the
 * fresh read runs. Plain `node:fs` and no `vscode`, so it is tested without an editor.
 *
 * A write is atomic (temp file, then rename) and skipped when the graph is too big to be a
 * quick local read. A read returns null on ANY error: a missing, torn or foreign file is
 * "nothing remembered", never a failure.
 */

import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { KnowledgeGraph } from "@seanhogg/builderforce-memory/knowledge";
import type { KnowledgeScopeRow } from "./knowledgeProtocol";

/** A graph whose JSON is larger than this is not remembered (the read must stay fast). */
export const LAST_SEEN_MAX_BYTES = 8 * 1024 * 1024;

export interface LastSeenRecord {
  scopes: KnowledgeScopeRow[];
  rootId: string;
  graph: KnowledgeGraph;
}

/**
 * One key per workspace AND account: the folders (order-independent) behind who is signed in
 * (`identity`: the acting tenant and linked project; "local" for an unlinked workspace), so one
 * account's graph is never painted for another.
 */
export const workspaceKey = (folders: readonly { path: string }[], identity = "local"): string =>
  `${identity}#${folders.map((f) => f.path).sort().join("|")}`;

/** Forgets every remembered graph (sign-out). Never throws. */
export async function clearLastSeen(storageDir: string): Promise<void> {
  await rm(join(storageDir, "knowledge-last-seen"), { recursive: true, force: true }).catch(() => undefined);
}

const fileFor = (storageDir: string, key: string): string =>
  join(storageDir, "knowledge-last-seen", `${createHash("sha1").update(key).digest("hex")}.json`);

/** The tail of each file's write chain: writes to ONE key run strictly in order, never interleaved. */
const chains = new Map<string, Promise<unknown>>();
let tempCounter = 0;

/** True when written; false when skipped (too big) or the write failed. Never throws. */
export function writeLastSeen(storageDir: string, key: string, record: LastSeenRecord): Promise<boolean> {
  const file = fileFor(storageDir, key);
  const run = (chains.get(file) ?? Promise.resolve()).then(() => writeOnce(storageDir, file, record));
  const tail = run.finally(() => { if (chains.get(file) === tail) chains.delete(file); });
  chains.set(file, tail);
  return run;
}

async function writeOnce(storageDir: string, file: string, record: LastSeenRecord): Promise<boolean> {
  // Unique per write: pid + counter + random, so two writers never share (or clobber) a temp file.
  const temp = `${file}.${process.pid}.${++tempCounter}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    const json = JSON.stringify(record);
    if (Buffer.byteLength(json) > LAST_SEEN_MAX_BYTES) return false;
    await mkdir(join(storageDir, "knowledge-last-seen"), { recursive: true });
    await writeFile(temp, json, "utf8");
    await rename(temp, file);
    return true;
  } catch {
    await rm(temp, { force: true }).catch(() => undefined);
    return false;
  }
}

/** The remembered record of this workspace, or null on any error. */
export async function readLastSeen(storageDir: string, key: string): Promise<LastSeenRecord | null> {
  try {
    const parsed = JSON.parse(await readFile(fileFor(storageDir, key), "utf8")) as Partial<LastSeenRecord> | null;
    if (!parsed || typeof parsed.rootId !== "string" || !Array.isArray(parsed.scopes) || !parsed.graph || !Array.isArray(parsed.graph.nodes)) return null;
    return { scopes: parsed.scopes, rootId: parsed.rootId, graph: parsed.graph };
  } catch {
    return null;
  }
}
