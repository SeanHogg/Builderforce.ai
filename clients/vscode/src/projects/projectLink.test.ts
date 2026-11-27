import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { linkProject, readProjectLink } from "./projectLink";

const folder = { name: "app", path: path.join("work", "app") };
const file = path.join(folder.path, ".builderforce", "project.json");
const fields = { projectId: 12, projectType: "ai-scratch" };
const BOM = String.fromCharCode(0xfeff);

const port = (files: Map<string, string>) => ({
  readText: async (f: string) => files.get(f),
  writeText: async (f: string, text: string) => void files.set(f, text),
});

describe("linkProject", () => {
  it("links a blank folder with version 1", async () => {
    const files = new Map<string, string>();
    expect(await linkProject(port(files), folder, fields)).toEqual({ status: "written" });
    expect(JSON.parse(files.get(file)!)).toEqual({ version: 1, ...fields });
  });

  it("keeps other members and tolerates a BOM", async () => {
    const files = new Map([[file, `${BOM}${JSON.stringify({ version: 1, note: "keep" })}`]]);
    expect(await linkProject(port(files), folder, fields)).toEqual({ status: "written" });
    expect(JSON.parse(files.get(file)!)).toEqual({ version: 1, note: "keep", ...fields });
  });

  it("never overwrites invalid JSON or a non-object, with distinct reasons", async () => {
    const bad = new Map([[file, "{ broken"]]);
    expect(await linkProject(port(bad), folder, fields)).toEqual({ status: "refused", reason: "invalid-json" });
    expect(bad.get(file)).toBe("{ broken");
    const arr = new Map([[file, "[1]"]]);
    expect(await linkProject(port(arr), folder, fields)).toEqual({ status: "refused", reason: "not-an-object" });
  });

  it("reports a different linked project as a conflict until its id is confirmed for replacement", async () => {
    const existing = JSON.stringify({ version: 1, projectId: 3, projectType: "ai-existing" });
    const files = new Map([[file, existing]]);
    expect(await linkProject(port(files), folder, fields)).toEqual({ status: "conflict", existing: { projectId: 3, projectType: "ai-existing" } });
    expect(files.get(file)).toBe(existing);
    expect(await linkProject(port(files), folder, fields, { replace: { expectedProjectId: 3 } })).toEqual({ status: "written" });
    expect(JSON.parse(files.get(file)!)).toMatchObject(fields);
  });

  it("replace is compare-and-swap: a link that changed since it was confirmed is a conflict", async () => {
    const changed = JSON.stringify({ version: 1, projectId: 99, projectType: "ai-existing" });
    const files = new Map([[file, changed]]);
    expect(await linkProject(port(files), folder, fields, { replace: { expectedProjectId: 3 } })).toMatchObject({ status: "conflict", existing: { projectId: 99 } });
    expect(files.get(file)).toBe(changed);
  });

  it("counts any projectId, of whatever type, as a link", async () => {
    const files = new Map([[file, JSON.stringify({ projectId: "abc" })]]);
    expect(await linkProject(port(files), folder, fields)).toMatchObject({ status: "conflict", existing: { projectId: "abc" } });
    expect(await linkProject(port(files), folder, fields, { replace: { expectedProjectId: "abc" } })).toEqual({ status: "written" });
  });

  it("is a no-op for the same link", async () => {
    const same = JSON.stringify({ version: 1, ...fields });
    const files = new Map([[file, same]]);
    expect(await linkProject(port(files), folder, fields)).toEqual({ status: "unchanged" });
    expect(files.get(file)).toBe(same);
  });
});

describe("readProjectLink", () => {
  it("reads the link, none for a blank folder, and the refusal for bad text", async () => {
    expect(await readProjectLink(port(new Map([[file, JSON.stringify({ version: 1, ...fields })]])), folder)).toEqual({ ok: true, link: fields });
    expect(await readProjectLink(port(new Map()), folder)).toEqual({ ok: true, link: undefined });
    expect(await readProjectLink(port(new Map([[file, "nope"]])), folder)).toEqual({ ok: false, reason: "invalid-json" });
  });

  it("returns a hand-edited non-numeric projectId as a link", async () => {
    expect(await readProjectLink(port(new Map([[file, JSON.stringify({ projectId: "x" })]])), folder)).toEqual({ ok: true, link: { projectId: "x", projectType: undefined } });
  });
});
