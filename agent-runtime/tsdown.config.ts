import { defineConfig, type UserConfig } from "tsdown";

// TypeScript is a devDependency used by ast-parser.ts at runtime.
// Marking it external keeps it as a CJS module loaded by Node, which
// avoids bundling TypeScript's CJS globals (__filename) into ESM output.
const external = ["typescript", "tsx"];

const base = {
  env: { NODE_ENV: "production" },
  fixedExtension: false,
  platform: "node",
  external,
  // Compress syntax and strip whitespace for a smaller dist footprint, but never
  // mangle, so identifier names survive for stack traces, plugin discovery, and
  // dynamic property access at runtime. (Rolldown's shape — the esbuild-style
  // `{ whitespace, syntax }` keys are rejected as invalid output options.)
  minify: { compress: true, mangle: false, codegen: { removeWhitespace: true } },
  // `@builderforce/tui` is a private workspace package (linked devDependency), so
  // it — and its ink/react closure — MUST be inlined into the published bundle;
  // they are not runtime dependencies of this package. That bundling is intended,
  // and under tsdown's CI-only failOnWarn the "consider inlineOnly" warning fails
  // the release build. An explicit allowlist would just mirror ink's transitive
  // tree and break on every ink upgrade.
  inlineOnly: false,
} satisfies UserConfig;

export default defineConfig([
  { ...base, entry: "src/index.ts" },
  { ...base, entry: "src/entry.ts" },
  { ...base, entry: "src/agents/builderforcellm-local-worker.ts" },
  // Ensure this module is bundled as an entry so legacy CLI shims can resolve its exports.
  { ...base, entry: "src/cli/daemon-cli.ts" },
  { ...base, entry: "src/infra/warning-filter.ts" },
  { ...base, entry: "src/plugin-sdk/index.ts", outDir: "dist/plugin-sdk" },
  { ...base, entry: "src/plugin-sdk/account-id.ts", outDir: "dist/plugin-sdk" },
  { ...base, entry: "src/extensionAPI.ts" },
  { ...base, entry: ["src/hooks/bundled/*/handler.ts", "src/hooks/llm-slug-generator.ts"] },
]);
