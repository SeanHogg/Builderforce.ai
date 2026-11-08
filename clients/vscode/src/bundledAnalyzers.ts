/**
 * The analyzers the VSIX ships (PRD 41 A3). `esbuild.mjs` installs the pinned packages
 * (`analyzers/package.json`) into `out/analyzers/node_modules`; this resolves each one's entry script
 * from its own `package.json` `bin` and registers them with the analysis runner
 * (`setBundledAnalyzers`, `@builderforce/agent-tools`). From then on every analyzer launch is
 * `node <entry>` and never `npm exec`. A package that is missing, or installed at a version other than the
 * pin the runner reports, gets NO entry: its findings are `not_measured` / `analyzer-unavailable`.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { ANALYZERS, setBundledAnalyzers, type AnalyzerName, type BundledAnalyzerEntries } from "@builderforce/agent-tools";

/** What the resolver reads from disk: injected so a test needs no install. */
export interface AnalyzerFs {
  readText(file: string): string | undefined;
  exists(file: string): boolean;
}

export const nodeAnalyzerFs: AnalyzerFs = {
  readText: (file) => { try { return fs.readFileSync(file, "utf8"); } catch { return undefined; } },
  exists: (file) => fs.existsSync(file),
};

/** The entry script of each analyzer installed under `analyzersDir` at its pinned version (forward slashes). */
export function resolveBundledAnalyzers(analyzersDir: string, files: AnalyzerFs = nodeAnalyzerFs): BundledAnalyzerEntries {
  const entries: BundledAnalyzerEntries = {};
  for (const analyzer of ANALYZERS) {
    const packageDir = path.join(analyzersDir, "node_modules", analyzer.name);
    const manifest = files.readText(path.join(packageDir, "package.json"));
    if (!manifest) continue;
    let parsed: { version?: string; bin?: string | Record<string, string> };
    try { parsed = JSON.parse(manifest); } catch { continue; }
    if (parsed.version !== analyzer.version) continue;
    const bin = typeof parsed.bin === "string" ? parsed.bin : parsed.bin?.[analyzer.bin] ?? Object.values(parsed.bin ?? {})[0];
    if (!bin) continue;
    const entry = path.join(packageDir, bin);
    if (files.exists(entry)) entries[analyzer.name as AnalyzerName] = entry.replace(/\\/g, "/");
  }
  return entries;
}

/** Register the VSIX's analyzers with the runner. Called once at activation. */
export function registerBundledAnalyzers(extensionPath: string): BundledAnalyzerEntries {
  const entries = resolveBundledAnalyzers(path.join(extensionPath, "out", "analyzers"));
  setBundledAnalyzers(entries);
  return entries;
}
