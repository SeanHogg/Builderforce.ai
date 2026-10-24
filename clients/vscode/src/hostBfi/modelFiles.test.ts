import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { createFileModelStore } from "./modelFiles";

/**
 * The host's model file cache: a download lands whole or not at all, `status` only
 * looks, and `open` streams the file back as the web `ReadableStream` `BfiEngine.load`
 * takes.
 */

const BONSAI = "local/bfi/bonsai-1.7b-q1_0";
const dirs: string[] = [];
const tempDir = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), "bf-models-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function body(bytes: number): Response {
  return new Response(new Uint8Array(bytes).fill(9), { headers: { "content-length": String(bytes) } });
}

describe("createFileModelStore", () => {
  it("downloads the Hugging Face file whole, reports progress, then reads it back", async () => {
    const dir = tempDir();
    const fetch = vi.fn(async () => body(1000));
    const store = createFileModelStore(dir, fetch);
    expect(await store.status(BONSAI)).toBe("absent");
    const progress: number[] = [];
    await store.download(BONSAI, (f) => progress.push(f));
    expect(fetch).toHaveBeenCalledWith(
      "https://huggingface.co/prism-ml/Bonsai-1.7B-gguf/resolve/main/Bonsai-1.7B-Q1_0.gguf",
      expect.objectContaining({ credentials: "omit" }),
    );
    expect(progress[progress.length - 1]).toBe(1);
    expect(await store.status(BONSAI)).toBe("ready");
    expect(await store.anyReady([BONSAI, "local/bfi/bonsai-8b-q1_0"])).toBe(true);
    const { stream, bytes } = await store.open(BONSAI);
    expect(bytes).toBe(1000);
    let read = 0;
    const reader = stream.getReader();
    for (let r = await reader.read(); !r.done; r = await reader.read()) read += r.value.byteLength;
    expect(read).toBe(1000);
    await store.remove(BONSAI);
    expect(await store.status(BONSAI)).toBe("absent");
  });

  it("leaves nothing behind when a download is short or fails", async () => {
    const dir = tempDir();
    const short = new Response(new Uint8Array(10), { headers: { "content-length": "20" } });
    const store = createFileModelStore(dir, async () => short);
    await expect(store.download(BONSAI)).rejects.toThrow(/download_incomplete/);
    expect(readdirSync(dir)).toEqual([]);
    const failing = createFileModelStore(dir, async () => new Response("no", { status: 404 }));
    await expect(failing.download(BONSAI)).rejects.toThrow(/HTTP 404/);
    expect(await failing.status(BONSAI)).toBe("absent");
  });

  it("shares one transfer between two downloads of a model, and sweeps a dead writer's part file", async () => {
    const dir = tempDir();
    // A crashed window's part (pid 2^31-2 is never live) and a pre-unique-name `.part`.
    writeFileSync(path.join(dir, "Bonsai-1.7B-Q1_0.gguf.part-2147483646-abcd"), "x");
    writeFileSync(path.join(dir, "Bonsai-1.7B-Q1_0.gguf.part"), "x");
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fetch = vi.fn(async () => {
      await gate;
      return body(1000);
    });
    const store = createFileModelStore(dir, fetch);
    const first = store.download(BONSAI);
    const second = store.download(BONSAI);
    release();
    await Promise.all([first, second]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(readdirSync(dir)).toEqual(["Bonsai-1.7B-Q1_0.gguf"]);
  });

  it("tells every joiner the progress, and one joiner cancelling leaves the other's transfer running", async () => {
    const dir = tempDir();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const store = createFileModelStore(dir, async () => {
      await gate;
      return body(1000);
    });
    const picker: number[] = [];
    const provision = new AbortController();
    const provisioned = store.download(BONSAI, () => {}, provision.signal);
    const picked = store.download(BONSAI, (f) => picker.push(f));
    provision.abort();
    await expect(provisioned).rejects.toBeDefined();
    release();
    await picked;
    expect(picker.at(-1)).toBe(1);
    expect(await store.status(BONSAI)).toBe("ready");
  });

  it("stops the transfer when its only caller cancels", async () => {
    const dir = tempDir();
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      await new Promise((_, reject) => {
        if (init.signal?.aborted) reject(new Error("aborted"));
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
      return body(1);
    });
    const store = createFileModelStore(dir, fetch);
    const ac = new AbortController();
    const download = store.download(BONSAI, undefined, ac.signal);
    ac.abort();
    await expect(download).rejects.toBeDefined();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(readdirSync(dir).filter((f) => f.includes(".part"))).toEqual([]);
  });

  it("keeps the copy another window finished first, discarding its own", async () => {
    const dir = tempDir();
    const store = createFileModelStore(dir, async () => {
      writeFileSync(path.join(dir, "Bonsai-1.7B-Q1_0.gguf"), new Uint8Array(1000).fill(1));
      return body(1000);
    });
    await store.download(BONSAI);
    expect(readdirSync(dir)).toEqual(["Bonsai-1.7B-Q1_0.gguf"]);
    expect(readFileSync(path.join(dir, "Bonsai-1.7B-Q1_0.gguf"))[0]).toBe(1);
  });

  it("refuses a ref that is not an hf-file catalog model", async () => {
    const store = createFileModelStore(tempDir(), async () => body(1));
    await expect(store.download("local/webllm/Qwen3-1.7B-q4f16_1-MLC")).rejects.toThrow(/unknown_model/);
  });
});
