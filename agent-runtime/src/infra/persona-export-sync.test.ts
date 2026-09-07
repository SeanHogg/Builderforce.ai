import { afterEach, describe, expect, it, vi } from "vitest";
import type { PersonaPlugin } from "../builderforce/types.js";
import { syncPersonasToBuilderforce, toPersonaDefinitions } from "./persona-export-sync.js";

const OPTS = { baseUrl: "https://bf.test/", agentNodeId: "42", apiKey: "k" };

function plugin(overrides: Partial<PersonaPlugin> & Pick<PersonaPlugin, "name" | "source">) {
  return {
    description: "",
    capabilities: [],
    tools: [],
    active: false,
    ...overrides,
  } as PersonaPlugin;
}

function mockFetchOnce(ok = true, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({ ok, status });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("toPersonaDefinitions", () => {
  it("exports only user-global and project-local personas, mapped to the wire shape", () => {
    const defs = toPersonaDefinitions([
      plugin({ name: "builtin-coder", source: "builtin" }),
      plugin({ name: "platform-pm", source: "builderforce-assigned" }),
      plugin({ name: "shop-item", source: "marketplace" }),
      plugin({
        name: "reviewer",
        source: "project-local",
        description: "Reviews PRs",
        capabilities: ["review", "security"],
        persona: { voice: "terse", perspective: "maintainer", decisionStyle: "cautious" },
        // `structure` is required on AgentOutputFormat; the exporter reads only
        // `outputPrefix`, so the value here just has to be a real one.
        outputFormat: { structure: "markdown", outputPrefix: "REVIEW:" },
      }),
      plugin({ name: "writer", source: "user-global" }),
    ]);

    expect(defs.map((d) => d.id)).toEqual(["reviewer", "writer"]);
    expect(defs[0]).toEqual({
      id: "reviewer",
      name: "reviewer",
      description: "Reviews PRs",
      voice: "terse",
      perspective: "maintainer",
      outputPrefix: "REVIEW:",
      capabilities: ["review", "security"],
    });
    // Empty optional fields are omitted rather than sent as ""/[].
    expect(defs[1]).toEqual({ id: "writer", name: "writer" });
  });
});

describe("syncPersonasToBuilderforce", () => {
  it("PUTs the personas to the agent-host endpoint with a bearer token", async () => {
    const fetchMock = mockFetchOnce();
    const ok = await syncPersonasToBuilderforce(OPTS, [{ id: "reviewer", name: "reviewer" }]);
    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://bf.test/api/agent-hosts/42/personas");
    expect(init.method).toBe("PUT");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer k");
    expect(JSON.parse(String(init.body))).toEqual({
      personas: [{ id: "reviewer", name: "reviewer" }],
    });
  });

  it("no-ops without a network call when there is nothing to export", async () => {
    const fetchMock = mockFetchOnce();
    expect(await syncPersonasToBuilderforce(OPTS, [])).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("degrades to false on a non-2xx response (older API)", async () => {
    mockFetchOnce(false, 404);
    expect(await syncPersonasToBuilderforce(OPTS, [{ id: "x", name: "x" }])).toBe(false);
  });

  it("degrades to false when fetch throws (unreachable)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    expect(await syncPersonasToBuilderforce(OPTS, [{ id: "x", name: "x" }])).toBe(false);
  });
});
