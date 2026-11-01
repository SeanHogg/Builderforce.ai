/**
 * The §8.4 reference scenario, scripted (PRD 35 §8.4, §3.3 "Efficiency"): "Review `docs/specs/35-prd-one-agent-one-kernel.md`
 * and update it using sub-agents", in a multi-repo workspace root, on a 45 KB markdown PRD.
 *
 * The 2026-10-25 run read the PRD eight times in overlapping windows and shell `sed`, was served covered-read stubs for lines it
 * had never seen, and never spawned or edited anything (79+ turns). Here a REACTIVE fake model plays a model that does what the
 * agent tells it to: it pages the document two windows a turn, and it spawns when - and only when - the read result carries the
 * delegation advisory. So the budgets below measure what the AGENT does around a model, not what a script says:
 *
 *   - the advisory reaches the model on the read that earned it, so the first spawn comes by parent turn 5;
 *   - the run finishes within 15 parent turns, with the PRD edited;
 *   - a window overlapping lines the model has seen but not all of them is READ (the unseen lines are served), never answered
 *     with a covered-read stub; a stub is only ever for lines that were actually served.
 *
 * Budgets proved here: first spawn by parent turn 5 (measured from the trace, for a model reading one window a turn and for one
 * reading two), at most 15 parent turns, the PRD actually edited on the in-memory provider, no covered-read stub for lines never served,
 * the first read of the large markdown returning its outline (so "outline + sections" is open to a model: the reads-of-the-PRD budget is
 * the model's to keep, the outline is the agent's to offer), and an unkept readiness claim answered by the progress guard on the third
 * turn. Delegation is requested the way every adapter requests it: `asksForSubagents(prompt)`.
 *
 * Not in here, because a fake cannot prove it: the repo-resolution errors (the node provider's resolver, whose own cases are
 * `test/tools/defaultRepo.test.ts`), the shell reads of workspace files (a model's choice; a shell print is counted as a read by
 * `test/tools/shellCoverage.test.ts`), the 2-second Stop and the foreground-command abort (live; `test/conformance/wiring.test.ts`
 * covers the steered stop and the steer reaching the next model call), and the model named before turn 1 (`test/model/preflight.test.ts`).
 * The same scenario through the Brain's production path (`startRun` -> `callPreflight` -> `runPrepared`, where covered reads are
 * stubbed and the Brain's own delegation gate runs) is `brain-embedded/src/referenceScenario.test.ts`.
 * Those are the live check on the VSIX (§8.4), not faked here.
 */
import { describe, expect, it } from "vitest";
import type { Capability, CapabilityProvider } from "@builderforce/agent-tools";
import { DEFAULT_READS_BEFORE_NUDGE, asksForSubagents, runAgent, teeEvents, type ModelCompletion, type ModelRequest, type RunEvent, type RunOutcome, type RunPolicy, type RunPorts } from "../../src/index.js";
import { TEST_POLICY } from "../support/policyContext.js";

const PRD_PATH = "Builderforce.ai/docs/specs/35-prd-one-agent-one-kernel.md";
const WINDOW = 120;

/** ~45 KB of markdown: headings every 40 lines, 70-character lines. */
const PRD_LINES: string[] = Array.from({ length: 660 }, (_, i) => (i % 40 === 0 ? `## Section ${i / 40 + 1}` : `Line ${i + 1}: ${"x".repeat(60)}`));
const PRD = PRD_LINES.join("\n");

/** The workspace the run sees: ONE document that edits really change, and the children the run started. */
interface Workspace {
  doc: { text: string };
  edits: string[];
  spawned: string[];
}

function workspace(): { provider: CapabilityProvider; state: Workspace } {
  const state: Workspace = { doc: { text: PRD }, edits: [], spawned: [] };
  const provider: CapabilityProvider = {
    capabilities: new Set<Capability>(["repo.read", "repo.write", "repo.edit", "orchestrate", "orchestrate.fanout"]),
    repoRead: {
      listFiles: async () => ({ ok: true, paths: [PRD_PATH, "other-repo/README.md"] }),
      readFile: async (path: string) => (path === PRD_PATH ? { ok: true, path, content: state.doc.text } : { ok: false, path, error: "not found" }),
      searchCode: async (query: string) => ({ ok: true, query, total: 0, matches: [] }),
    },
    repoWrite: {
      writeFile: async () => ({ ok: true }),
      deleteFile: async () => ({ ok: false }),
      editFile: async (path: string, oldString: string, newString: string) => {
        if (path !== PRD_PATH || !state.doc.text.includes(oldString)) return { ok: false, error: "old_string not found" };
        state.doc.text = state.doc.text.replace(oldString, newString);
        state.edits.push(path);
        return { ok: true };
      },
    },
    orchestration: { spawn: async (input) => { state.spawned.push(input.label); return { ok: true, output: `started ${input.label}` } as never; } },
  };
  return { provider, state };
}

