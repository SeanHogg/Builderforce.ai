import { DEFAULT_ENGINE_ID, ENGINE_IDS, resolveEngineById } from "@builderforce/agent-tools";
import { describe, expect, it } from "vitest";

// The shared id→impl + default-fallback helper both engine seams use (relay
// resolveEngine + cloud resolveAgentEngine). Lives here because the shared package
// has no test runner of its own; agent-runtime imports it directly.
describe("resolveEngineById", () => {
  const v2 = { id: ENGINE_IDS.v2 };
  const registry = { [ENGINE_IDS.v2]: v2 };

  it("resolves a known id", () => {
    expect(resolveEngineById(registry, ENGINE_IDS.v2)).toBe(v2);
  });

  it("falls back to DEFAULT_ENGINE_ID for an unknown id (e.g. legacy v1)", () => {
    expect(resolveEngineById(registry, ENGINE_IDS.v1)).toBe(v2);
    expect(resolveEngineById(registry, "builderforce-local")).toBe(v2);
    expect(DEFAULT_ENGINE_ID).toBe(ENGINE_IDS.v2);
  });

  it("falls back when id is undefined", () => {
    expect(resolveEngineById(registry, undefined)).toBe(v2);
  });

  it("honors an explicit non-default fallback id", () => {
    const reg = { a: { id: "a" }, b: { id: "b" } };
    expect(resolveEngineById(reg, "missing", "b")).toEqual({ id: "b" });
  });
});
