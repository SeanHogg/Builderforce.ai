import { CURRENT_ENGINE_ID, DEFAULT_ENGINE_ID, resolveEngineById } from "@builderforce/agent-tools";
import { describe, expect, it } from "vitest";

// The shared id→impl + default-fallback helper both engine seams use (relay
// resolveEngine + cloud resolveAgentEngine). Lives here because the shared package
// has no test runner of its own; agent-runtime imports it directly.
describe("resolveEngineById", () => {
  const current = { id: CURRENT_ENGINE_ID };
  const registry = { [CURRENT_ENGINE_ID]: current };

  it("resolves the current id", () => {
    expect(resolveEngineById(registry, CURRENT_ENGINE_ID)).toBe(current);
  });

  it("falls back to the current engine for any unknown / legacy id", () => {
    expect(resolveEngineById(registry, "builderforce-v1")).toBe(current);
    expect(resolveEngineById(registry, "builderforce-v2")).toBe(current);
    expect(resolveEngineById(registry, "builderforce-local")).toBe(current);
    expect(DEFAULT_ENGINE_ID).toBe(CURRENT_ENGINE_ID);
  });

  it("falls back when id is undefined", () => {
    expect(resolveEngineById(registry, undefined)).toBe(current);
  });

  it("honors an explicit non-default fallback id", () => {
    const reg = { a: { id: "a" }, b: { id: "b" } };
    expect(resolveEngineById(reg, "missing", "b")).toEqual({ id: "b" });
  });
});
