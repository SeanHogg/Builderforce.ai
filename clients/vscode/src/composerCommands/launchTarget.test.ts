import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { findIndexPage, INDEX_PAGE_NAMES, pageFile, quoteCommandArg, resolveLaunchTarget } from "./launchTarget";
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

describe("resolveLaunchTarget: the order", () => {
  it("1. no argument and a subcommand are the workspace flow", async () => {
    const port = fakeWorkspacePort([app], { [at("stop", "x.html")]: "" });
    for (const argument of [undefined, "stop", "external", "trust"]) {
      expect(await resolveLaunchTarget(port, argument, ["staging"])).toEqual({ kind: "workspace" });
    }
  });

  it("2. a declared environment is the workspace flow — even one that looks like a path (prod.eu) or names a folder", async () => {
    const port = fakeWorkspacePort([app], { [at("prod.eu", "index.html")]: "", [at("docs", "a.html")]: "" });
    expect(await resolveLaunchTarget(port, "prod.eu", ["prod.eu", "docs"])).toEqual({ kind: "workspace" });
    expect(await resolveLaunchTarget(port, "docs", ["prod.eu", "docs"])).toEqual({ kind: "workspace" });
  });

  it("3. a name that is a folder here and no declared environment is that folder (docs)", async () => {
    const port = fakeWorkspacePort([app], { [at("docs", "readme.md")]: "x" });
    expect(await resolveLaunchTarget(port, "docs", ["staging"])).toEqual({ kind: "folder", projectDir: at("docs"), hasManifest: false, via: at("docs") });
    expect(await resolveLaunchTarget(port, "docs")).toEqual({ kind: "folder", projectDir: at("docs"), hasManifest: false, via: at("docs") });
  });

  it("4. a path-looking argument with nothing there is missing", async () => {
    const port = fakeWorkspacePort([app], {});
    expect(await resolveLaunchTarget(port, "gone/page.html", ["staging"])).toEqual({ kind: "missing", argument: "gone/page.html", bare: false });
    // A dotted name with no separator is flagged: with environments known it may be a mistyped environment (`launch.ts`).
    expect(await resolveLaunchTarget(port, "prod.eau", ["prod.eu"])).toEqual({ kind: "missing", argument: "prod.eau", bare: true });
  });

  it("5. any other name is the workspace flow, where the chosen folder's environments judge it", async () => {
    const port = fakeWorkspacePort([app], {});
    for (const known of [["staging", "local"], [], undefined]) {
      expect(await resolveLaunchTarget(port, "stagign", known)).toEqual({ kind: "workspace" });
    }
  });

  it("refuses a drive-relative or (Windows) root-relative path, asking for a full one", async () => {
    const port = fakeWorkspacePort([app], {});
    if (process.platform === "win32") {
      expect(await resolveLaunchTarget(port, "C:foo.html")).toEqual({ kind: "needsFullPath", argument: "C:foo.html" });
      expect(await resolveLaunchTarget(port, "\\site")).toEqual({ kind: "needsFullPath", argument: "\\site" });
      expect(await resolveLaunchTarget(port, "/site/a.html")).toEqual({ kind: "needsFullPath", argument: "/site/a.html" });
    }
    // A full path is never refused for its shape.
    expect((await resolveLaunchTarget(port, at("x.html"))).kind).toBe("missing");
  });
});

describe("resolveLaunchTarget: paths", () => {
  it("an existing .html or .htm file, absolute or relative to a workspace folder, is a page of its directory", async () => {
    const port = fakeWorkspacePort([app], { [at("design", "mock up.html")]: "", [at("old.HTM")]: "" });
    const mock = { kind: "page", projectDir: at("design"), page: "/mock up.html", via: at("design", "mock up.html") };
    expect(await resolveLaunchTarget(port, at("design", "mock up.html"))).toEqual(mock);
    expect(await resolveLaunchTarget(port, "design/mock up.html")).toEqual(mock);
    expect(await resolveLaunchTarget(port, "old.HTM")).toEqual({ kind: "page", projectDir: app.path, page: "/old.HTM", via: at("old.HTM") });
  });

  it("shows a page's file name as the directory lists it", async () => {
    const port = fakeWorkspacePort([app], { [at("Mock.HTML")]: "" });
    expect(pageFile(await resolveLaunchTarget(port, at("Mock.HTML")) as never)).toBe(at("Mock.HTML"));
  });

  it("an existing directory with a manifest is launched as a project", async () => {
    const port = fakeWorkspacePort([app], { [at("site", ".builderforce", "builderforce.json")]: "{}", [at("site", "index.html")]: "" });
    expect(await resolveLaunchTarget(port, at("site"))).toEqual({ kind: "folder", projectDir: at("site"), hasManifest: true, via: at("site") });
  });

  it("an existing directory with no manifest launches its index page, the same target as typing that file", async () => {
    const port = fakeWorkspacePort([app], { [at(".design", "Index.HTML")]: "", [at(".design", "other.html")]: "" });
    const viaDirectory = await resolveLaunchTarget(port, at(".design") + path.sep);
    const viaFile = await resolveLaunchTarget(port, at(".design", "Index.HTML"));
    expect(viaDirectory).toEqual({ kind: "page", projectDir: at(".design"), page: "/Index.HTML", via: at(".design") });
    // The same page; only the path it was reached by differs (so each finds the launcher again).
    expect(viaFile).toEqual({ ...viaDirectory, via: at(".design", "Index.HTML") });
  });

  it("an existing directory with neither a manifest nor a top-level index page is a folder to detect in", async () => {
    const port = fakeWorkspacePort([app], { [at("docs", "sub", "index.html")]: "", [at("docs", "a.html")]: "" });
    expect(await resolveLaunchTarget(port, "docs")).toEqual({ kind: "folder", projectDir: at("docs"), hasManifest: false, via: at("docs") });
  });

  it("a path that resolves to a workspace folder is that folder's workspace flow, not a second launcher", async () => {
    const port = fakeWorkspacePort([app], { [at("index.html")]: "", [at("link", "x")]: "" });
    // A link inside the folder that leads back to it: the same directory by real path.
    port.links.set(at("link"), app.path);
    expect(await resolveLaunchTarget(port, at("link"))).toEqual({ kind: "workspaceFolder", folder: app });
    expect(await resolveLaunchTarget(port, app.path)).toEqual({ kind: "workspaceFolder", folder: app });
    expect(await resolveLaunchTarget(port, ".")).toEqual({ kind: "workspaceFolder", folder: app });
  });

  it("an existing file of another type is refused", async () => {
    const port = fakeWorkspacePort([app], { [at("notes.txt")]: "x" });
    expect(await resolveLaunchTarget(port, "notes.txt")).toEqual({ kind: "notPage", file: at("notes.txt") });
  });

});

describe("quoteCommandArg", () => {
  it("quotes as the composer tokenizer reads it back: double quotes, or single when the value holds a double quote", () => {
    expect(quoteCommandArg("C:\\My Docs\\a.html")).toBe('"C:\\My Docs\\a.html"');
    expect(quoteCommandArg('/tmp/say "hi".html')).toBe("'/tmp/say \"hi\".html'");
  });

  it("has no quoting for a value holding both quote characters", () => {
    expect(quoteCommandArg(`/tmp/a"b'c.html`)).toBeUndefined();
  });
});