const call = (id: string, name: string, args: unknown): { id: string; name: string; arguments: string } => ({ id, name, arguments: JSON.stringify(args) });

/**
 * A model that does what the agent tells it. Each turn: if the last tool results carry the delegation advisory, spawn; if it has
 * spawned, edit and finish; otherwise page the PRD two windows further. Turn 2 also asks for a window that OVERLAPS what it has seen
 * but reaches past it.
 */
function reactiveModel(readsPerTurn: 1 | 2): (request: ModelRequest) => ModelCompletion {
  let turn = 0;
  let next = 1;
  let spawnedAt = 0;
  return (request) => {
    turn += 1;
    const recent = request.messages.slice(-4).map((m) => m.content).join("\n");
    if (spawnedAt) {
      return turn === spawnedAt + 1
        ? { content: "", toolCalls: [call(`e${turn}`, "edit_file", { path: PRD_PATH, old_string: "## Section 1", new_string: "## Section 1 (reviewed)" })] }
        : { content: "The PRD is reviewed and updated." };
    }
    if (recent.includes("STOP READING AND DELEGATE")) {
      spawnedAt = turn;
      return { content: "", toolCalls: [call(`s${turn}`, "spawn_agents", { workstreams: [{ label: "WS2", task: "Review section 2 and report." }, { label: "WS4", task: "Review section 4 and report." }] })] };
    }
    // Turn 2 asks for lines the model has seen (1-120, 121-240) AND lines it has not (241-300); turn 3 re-reads lines it HAS seen.
    const ahead = { path: PRD_PATH, offset: next, limit: WINDOW };
    const wanted = turn === 2 ? [{ path: PRD_PATH, offset: 200, limit: 100 }, ahead] : turn === 3 ? [{ path: PRD_PATH, offset: 10, limit: 30 }, ahead] : [ahead, { ...ahead, offset: next + WINDOW }];
    // The first read of the document names no window, as the tool's own description invites: that is the read that returns the outline.
    if (turn === 1) wanted[0] = { path: PRD_PATH } as (typeof wanted)[number];
    const reads = wanted.slice(0, readsPerTurn);
    next += readsPerTurn * WINDOW;
    return { content: "", toolCalls: reads.map((args, i) => call(`r${turn}-${i}`, "read_file", args)) };
  };
}

const PROMPT = `Review ${PRD_PATH} and update it using sub-agents.`;
const POLICY: RunPolicy = { ...TEST_POLICY, role: "code", delegation: { requested: asksForSubagents(PROMPT), readsBeforeNudge: DEFAULT_READS_BEFORE_NUDGE } };

async function replay(readsPerTurn: 1 | 2 = 2, model: (request: ModelRequest) => ModelCompletion = reactiveModel(readsPerTurn), policy: RunPolicy = POLICY) {
  const events: RunEvent[] = [];
  const { provider, state } = workspace();
  const requests: ModelRequest[] = [];
  const ports: RunPorts = {
    model: { complete: async (request) => { const seen = JSON.parse(JSON.stringify(request)) as ModelRequest; requests.push(seen); return model(seen); } },
    capabilities: provider,
    store: { load: () => undefined, save: () => undefined },
    events: teeEvents(undefined, events),
    human: { ask: async () => ({ kind: "paused" }) },
    context: { pack: () => ({ focus: [], facts: [], recall: [] }) },
  };
  const outcome = await runAgent({ task: { prompt: PROMPT, dispatch: { source: "chat" }, workspace: { defaultRepo: "Builderforce.ai" } }, policy, ports });
  /** Parent turns, and the turn of the first spawn: both read off the agent's own trace, not off the script. */
  const turns = events.filter((e) => e.kind === "model.completed").length;
  const spawn = events.find((e) => e.kind === "tool.dispatched" && e.tool === "spawn_agents");
  return { outcome, events, state, requests, lastRequest: requests[requests.length - 1]!, turns, spawnTurn: spawn ? spawn.step + 1 : undefined };
}

/** The lines a read_file result actually served: `[first, last]` from its own `offset` and content. */
function servedRange(result: unknown): [number, number] | null {
  const r = result as { ok?: boolean; offset?: number; content?: string } | undefined;
  if (!r || r.ok === false || typeof r.content !== "string") return null;
  const first = r.offset ?? 1;
  return [first, first + r.content.split("\n").length - 1];
}

