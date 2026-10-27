import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { catalogDesktopSemantic, desktopBackedTools, desktopCompressProse, setDesktopFetchForTests } from "./node-desktop";

/** A desktop service whose health reports `compress` as given; `compress` halves the text. */
function service(compress: string | undefined) {
  return async (url: string, init?: RequestInit): Promise<Response> => {
    const op = url.split("/v1/")[1] ?? "";
    if (op === "health") return new Response(JSON.stringify({ version: "x", ...(compress ? { compress } : {}) }), { status: 200 });
    if (op === "compress") {
      const { text } = JSON.parse(String(init?.body ?? "{}")) as { text: string };
      return new Response(JSON.stringify({ text: text.slice(0, Math.floor(text.length / 2)), originalTokens: 10, keptTokens: 5 }), { status: 200 });
    }
    return new Response("{}", { status: 400 });
  };
}

const DEFS = [{ name: "read_file" }, { name: "semantic_search" }, { name: "repo_map" }, { name: "read_compressed" }];
const PROSE = "The run keeps the invoice open until the retry window closes. ".repeat(100);

describe("desktop-backed catalog — the WS-L local levers", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-desktop-levers-"));
    process.env.BUILDERFORCE_DESKTOP_DISCOVERY = path.join(dir, "desktop.json");
  });
  afterEach(() => {
    setDesktopFetchForTests(null);
    delete process.env.BUILDERFORCE_DESKTOP_DISCOVERY;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const publish = () => fs.writeFileSync(process.env.BUILDERFORCE_DESKTOP_DISCOVERY!, JSON.stringify({ port: 4999, token: "tok", pid: 1, version: "x" }));

  it("without Desktop keeps repo_map for a surface that serves it from its own index", async () => {
    setDesktopFetchForTests(service(undefined));
    expect((await desktopBackedTools(DEFS)).map((d) => d.name)).toEqual(["read_file"]);
    expect((await desktopBackedTools(DEFS, { localRepoMap: true })).map((d) => d.name)).toEqual(["read_file", "repo_map"]);
  });

  it("keeps read_compressed only while the service reports its compressor", async () => {
    publish();
    setDesktopFetchForTests(service(undefined));
    expect((await desktopBackedTools(DEFS)).map((d) => d.name)).toEqual(["read_file", "semantic_search", "repo_map"]);
    expect((await catalogDesktopSemantic("/repo"))?.compress).toBeUndefined();
    setDesktopFetchForTests(service("ready"));
    expect((await desktopBackedTools(DEFS)).map((d) => d.name)).toEqual(["read_file", "semantic_search", "repo_map", "read_compressed"]);
    expect(typeof (await catalogDesktopSemantic("/repo"))?.compress).toBe("function");
  });

  it("desktopCompressProse compresses prose through the service and never code", async () => {
    publish();
    setDesktopFetchForTests(service("ready"));
    const prose = await desktopCompressProse(PROSE, "markdown");
    expect(prose.compressed).toBe(true);
    expect((await desktopCompressProse(PROSE, "code")).compressed).toBe(false);
    setDesktopFetchForTests(service(undefined));
    expect((await desktopCompressProse(PROSE, "markdown")).compressed).toBe(false);
  });
});
