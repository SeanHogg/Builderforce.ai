import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BuilderForceAgentsConfig } from "../../config/config.js";
import { buildConvergedFileTools } from "../converged-coding-tools.js";
import {
  isLocalResearchProvider,
  onPremResearchModel,
  resetLocalResearchProbesForTests,
  resolveOnPremResearch,
} from "./on-prem-research-model.js";

const OLLAMA = "http://127.0.0.1:11434";

/** A cloud primary (with a key) beside a local Ollama: research must never reach the cloud. */
function config(): BuilderForceAgentsConfig {
  return {
    agents: { defaults: { model: { primary: "openai/gpt-5" } } },
    models: {
      providers: {
        openai: { baseUrl: "https://api.openai.com/v1", api: "openai-completions", apiKey: "sk-test", models: [{ id: "gpt-5" }] },
        ollama: { baseUrl: OLLAMA, api: "ollama", models: [{ id: "qwen3:8b" }] },
      },
    },
  } as unknown as BuilderForceAgentsConfig;
}

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe("isLocalResearchProvider", () => {
  it("keeps providers served on this machine over a wire the cascade calls", () => {
    expect(isLocalResearchProvider("ollama", { api: "ollama", baseUrl: OLLAMA })).toBe(true);
    expect(isLocalResearchProvider("lmstudio", { api: "openai-completions", baseUrl: "http://localhost:1234/v1" })).toBe(true);
    expect(isLocalResearchProvider("openai", { api: "openai-completions", baseUrl: "https://api.openai.com/v1" })).toBe(false);
    // node-llama-cpp is local, but not a wire the cascade speaks.
    expect(isLocalResearchProvider("llama", { api: "llama", baseUrl: "/models/x.gguf" })).toBe(false);
  });

  it("refuses a local-sounding provider whose baseUrl leaves this machine", () => {
    expect(isLocalResearchProvider("ollama", { api: "ollama", baseUrl: "http://192.168.1.50:11434" })).toBe(false);
    expect(isLocalResearchProvider("ollama", { api: "ollama", baseUrl: "https://ollama.example.com" })).toBe(false);
    expect(isLocalResearchProvider("lmstudio", { api: "openai-completions", baseUrl: "http://10.0.0.7:1234/v1" })).toBe(false);
    expect(isLocalResearchProvider("ollama", { api: "ollama" })).toBe(false);
    expect(isLocalResearchProvider("vllm", { api: "openai-completions", baseUrl: "http://[::1]:8000/v1" })).toBe(true);
  });
});

