import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CapabilityProvider } from "@builderforce/agent-tools";
import type { KnowledgeClient } from "@builderforce/knowledge-client";
import { knowledgeSurfaceUrl, onPremKnowledgeClient, onPremKnowledgeRowsHost } from "./onPremKnowledge.js";

const linked = { client: { graph: vi.fn(async () => null) } as unknown as KnowledgeClient, projectId: 42 };
const caps = {} as CapabilityProvider;

describe("the on-prem knowledge host", () => {
  it("answers /graph with the web canvas's knowledge surface for the project", async () => {
    const root = await mkdtemp(join(tmpdir(), "kg-"));
    const host = onPremKnowledgeRowsHost({ workspaceRoot: root, caps, linked });
    expect(knowledgeSurfaceUrl(42)).toMatch(/\/projects\/42\?surface=knowledge$/);
    const shown = await host.showGraph(await host.rootId(), ["src:x::a.ts"]);
    expect(shown.text).toContain(knowledgeSurfaceUrl(42));
    expect(shown.chip).toBeUndefined();
  });

  it("opens only folders inside the workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "kg-"));
    await mkdir(join(root, "docs"));
    await writeFile(join(root, "docs", "a.md"), "# A\n");
    const host = onPremKnowledgeRowsHost({ workspaceRoot: root, caps, linked });
    expect(await host.openReview("../")).toBeNull();
    expect(await host.openReview("missing")).toBeNull();
    const session = await host.openReview("docs");
    expect(session?.rootId).toBe(`${await host.rootId()}:docs`);
    expect(session?.title).toBe("docs");
  });

  afterEach(() => vi.unstubAllGlobals());

  it("speaks through the agent-host door with the host key and host id", async () => {
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      seen.push({ url, headers: init?.headers as Record<string, string> });
      return new Response(JSON.stringify({ scopes: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));
    const linkedHost = onPremKnowledgeClient({ gatewayUrl: "https://api.example.test/", apiKey: "bfk_host", agentHostId: 17, projectId: 42 });
    expect(linkedHost?.projectId).toBe(42);
    await linkedHost!.client.scopes();
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe("https://api.example.test/api/agent/projects/42/knowledge/scopes");
    expect(seen[0]!.headers).toMatchObject({ Authorization: "Bearer bfk_host", "X-AgentHost-Id": "17" });
  });

  it("offers no client when the host is not linked", () => {
    expect(onPremKnowledgeClient(null)).toBeUndefined();
  });
});
