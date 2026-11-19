/**
 * policy/model/reask — the planner's first code change is re-asked of the coder, and a `run_command` that may write
 * counts as one (VS Code chat #275: the plan-role model split a file with an inline node script and nothing re-asked it).
 */

import { describe, expect, it } from "vitest";
import { initialRunPolicy } from "@builderforce/run-policy";
import { reaskAsCoder } from "../../src/policy/model/reask.js";
import type { ModelCompletion, RunState } from "../../src/contract.js";

const POLICY = { codeChangeTools: ["write_file", "edit_file"] };

function stateOf(): RunState {
  return { model: initialRunPolicy() } as unknown as RunState;
}

function turnCalling(name: string, args: Record<string, unknown>): ModelCompletion {
  return { content: "Splitting the file now.", toolCalls: [{ id: "c1", name, arguments: JSON.stringify(args) }] };
}

const PLAN = { role: "plan", hasTools: true };

describe("reaskAsCoder", () => {
  it("re-asks a plan turn whose first change is an edit", () => {
    expect(reaskAsCoder(stateOf(), POLICY, turnCalling("edit_file", { path: "a.ts" }), PLAN)?.ask.role).toBe("code");
  });

  it("re-asks a plan turn that runs a MUTATING shell command (chat #275's inline node split)", () => {
    const command = `node -e "const fs=require('fs');const s=fs.readFileSync('frontend/src/big.tsx','utf8');fs.writeFileSync('frontend/src/part.tsx',s.slice(0,100))"`;
    const reask = reaskAsCoder(stateOf(), POLICY, turnCalling("run_command", { command }), PLAN);
    expect(reask?.ask.role).toBe("code");
    expect(reask?.brief.content).toContain("run_command");
  });

  it("re-asks a ratchet --update (it rewrites a baseline file)", () => {
    const command = "node scripts/check-react-hooks-ratchet.mjs --update";
    expect(reaskAsCoder(stateOf(), POLICY, turnCalling("run_command", { command }), PLAN)?.ask.role).toBe("code");
  });

  it("leaves a read-only or check-running shell command with the planner", () => {
    for (const command of ["git log --oneline -5", "ls frontend/scripts", "pnpm run typecheck", "npx vitest run src/a.test.ts"]) {
      expect(reaskAsCoder(stateOf(), POLICY, turnCalling("run_command", { command }), PLAN)).toBeUndefined();
    }
  });

  it("never re-asks a code turn, nor a run that names no code-change tools", () => {
    const command = "sed -i 's/a/b/' x.ts";
    expect(reaskAsCoder(stateOf(), POLICY, turnCalling("run_command", { command }), { role: "code", hasTools: true })).toBeUndefined();
    expect(reaskAsCoder(stateOf(), {}, turnCalling("run_command", { command }), PLAN)).toBeUndefined();
  });
});
