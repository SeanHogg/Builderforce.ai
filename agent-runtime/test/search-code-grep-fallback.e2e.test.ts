/**
 * Regression lock for a REAL product bug in the on-prem `search_code` backend.
 *
 * `runCodebaseSearch` (src/builderforce/shared-tools/node-code-tools.ts) picks ripgrep
 * when it is installed and otherwise falls back to GNU `grep`. The grep argument vector
 * it builds passes the long option and its value as TWO argv entries:
 *
 *     ["-ril", …, "--include", "*.ts", "--", keyword, projectRoot]
 *
 * GNU grep does not accept a space-separated `--include`; it consumes the next argv entry
 * as the PATTERN, leaving `keyword` in file position. grep exits 2 with
 * `grep: <keyword>: No such file or directory`, and `cbSearchKeyword` swallows that in a
 * bare `catch { return [] }`. The failure is therefore SILENT: `search_code` reports
 * `ok:true, total:0` for a symbol that is plainly present, and `searchCodeTool` then hands
 * the model the note "the term is not referenced … there is nothing to change; say so
 * instead of inventing an edit". A grep-only host makes the agent confidently declare that
 * code it was asked to change does not exist.
 *
 * `--exclude-dir` in the same vector DOES tolerate the separated form, which is why the
 * command looks plausible; only `--include` breaks it.
 *
 * The suite only runs where the fallback is actually live (no ripgrep on PATH). The
 * assertion below is the CORRECT expectation, marked `it.fails` so this file stays green
 * while the bug exists and turns RED the moment someone fixes `cbSearchKeyword` — at which
 * point it should be changed to a plain `it`.
 */

import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { runCodingEval, type CodingEvalResult } from "./helpers/coding-eval.js";

function hasRipgrep(): boolean {
  try {
    execFileSync("rg", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const FIXTURE = {
  "src/pricing.ts": "export function computeTotalPrice(n: number): number {\n  return n;\n}\n",
};

describe.skipIf(hasRipgrep())("search_code · GNU grep fallback (no ripgrep on PATH)", () => {
  it("grep rejects the separated --include form the searcher builds", () => {
    // The exact shape difference, proven against the real grep on this host: identical
    // commands except `--include *.ts` vs `--include=*.ts`.
    const base = ["-ril", "--", "computetotalprice", "src"];
    const separated = ["-ril", "--include", "*.ts", "--", "computetotalprice", "src"];
    const joined = ["-ril", "--include=*.ts", "--", "computetotalprice", "src"];
    const run = (args: string[]): number => {
      try {
        execFileSync("grep", args, { cwd: process.cwd(), stdio: "ignore" });
        return 0;
      } catch (err) {
        return (err as { status?: number }).status ?? -1;
      }
    };
    // 0 = matched, 1 = no match, 2 = grep usage/IO error. Only the separated form errors.
    expect(run(separated)).toBe(2);
    expect(run(joined)).not.toBe(2);
    expect(run(base)).not.toBe(2);
  });

  it.fails("BUG: search_code finds a symbol that exists (currently returns 0 matches)", async () => {
    let run: CodingEvalResult | undefined;
    try {
      run = await runCodingEval({
        files: FIXTURE,
        task: "Find computeTotalPrice.",
        plan: [{ tool: "search_code", args: { query: "computeTotalPrice" } }, { text: "searched" }],
      });
      const search = run.trace[0];
      expect(search.data.ok).toBe(true);
      expect(search.data.total).toBeGreaterThan(0);
    } finally {
      await run?.cleanup();
    }
  });
});
