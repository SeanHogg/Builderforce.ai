import { readFileSync } from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@builderforce/agent-tools", () => {
  const ANALYZERS = [
    { name: "dependency-cruiser", version: "16.10.4", bin: "depcruise" },
    { name: "jscpd", version: "4.0.5", bin: "jscpd" },
    { name: "knip", version: "5.30.0", bin: "knip" },
  ];
  let bundled: unknown;
  return { ANALYZERS, setBundledAnalyzers: (v: unknown) => { bundled = v; }, bundledAnalyzers: () => bundled };
});

import { bundledAnalyzers } from "@builderforce/agent-tools";
import { registerBundledAnalyzers, resolveBundledAnalyzers, type AnalyzerFs } from "./bundledAnalyzers";

const DIR = path.join("/ext", "out", "analyzers");
const pkg = (name: string) => path.join(DIR, "node_modules", name, "package.json");
const fakeFs = (manifests: Record<string, object>, present: string[]): AnalyzerFs => ({
  readText: (file) => (manifests[file] ? JSON.stringify(manifests[file]) : undefined),
  exists: (file) => present.includes(file),
});

afterEach(() => vi.clearAllMocks());

describe("bundled analyzer resolution", () => {
  it("resolves each pinned package's bin to an absolute forward-slash entry", () => {
    const entries = resolveBundledAnalyzers(DIR, fakeFs(
      {
        [pkg("dependency-cruiser")]: { version: "16.10.4", bin: { depcruise: "bin/dependency-cruise.mjs", "dependency-cruise": "bin/other.mjs" } },
        [pkg("jscpd")]: { version: "4.0.5", bin: { jscpd: "./bin/jscpd" } },
        [pkg("knip")]: { version: "5.30.0", bin: "bin/knip.js" },
      },
      [
        path.join(DIR, "node_modules", "dependency-cruiser", "bin/dependency-cruise.mjs"),
        path.join(DIR, "node_modules", "jscpd", "./bin/jscpd"),
        path.join(DIR, "node_modules", "knip", "bin/knip.js"),
      ],
    ));
    expect(Object.keys(entries).sort()).toEqual(["dependency-cruiser", "jscpd", "knip"]);
    for (const entry of Object.values(entries)) expect(entry).not.toContain("\\");
    expect(entries["dependency-cruiser"]).toMatch(/dependency-cruiser\/bin\/dependency-cruise\.mjs$/);
  });

  it("gives no entry to a missing package, a wrong version, or a missing script", () => {
    const entries = resolveBundledAnalyzers(DIR, fakeFs(
      {
        [pkg("dependency-cruiser")]: { version: "16.0.0", bin: { depcruise: "bin/x.mjs" } },
        [pkg("knip")]: { version: "5.30.0", bin: "bin/knip.js" },
      },
      [],
    ));
    expect(entries).toEqual({});
  });

  it("registers the entries with the runner so it never falls back to npm exec", () => {
    const entries = registerBundledAnalyzers("/definitely/not/installed");
    expect(entries).toEqual({});
    // An empty record is still 'a host that bundles': every analyzer reads not_measured, none is downloaded.
    expect(bundledAnalyzers()).toEqual({});
  });
});

describe("pins", () => {
  it("analyzers/package.json pins exactly what the REAL runner reports", async () => {
    // The package is mocked above; the pins come from their own tiny module (the real values, no heavy imports).
    const real = await import("../../../packages/agent-tools/src/analyzerPins");
    const manifest = JSON.parse(readFileSync(path.join(__dirname, "..", "analyzers", "package.json"), "utf8")) as { dependencies: Record<string, string> };
    const pinned = real.ANALYZER_VERSIONS;
    const [tsName, tsVersion] = real.TYPESCRIPT_PIN.split("@");
    expect(manifest.dependencies).toEqual({ ...pinned, [tsName as string]: tsVersion });
  });
});
