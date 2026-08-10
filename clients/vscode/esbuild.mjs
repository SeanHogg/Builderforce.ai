/**
 * Bundles the extension into a single CommonJS file so ESM-only dependencies
 * (e.g. @seanhogg/builderforce-memory — Evermind Write-Through Cognition) can be
 * imported normally. `vscode` is provided by the host, so it stays external.
 */
import * as esbuild from "esbuild";
import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const watch = process.argv.includes("--watch");
const production = process.argv.includes("--production");
// The headless harness: the scenario replayer + the live probe, bundled as a Node CLI
// so the extension's chat can be exercised without packaging or installing a VSIX.
// Built to a SEPARATE entry point (never shipped in the .vsix — see .vscodeignore).
const harness = process.argv.includes("--harness");

// Clean stale per-file output from the old tsc build so out/ holds only the bundle.
// Skipped for the harness build, which must not wipe an existing extension bundle.
if (!harness) fs.rmSync("out", { recursive: true, force: true });

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Ship the Agent SDK's native Claude Code runtime inside the VSIX. The optional
 * dependency is platform-specific, so a package built on Windows/macOS/Linux is
 * intentionally a package for that platform. The SDK JS is bundled by esbuild;
 * only this executable asset must remain a real file at runtime.
 */
function copyClaudeAgentSdkRuntime() {
  const sdkEntry = createRequire(import.meta.url).resolve("@anthropic-ai/claude-agent-sdk");
  const sdkRequire = createRequire(sdkEntry);
  const isMusl = process.platform === "linux" && !process.report?.getReport?.().header?.glibcVersionRuntime;
  const platform = process.platform === "linux" && isMusl
    ? `linux-${process.arch}-musl`
    : `${process.platform}-${process.arch}`;
  const packageName = `@anthropic-ai/claude-agent-sdk-${platform}`;
  const manifest = sdkRequire.resolve(`${packageName}/package.json`);
  const sourceDir = path.dirname(manifest);
  const binaryName = process.platform === "win32" ? "claude.exe" : "claude";
  const targetDir = path.join(here, "out", "claude-agent-sdk");
  fs.mkdirSync(targetDir, { recursive: true });
  fs.copyFileSync(path.join(sourceDir, binaryName), path.join(targetDir, binaryName));
  fs.copyFileSync(path.join(sourceDir, "LICENSE.md"), path.join(targetDir, "LICENSE.md"));
  if (process.platform !== "win32") fs.chmodSync(path.join(targetDir, binaryName), 0o755);
}
// The shared `@builderforce/agent-tools` contract is consumed as SOURCE (no dist —
// mirrors how `api` resolves it via tsconfig paths), so the editor surface runs the
// SAME tool definitions as the cloud. Bundle it from its TS entry…
const agentToolsRoot = path.resolve(here, "../../packages/agent-tools/src");
const creationCanvasContract = path.resolve(here, "../../packages/creation-canvas-contract/src/index.ts");

/** …and rewrite its NodeNext `./x.js` relative imports to the real `./x.ts` source
 *  (esbuild won't map .js→.ts on its own). Scoped to that package so nothing else
 *  is affected. */
const agentToolsTsResolve = {
  name: "agent-tools-ts-resolve",
  setup(build) {
    build.onResolve({ filter: /\.js$/ }, (args) => {
      if (!args.importer.startsWith(agentToolsRoot)) return undefined;
      const tsPath = path.resolve(path.dirname(args.importer), args.path.replace(/\.js$/, ".ts"));
      return fs.existsSync(tsPath) ? { path: tsPath } : undefined;
    });
  },
};

/** @type {import('esbuild').BuildOptions} */
const options = harness
  ? {
      entryPoints: ["harness/cli.ts"],
      bundle: true,
      outfile: "out/harness.cjs",
      platform: "node",
      format: "cjs",
      target: "node20",
      // The harness never runs inside the editor, so `vscode` must not even be
      // reachable — anything that reaches for it belongs on the extension side.
      external: ["vscode", "react", "react-dom"],
      alias: { "@builderforce/agent-tools": path.join(agentToolsRoot, "index.ts"), "@builderforce/creation-canvas-contract": creationCanvasContract },
      plugins: [agentToolsTsResolve],
      sourcemap: true,
      logLevel: "warning",
    }
  : {
      entryPoints: ["src/extension.ts"],
      bundle: true,
      outfile: "out/extension.js",
      platform: "node",
      format: "cjs",
      target: "node20",
      external: ["vscode"],
      alias: { "@builderforce/agent-tools": path.join(agentToolsRoot, "index.ts"), "@builderforce/creation-canvas-contract": creationCanvasContract },
      plugins: [agentToolsTsResolve],
      sourcemap: !production,
      minify: production,
      logLevel: "info",
    };

if (watch) {
  if (!harness) copyClaudeAgentSdkRuntime();
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("[esbuild] watching…");
} else {
  await esbuild.build(options);
  if (!harness) copyClaudeAgentSdkRuntime();
}
