import { defineConfig } from "tsdown";

const env = {
  NODE_ENV: "production",
};

// TypeScript is a devDependency used by ast-parser.ts at runtime.
// Marking it external keeps it as a CJS module loaded by Node, which
// avoids bundling TypeScript's CJS globals (__filename) into ESM output.
const external = ["typescript", "tsx"];

// Minify whitespace and syntax for a smaller dist footprint while
// preserving identifier names so stack traces, plugin discovery, and
// dynamic property access remain reliable at runtime.
const minify = { whitespace: true, syntax: true } as const;

export default defineConfig([
  {
    entry: "src/index.ts",
    env,
    fixedExtension: false,
    minify,
    platform: "node",
    external,
  },
  {
    entry: "src/entry.ts",
    env,
    fixedExtension: false,
    minify,
    platform: "node",
    external,
  },
  {
    entry: "src/agents/builderforcellm-local-worker.ts",
    env,
    fixedExtension: false,
    minify,
    platform: "node",
    external,
  },
  {
    // Ensure this module is bundled as an entry so legacy CLI shims can resolve its exports.
    entry: "src/cli/daemon-cli.ts",
    env,
    fixedExtension: false,
    minify,
    platform: "node",
    external,
  },
  {
    entry: "src/infra/warning-filter.ts",
    env,
    fixedExtension: false,
    minify,
    platform: "node",
    external,
  },
  {
    entry: "src/plugin-sdk/index.ts",
    outDir: "dist/plugin-sdk",
    env,
    fixedExtension: false,
    minify,
    platform: "node",
    external,
  },
  {
    entry: "src/plugin-sdk/account-id.ts",
    outDir: "dist/plugin-sdk",
    env,
    fixedExtension: false,
    minify,
    platform: "node",
    external,
  },
  {
    entry: "src/extensionAPI.ts",
    env,
    fixedExtension: false,
    minify,
    platform: "node",
    external,
  },
  {
    entry: ["src/hooks/bundled/*/handler.ts", "src/hooks/llm-slug-generator.ts"],
    env,
    fixedExtension: false,
    minify,
    platform: "node",
    external,
  },
]);
