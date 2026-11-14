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
import { ANALYZERS, setBundledAnalyzers } from "@builderforce/agent-tools";
export const nodeAnalyzerFs = {
    readText: (file) => { try {
        return fs.readFileSync(file, "utf8");
    }
    catch {
        return undefined;
    } },
    exists: (file) => fs.existsSync(file),
};
/** The entry script of each analyzer installed under `analyzersDir` at its pinned version (forward slashes). */
export function resolveBundledAnalyzers(analyzersDir, files = nodeAnalyzerFs) {
    const entries = {};
    for (const analyzer of ANALYZERS) {
        const packageDir = path.join(analyzersDir, "node_modules", analyzer.name);
        const manifest = files.readText(path.join(packageDir, "package.json"));
        if (!manifest)
            continue;
        let parsed;
        try {
            parsed = JSON.parse(manifest);
        }
        catch {
            continue;
        }
        if (parsed.version !== analyzer.version)
            continue;
        const bin = typeof parsed.bin === "string" ? parsed.bin : parsed.bin?.[analyzer.bin] ?? Object.values(parsed.bin ?? {})[0];
        if (!bin)
            continue;
        const entry = path.join(packageDir, bin);
        if (files.exists(entry))
            entries[analyzer.name] = entry.replace(/\\/g, "/");
    }
    return entries;
}
/** Register the VSIX's analyzers with the runner. Called once at activation. */
export function registerBundledAnalyzers(extensionPath) {
    const entries = resolveBundledAnalyzers(path.join(extensionPath, "out", "analyzers"));
    setBundledAnalyzers(entries);
    return entries;
}
//# sourceMappingURL=bundledAnalyzers.js.map