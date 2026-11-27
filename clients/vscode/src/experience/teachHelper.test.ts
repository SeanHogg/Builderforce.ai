import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { helperFileName } from "./teachHelper";

const table = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../../../../packages/bf-teach-helper/targets.json"), "utf8"),
) as { targets: Array<{ triple: string; tag: string; asset: string; out: string }> };

describe("helperFileName", () => {
  it("agrees with the ONE targets table esbuild and the fetch script use", () => {
    for (const t of table.targets) {
      const [platform, arch] = t.tag.split("-") as [NodeJS.Platform, string];
      expect(helperFileName(platform, arch)).toBe(t.out);
    }
  });

  it("maps the release triples to the platforms the loader asks for", () => {
    const byTriple = Object.fromEntries(table.targets.map((t) => [t.triple, t.tag]));
    expect(byTriple).toEqual({
      "x86_64-pc-windows-msvc": "win32-x64",
      "aarch64-apple-darwin": "darwin-arm64",
      "x86_64-apple-darwin": "darwin-x64",
    });
  });
});
