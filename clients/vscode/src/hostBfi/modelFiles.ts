/**
 * The extension host's own cache of `hf-file` models (the Bonsai GGUFs) — plain files
 * under `globalStorageUri/local-models/<runtime>/`, the `HfModelStore` the `bfi` page
 * engine reads, so the host worker runs the SAME engine adapter a page does.
 *
 * It is the editor's ONE copy: the webview's `bfi` model store is a view of it
 * (`modelFileServer.ts`), so a picker download lands here — never from a chat turn — and
 * the webview's engine streams the same bytes back. A download
 * streams to `<file>.part` and is renamed only when every byte arrived, so a cancelled or
 * failed one leaves nothing a probe would read as ready.
 *
 * Node only (fs, streams) — never imported by a webview-reachable file.
 */
import { createReadStream, createWriteStream, promises as fs } from "node:fs";
import * as path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { localCatalogModel } from "@builderforce/local-inference";
import { hfResolveUrl, type HfModelStore } from "@seanhogg/builderforce-brain-embedded/bfi";

const READ_CHUNK_BYTES = 4 * 1024 * 1024;

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

    async download(ref, onProgress, signal) {
      const { repo, file: name } = hfSource(ref);
      const file = path.join(dir, name);
      const part = `${file}.part`;
      await fs.mkdir(dir, { recursive: true });
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
        await pipeline(Readable.fromWeb(res.body as unknown as NodeReadableStream), counter, createWriteStream(part), signal ? { signal } : {});
        if (loaded !== total) throw new Error(`download_incomplete: ${loaded} of ${total} bytes`);
        await fs.rename(part, file);
      } finally {
        await fs.rm(part, { force: true });
      }
    },

    async remove(ref) {
      const file = fileOf(ref);
      await Promise.all([fs.rm(file, { force: true }), fs.rm(`${file}.part`, { force: true })]);
    },
  };
  return store;
}
