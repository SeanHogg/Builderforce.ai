import { describe, expect, it } from "vitest";
import {
  bumpPatchVersion,
  nextFreeVersion,
  parseOutArg,
  rewriteVersionLine,
} from "../vsce-platform.lib.mjs";

describe("bumpPatchVersion", () => {
  it("bumps the trailing numeric run", () => {
    expect(bumpPatchVersion("2026.10.178")).toBe("2026.10.179");
    expect(bumpPatchVersion("1.0.9")).toBe("1.0.10");
    expect(bumpPatchVersion("v2")).toBe("v3");
  });

  it("bumps a trailing prerelease/build-metadata digit group", () => {
    expect(bumpPatchVersion("1.2.3-beta.1")).toBe("1.2.3-beta.2");
    expect(bumpPatchVersion("1.2.3+4")).toBe("1.2.3+5");
  });

  it("returns null when there is no trailing digit run", () => {
    expect(bumpPatchVersion("abc")).toBeNull();
    expect(bumpPatchVersion("")).toBeNull();
  });
});

describe("rewriteVersionLine", () => {
  it("rewrites only the version line, preserving everything else", () => {
    const original = [
      "{",
      '  "name": "builderforce-ai",',
      '  "version": "2026.10.178",',
      '  "publisher": "builderforce"',
      "}",
      "",
    ].join("\n");
    const rewritten = rewriteVersionLine(original, "2026.10.179");
    expect(rewritten).toBe(
      [
        "{",
        '  "name": "builderforce-ai",',
        '  "version": "2026.10.179",',
        '  "publisher": "builderforce"',
        "}",
        "",
      ].join("\n"),
    );
  });

  it("throws when no version line exists", () => {
    expect(() => rewriteVersionLine('{"name":"x"}', "1.0.0")).toThrow();
  });

  it("rewrites the TOP-LEVEL version even when a nested version line comes first", () => {
    // A nested "version" key (e.g. inside a config block) appearing BEFORE the
    // top-level one must not be rewritten — only the least-indented key wins.
    const original = [
      "{",
      '  "name": "builderforce-ai",',
      '  "config": {',
      '    "version": "9.9.9"',
      "  },",
      '  "version": "2026.10.178",',
      '  "publisher": "builderforce"',
      "}",
      "",
    ].join("\n");
    const rewritten = rewriteVersionLine(original, "2026.10.179");
    expect(rewritten).toContain('    "version": "9.9.9"');
    expect(rewritten).toContain('  "version": "2026.10.179"');
  });

  it("preserves spacing, key order, and trailing newline of the version line", () => {
    const original = '{\n  "name": "x",\n\t"version" : "1.0.0" ,\n}\n';
    const rewritten = rewriteVersionLine(original, "2.0.0");
    expect(rewritten).toBe('{\n  "name": "x",\n\t"version" : "2.0.0" ,\n}\n');
  });
});

describe("parseOutArg", () => {
  it("returns null when no output flag is present", () => {
    expect(parseOutArg(["--no-dependencies"])).toBeNull();
    expect(parseOutArg([])).toBeNull();
  });

  it("parses the separate value forms (--out <path>, -o <path>)", () => {
    expect(parseOutArg(["--out", "a.vsix"])).toEqual({ index: 0, path: "a.vsix", joined: false });
    expect(parseOutArg(["-o", "b.vsix"])).toEqual({ index: 0, path: "b.vsix", joined: false });
    expect(parseOutArg(["--target", "win32-x64", "--out", "c.vsix"])).toEqual({
      index: 2,
      path: "c.vsix",
      joined: false,
    });
  });

  it("parses the joined forms (--out=<path>, -o=<path>)", () => {
    expect(parseOutArg(["--out=d.vsix"])).toEqual({ index: 0, path: "d.vsix", joined: true });
    expect(parseOutArg(["-o=e.vsix"])).toEqual({ index: 0, path: "e.vsix", joined: true });
  });

  it("does not treat a value that merely equals --out as a flag", () => {
    // e.g. `--allow-overwrite --out` where the real path is missing would parse
    // path as undefined here; the CLI guards on the resolved absolute path anyway.
    expect(parseOutArg(["x", "--out"])?.index).toBe(1);
  });
});

describe("nextFreeVersion", () => {
  it("returns the start version when it is free", () => {
    expect(nextFreeVersion("1.0.0", () => false)).toBe("1.0.0");
  });

  it("bumps once when only the start version is taken", () => {
    const taken = new Set(["1.0.0"]);
    expect(nextFreeVersion("1.0.0", (v: string) => taken.has(v))).toBe("1.0.1");
  });

  it("re-checks each bumped version and skips one that is itself packaged", () => {
    // Regression for the reviewer's finding: bumping 1.0.0 → 1.0.1 must not
    // silently overwrite a 1.0.1 artifact that already exists from an earlier cut.
    const taken = new Set(["1.0.0", "1.0.1"]);
    expect(nextFreeVersion("1.0.0", (v: string) => taken.has(v))).toBe("1.0.2");
  });

  it("carries across a 9 → 10 boundary", () => {
    const taken = new Set(["2.0.9"]);
    expect(nextFreeVersion("2.0.9", (v: string) => taken.has(v))).toBe("2.0.10");
  });

  it("returns null when no free version is found within maxAttempts", () => {
    // Every version taken.
    expect(nextFreeVersion("1.0.0", () => true, 5)).toBeNull();
  });
});
