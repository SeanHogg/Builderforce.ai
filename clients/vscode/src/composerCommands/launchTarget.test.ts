import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { findIndexPage, launcherKey, pageFile, resolveLaunchTarget, INDEX_PAGE_NAMES } from "./launchTarget";
import { fakeWorkspacePort, folderRef } from "./testWorkspacePort";

const app = folderRef("app");
const at = (...parts: string[]) => path.join(app.path, ...parts);

describe("findIndexPage", () => {
  it("is the first index name present, .html before .htm, whatever the case", () => {
    expect(INDEX_PAGE_NAMES).toEqual(["index.html", "index.htm"]);
    expect(findIndexPage(["a.html", "Index.HTML"])).toBe("Index.HTML");
    expect(findIndexPage(["index.htm", "INDEX.html"])).toBe("INDEX.html");
    expect(findIndexPage(["index.htm"])).toBe("index.htm");
  });

  it("is deterministic when several spellings of one name exist", () => {
    expect(findIndexPage(["index.html", "Index.html"])).toBe("Index.html");
    expect(findIndexPage(["Index.html", "index.html"])).toBe("Index.html");
  });

  it("finds nothing among other names (index files in subfolders are not top-level names)", () => {
    expect(findIndexPage(["main.html", "docs", "index.html.bak", "xindex.html"])).toBeUndefined();
    expect(findIndexPage([])).toBeUndefined();
  });
});

describe("resolveLaunchTarget", () => {
  it("leaves no argument, a subcommand and an environment name to the workspace flow", async () => {
    const port = fakeWorkspacePort([app], { [at("staging", "x.html")]: "" });
    for (const argument of [undefined, "stop", "external", "trust", "staging"]) {
      expect(await resolveLaunchTarget(port, argument)).toEqual({ kind: "workspace" });
    }
  });

  it("an existing .html or .htm file, absolute or relative to a workspace folder, is a page of its directory", async () => {
    const port = fakeWorkspacePort([app], { [at("design", "mock up.html")]: "", [at("old.HTM")]: "" });
    expect(await resolveLaunchTarget(port, at("design", "mock up.html"))).toEqual({ kind: "page", projectDir: at("design"), page: "/mock up.html" });
    expect(await resolveLaunchTarget(port, "design/mock up.html")).toEqual({ kind: "page", projectDir: at("design"), page: "/mock up.html" });
    expect(await resolveLaunchTarget(port, "old.HTM")).toEqual({ kind: "page", projectDir: app.path, page: "/old.HTM" });
  });

  it("an existing directory with a manifest is launched as a project", async () => {
    const port = fakeWorkspacePort([app], { [at("site", ".builderforce", "builderforce.json")]: "{}", [at("site", "index.html")]: "" });
    expect(await resolveLaunchTarget(port, at("site"))).toEqual({ kind: "folder", projectDir: at("site"), hasManifest: true });
  });

  it("an existing directory with no manifest launches its index page, the same target as typing that file", async () => {
    const port = fakeWorkspacePort([app], { [at(".design", "Index.HTML")]: "", [at(".design", "other.html")]: "" });
    const viaDirectory = await resolveLaunchTarget(port, at(".design") + path.sep);
    const viaFile = await resolveLaunchTarget(port, at(".design", "Index.HTML"));
    expect(viaDirectory).toEqual({ kind: "page", projectDir: at(".design"), page: "/Index.HTML" });
    expect(viaDirectory).toEqual(viaFile);
    expect(launcherKey(viaDirectory as never)).toBe(launcherKey(viaFile as never));
  });

  it("an existing directory with neither a manifest nor a top-level index page is a folder to detect in", async () => {
    const port = fakeWorkspacePort([app], { [at("docs", "sub", "index.html")]: "", [at("docs", "a.html")]: "" });
    expect(await resolveLaunchTarget(port, "docs")).toEqual({ kind: "folder", projectDir: at("docs"), hasManifest: false });
  });

  it("an existing file of another type is refused, and a path with nothing there is missing", async () => {
    const port = fakeWorkspacePort([app], { [at("notes.txt")]: "x" });
    expect(await resolveLaunchTarget(port, "notes.txt")).toEqual({ kind: "notPage", file: at("notes.txt") });
    expect(await resolveLaunchTarget(port, "gone/page.html")).toEqual({ kind: "missing", argument: "gone/page.html" });
  });
});

describe("launcherKey", () => {
  it("is the page's file, or the folder", () => {
    const page = { kind: "page", projectDir: at("d"), page: "/a.html" } as const;
    expect(pageFile(page)).toBe(at("d", "a.html"));
    expect(launcherKey(page).toLowerCase()).toBe(at("d", "a.html").toLowerCase());
    expect(launcherKey({ kind: "folder", projectDir: at("d"), hasManifest: false }).toLowerCase()).toBe(at("d").toLowerCase());
  });
});
