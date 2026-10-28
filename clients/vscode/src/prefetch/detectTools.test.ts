import { describe, expect, it, vi } from "vitest";
import type { ToolProbe } from "@builderforce/agent-tools/prefetch";
import { createToolDetector, watchToolManifests } from "./detectTools";

function countingProbe(manifest: () => string) {
  const reads = vi.fn();
  const probeFor = (root: string): ToolProbe => ({
    readText: async (p) => {
      if (p === "package.json") reads(root);
      return p === "package.json" ? manifest() : undefined;
    },
    exists: async () => false,
    onPath: async () => false,
  });
  return { probeFor, reads };
}

describe("detectTools memo", () => {
  it("detects once per workspace root, and nothing is known until it finished", async () => {
    const { probeFor, reads } = countingProbe(() => JSON.stringify({ devDependencies: { eslint: "9" } }));
    const detector = createToolDetector(probeFor);
    expect(detector.current("/w")).toBeUndefined();
    const [a, b] = await Promise.all([detector.ensure("/w"), detector.ensure("/w")]);
    expect(a).toBe(b);
    await detector.ensure("/w");
    expect(reads).toHaveBeenCalledTimes(1);
    expect(detector.current("/w")?.get("linter")?.id).toBe("eslint");
    await detector.ensure("/other");
    expect(reads).toHaveBeenCalledTimes(2);
  });

  it("detects again after package.json changes", async () => {
    let deps: Record<string, string> = {};
    const { probeFor, reads } = countingProbe(() => JSON.stringify({ devDependencies: deps }));
    const detector = createToolDetector(probeFor);
    expect((await detector.ensure("/w")).has("vitest")).toBe(false);

    const handlers: Array<(uri: { fsPath: string }) => void> = [];
    const watcher = { onDidChange: (h: never) => handlers.push(h), onDidCreate: (h: never) => handlers.push(h), onDidDelete: (h: never) => handlers.push(h), dispose: () => {} };
    const subscriptions: unknown[] = [];
    watchToolManifests({ createFileSystemWatcher: () => watcher } as never, { push: (d) => subscriptions.push(d) }, detector);
    expect(subscriptions).toEqual([watcher]);

    deps = { vitest: "4" };
    // A nested node_modules manifest is not the workspace's own: no re-detection.
    handlers[0]!({ fsPath: "/w/node_modules/x/package.json" });
    expect(detector.current("/w")?.has("vitest")).toBe(false);
    handlers[0]!({ fsPath: "/w/package.json" });
    expect(detector.current("/w")).toBeUndefined();
    expect((await detector.ensure("/w")).has("vitest")).toBe(true);
    expect(reads).toHaveBeenCalledTimes(2);
  });
});
