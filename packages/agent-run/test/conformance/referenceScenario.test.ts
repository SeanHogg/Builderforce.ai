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
 * Not in here, because a fake cannot prove it: the repo-resolution errors (the node provider's resolver, whose own cases are
 * `test/tools/defaultRepo.test.ts`), the shell reads of workspace files (a model's choice; a shell print is counted as a read by
 * `test/tools/shellCoverage.test.ts`), the 2-second Stop and the foreground-command abort (live; `test/conformance/wiring.test.ts`
 * covers the steered stop and the steer reaching the next model call), and the model named before turn 1 (`test/model/preflight.test.ts`).
 * Those are the live check on the VSIX (§8.4), not faked here.
 */
import { describe, expect, it } from "vitest";
import type { Capability, CapabilityProvider } from "@builderforce/agent-tools";
import { DEFAULT_READS_BEFORE_NUDGE, runAgent, teeEvents, type ModelCompletion, type ModelRequest, type RunEvent, type RunOutcome, type RunPolicy, type RunPorts } from "../../src/index.js";
import { TEST_POLICY } from "../support/policyContext.js";

const PRD_PATH = "Builderforce.ai/docs/specs/35-prd-one-agent-one-kernel.md";
const WINDOW = 120;

/** ~45 KB of markdown: headings every 40 lines, 70-character lines. */
const PRD_LINES: string[] = Array.from({ length: 660 }, (_, i) => (i % 40 === 0 ? `## Section ${i / 40 + 1}` : `Line ${i + 1}: ${"x".repeat(60)}`));
const PRD = PRD_LINES.join("\n");

function workspace(edits: string[]): CapabilityProvider {
  return {
    capabilities: new Set<Capability>(["repo.read", "repo.write", "repo.edit", "orchestrate", "orchestrate.fanout"]),
    repoRead: {
      listFiles: async () => ({ ok: true, paths: [PRD_PATH, "other-repo/README.md"] }),
      readFile: async (path: string) => (path === PRD_PATH ? { ok: true, path, content: PRD } : { ok: false, path, error: "not found" }),
      searchCode: async (query: string) => ({ ok: true, query, total: 0, matches: [] }),
    },
    repoWrite: {
      writeFile: async () => ({ ok: true }),
      deleteFile: async () => ({ ok: false }),
      editFile: async (path: string) => {
        edits.push(path);
        return { ok: true };
      },
    },
    orchestration: { spawn: async (input) => ({ ok: true, output: `started ${input.label}` }) as never },
  };
}

const call = (id: string, name: string, args: unknown): { id: string; name: string; arguments: string } => ({ id, name, arguments: JSON.stringify(args) });

/**
 * A model that does what the agent tells it. Each turn: if the last tool results carry the delegation advisory, spawn; if it has
 * spawned, edit and finish; otherwise page the PRD two windows further. Turn 2 also asks for a window that OVERLAPS what it has seen
 * but reaches past it.
 */
function reactiveModel(log: { spawnTurn?: number }, readsPerTurn: 1 | 2): (request: ModelRequest) => ModelCompletion {
  let turn = 0;
  let next = 1;
  let spawned = false;
  return (request) => {
    turn += 1;
    const recent = request.messages.slice(-4).map((m) => m.content).join("\n");
    if (spawned) {
      return turn === (log.spawnTurn ?? 0) + 1
        ? { content: "", toolCalls: [call(`e${turn}`, "edit_file", { path: PRD_PATH, old_string: "## Section 1", new_string: "## Section 1 (reviewed)" })] }
        : { content: "", toolCalls: [call(`f${turn}`, "finish", { summary: "PRD reviewed and updated." })] };
    }
    if (recent.includes("STOP READING AND DELEGATE")) {
      spawned = true;
      log.spawnTurn = turn;
      return { content: "", toolCalls: [call(`s${turn}`, "spawn_agents", { workstreams: [{ label: "WS2", task: "Review section 2 and report." }, { label: "WS4", task: "Review section 4 and report." }] })] };
    }
    // Turn 2 asks for lines the model has seen (1-120, 121-240) AND lines it has not (241-300); turn 3 re-reads lines it HAS seen.
    const ahead = { path: PRD_PATH, offset: next, limit: WINDOW };
    const wanted = turn === 2 ? [{ path: PRD_PATH, offset: 200, limit: 100 }, ahead] : turn === 3 ? [{ path: PRD_PATH, offset: 10, limit: 30 }, ahead] : [ahead, { ...ahead, offset: next + WINDOW }];
    const reads = wanted.slice(0, readsPerTurn);
    next += readsPerTurn * WINDOW;
    return { content: "", toolCalls: reads.map((args, i) => call(`r${turn}-${i}`, "read_file", args)) };
  };
}

