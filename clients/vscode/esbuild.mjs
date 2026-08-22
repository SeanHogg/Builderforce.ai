/**
 * Bundles the extension into a single CommonJS file so ESM-only dependencies
 * (e.g. @seanhogg/builderforce-memory — Evermind Write-Through Cognition) can be
 * imported normally. `vscode` is provided by the host, so it stays external.
 */
import * as esbuild from "esbuild";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { computeBuildId } from "./buildId.mjs";
import { sourcePackageAliasMap, sourcePackageRoots } from "../../scripts/sourcePackages.mjs";

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
const repoRoot = path.resolve(here, "../..");

// The shared contracts (`@builderforce/agent-tools`, `run-context`, the canvas
// contract) are consumed as SOURCE (no dist — mirrors how `api` resolves them via
// tsconfig paths), so the editor surface runs the SAME tool definitions as the cloud.
// Both the alias map and the roots below are derived from the package manifests, so a
// new shared package is bundled here, in the harness and on the web without a list to
// remember. See `scripts/sourcePackages.mjs`.
//
// `@builderforce/agent-tools/node-path` is agent-tools' node-only export condition (the
// shared workspace-containment path resolver). The package ROOT stays node-builtin-free
// because the Cloudflare Worker imports it; this subpath is Node-surface-only, which is
// why it is a separate entry rather than a re-export from the index — esbuild matches
// the longest alias key, so both resolve correctly.
const sharedPackageAliases = sourcePackageAliasMap(repoRoot);

/** Source-consumed shared packages whose NodeNext `./x.js` imports must be rewritten to
 *  `./x.ts`. The resolver plugin below reads these roots rather than hard-coding one
 *  (which is how `run-context` would otherwise have failed to bundle the moment it
 *  imported its own `blocks.js`). */
const tsSourcePackageRoots = sourcePackageRoots(repoRoot);

/** …and rewrite its NodeNext `./x.js` relative imports to the real `./x.ts` source
 *  (esbuild won't map .js→.ts on its own). Scoped to that package so nothing else
 *  is affected. */
const agentToolsTsResolve = {
  name: "shared-package-ts-resolve",
  setup(build) {
    build.onResolve({ filter: /\.js$/ }, (args) => {
      if (!tsSourcePackageRoots.some((root) => args.importer.startsWith(root))) return undefined;
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
const buildIdentity = {
  define: {
    __BF_BUILD_ID__: JSON.stringify(computeBuildId(here)),
    __BF_BUILT_AT__: JSON.stringify(new Date().toISOString()),
  },
};

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
      alias: sharedPackageAliases,
      plugins: [agentToolsTsResolve],
      ...importMetaUrlShim,
      define: { ...importMetaUrlShim.define, ...buildIdentity.define },
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
      alias: sharedPackageAliases,
      plugins: [agentToolsTsResolve],
      ...importMetaUrlShim,
      define: { ...importMetaUrlShim.define, ...buildIdentity.define },
      sourcemap: !production,
      minify: production,
      logLevel: "info",
    };

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("[esbuild] watching…");
} else {
  await esbuild.build(options);
}
