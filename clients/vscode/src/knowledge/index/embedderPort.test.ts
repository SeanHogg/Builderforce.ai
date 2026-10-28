import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { resolveWarmEmbedder } from "@builderforce/agent-tools/knowledge-index";
import type { FetchLike } from "@builderforce/local-inference";
import type { EmbedderPort } from "@seanhogg/builderforce-memory/knowledge";
import { evermindCheckpointStamp, evermindEmbedderSource, ollamaEmbedderSource } from "./embedderPort";

const fakePort = (fingerprint: string, dims = 3): EmbedderPort => ({
  fingerprint,
  dims,
  embed: async (texts) => texts.map(() => new Float32Array(dims)),
});

/** A single-slot idle scheduler run by hand. */
function manualIdle() {
  let task: (() => Promise<void>) | undefined;
  const idle = (t: () => Promise<void>) => { task = t; };
  return { idle, run: async () => { const t = task; task = undefined; await t?.(); } };
}

const json = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200 });

describe("editor embedder — Evermind CPU", () => {
  it("is present only when the configured checkpoint file exists, stamped with its save time", () => {
    const dir = mkdtempSync(join(tmpdir(), "bf-evermind-"));
    const file = join(dir, "model.evermind");
    expect(evermindCheckpointStamp({})).toBeUndefined();
    expect(evermindCheckpointStamp({ BUILDERFORCE_MEMORY_MODEL: file })).toBeUndefined();
    writeFileSync(file, "x");
    expect(evermindCheckpointStamp({ BUILDERFORCE_MEMORY_MODEL: file })).toMatch(new RegExp(`^${file.replace(/[\\.]/g, "\\$&")}@\\d+$`));
  });

  it("reads cold until the idle load lands, never loading on the request", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bf-evermind-"));
    const file = join(dir, "model.evermind");
    writeFileSync(file, "x");
    const sched = manualIdle();
    const load = vi.fn(async (stamp: string) => fakePort(`evermind-cpu:lm@${stamp}`));
    const source = evermindEmbedderSource(sched.idle, { BUILDERFORCE_MEMORY_MODEL: file }, load);
    expect(await resolveWarmEmbedder([source])).toBeUndefined();
    expect(load).not.toHaveBeenCalled();
    await sched.run();
    expect((await resolveWarmEmbedder([source]))?.fingerprint).toContain("evermind-cpu:lm@");
  });
});

describe("editor embedder — Ollama", () => {
  const endpoint = { baseUrl: "http://127.0.0.1:11434" };

  it("is warm only while an embedding model is resident, and Evermind outranks it", async () => {
    const fetchImpl = vi.fn<FetchLike>(async (url, init) => {
      if (url.endsWith("/api/ps")) return json({ models: [{ name: "nomic-embed-text", digest: "abcdefabcdef0000" }] });
      if (url.endsWith("/api/show")) return json({ capabilities: ["embedding"] });
      const input = (JSON.parse(String(init?.body)) as { input: string[] }).input;
      return json({ embeddings: input.map(() => [0.1, 0.2, 0.3, 0.4]) });
    });
    const ollama = ollamaEmbedderSource(endpoint, fetchImpl);
    expect(ollama.warm()).toBe(false);
    await vi.waitFor(() => expect(ollama.warm()).toBe(true));
    const port = await resolveWarmEmbedder([ollama]);
    expect(port?.fingerprint).toBe("ollama:nomic-embed-text@abcdefabcdef:4");
    const evermind = { id: "evermind" as const, warm: () => true, port: () => fakePort("evermind-cpu:x") };
    expect((await resolveWarmEmbedder([ollama, evermind]))?.fingerprint).toBe("evermind-cpu:x");
  });

  it("a resident chat model is not an embedder", async () => {
    const fetchImpl = vi.fn<FetchLike>(async (url) => {
      if (url.endsWith("/api/ps")) return json({ models: [{ name: "qwen3:8b" }] });
      return json({ capabilities: ["completion", "tools"] });
    });
    const ollama = ollamaEmbedderSource(endpoint, fetchImpl);
    ollama.warm();
    await vi.waitFor(() => expect(fetchImpl.mock.calls.some(([url]) => url.endsWith("/api/show"))).toBe(true));
    await new Promise((r) => setTimeout(r, 0));
    expect(ollama.warm()).toBe(false);
    expect(fetchImpl.mock.calls.some(([url]) => url.endsWith("/api/embed"))).toBe(false);
  });
});
