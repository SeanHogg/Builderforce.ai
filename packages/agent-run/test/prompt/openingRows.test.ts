/**
 * Prompt assembly (PRD 35 §7 "Prompt assembly: persona, skills, governance, heartbeat prompt, psychometrics"). The sources the
 * three engines each assembled by hand (the SDK runner's persona append, the on-prem embedded runner's system prompt, the
 * cloud engine's persona + affect section) are ONE assembly now, and the adapter supplies only data:
 *
 *   - the assigned persona / skill / content block, heartbeat prompt and psychometric profile arrive as `RunTask.persona`;
 *   - the governance gates the run is bound by arrive as `RunPolicy.approvalGates` and are rendered ONCE, ahead of the persona;
 *   - the task is always the first `user` row, and nothing volatile is in the opening rows;
 *   - a per-turn section a surface supplies (the cloud's affect state) rides the LAST row of each request, never the transcript.
 *
 * These cases pin that assembly as it is today. The three old assemblies are deleted, so there is no old home to baseline
 * against: this is a characterization of the one home, not a parity proof.
 */
import { describe, expect, it } from "vitest";
import type { Capability, PolicyGate } from "@builderforce/agent-tools";
import { openingRows, runAgent, type ModelRequest, type RunPorts } from "../../src/index.js";
import { TEST_POLICY } from "../support/policyContext.js";

const BLOCK: PolicyGate = { id: "g1", tool: "delete_file", effect: "block", reason: "no deletes in this workspace" };

const PERSONA = "You are the reviewer.\n\nSkill: be terse.\n\nProfile: careful, low risk appetite.";

describe("openingRows", () => {
  it("is the task alone when there is no persona and no gate", () => {
    expect(openingRows({ prompt: "Fix it", dispatch: { source: "chat" } })).toEqual([{ role: "user", content: "Fix it" }]);
  });

  it("puts the persona in ONE system row ahead of the task, keeping a multi-block persona whole and trimmed", () => {
    const rows = openingRows({ prompt: "Fix it", persona: `  ${PERSONA}\n`, dispatch: { source: "chat" } });
    expect(rows).toEqual([
      { role: "system", content: PERSONA },
      { role: "user", content: "Fix it" },
    ]);
  });

  it("ignores a blank persona", () => {
    expect(openingRows({ prompt: "Fix it", persona: "   ", dispatch: { source: "chat" } })).toEqual([{ role: "user", content: "Fix it" }]);
  });

  it("renders the governance gates once, ahead of the persona, in the same system row", () => {
    const [system, task] = openingRows({ prompt: "Fix it", persona: PERSONA, dispatch: { source: "chat" } }, [BLOCK]);
    expect(system?.role).toBe("system");
    expect(system?.content.endsWith(PERSONA)).toBe(true);
    expect(system?.content.indexOf("no deletes in this workspace")).toBeGreaterThanOrEqual(0);
    expect(system!.content.indexOf("no deletes in this workspace")).toBeLessThan(system!.content.indexOf("You are the reviewer."));
    expect(task).toEqual({ role: "user", content: "Fix it" });
  });
});

describe("what a request carries, end to end", () => {
  function ports(requests: ModelRequest[]): RunPorts {
    const script = [{ content: "", toolCalls: [{ id: "c1", name: "finish", arguments: '{"summary":"done"}' }] }, { content: "done" }];
    let n = 0;
    return {
      model: { complete: async (request) => { requests.push(JSON.parse(JSON.stringify(request)) as ModelRequest); return script[n++]!; } },
      capabilities: { capabilities: new Set<Capability>() },
      store: { load: () => undefined, save: () => undefined },
      events: { emit: () => undefined },
      human: { ask: async () => ({ kind: "paused" }) },
      context: { pack: () => ({ focus: [], facts: [], recall: [] }), turnSections: () => ["## affect\ncalm"] },
    };
  }

  it("opens with persona then task, ends with the surface's per-turn section, and keeps the section out of the transcript", async () => {
    const requests: ModelRequest[] = [];
    const outcome = await runAgent({
      task: { prompt: "Review the change.", persona: PERSONA, dispatch: { source: "chat" } },
      policy: TEST_POLICY,
      ports: ports(requests),
    });

    expect(outcome.kind).toBe("finished");
    const first = requests[0]!.messages;
    expect(first[0]).toEqual({ role: "system", content: PERSONA });
    expect(first[1]).toEqual({ role: "user", content: "Review the change." });
    expect(first[first.length - 1]!.content).toContain("## affect");
    if (outcome.kind === "finished") {
      expect(JSON.stringify(outcome.state.messages)).not.toContain("## affect");
    }
  });
});