describe("a remote Ollama is never a research target", () => {
  afterEach(() => {
    resetLocalResearchProbesForTests();
    vi.unstubAllGlobals();
  });

  it("builds no research model and sends nothing when the only Ollama is on the LAN", async () => {
    const remote = {
      models: { providers: { ollama: { baseUrl: "http://192.168.1.50:11434", api: "ollama", models: [{ id: "qwen3:8b" }] } } },
    } as unknown as BuilderForceAgentsConfig;
    const fetch = vi.fn(async () => ok({ models: [] }));
    expect(onPremResearchModel(remote, { fetch })).toBeNull();
    expect(await resolveOnPremResearch(tmpdir(), remote, { fetch })).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("a keyless loopback OpenAI-compatible server", () => {
  afterEach(() => {
    resetLocalResearchProbesForTests();
    vi.unstubAllGlobals();
  });

  const keyless = {
    models: { providers: { lmstudio: { baseUrl: "http://127.0.0.1:1234/v1", api: "openai-completions", models: [{ id: "qwen" }] } } },
  } as unknown as BuilderForceAgentsConfig;

  it("is advertised AND answers — the cascade calls it without a bearer", async () => {
    const model = onPremResearchModel(keyless, { fetch: async () => ok({ data: [] }) })!;
    expect(await model.available()).toBe(true);
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      seen.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
      return ok({ choices: [{ message: { content: "found it" } }] });
    });
    expect(await model.complete([{ role: "user", content: "q" }], new AbortController().signal)).toBe("found it");
    expect(seen.map((s) => s.url)).toEqual(["http://127.0.0.1:1234/v1/chat/completions"]);
    expect(seen[0]!.headers.Authorization).toBeUndefined();
  });
});

describe("onPremResearchModel", () => {
  afterEach(() => {
    resetLocalResearchProbesForTests();
    vi.unstubAllGlobals();
  });

  it("is null when no local provider is configured", () => {
    expect(onPremResearchModel(undefined)).toBeNull();
    const cloudOnly = { models: { providers: { openai: config().models!.providers!.openai } } } as unknown as BuilderForceAgentsConfig;
    expect(onPremResearchModel(cloudOnly)).toBeNull();
  });

  it("is available only while the local catalog route answers, memoized per URL", async () => {
    const calls: string[] = [];
    const up = onPremResearchModel(config(), { fetch: async (url) => (calls.push(url), ok({ models: [] })) })!;
    expect(await up.available()).toBe(true);
    expect(await up.available()).toBe(true);
    expect(calls).toEqual([`${OLLAMA}/api/tags`]);

    resetLocalResearchProbesForTests();
    const down = onPremResearchModel(config(), {
      fetch: async () => {
        throw new Error("ECONNREFUSED");
      },
    })!;
    expect(await down.available()).toBe(false);
  });

  it("completes through the cascade narrowed to the local provider — never the cloud primary", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      return ok({ message: { content: "chargeInvoice is defined at src/billing.ts:1" } });
    });
    const model = onPremResearchModel(config())!;
    const answer = await model.complete([{ role: "user", content: "where is chargeInvoice?" }], new AbortController().signal);
    expect(answer).toBe("chargeInvoice is defined at src/billing.ts:1");
    expect(urls).toEqual([`${OLLAMA}/api/chat`]);
  });

  it("throws when the local model answers nothing (the tool then returns its search hits)", async () => {
    vi.stubGlobal("fetch", async () => new Response("down", { status: 500 }));
    const model = onPremResearchModel(config())!;
    await expect(model.complete([{ role: "user", content: "q" }], new AbortController().signal)).rejects.toThrow(/No local model/);
  });
});

describe("resolveOnPremResearch", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "bf-onprem-research-"));
    await writeFile(join(root, "a.ts"), "export const a = 1;\n");
  });
  afterEach(async () => {
    resetLocalResearchProbesForTests();
    await rm(root, { recursive: true, force: true });
  });

  it("is undefined while no local model answers", async () => {
    const fetch = async () => new Response("", { status: 404 });
    expect(await resolveOnPremResearch(root, config(), { fetch })).toBeUndefined();
  });

  it("backs local.research with workspace fingerprints and the cache under .builderforce/", async () => {
    const research = await resolveOnPremResearch(root, config(), { fetch: async () => ok({ models: [] }) });
    expect(research).toBeDefined();
    const prints = await research!.fingerprint(["a.ts", "missing.ts", "../outside.ts"]);
    expect(prints.map((p) => p.path)).toEqual(["a.ts"]);
    await research!.cache!.set("k", "the answer");
    expect(await research!.cache!.get("k")).toBe("the answer");
    const persisted = JSON.parse(await readFile(join(root, ".builderforce", "research-cache.json"), "utf-8")) as {
      entries: Array<[string, string]>;
    };
    expect(persisted.entries).toEqual([["k", "the answer"]]);
  });
});

describe("local_research in the converged catalog", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "bf-onprem-research-cat-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("is advertised with a research backing and withheld without one", () => {
    const research = {
      complete: async () => "answer",
      fingerprint: async () => [],
    };
    expect(buildConvergedFileTools({ workspaceRoot: root, research }).map((t) => t.name)).toContain("local_research");
    expect(buildConvergedFileTools({ workspaceRoot: root }).map((t) => t.name)).not.toContain("local_research");
  });
});
