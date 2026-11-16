#!/usr/bin/env node
// `npx --no-install jest <file>` resolves this bin (via node_modules/.bin/jest).
//
// This package's real test runner is **vitest**; jest proper is not installed and its
// mock-hoisting semantics cannot reproduce vitest's `vi.mock`/`vi.hoisted`. So this shim
// delegates to vitest, which runs the repo's test files natively. Some host/push gates
// invoke a bare `npx jest <changed-test-file>`; without this shim that command fails on
// a missing jest for reasons unrelated to the change being pushed.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Find the vitest CLI by walking up from the caller's cwd looking for
// node_modules/vitest/vitest.mjs. This avoids module-resolution subtleties
// (pnpm's symlinked layout, exports maps) — the file either exists or it doesn't.
function findVitestEntry(startDir) {
  let dir = resolve(startDir);
  for (;;) {
    const candidate = join(dir, "node_modules", "vitest", "vitest.mjs");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

const vitestEntry = findVitestEntry(process.cwd());
if (!vitestEntry) {
  console.error(`[jest-shim] vitest not found walking up from ${process.cwd()}`);
  process.exit(1);
}

// Keep positional file args; drop jest-specific flags vitest would not understand.
const files = process.argv.slice(2).filter((a) => !a.startsWith("-"));

// The default vitest config excludes *.e2e.test.ts; route those through the e2e config.
const args = ["run", ...files];
if (files.some((f) => f.includes(".e2e.test."))) {
  args.push("--config", join(process.cwd(), "vitest.e2e.config.ts"));
}

const result = spawnSync(process.execPath, [vitestEntry, ...args], {
  stdio: "inherit",
  cwd: process.cwd(),
});
process.exit(result.status ?? 1);
