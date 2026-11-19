/**
 * The targeted re-verify advisory: a run that REPEATS a full-suite command is steered to re-run only the checks that
 * failed (VS Code chat #275 ran `pnpm run check` twice — 3m24s, 4m58s — when four guards had failed). Advisory only.
 */
import { describe, expect, it } from "vitest";

import { fullSuiteKey } from "./checkCommand.js";
import { ProgressDetector } from "./progressDetector.js";
import { SuiteRepeat } from "./suiteRepeat.js";

const READS = new Set(["read_file"]);
const ports = { isReadOnly: (tool: string) => READS.has(tool) };
const failed = (stdout: string) => ({ data: { ok: false, exitCode: 1, stdout } });

describe("fullSuiteKey", () => {
  it("names full-suite sweeps", () => {
    for (const cmd of ["pnpm run check", "cd frontend && pnpm run check 2>&1 | tail -60", "npm test", "pnpm test", "npx vitest run", "node scripts/check-react-hooks-ratchet.mjs"]) {
      expect(fullSuiteKey(cmd), cmd).not.toBeNull();
    }
    expect(fullSuiteKey("cd frontend && pnpm run check | tail -5")).toBe(fullSuiteKey("cd frontend && pnpm run check 2>&1 | tail -80"));
    expect(fullSuiteKey("cd api && pnpm run check")).not.toBe(fullSuiteKey("cd frontend && pnpm run check"));
  });

  it("leaves targeted checks and non-checks alone", () => {
    for (const cmd of ["npx vitest run src/a.test.ts", "node scripts/check-react-hooks-ratchet.mjs --update", "node scripts/check-design-scale.mjs", "pnpm run build", "git status", "pnpm test src/x.test.ts"]) {
      expect(fullSuiteKey(cmd), cmd).toBeNull();
    }
  });
});

describe("ProgressDetector: repeated full suite", () => {
  it("advises re-running only the failed checks when a full suite repeats — once per suite", () => {
    let d = new ProgressDetector({}, ports);
    d.observe("run_command", { command: "pnpm run check" }, failed("4 guards failed: a b c d"));
    expect(d.endTurn()).toBeNull();
    d.observe("edit_file", { path: "src/a.ts", old_string: "x", new_string: "y" }, { data: { ok: true } });
    expect(d.endTurn()).toBeNull();
    // A resumed run (the cloud loop rebuilds the detector from JSON) still remembers the first sweep.
    d = new ProgressDetector(JSON.parse(JSON.stringify(d.snapshot())), ports);
    d.observe("run_command", { command: "pnpm run check 2>&1 | tail -40" }, failed("2 guards failed: c d"));
    const advice = d.endTurn();
    expect(advice).toMatchObject({ kind: "advisory" });
    expect(advice && advice.kind === "advisory" ? advice.note : "").toContain("re-run ONLY the checks that failed");
    d.observe("edit_file", { path: "src/b.ts", old_string: "x", new_string: "y" }, { data: { ok: true } });
    d.endTurn();
    d.observe("run_command", { command: "pnpm run check" }, { data: { ok: true, exitCode: 0, stdout: "ok" } });
    expect(d.endTurn()).toBeNull();
  });

  it("keeps the note owed until it is actually returned (a turn that ends otherwise does not spend it)", () => {
    const s = new SuiteRepeat();
    s.ranCommand("pnpm run check");
    s.ranCommand("pnpm run check");
    // The detector returned a trip or another advisory this turn: it never called take().
    const resumed = new SuiteRepeat(JSON.parse(JSON.stringify(s.snapshot())));
    expect(resumed.take()).toContain("pnpm run check");
    expect(resumed.take()).toBe("");
    resumed.ranCommand("pnpm run check");
    expect(resumed.take()).toBe("");
  });

  it("never advises on targeted re-runs", () => {
    const d = new ProgressDetector({}, ports);
    d.observe("run_command", { command: "node scripts/check-a.mjs" }, failed("a"));
    d.endTurn();
    d.observe("run_command", { command: "node scripts/check-a.mjs" }, failed("b"));
    expect(d.endTurn()).toBeNull();
  });
});
