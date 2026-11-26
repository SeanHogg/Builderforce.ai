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

/** A graph whose JSON is larger than this is not remembered (the read must stay fast). Room for a 20k-file outline. */
export const LAST_SEEN_MAX_BYTES = 24 * 1024 * 1024;

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

/** How a write ended, for the log: never silent (a skip says why, with sizes). */
export interface LastSeenWriteReport {
  outcome: "written" | "oversize" | "error";
  /** Bytes serialised (for `oversize`: at least this many, serialising stopped at the cap). */
  bytes: number;
  ms: number;
  error?: string;
}

/** Array members serialised per slice, and the pause between slices: a huge graph never holds the host's thread for seconds. */
const SLICE = 4000;
const yieldThread = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/**
 * `JSON.stringify(record)` in slices: each large array of the graph is serialised {@link SLICE} members at a time with the
 * event loop released between slices, and it stops as soon as the cap is passed (the rest would be discarded anyway).
 * Returns the JSON, or the bytes counted when it stopped over the cap.
 */
async function serialise(record: LastSeenRecord): Promise<{ json: string } | { over: number }> {
  let bytes = 0;
  const parts: string[] = [];
  const add = (s: string): boolean => { parts.push(s); bytes += Buffer.byteLength(s); return bytes <= LAST_SEEN_MAX_BYTES; };
  const { graph, ...rest } = record;
  if (!add(`{${Object.entries(rest).map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`).join(",")},"graph":{`)) return { over: bytes };
  let first = true;
  for (const [k, v] of Object.entries(graph as unknown as Record<string, unknown>)) {
    if (v === undefined) continue;
    if (!add(`${first ? "" : ","}${JSON.stringify(k)}:`)) return { over: bytes };
    first = false;
    if (Array.isArray(v) && v.length > SLICE) {
      if (!add("[")) return { over: bytes };
      for (let i = 0; i < v.length; i += SLICE) {
        const slice = JSON.stringify(v.slice(i, i + SLICE));
        if (!add(`${i === 0 ? "" : ","}${slice.slice(1, -1)}`)) return { over: bytes };
        await yieldThread();
      }
      if (!add("]")) return { over: bytes };
    } else if (!add(JSON.stringify(v))) return { over: bytes };
  }
  add("}}");
  return bytes > LAST_SEEN_MAX_BYTES ? { over: bytes } : { json: parts.join("") };
}

/** True when written; false when skipped (too big) or the write failed. Never throws; `report` says which, with sizes and time. */
export function writeLastSeen(storageDir: string, key: string, record: LastSeenRecord, report?: (r: LastSeenWriteReport) => void): Promise<boolean> {
  const file = fileFor(storageDir, key);
  const run = (chains.get(file) ?? Promise.resolve()).then(() => writeOnce(storageDir, file, record, report));
  const tail = run.finally(() => { if (chains.get(file) === tail) chains.delete(file); });
  chains.set(file, tail);
  return run;
}

async function writeOnce(storageDir: string, file: string, record: LastSeenRecord, report?: (r: LastSeenWriteReport) => void): Promise<boolean> {
  // Unique per write: pid + counter + random, so two writers never share (or clobber) a temp file.
  const temp = `${file}.${process.pid}.${++tempCounter}.${randomBytes(4).toString("hex")}.tmp`;
  const t0 = Date.now();
  let bytes = 0;
  try {
    const out = await serialise(record);
    if ("over" in out) { report?.({ outcome: "oversize", bytes: out.over, ms: Date.now() - t0 }); return false; }
    bytes = Buffer.byteLength(out.json);
    await mkdir(join(storageDir, "knowledge-last-seen"), { recursive: true });
    await writeFile(temp, out.json, "utf8");
    await rename(temp, file);
    report?.({ outcome: "written", bytes, ms: Date.now() - t0 });
    return true;
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    report?.({ outcome: "error", bytes, ms: Date.now() - t0, error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

/** The remembered record of this workspace, or null on any error; `onMiss` says why (absent file, an unexpected shape, or the error). */
export async function readLastSeen(storageDir: string, key: string, onMiss?: (reason: string) => void): Promise<LastSeenRecord | null> {
  try {
    const parsed = JSON.parse(await readFile(fileFor(storageDir, key), "utf8")) as Partial<LastSeenRecord> | null;
    if (!parsed || typeof parsed.rootId !== "string" || !Array.isArray(parsed.scopes) || !parsed.graph || !Array.isArray(parsed.graph.nodes)) { onMiss?.("unreadable: the file's shape is not a last-seen record"); return null; }
    return { scopes: parsed.scopes, rootId: parsed.rootId, graph: parsed.graph };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    onMiss?.(code === "ENOENT" ? "absent: nothing was written for this workspace key (a version/key change, or no earlier write finished)" : `error: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}
