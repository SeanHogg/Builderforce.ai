import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import type { ModelFileEvent } from "../pageEngineBridgeProtocol";
import { createHostModelStore } from "../../webview/src/hostModelStore";
import { createModelFileServer } from "./modelFileServer";
import { createFileModelStore } from "./modelFiles";

/**
 * ONE copy of a model in the editor: the webview's `bfi` model store (`hostModelStore`)
 * over the host's file cache (`modelFileServer`), joined by an async fake of the
 * webview's request/response bridge. A picker download lands in the host cache, and the
 * engine's load streams the very same bytes back, pulled a chunk at a time.
 */

const BONSAI = "local/bfi/bonsai-1.7b-q1_0";
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function joined(fileBytes: number) {
  const dir = mkdtempSync(path.join(tmpdir(), "bf-modelfiles-"));
  dirs.push(dir);
  const fetch = vi.fn(async () => new Response(new Uint8Array(fileBytes).fill(5), { headers: { "content-length": String(fileBytes) } }));
  const files = createFileModelStore(dir, fetch);
  const changed = vi.fn();
  const server = createModelFileServer(files, changed);
  const listeners = new Set<(event: ModelFileEvent) => void>();
  let seq = 0;
  const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  const io = {
    respond: (id: string | undefined, ok: boolean, result?: unknown, error?: string) =>
      queueMicrotask(() => {
        const p = pending.get(id!);
        pending.delete(id!);
        if (ok) p?.resolve(result);
        else p?.reject(new Error(error));
      }),
    post: (event: ModelFileEvent) => queueMicrotask(() => listeners.forEach((l) => l(event))),
  };
  const store = createHostModelStore({
    request: (type, payload) =>
      new Promise((resolve, reject) => {
        const id = `r${++seq}`;
        pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
        server.handle({ type, id, ...payload }, io);
      }) as never,
    post: (type, payload) => server.handle({ type, ...payload }, io),
    onEvent: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
  return { store, fetch, changed, dir };
}

describe("the webview's bfi store over the host's file cache", () => {
  it("downloads once into the host cache, then streams the same bytes back to the engine", async () => {
    const { store, fetch, changed } = joined(9 * 1024 * 1024);
    expect(await store.status(BONSAI)).toBe("absent");
    const progress: number[] = [];
    await store.download(BONSAI, (f) => progress.push(f));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(progress[progress.length - 1]).toBe(1);
    expect(changed).toHaveBeenCalled();
    expect(await store.status(BONSAI)).toBe("ready");

    const { stream, bytes } = await store.open(BONSAI);
    expect(bytes).toBe(9 * 1024 * 1024);
    const reader = stream.getReader();
    let total = 0;
    let chunks = 0;
    for (let r = await reader.read(); !r.done; r = await reader.read()) {
      total += r.value.byteLength;
      chunks++;
    }
    expect(total).toBe(bytes);
    // Pulled in 4 MiB pieces, one request each — never the whole file at once.
    expect(chunks).toBe(3);

    await store.remove(BONSAI);
    expect(await store.status(BONSAI)).toBe("absent");
  });

  it("reports a failed download to the picker and leaves the cache empty", async () => {
    const { store } = joined(0);
    await expect(store.download("local/webllm/Qwen3-1.7B-q4f16_1-MLC")).rejects.toThrow(/unknown_model/);
    expect(await store.status(BONSAI)).toBe("absent");
  });
});

describe("releasing a panel's reads", () => {
  it("closes the open reads of a panel that went away, and only those", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bf-release-"));
    dirs.push(dir);
    const files = createFileModelStore(dir, async () => new Response(new Uint8Array(10), { headers: { "content-length": "10" } }));
    await files.download(BONSAI);
    const server = createModelFileServer(files, () => undefined);
    const answers = new Map<string, unknown>();
    const ioFor = (owner: object) => ({
      owner,
      respond: (id: string | undefined, _ok: boolean, result?: unknown) => void answers.set(id!, result),
      post: () => undefined,
    });
    const [a, b] = [{}, {}];
    server.handle({ type: "modelFile.open", id: "1", ref: BONSAI }, ioFor(a));
    server.handle({ type: "modelFile.open", id: "2", ref: BONSAI }, ioFor(b));
    await new Promise((r) => setTimeout(r, 20));
    const ha = (answers.get("1") as { handle: string }).handle;
    const hb = (answers.get("2") as { handle: string }).handle;
    server.release(a);
    server.handle({ type: "modelFile.read", id: "3", handle: ha }, ioFor(a));
    server.handle({ type: "modelFile.read", id: "4", handle: hb }, ioFor(b));
    await new Promise((r) => setTimeout(r, 20));
    expect(answers.get("3")).toBeNull();
    expect((answers.get("4") as Uint8Array).byteLength).toBe(10);
  });
});
