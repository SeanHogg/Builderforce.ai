import { defineConfig } from "vitest/config";

/**
 * The Pyodide suites need JSPI (WebAssembly stack switching) for blocking
 * readback. Node ≥ 26 ships it (and rejects the flag); Node 24 has it behind
 * `--experimental-wasm-jspi`, which the test workers get only where the
 * runtime lacks `WebAssembly.Suspending`. test/helpers/pyodide.ts fails the
 * suites loudly if JSPI is still missing.
 */
const jspiFlag = typeof (WebAssembly as { Suspending?: unknown }).Suspending === "function" ? [] : ["--experimental-wasm-jspi"];

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    execArgv: jspiFlag,
  },
});
