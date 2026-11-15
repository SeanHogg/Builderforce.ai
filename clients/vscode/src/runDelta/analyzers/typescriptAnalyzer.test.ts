/** The run delta's TypeScript checker runs in an eval'd worker whose diagnostics come back through the bounded transfer. */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { TYPESCRIPT_TOOL, type AnalyzerExec, type AnalyzerSide } from "@builderforce/agent-tools";
import { typescriptAnalyzer } from "./typescriptAnalyzer";

const tscEntry = path.resolve(__dirname, "..", "..", "..", "out", "analyzers", "node_modules", "typescript", "bin", "tsc");
const bundled = fs.existsSync(path.join(path.dirname(tscEntry), "..", "lib", "typescript.js"));

describe("typescriptAnalyzer — the eval'd worker sends its diagnostics in bounded parts", () => {
  // Needs the VSIX's bundled compiler (`out/analyzers`, written by `node esbuild.mjs`).
  it.skipIf(!bundled)("every type error of a changed file arrives (the worker embeds the shared sender)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-tsa-"));
    try {
      const text = Array.from({ length: 40 }, (_, i) => `export const v${i}: number = "not a number ${i}";`).join("\n");
      fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, noEmit: true }, include: ["*.ts"] }));
      fs.writeFileSync(path.join(dir, "a.ts"), text);
      const side: AnalyzerSide = { side: "after", dir, changed: [{ path: "a.ts", text }], entries: { [TYPESCRIPT_TOOL]: tscEntry }, bundled: true };
      const exec = { mtime: async (p: string) => (fs.existsSync(p) ? fs.statSync(p).mtimeMs : undefined) } as unknown as AnalyzerExec;
      const result = await typescriptAnalyzer.run(side, exec);
      expect(result.status).toBe("ok");
      expect(result.findings.length).toBeGreaterThanOrEqual(1);
      expect(JSON.stringify(result.findings)).toContain("a.ts");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
