import { memoryRecallTool, memoryRememberTool, type ToolContext } from "@builderforce/agent-tools";
import { describe, expect, it, vi } from "vitest";
import { buildMemoryCapabilityProvider } from "./memory-tools.js";
import type { SsmMemoryService } from "../infra/ssm-memory-service.js";

/** A fake SSM service exposing just the two methods the memory provider uses. */
function fakeSvc(over: Partial<Pick<SsmMemoryService, "remember" | "recallSimilar">> = {}) {
  return {
    remember: vi.fn(async () => undefined),
    recallSimilar: vi.fn(async () => [{ key: "k", content: "v" }]),
    ...over,
  } as unknown as SsmMemoryService;
}

const ctxFor = (svc: SsmMemoryService): ToolContext => ({ caps: buildMemoryCapabilityProvider(svc) });

describe("memory capability provider", () => {
  it("advertises the memory capability and backs it", () => {
    const provider = buildMemoryCapabilityProvider(fakeSvc());
    expect([...provider.capabilities]).toEqual(["memory"]);
    expect(provider.memory).toBeDefined();
  });

  it("remember delegates to the service and returns {ok, key}", async () => {
    const svc = fakeSvc();
    const r = await buildMemoryCapabilityProvider(svc).memory!.remember("deploy", "pnpm build", {
      tags: ["ops"],
      importance: 0.9,
    });
    expect(r).toEqual({ ok: true, key: "deploy" });
    expect(svc.remember).toHaveBeenCalledWith("deploy", "pnpm build", { tags: ["ops"], importance: 0.9 });
  });

  it("recall delegates to recallSimilar and maps entries", async () => {
    const svc = fakeSvc({ recallSimilar: vi.fn(async () => [{ key: "a", content: "b" }]) });
    const r = await buildMemoryCapabilityProvider(svc).memory!.recall("how to deploy", 3);
    expect(r).toEqual({ ok: true, query: "how to deploy", entries: [{ key: "a", content: "b" }] });
    expect(svc.recallSimilar).toHaveBeenCalledWith("how to deploy", 3);
  });

  it("surfaces a backend error as {ok:false,error} instead of throwing", async () => {
    const svc = fakeSvc({
      remember: vi.fn(async () => {
        throw new Error("store down");
      }),
    });
    const r = await buildMemoryCapabilityProvider(svc).memory!.remember("k", "v");
    expect(r).toEqual({ ok: false, error: "store down" });
  });
});

describe("memory tools (shared definitions, executed via the Node provider)", () => {
  it("memory_remember requires key+content and round-trips through the service", async () => {
    const svc = fakeSvc();
    const ctx = ctxFor(svc);

    const bad = await memoryRememberTool.execute({ key: "", content: "x" }, ctx);
    expect(bad.data.ok).toBe(false);

    const ok = await memoryRememberTool.execute({ key: "auth-flow", content: "JWT in cookie" }, ctx);
    expect(ok.data).toEqual({ ok: true, key: "auth-flow" });
    expect(svc.remember).toHaveBeenCalledWith("auth-flow", "JWT in cookie", { tags: undefined, importance: undefined });
  });

  it("memory_recall requires a query and returns entries", async () => {
    const svc = fakeSvc({ recallSimilar: vi.fn(async () => [{ key: "auth-flow", content: "JWT in cookie" }]) });
    const ctx = ctxFor(svc);

    const bad = await memoryRecallTool.execute({ query: "   " }, ctx);
    expect(bad.data.ok).toBe(false);

    const ok = await memoryRecallTool.execute({ query: "auth", limit: 2 }, ctx);
    expect(ok.data.ok).toBe(true);
    expect((ok.data as { entries: unknown[] }).entries).toEqual([{ key: "auth-flow", content: "JWT in cookie" }]);
    expect(svc.recallSimilar).toHaveBeenCalledWith("auth", 2);
  });

  it("both tools require the `memory` capability", () => {
    expect(memoryRecallTool.requires).toEqual(["memory"]);
    expect(memoryRememberTool.requires).toEqual(["memory"]);
  });
});
