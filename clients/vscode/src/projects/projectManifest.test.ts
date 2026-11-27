import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { mergeProjectManifest, writeProjectManifest } from "./projectManifest";

const fields = { projectId: 12, projectType: "ai-scratch" };
const folder = { name: "app", path: path.join("work", "app") };
const manifestFile = path.join(folder.path, ".builderforce", "builderforce.json");

describe("mergeProjectManifest", () => {
  it("starts a new file with just the two fields", () => {
    const merged = mergeProjectManifest(undefined, fields);
    expect(merged.ok && JSON.parse(merged.text)).toEqual(fields);
  });

  it("keeps every existing member and replaces a stale link", () => {
    const existing = JSON.stringify({ version: 1, name: "demo", services: { web: { runtime: "node" } }, projectId: 3, projectType: "old" });
    const merged = mergeProjectManifest(existing, fields);
    expect(merged.ok && JSON.parse(merged.text)).toEqual({ version: 1, name: "demo", services: { web: { runtime: "node" } }, ...fields });
  });

  it("refuses a file that is not a JSON object", () => {
    for (const bad of ["{ not json", "[1,2]", "42", "null"]) expect(mergeProjectManifest(bad, fields)).toEqual({ ok: false, reason: "not-an-object" });
  });
});

describe("writeProjectManifest", () => {
  const port = (files: Map<string, string>) => ({
    readText: async (file: string) => files.get(file),
    writeText: async (file: string, text: string) => void files.set(file, text),
  });

  it("merges into an existing manifest instead of clobbering it", async () => {
    const files = new Map([[manifestFile, JSON.stringify({ version: 1, name: "demo" })]]);
    expect(await writeProjectManifest(port(files), folder, fields)).toMatchObject({ ok: true });
    expect(JSON.parse(files.get(manifestFile)!)).toEqual({ version: 1, name: "demo", ...fields });
  });

  it("leaves an unreadable manifest untouched", async () => {
    const files = new Map([[manifestFile, "{ broken"]]);
    expect(await writeProjectManifest(port(files), folder, fields)).toEqual({ ok: false, reason: "not-an-object" });
    expect(files.get(manifestFile)).toBe("{ broken");
  });
});
