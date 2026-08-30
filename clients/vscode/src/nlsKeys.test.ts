import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * The manifest is a localization-key REGISTRY: every `%key%` in `package.json`
 * (setting descriptions, view titles, command titles, enum descriptions) is resolved by
 * VS Code against `package.nls[.<locale>].json` at load time.
 *
 * Catalog-to-catalog parity is NOT sufficient to protect it, which is the whole reason
 * this test reads the manifest rather than diffing the catalogs: a key can be spelled one
 * way in `package.json` and another in all five catalogs, or added to the manifest and to
 * none of them. Either way every catalog stays internally consistent and the setting
 * still renders as a raw `%config.something%` to the user — in every language at once.
 *
 * Resolving SOURCE → CATALOG, per locale, is what actually catches that.
 */

const here = __dirname;
const manifestPath = path.join(here, "..", "package.json");

/** Every supported locale catalog, including the default. */
const CATALOGS = [
  "package.nls.json",
  "package.nls.de.json",
  "package.nls.es.json",
  "package.nls.fr.json",
  "package.nls.zh-cn.json",
] as const;

/** Collect every `%key%` reference anywhere in the manifest tree. VS Code only treats a
 *  string that is ENTIRELY `%…%` as a reference, so the match is anchored. */
function referencedKeys(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (typeof value === "string") {
    const match = /^%(.+)%$/.exec(value);
    if (match) into.add(match[1]!);
  } else if (Array.isArray(value)) {
    for (const item of value) referencedKeys(item, into);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) referencedKeys(item, into);
  }
  return into;
}

const manifest: unknown = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const keys = [...referencedKeys(manifest)].sort();

describe("manifest localization keys resolve in every locale", () => {
  it("finds keys to check at all (guards the extractor itself)", () => {
    // A regression that broke extraction would otherwise make every case below pass
    // vacuously — the failure mode this suite exists to prevent.
    expect(keys.length).toBeGreaterThan(0);
    expect(keys).toContain("config.localModels.enabled.desc");
  });

  for (const catalog of CATALOGS) {
    it(`${catalog} defines every key the manifest references`, () => {
      const entries = JSON.parse(fs.readFileSync(path.join(here, "..", catalog), "utf8")) as Record<string, string>;
      const missing = keys.filter((key) => !(key in entries));
      expect(missing).toEqual([]);
    });

    it(`${catalog} leaves no key empty`, () => {
      const entries = JSON.parse(fs.readFileSync(path.join(here, "..", catalog), "utf8")) as Record<string, string>;
      const blank = keys.filter((key) => key in entries && entries[key]!.trim() === "");
      expect(blank).toEqual([]);
    });
  }
});
