import { afterEach, describe, expect, it, vi } from "vitest";
import type { BuilderForceAgentsConfig } from "../config/config.js";
import { cascadeTargets, runProviderCascade } from "./provider-cascade.js";

// One credential rule for targets and calls: a keyless OpenAI-wire server is callable only
// on loopback, so a caller that probes `cascadeTargets` never advertises one the cascade skips.

function config(providers: Record<string, unknown>): BuilderForceAgentsConfig {
  return { models: { providers } } as unknown as BuilderForceAgentsConfig;
}

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe("cascadeTargets — keyless OpenAI-wire providers", () => {
  it("keeps a keyless loopback server and drops a keyless remote one", () => {
    const targets = cascadeTargets(
      config({
        local: { baseUrl: "http://localhost:8000/v1", api: "openai-completions", models: [{ id: "m" }] },
        remote: { baseUrl: "https://llm.example.com/v1", api: "openai-responses", models: [{ id: "m" }] },
        keyed: { baseUrl: "https://llm.example.com/v1", api: "openai-completions", apiKey: "sk-x", models: [{ id: "m" }] },
      }),
    );
    expect(targets.map((t) => t.id)).toEqual(["local", "keyed"]);
  });
});

describe("runProviderCascade", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("calls a keyless loopback server without an Authorization header", async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
      return ok({ choices: [{ message: { content: "hi" } }] });
    });
    const answer = await runProviderCascade({
      config: config({ local: { baseUrl: "http://127.0.0.1:8000/v1", api: "openai-completions", models: [{ id: "m" }] } }),
      messages: [{ role: "user", content: "q" }],
      maxTokens: 16,
      temperature: 0,
    });
    expect(answer).toBe("hi");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.headers.Authorization).toBeUndefined();
  });

  it("still sends the bearer when a key is configured", async () => {
    let auth: string | undefined;
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
      auth = (init?.headers as Record<string, string>).Authorization;
      return ok({ choices: [{ message: { content: "hi" } }] });
    });
    await runProviderCascade({
      config: config({ keyed: { baseUrl: "https://llm.example.com/v1", api: "openai-completions", apiKey: "sk-x", models: [{ id: "m" }] } }),
      messages: [{ role: "user", content: "q" }],
      maxTokens: 16,
      temperature: 0,
    });
    expect(auth).toBe("Bearer sk-x");
  });

  it("never calls a keyless remote server", async () => {
    const fetch = vi.fn(async () => ok({}));
    vi.stubGlobal("fetch", fetch);
    const answer = await runProviderCascade({
      config: config({ remote: { baseUrl: "https://llm.example.com/v1", api: "openai-completions", models: [{ id: "m" }] } }),
      messages: [{ role: "user", content: "q" }],
      maxTokens: 16,
      temperature: 0,
    });
    expect(answer).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
