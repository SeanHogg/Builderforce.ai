import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CapabilityProvider } from "@builderforce/agent-tools";
import type { KnowledgeClient } from "@builderforce/knowledge-client";
import path from "node:path";
import { insideWorkspace, knowledgeSurfaceUrl, onPremKnowledgeClient, onPremKnowledgeRowsHost, realPathWithin } from "./onPremKnowledge.js";

const linked = { client: { graph: vi.fn(async () => null) } as unknown as KnowledgeClient, projectId: 42 };
const caps = {} as CapabilityProvider;

describe("the on-prem knowledge host", () => {
  it("answers /graph with the web canvas's knowledge surface for the project", async () => {
    const root = await mkdtemp(join(tmpdir(), "kg-"));
    const host = onPremKnowledgeRowsHost({ workspaceRoot: root, caps, linked });
    expect(knowledgeSurfaceUrl(42)).toMatch(/\/projects\/42\?surface=knowledge$/);
    const shown = await host.showGraph(await host.rootId(), ["src:x::a.ts"]);
    // The link carries the focus the way the web canvas's knowledge surface reads it (`kgFocus`, a JSON array).
    expect(shown.text).toContain(knowledgeSurfaceUrl(42, ["src:x::a.ts"]));
    const query = new URL(knowledgeSurfaceUrl(42, ["src:x::a.ts"])).searchParams;
    expect(query.get("surface")).toBe("knowledge");
    expect(JSON.parse(query.get("kgFocus") ?? "[]")).toEqual(["src:x::a.ts"]);
    expect(new URL(knowledgeSurfaceUrl(42, Array.from({ length: 30 }, (_, i) => `src:x::f${i}.ts`))).searchParams.get("kgFocus")).toContain("f19.ts");
    expect(new URL(knowledgeSurfaceUrl(42, Array.from({ length: 30 }, (_, i) => `src:x::f${i}.ts`))).searchParams.get("kgFocus")).not.toContain("f20.ts");
    // The chip carries the root and the named files' focus refs — the same shape every host answers with.
    expect(shown.chip).toEqual({
      labelKey: "prefetch.chip.openInGraph",
      command: "builderforce.openKnowledgeGraph",
      args: { rootId: await host.rootId(), focus: ["src:x::a.ts"] },
    });
  });

  it("prices the confirm chip with the platform's judge estimate through the linked client", async () => {
    const judgeEstimate = vi.fn(async () => ({ perCallUsd: 0.003, model: "m", local: false }));
    const withEstimate = { client: { judgeEstimate } as unknown as KnowledgeClient, projectId: 42 };
    const host = onPremKnowledgeRowsHost({ workspaceRoot: await mkdtemp(join(tmpdir(), "kg-")), caps, linked: withEstimate });
    expect(await host.callPrice!()).toEqual({ perCallUsd: 0.003, model: "m", local: false });
    expect(judgeEstimate).toHaveBeenCalledTimes(1);
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

  it("rejects paths outside the workspace, on another drive too", () => {
    expect(insideWorkspace("/ws/repo", "/ws/repo/docs", path.posix)).toBe("docs");
    expect(insideWorkspace("/ws/repo", "/ws/repo", path.posix)).toBe("");
    expect(insideWorkspace("/ws/repo", "/ws/other", path.posix)).toBeUndefined();
    expect(insideWorkspace("/ws/repo", "/ws", path.posix)).toBeUndefined();
    expect(insideWorkspace("C:\\ws", "C:\\ws\\docs\\specs", path.win32)).toBe("docs/specs");
    expect(insideWorkspace("C:\\ws", "C:\\other", path.win32)).toBeUndefined();
    // Another drive has no relative form: `relative` answers an absolute path.
    expect(insideWorkspace("C:\\ws", "D:\\x", path.win32)).toBeUndefined();
    // A folder whose NAME starts with dots is a folder.
    expect(insideWorkspace("/ws/repo", "/ws/repo/..cache", path.posix)).toBe("..cache");
  });

  it("rejects a folder outside the workspace even when a link inside it leads there", async (ctx) => {
    const base = await mkdtemp(join(tmpdir(), "kg-link-"));
    const root = join(base, "ws");
    const outside = join(base, "elsewhere");
    await mkdir(join(root, "docs"), { recursive: true });
    await mkdir(outside);
    await writeFile(join(outside, "secret.md"), "# Elsewhere\n");
    try {
      // A junction needs no privilege on Windows; elsewhere it is an ordinary directory link.
      await symlink(outside, join(root, "link"), "junction");
    } catch {
      ctx.skip(); // This platform will not create the link here.
      return;
    }
    const host = onPremKnowledgeRowsHost({ workspaceRoot: root, caps, linked });
    expect(await host.openReview("link")).toBeNull();
    expect(await realPathWithin(root, join(root, "link"))).toBeUndefined();
    // A real folder of the workspace is unaffected.
    expect((await host.openReview("docs"))?.title).toBe("docs");
    expect(await realPathWithin(root, join(root, "docs"))).toBe(await realpath(join(root, "docs")));
  });

  it("refuses to review a folder that became a link outside the workspace after it was opened", async (ctx) => {
    const base = await mkdtemp(join(tmpdir(), "kg-swap-"));
    const root = join(base, "ws");
    const outside = join(base, "elsewhere");
    await mkdir(join(root, "docs"), { recursive: true });
    await mkdir(outside);
    await writeFile(join(outside, "secret.md"), "# Elsewhere\n");
    const host = onPremKnowledgeRowsHost({ workspaceRoot: root, caps, linked });
    const session = await host.openReview("docs");
    expect(session?.title).toBe("docs");
    await rm(join(root, "docs"), { recursive: true });
    try {
      await symlink(outside, join(root, "docs"), "junction");
    } catch {
      ctx.skip(); // This platform will not create the link here.
      return;
    }
    // Refused before any port is built or file read, so the plan argument is never consulted.
    await expect(session!.review({} as never, new AbortController().signal)).rejects.toThrow(/no folder `docs`/);
  });

  it("refuses to review a folder that was replaced by a file after it was opened", async () => {
    const root = await mkdtemp(join(tmpdir(), "kg-file-"));
    await mkdir(join(root, "docs"));
    const host = onPremKnowledgeRowsHost({ workspaceRoot: root, caps, linked });
    const session = await host.openReview("docs");
    expect(session?.title).toBe("docs");
    await rm(join(root, "docs"), { recursive: true });
    await writeFile(join(root, "docs"), "not a folder\n");
    // Refused before any port is built, so the plan argument is never consulted — and so for the preview.
    await expect(session!.review({} as never, new AbortController().signal)).rejects.toThrow(/no folder `docs`/);
    await expect(session!.plan(new AbortController().signal)).rejects.toThrow(/no folder `docs`/);
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