const POLICY: RunPolicy = { ...TEST_POLICY, role: "code", delegation: { requested: true, readsBeforeNudge: DEFAULT_READS_BEFORE_NUDGE } };

async function replay(readsPerTurn: 1 | 2 = 2): Promise<{ outcome: RunOutcome; events: RunEvent[]; edits: string[]; spawnTurn: number | undefined; modelTurns: number; lastRequest: ModelRequest }> {
  const events: RunEvent[] = [];
  const edits: string[] = [];
  const log: { spawnTurn?: number } = {};
  const model = reactiveModel(log, readsPerTurn);
  let modelTurns = 0;
  let lastRequest!: ModelRequest;
  const ports: RunPorts = {
    model: { complete: async (request) => { modelTurns += 1; lastRequest = JSON.parse(JSON.stringify(request)) as ModelRequest; return model(lastRequest); } },
    capabilities: workspace(edits),
    store: { load: () => undefined, save: () => undefined },
    events: teeEvents(undefined, events),
    human: { ask: async () => ({ kind: "paused" }) },
    context: { pack: () => ({ focus: [], facts: [], recall: [] }) },
  };
  const outcome = await runAgent({
    task: { prompt: `Review ${PRD_PATH} and update it using sub-agents.`, dispatch: { source: "chat" }, workspace: { defaultRepo: "Builderforce.ai" } },
    policy: POLICY,
    ports,
  });
  return { outcome, events, edits, spawnTurn: log.spawnTurn, modelTurns, lastRequest };
}

/** The lines a read_file result actually served: `[first, last]` from its own `offset` and content. */
function servedRange(result: unknown): [number, number] | null {
  const r = result as { ok?: boolean; offset?: number; content?: string } | undefined;
  if (!r || r.ok === false || typeof r.content !== "string") return null;
  const first = r.offset ?? 1;
  return [first, first + r.content.split("\n").length - 1];
}

describe("the §8.4 reference scenario, replayed on the one agent", () => {
  it("finishes within 15 parent turns, spawns by turn 5 on the agent's own advisory (two reads a turn), and edits the PRD", async () => {
    const { outcome, edits, spawnTurn, modelTurns } = await replay();
    expect(outcome).toMatchObject({ kind: "finished", output: "PRD reviewed and updated." });
    expect(spawnTurn).toBeDefined();
    expect(spawnTurn!).toBeLessThanOrEqual(5);
    expect(modelTurns).toBeLessThanOrEqual(15);
    expect(edits).toEqual([PRD_PATH]);
  });

  it("holds the same budgets for a model that reads ONE window a turn: told on the fourth read, spawned by turn 5", async () => {
    const { outcome, edits, spawnTurn, modelTurns } = await replay(1);
    expect(outcome).toMatchObject({ kind: "finished", output: "PRD reviewed and updated." });
    expect(DEFAULT_READS_BEFORE_NUDGE).toBe(4);
    expect(spawnTurn).toBe(5);
    expect(modelTurns).toBeLessThanOrEqual(15);
    expect(edits).toEqual([PRD_PATH]);
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