describe("the §8.4 reference scenario, replayed on the one agent", () => {
  it("requests delegation from the prompt the way every adapter does", () => {
    expect(asksForSubagents(PROMPT)).toBe(true);
    expect(POLICY.delegation.requested).toBe(true);
    expect(asksForSubagents(`Review ${PRD_PATH} and update it.`)).toBe(false);
  });

  it("finishes within 15 parent turns, spawns by turn 5 on the agent's own advisory (two reads a turn), and really edits the PRD", async () => {
    const { outcome, state, spawnTurn, turns } = await replay();
    expect(outcome.kind).toBe("finished");
    expect(spawnTurn).toBeDefined();
    expect(spawnTurn!).toBeLessThanOrEqual(5);
    expect(turns).toBeLessThanOrEqual(15);
    expect(state.spawned).toEqual(["WS2", "WS4"]);
    expect(state.edits).toEqual([PRD_PATH]);
    expect(state.doc.text).toContain("## Section 1 (reviewed)");
    expect(state.doc.text.length).toBeGreaterThan(PRD.length);
  });

  it("holds the same budgets for a model that reads ONE window a turn: told on the fourth read, spawned on turn 5", async () => {
    const { outcome, state, spawnTurn, turns } = await replay(1);
    expect(outcome.kind).toBe("finished");
    expect(DEFAULT_READS_BEFORE_NUDGE).toBe(4);
    expect(spawnTurn).toBe(5);
    expect(turns).toBeLessThanOrEqual(15);
    expect(state.doc.text).toContain("## Section 1 (reviewed)");
  });

  it("without a request for sub-agents the advisory never comes, so nothing spawns (the nudge is the request's, not the run's)", async () => {
    const quiet = { ...POLICY, delegation: { requested: false, readsBeforeNudge: DEFAULT_READS_BEFORE_NUDGE } };
    // A model that only reads, then answers: with no request there is nothing to nudge, and nothing to hold the settle.
    let turn = 0;
    const reader = (): ModelCompletion => (++turn <= 6 ? { content: "", toolCalls: [call(`r${turn}`, "read_file", { path: PRD_PATH, offset: turn * 100, limit: 50 })] } : { content: "Done reading." });
    const { outcome, state, spawnTurn } = await replay(1, reader, quiet);
    expect(outcome.kind).toBe("finished");
    expect(spawnTurn).toBeUndefined();
    expect(state.spawned).toEqual([]);
  });

  it("offers the outline of the large markdown on the first read, so outline + sections is open to a model", async () => {
    const { requests } = await replay(1);
    const firstRead = requests[1]!.messages.find((m) => m.role === "tool");
    const result = JSON.parse(firstRead!.content) as { outline?: Array<{ heading: string; line: number }> };
    expect(result.outline?.length).toBeGreaterThan(0);
    expect(result.outline?.[0]).toMatchObject({ heading: expect.stringContaining("Section 1"), line: 1 });
  });

  it("answers a readiness claim that was not kept: after two turns that say \"I have everything I need\" and only read, the third turn is told to act", async () => {
    const claiming = (): ModelCompletion => ({ content: "I have everything I need to write the update.", toolCalls: [call("c", "read_file", { path: PRD_PATH, offset: 1, limit: 20 })] });
    let n = 0;
    const model = (): ModelCompletion => (++n <= 3 ? claiming() : { content: "Done." });
    const policy = { ...POLICY, levers: ["a3_progress_detector"] as RunPolicy["levers"], delegation: { requested: false, readsBeforeNudge: DEFAULT_READS_BEFORE_NUDGE } };
    const { requests } = await replay(1, model, policy);
    const told = (i: number) => JSON.stringify(requests[i]!.messages);
    expect(told(1)).not.toContain("you have said");
    expect(told(2)).toContain("you have said 2 times that you have what you need");
  });

  it("never answers with a covered-read stub for lines the model was not served", async () => {
    const { lastRequest } = await replay(1);
    // Pair each read_file call with the row the model got back, in transcript order.
    const asked = new Map<string, { offset?: number; limit?: number }>();
    for (const m of lastRequest.messages) {
      for (const c of m.toolCalls ?? []) if (c.name === "read_file") asked.set(c.id, JSON.parse(c.arguments) as { offset?: number; limit?: number });
    }
    const served: Array<[number, number]> = [];
    let reads = 0;
    let stubs = 0;
    for (const m of lastRequest.messages) {
      const args = m.role === "tool" && m.toolCallId ? asked.get(m.toolCallId) : undefined;
      if (!args) continue;
      reads += 1;
      const range = servedRange(JSON.parse(m.content));
      if (range) {
        served.push(range);
        continue;
      }
      // Not a served window: the agent answered from its read coverage. That is only honest for lines already served.
      stubs += 1;
      const first = args.offset ?? 1;
      const last = first + (args.limit ?? WINDOW) - 1;
      for (let line = first; line <= last; line += 1) {
        expect(served.some(([a, b]) => line >= a && line <= b), `line ${line} was answered from coverage but never served`).toBe(true);
      }
    }
    expect(reads).toBeGreaterThanOrEqual(4);
    // Turn 3 re-read lines 10-39, which WERE served: the agent answered from coverage, so the check above ran on a real stub.
    expect(stubs).toBeGreaterThan(0);
  });
});
