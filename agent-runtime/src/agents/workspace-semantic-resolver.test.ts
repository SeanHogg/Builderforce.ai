import { describe, expect, it, vi } from "vitest";
import type { RepoSemanticCapability } from "@builderforce/agent-tools";
import { resolveWorkspaceSemantic } from "@builderforce/workspace-mcp";

const capability = (): RepoSemanticCapability => ({ search: vi.fn(), repoMap: vi.fn() }) as unknown as RepoSemanticCapability;

describe("resolveWorkspaceSemantic", () => {
  it("returns Desktop's capability when it answers, without building the local index", async () => {
    const desktop = capability();
    const local = vi.fn(capability);
    const onDesktopError = vi.fn();
    expect(await resolveWorkspaceSemantic({ desktop: async () => desktop, local, onDesktopError })).toBe(desktop);
    expect(local).not.toHaveBeenCalled();
    expect(onDesktopError).not.toHaveBeenCalled();
  });

  it("falls back to the local index when Desktop is absent", async () => {
    const local = capability();
    const onDesktopError = vi.fn();
    expect(await resolveWorkspaceSemantic({ desktop: async () => undefined, local: () => local, onDesktopError })).toBe(local);
    expect(onDesktopError).not.toHaveBeenCalled();
  });

  it("reports a Desktop probe failure and still falls back to the local index", async () => {
    const local = capability();
    const failure = new Error("probe refused");
    const onDesktopError = vi.fn();
    expect(await resolveWorkspaceSemantic({ desktop: async () => { throw failure; }, local: () => local, onDesktopError })).toBe(local);
    expect(onDesktopError).toHaveBeenCalledWith(failure);
  });
});
