import { afterEach, describe, expect, it, vi } from "vitest";
import { builderforceApiBase, requestBuilderforce } from "./builderforce-http.js";

vi.mock("./env-file.js", () => ({ readRuntimeEnvVar: () => "https://configured.example/gateway/" }));

afterEach(() => vi.unstubAllGlobals());

describe("Builderforce API transport", () => {
  it("uses the configured URL and retains its gateway prefix", () => {
    expect(builderforceApiBase()).toBe("https://configured.example/gateway");
    expect(builderforceApiBase(" https://explicit.example/ ")).toBe("https://explicit.example");
  });

  it("attaches the caller's token once and preserves the other request headers", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    await requestBuilderforce("/api/agent-hosts", "fixture", { headers: { "X-AgentHost-Id": "7", authorization: "old" } });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://configured.example/gateway/api/agent-hosts");
    expect(Object.fromEntries(new Headers(init?.headers))).toEqual({ authorization: "Bearer fixture", "x-agenthost-id": "7" });
  });
});
