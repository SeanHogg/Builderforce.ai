import { describe, expect, it, vi } from "vitest";
import { createHostPageEngineBridge } from "../pageEngineBridge";
import type { FileModelStore } from "./modelFiles";
import { installHostBfiRuntime } from "./runtime";

/**
 * `bfi` on the host: the worker joins the bridge — for `bfi` only — exactly while its
 * file cache holds a model, starts only when first asked, follows the downloads and
 * removals the webview's model store makes in that cache, and its refreshes never race.
 */

const BONSAI = "local/bfi/bonsai-1.7b-q1_0";
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

function fakeStore(initial: string[] = []): FileModelStore & { files: Set<string> } {
  const files = new Set(initial);
  return {
    files,
    status: vi.fn(async (ref: string) => (files.has(ref) ? ("ready" as const) : ("absent" as const))),
    anyReady: vi.fn(async (refs: readonly string[]) => refs.some((r) => files.has(r))),
    open: vi.fn(),
    download: vi.fn(async (ref: string) => void files.add(ref)),
    remove: vi.fn(async (ref: string) => void files.delete(ref)),
  };
}

function fakeSpawn() {
  const workers: Array<{ posted: unknown[]; terminate: ReturnType<typeof vi.fn> }> = [];
  const spawn = vi.fn((_script: string, _data: unknown) => {
    const w = { posted: [] as unknown[], terminate: vi.fn(async () => 0) };
    workers.push(w);
    return { postMessage: (m: unknown) => w.posted.push(m), on: vi.fn(), terminate: w.terminate } as never;
  });
  return { spawn, workers };
}

const options = (store: FileModelStore, spawn: ReturnType<typeof fakeSpawn>["spawn"]) => ({
  extensionPath: "/ext",
  storagePath: "/storage",
  bridge: createHostPageEngineBridge({ probeTimeoutMs: 20 }),
  store,
  spawn,
});

describe("installHostBfiRuntime", () => {
  it("attaches for bfi only once a model is cached, and starts no worker until asked", async () => {
    const { spawn, workers } = fakeSpawn();
    const o = options(fakeStore([BONSAI]), spawn);
    installHostBfiRuntime(o);
    await flush();
    expect(o.bridge.connected("bfi")).toBe(true);
    expect(o.bridge.connected("webllm")).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
    void o.bridge.probe({ fresh: true });
    await flush();
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn.mock.calls[0]![0]).toMatch(/bfiHostWorker\.js$/);
    expect(workers[0]!.posted).toContainEqual(expect.objectContaining({ type: "pageEngine.probe", runtime: "bfi" }));
  });

  it("stays detached with an empty cache", async () => {
    const { spawn } = fakeSpawn();
    const o = options(fakeStore(), spawn);
    installHostBfiRuntime(o);
    await flush();
    expect(o.bridge.connected("bfi")).toBe(false);
  });

  it("re-attaches when the webview's model store downloads into the host cache, and detaches on removal", async () => {
    const { spawn, workers } = fakeSpawn();
    const store = fakeStore();
    const o = options(store, spawn);
    const runtime = installHostBfiRuntime(o);
    await flush();
    expect(o.bridge.connected("bfi")).toBe(false);
    const io = { respond: vi.fn(), post: vi.fn() };
    runtime.files.handle({ type: "modelFile.download", id: "r1", ref: BONSAI, handle: "d-1" }, io);
    await flush();
    expect(store.download).toHaveBeenCalledWith(BONSAI, expect.any(Function), expect.any(AbortSignal));
    expect(io.post).toHaveBeenCalledWith(expect.objectContaining({ type: "modelFile.downloaded", ok: true }));
    expect(o.bridge.connected("bfi")).toBe(true);
    void o.bridge.probe({ fresh: true });
    await flush();
    runtime.files.handle({ type: "modelFile.remove", id: "r2", ref: BONSAI }, io);
    await flush();
    expect(store.remove).toHaveBeenCalledWith(BONSAI);
    expect(o.bridge.connected("bfi")).toBe(false);
    expect(workers[0]!.terminate).toHaveBeenCalled();
  });

  it("serializes overlapping refreshes: one runs, exactly one follow-up queues, one port attaches", async () => {
    const { spawn } = fakeSpawn();
    const store = fakeStore([BONSAI]);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let reads = 0;
    store.anyReady = vi.fn(async (refs: readonly string[]) => {
      reads++;
      if (reads === 2) await gate;
      return refs.some((r) => store.files.has(r));
    });
    const o = options(store, spawn);
    const attach = vi.spyOn(o.bridge, "attach");
    const runtime = installHostBfiRuntime(o);
    await flush();
    const a = runtime.refresh(); // read 2, held at the gate
    const b = runtime.refresh(); // queued
    const c = runtime.refresh(); // joins the queued one
    expect(b).toBe(c);
    release();
    await Promise.all([a, b, c]);
    expect(reads).toBe(3);
    expect(attach).toHaveBeenCalledTimes(1);
    expect(o.bridge.connected("bfi")).toBe(true);
  });

  it("attaches nothing when disposed while a refresh is reading the cache", async () => {
    const { spawn } = fakeSpawn();
    const store = fakeStore([BONSAI]);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    store.anyReady = vi.fn(async () => {
      await gate;
      return true;
    });
    const o = options(store, spawn);
    const runtime = installHostBfiRuntime(o);
    runtime.dispose();
    release();
    await flush();
    expect(o.bridge.connected("bfi")).toBe(false);
  });

  it("answers the webview picker's modelFile.support with the host's CPU record, without starting the worker", async () => {
    const { spawn } = fakeSpawn();
    const o = options(fakeStore(), spawn);
    const runtime = installHostBfiRuntime(o);
    const io = { respond: vi.fn(), post: vi.fn() };
    runtime.files.handle({ type: "modelFile.support", id: "s1" }, io);
    await flush();
    expect(io.respond).toHaveBeenCalledWith("s1", true, expect.objectContaining({ backends: expect.objectContaining({ cpu: expect.objectContaining({ deviceMemoryBytes: expect.any(Number) }) }) }));
    expect(spawn).not.toHaveBeenCalled();
  });

  it("a download of a model only the CPU fits lands in the host cache and attaches the host worker", async () => {
    const { spawn } = fakeSpawn();
    const store = fakeStore();
    const o = options(store, spawn);
    const runtime = installHostBfiRuntime(o);
    await flush();
    const EIGHT = "local/bfi/bonsai-8b-q1_0";
    runtime.files.handle({ type: "modelFile.download", id: "r1", ref: EIGHT, handle: "d-8" }, { respond: vi.fn(), post: vi.fn() });
    await flush();
    expect(store.files.has(EIGHT)).toBe(true);
    expect(o.bridge.connected("bfi")).toBe(true);
  });

  it("dispose detaches", async () => {
    const { spawn } = fakeSpawn();
    const o = options(fakeStore([BONSAI]), spawn);
    const runtime = installHostBfiRuntime(o);
    await flush();
    runtime.dispose();
    expect(o.bridge.connected("bfi")).toBe(false);
  });
});
