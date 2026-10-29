/**
 * The agent's read coverage and the shell (PRD 35 E1, §6.10) — what the Brain's read guard
 * has always done, now on every entry point: a shell command that provably only reads
 * forgets no read, and one that PRINTED a workspace file is the `read_file` it stands for.
 * New characterization of the shared rules (`@builderforce/run-guards` `readOnlyShell` /
 * `shellPrint`, whose own cases are the Brain's `readOnlyShell.test` / `shellReadCoverage.test`).
 */
import { describe, expect, it } from "vitest";
import { coveredReadAnswer, recordServedRead } from "../../src/policy/tools/index.js";
import { policyCtx } from "../support/policyContext.js";

const READ = { id: "r1", name: "read_file", args: { path: "src/a.ts" } };
const served = { ok: true, path: "src/a.ts", content: "one\ntwo\nthree", totalLines: 3, offset: 1, truncated: false };

/** A run that has been served `src/a.ts`, with the serving row still in its transcript. */
function afterRead() {
  const ctx = policyCtx({ messages: [{ role: "tool", content: "{}", toolCallId: "r1" }] });
  recordServedRead(ctx, READ, served, false);
  return ctx;
}

const duplicate = (ctx: ReturnType<typeof afterRead>) => coveredReadAnswer(ctx, { ...READ, id: "r2" });

describe("a shell command and the read cache", () => {
  it("a command that only reads forgets nothing — `git log` between two reads of a file", () => {
    const ctx = afterRead();
    recordServedRead(ctx, { id: "s1", name: "run_command", args: { command: "git log --oneline -5" } }, { ok: true, exitCode: 0, stdout: "abc fix" }, false);
    expect(JSON.stringify(duplicate(ctx))).toContain("Duplicate read_file");
  });

  it("a command that may write forgets every read — the old behaviour, kept", () => {
    const ctx = afterRead();
    recordServedRead(ctx, { id: "s1", name: "run_command", args: { command: "npm test" } }, { ok: true, exitCode: 0, stdout: "ok" }, false);
    expect(duplicate(ctx)).toBeUndefined();
  });
});

describe("a shell print of a workspace file is a read of it", () => {
  it("`cat src/b.ts` covers a later read_file of that file, and persists in the run state", () => {
    const ctx = policyCtx({ messages: [{ role: "tool", content: "{}", toolCallId: "s1" }] });
    recordServedRead(ctx, { id: "s1", name: "run_command", args: { command: "cat src/b.ts" } }, { ok: true, exitCode: 0, stdout: "one\ntwo\nthree" }, false);

    expect(JSON.stringify(coveredReadAnswer(ctx, { id: "r3", name: "read_file", args: { path: "src/b.ts" } }))).toContain("read_file");
    expect(Object.keys(ctx.state.reads.served).some((key) => key.includes("src/b.ts"))).toBe(true);
  });

  it("a print the cap cut is not a read — it did not show every line it printed", () => {
    const ctx = policyCtx();
    recordServedRead(ctx, { id: "s1", name: "run_command", args: { command: "cat src/b.ts" } }, { ok: true, truncated: true, output: "one\ntwo" }, false);
    expect(coveredReadAnswer(ctx, { id: "r3", name: "read_file", args: { path: "src/b.ts" } })).toBeUndefined();
  });

  it("a failed command is not a read", () => {
    const ctx = policyCtx();
    recordServedRead(ctx, { id: "s1", name: "run_command", args: { command: "cat src/b.ts" } }, { ok: false, exitCode: 1, stdout: "" }, true);
    expect(coveredReadAnswer(ctx, { id: "r3", name: "read_file", args: { path: "src/b.ts" } })).toBeUndefined();
  });
});
