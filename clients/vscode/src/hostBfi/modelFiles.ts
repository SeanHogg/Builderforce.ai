/**
 * The extension host's own cache of `hf-file` models (the Bonsai GGUFs) — plain files
 * under `globalStorageUri/local-models/<runtime>/`, the `HfModelStore` the `bfi` page
 * engine reads, so the host worker runs the SAME engine adapter a page does.
 *
 * It is the editor's ONE copy: the webview's `bfi` model store is a view of it
 * (`modelFileServer.ts`), so a download (the picker's, or the one-time provisioning of
 * `provision.ts`) lands here and the webview's engine streams the same bytes back.
 *
 * A download streams to its OWN part file (`<file>.part-<pid>-<nonce>`) and is renamed
 * only when every byte arrived, so a cancelled or failed one leaves nothing a probe would
 * read as ready. Two downloads of one model in this host share one transfer; two
 * windows (each with its own host, one shared globalStorage) write separate part files,
 * and whichever finishes second finds the model ready and discards its copy — neither
 * can truncate, delete or publish the other's bytes.
 *
 * Node only (fs, streams) — never imported by a webview-reachable file.
 */
import { randomBytes } from "node:crypto";
import { createReadStream, createWriteStream, promises as fs } from "node:fs";
import * as path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { localCatalogModel } from "@builderforce/local-inference";
import { hfResolveUrl, type HfModelStore } from "@seanhogg/builderforce-brain-embedded/bfi";

const READ_CHUNK_BYTES = 4 * 1024 * 1024;

/** `<file>.part-<pid>-<nonce>` → the writer's pid. */
const PART = /\.part-(\d+)-[0-9a-f]+$/;

/** Whether `pid` is a live process (signal 0 probes without signalling). */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

export type FileFetch = (input: string, init: RequestInit) => Promise<Response>;

export interface FileModelStore extends HfModelStore {
  /** Whether any of `refs` is cached — the host attaches its worker only then. */
  anyReady(refs: readonly string[]): Promise<boolean>;
}

function hfSource(ref: string): { repo: string; file: string } {
  const row = localCatalogModel(ref);
  if (!row || row.source.kind !== "hf-file") throw new Error(`unknown_model: ${ref}`);
  return row.source;
}

export function createFileModelStore(dir: string, fetchImpl: FileFetch = (input, init) => fetch(input, init)): FileModelStore {
  const fileOf = (ref: string): string => path.join(dir, hfSource(ref).file);
  const sizeOf = async (file: string): Promise<number> => {
    try {
      const stat = await fs.stat(file);
      return stat.isFile() ? stat.size : 0;
    } catch {
      return 0;
    }
  };

  /** Part files of `name` in `dir`; `orphans` = only those whose writer is gone. */
  const partsOf = async (name: string, orphans: boolean): Promise<string[]> => {
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      return [];
    }
    return entries
      .filter((entry) => entry === `${name}.part` || (entry.startsWith(`${name}.part-`) && PART.test(entry)))
      .filter((entry) => !orphans || !PART.test(entry) || !alive(Number(PART.exec(entry)![1])))
      .map((entry) => path.join(dir, entry));
  };
  /** A transfer and who waits on it: each joiner hears progress, and the transfer
   *  stops only once every joiner has cancelled. */
  interface Shared {
    done: Promise<void>;
    listeners: Set<(fraction: number) => void>;
    joiners: number;
    abort: AbortController;
    settled: boolean;
  }
  const inFlight = new Map<string, Shared>();

  const transfer = async (ref: string, onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<void> => {
    const { repo, file: name } = hfSource(ref);
    const file = path.join(dir, name);
    await fs.mkdir(dir, { recursive: true });
    await Promise.all((await partsOf(name, true)).map((orphan) => fs.rm(orphan, { force: true })));
    const part = `${file}.part-${process.pid}-${randomBytes(4).toString("hex")}`;
    const res = await fetchImpl(hfResolveUrl(repo, name), { credentials: "omit", ...(signal ? { signal } : {}) });
    if (!res.ok || !res.body) throw new Error(`download_failed: HTTP ${res.status}`);
    const total = Number(res.headers.get("content-length")) || localCatalogModel(ref)!.bytes;
    let loaded = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        loaded += chunk.byteLength;
        onProgress?.(Math.min(1, loaded / total));
        done(null, chunk);
      },
    });
    try {
      await pipeline(Readable.fromWeb(res.body as unknown as NodeReadableStream), counter, createWriteStream(part, { flags: "wx" }), signal ? { signal } : {});
      if (loaded !== total) throw new Error(`download_incomplete: ${loaded} of ${total} bytes`);
      // Another window finished first: its copy is the model.
      if ((await sizeOf(file)) === total) return;
      await fs.rename(part, file);
    } finally {
      await fs.rm(part, { force: true });
    }
  };

  const store: FileModelStore = {
    async status(ref) {
      return (await sizeOf(fileOf(ref))) > 0 ? "ready" : "absent";
    },

    async anyReady(refs) {
      const states = await Promise.all(refs.map((ref) => store.status(ref)));
      return states.includes("ready");
    },

    async open(ref) {
      const file = fileOf(ref);
      const bytes = await sizeOf(file);
      if (bytes === 0) throw new Error(`model_not_downloaded: ${ref}`);
      // 4 MiB reads: one bridge round trip per chunk when the webview pulls them.
      const stream = Readable.toWeb(createReadStream(file, { highWaterMark: READ_CHUNK_BYTES })) as unknown as ReadableStream<Uint8Array>;
      return { stream, bytes };
    },

    /** One transfer per model in this host: a second caller joins the one running
     *  (the picker and provisioning can both ask). Each hears the progress; one
     *  cancelling leaves the others' transfer running. */
    async download(ref, onProgress, signal) {
      signal?.throwIfAborted();
      let shared = inFlight.get(ref);
      if (!shared) {
        const abort = new AbortController();
        const listeners = new Set<(fraction: number) => void>();
        const fresh: Shared = {
          listeners,
          joiners: 0,
          abort,
          settled: false,
          done: transfer(ref, (fraction) => listeners.forEach((l) => l(fraction)), abort.signal).finally(() => {
            fresh.settled = true;
            if (inFlight.get(ref) === fresh) inFlight.delete(ref);
          }),
        };
        // Every joiner awaits it (or has left); a transfer all of them cancelled
        // rejects with nobody listening, which is not an unhandled failure.
        fresh.done.catch(() => {});
        shared = fresh;
        inFlight.set(ref, shared);
      }
      const joined = shared;
      if (onProgress) joined.listeners.add(onProgress);
      joined.joiners++;
      let left = false;
      const leave = (): void => {
        if (left) return;
        left = true;
        if (onProgress) joined.listeners.delete(onProgress);
        if (--joined.joiners === 0 && !joined.settled) joined.abort.abort(signal?.reason);
      };
      try {
        if (!signal) return await joined.done;
        // This caller's cancel rejects ITS wait now; the transfer runs on while
        // another caller still wants it.
        const cancelled = new Promise<never>((_, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason ?? new Error("aborted")), { once: true });
        });
        cancelled.catch(() => {});
        return await Promise.race([joined.done, cancelled]);
      } finally {
        leave();
      }
    },

    async remove(ref) {
      const file = fileOf(ref);
      const parts = await partsOf(hfSource(ref).file, true);
      await Promise.all([file, ...parts].map((f) => fs.rm(f, { force: true })));
    },
  };
  return store;
}
