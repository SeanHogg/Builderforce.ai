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
// The extension-host integration suite: the Mocha entry VS Code loads inside the
// running host, plus the launcher that downloads/boots that host. Bundled (not tsc'd)
// so it resolves dependencies exactly as the shipped extension does, and written to a
// SEPARATE directory that is never packaged (see .vscodeignore).
const integration = process.argv.includes("--integration");

// Clean stale per-file output from the old tsc build so out/ holds only the bundle.
// Skipped for the harness build, which must not wipe an existing extension bundle.
if (!harness && !integration) fs.rmSync("out", { recursive: true, force: true });

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

/**
 * A REAL `import.meta.url` inside the CommonJS bundle.
 *
 * esbuild has to shim `import.meta` when it emits CJS, and its shim is an empty object
 * — so every bundled ESM dependency that does `createRequire(import.meta.url)` (the
 * Agent/MCP SDKs do, at MODULE scope) receives `undefined` and throws
 * `The argument 'filename' must be a file URL object, file URL string, or absolute path
 * string` before a single line of our code runs. That is not a degraded feature: the
 * extension fails to ACTIVATE, so every command, view and webview is dead, and the only
 * evidence is one notification in a window the user may already have dismissed.
 *
 * It shipped that way in 2026.7.126 → 2026.8.128 and no offline test could see it,
 * because the bundle is only ever LOADED by a real extension host — which is exactly the
 * gap `test-integration/` now covers.
 *
 * `pathToFileURL(__filename).href` is the honest value: a file URL, so both
 * `createRequire(...)` and `fileURLToPath(...)` consumers get what they expect (a bare
 * `__filename` would satisfy the first and break the second).
 */
const importMetaUrlShim = {
  banner: { js: `var __bfImportMetaUrl = require("node:url").pathToFileURL(__filename).href;` },
  define: { "import.meta.url": "__bfImportMetaUrl" },
};

/** @type {import('esbuild').BuildOptions} */
const options = integration
  ? {
      // `suite.cjs` runs INSIDE the extension host (so `vscode` is provided);
      // `runTests.cjs` runs outside it, in plain Node.
      entryPoints: { suite: "test-integration/index.ts", runTests: "test-integration/runTests.ts" },
      bundle: true,
      outdir: "out-integration",
      outExtension: { ".js": ".cjs" },
      platform: "node",
      format: "cjs",
      target: "node20",
      // `vscode` is the host's. Mocha and the launcher stay external and resolve from
      // this package's `node_modules` at runtime: bundling Mocha inlines its
      // `require.resolve` worker paths, which only resolve as real files on disk.
      external: ["vscode", "mocha", "@vscode/test-electron"],
      sourcemap: true,
      logLevel: "warning",
    }
  : harness
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
      ...importMetaUrlShim,
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
      ...importMetaUrlShim,
      sourcemap: !production,
      minify: production,
      logLevel: "info",
    };

if (watch) {
  if (!harness && !integration) copyClaudeAgentSdkRuntime();
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("[esbuild] watching…");
} else {
  await esbuild.build(options);
  if (!harness && !integration) copyClaudeAgentSdkRuntime();
}
