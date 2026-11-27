import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { searchWorkspace } from "./workspace-search.js";

describe("searchWorkspace", () => {
  it("reports an error for a root that does not exist, never an empty successful result", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bf-ws-search-"));
    try {
      const result = await searchWorkspace({ projectRoot: join(parent, "missing-root"), query: "invoice", language: "ts" }, true);
      expect(typeof result.error).toBe("string");
      expect(result.error).not.toBe("");
      expect(result.results).toBeUndefined();
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("rejects an empty query", async () => {
    expect(await searchWorkspace({ projectRoot: tmpdir(), query: "   " }, true)).toEqual({ error: "query is required" });
  });
});
