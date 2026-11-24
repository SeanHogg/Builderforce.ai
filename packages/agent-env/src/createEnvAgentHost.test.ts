/**
 * createEnvAgentHost — three declared agents (coordinator, developer, tester) driven by a scripted, role-routed model through the
 * ONE entry (`openRun`) against a fake environment port: edits, `env.run` for the tests, and a report. An out-of-allowlist call is
 * a typed refusal and a Shield event; a credential the run saw reaches no persisted or emitted record.
 */
import { describe, expect, it } from "vitest";
import type { ModelCompletion, ModelRequest, ModelTransport, RunEvent, RunState } from "@builderforce/agent-run";
import { createEnvAgentHost, HOST_EVENT, type EnvAgentDeclaration } from "./createEnvAgentHost.js";
import type { AgentHostEvent, EnvironmentToolPort, EnvToolResult } from "./envContract.js";
import { ENV_TOOL_MUTATES, type IdempotencyKey } from "./idempotentTools.js";

const SECRET = "sk-test-4f9aQ2bX7mN1pL8rT3vW6yZ0";
const CORRELATION = { environmentId: "env-1", runtimeId: "rt-1", correlationId: "corr-1" };

const AGENTS: EnvAgentDeclaration[] = [
  { id: "coordinator", role: "coordinator", tools: ["env.fs.read", "env.fs.list", "env.services.status"] },
  { id: "developer", role: "developer", tools: ["env.fs.read", "env.fs.write", "env.fs.list", "env.run"] },
  { id: "tester", role: "tester", tools: ["env.fs.read", "env.fs.list", "env.run", "env.preview.fetch", "env.services.status"] },
];

interface ShieldEvent { agentId: string; tool: string; reason: string }

/** The environment: project files, one service, `npm test`, and the port's allowlist and key checks with Shield reports. */
function fakeEnvironment() {
  const files = new Map<string, string>([[".env", `OPENAI_KEY_FOR_TESTS ${SECRET}`], ["src/sum.ts", "export const sum = (a: number, b: number) => a - b;\n"]]);
  const shield: ShieldEvent[] = [];
  const runs: Array<{ agentId: string; command: string; key?: IdempotencyKey }> = [];
  const portFor = (agent: EnvAgentDeclaration): EnvironmentToolPort => ({
    async call(tool, args, key): Promise<EnvToolResult> {
      const refuse = (reason: string, detail: string): EnvToolResult => {
        shield.push({ agentId: agent.id, tool, reason });
        return { ok: false, refusal: { code: "tool-not-allowed", tool, detail } };
      };
      if (!agent.tools.includes(tool)) return refuse("agent.tool_not_allowed", `"${tool}" is not on agent "${agent.id}"'s allowlist.`);
      if (ENV_TOOL_MUTATES[tool] && !key) return refuse("agent.tool_not_allowed", `"${tool}" needs an idempotency key.`);
      const a = args as Record<string, string | string[]>;
      switch (tool) {
        case "env.fs.read": return { ok: true, result: { path: a.path, found: files.has(String(a.path)), content: files.get(String(a.path)) } };
        case "env.fs.list": return { ok: true, result: { entries: [...files.keys()] } };
        case "env.fs.write": files.set(String(a.path), String(a.content)); return { ok: true, result: { path: a.path, written: true } };
        case "env.services.status": return { ok: true, result: [{ id: "web", state: "ready", port: 3000 }] };
        case "env.run": {
          runs.push({ agentId: agent.id, command: [a.command, ...((a.args as string[]) ?? [])].join(" "), ...(key ? { key } : {}) });
          const passing = files.get("src/sum.ts")?.includes("a + b");
          // The test runner echoes the environment it ran with, the credential included.
          return { ok: true, result: { exitCode: passing ? 0 : 1, output: `env: OPENAI_API_KEY=${SECRET}\n${passing ? "3 passed" : "1 failed"}\n`, truncated: false } };
        }
        default: return refuse("agent.tool_not_allowed", `"${tool}" is not an environment tool.`);
      }
    },
  });
  return { files, shield, runs, portFor };
}

const call = (id: string, name: string, args: Record<string, unknown>): ModelCompletion => ({ content: "", toolCalls: [{ id, name, arguments: JSON.stringify(args) }] });

/** Each agent's turns, picked by the task it was handed (the transport routes by role; it never names a model). */
const SCRIPTS: Record<string, ModelCompletion[]> = {
  coordinator: [
    call("c1", "env_services_status", {}),
    call("c2", "env_fs_list", { path: "src" }),
    { content: "Plan: the developer fixes src/sum.ts, the tester runs npm test and reports." },
  ],
  developer: [
    call("d1", "env_fs_read", { path: ".env" }),
    call("d2", "env_fs_write", { path: "src/sum.ts", content: "export const sum = (a: number, b: number) => a + b;\n" }),
    call("d3", "env_run", { command: "npm", args: ["test"] }),
    { content: "Fixed src/sum.ts; npm test passes." },
  ],
  tester: [
    call("t1", "env_run", { command: "npm", args: ["test"] }),
    call("t2", "env_fs_write", { path: "src/sum.ts", content: "tampered" }),
    { content: "Report: npm test — 3 passed. Writing is outside my allowlist." },
  ],
};

function scriptedModel() {
  const requests: Array<{ agent: string; request: ModelRequest }> = [];
  const turns = new Map<string, number>();
  const model: ModelTransport = {
    async complete(request) {
      const text = JSON.stringify(request.messages);
      const agent = Object.keys(SCRIPTS).find((id) => text.includes(`[task:${id}]`));
      if (!agent) throw new Error("The scripted model was asked by no known agent.");
      requests.push({ agent, request });
      const n = turns.get(agent) ?? 0;
      turns.set(agent, n + 1);
      return SCRIPTS[agent]![n] ?? { content: "Done." };
    },
  };
  return { model, requests };
}

function setup() {
  const env = fakeEnvironment();
  const { model, requests } = scriptedModel();
  const persisted: string[] = [];
  const emitted: RunEvent[] = [];
  let runs = 0;
  const host = createEnvAgentHost({
    agents: AGENTS,
    model,
    environment: (agent) => env.portFor(agent),
    store: () => {
      let saved: RunState | undefined;
      return {
        load: () => saved,
        save: (state) => { saved = state; persisted.push(JSON.stringify(state)); },
        appended: (row) => void persisted.push(JSON.stringify(row)),
      };
    },
    human: { ask: async () => ({ kind: "paused" }) },
    context: { pack: () => ({ focus: [], facts: [], recall: [] }) },
    events: { emit: (event) => void emitted.push(event), outcome: (row) => void persisted.push(JSON.stringify(row)) },
    newRunId: () => `run-${++runs}`,
  });
  return { host, env, requests, persisted, emitted };
}

async function collect(stream: AsyncIterable<AgentHostEvent>): Promise<AgentHostEvent[]> {
  const out: AgentHostEvent[] = [];
  for await (const event of stream) out.push(event);
  return out;
}

async function runAgent(host: ReturnType<typeof setup>["host"], agentId: string, task: string) {
  const { runId } = await host.start(agentId, { task: `[task:${agentId}] ${task}`, correlation: CORRELATION });
  const [outcome, stream] = await Promise.all([host.settled(runId), collect(host.events(runId))]);
  return { runId, outcome, stream };
}

describe("createEnvAgentHost", () => {
  it("drives coordinator, developer and tester through plan, edit, env.run and report", async () => {
    const { host, env, requests, emitted } = setup();

    const coordinator = await runAgent(host, "coordinator", "Plan the fix for the failing sum test.");
    expect(coordinator.outcome).toMatchObject({ kind: "finished", output: expect.stringContaining("Plan:") });

    const developer = await runAgent(host, "developer", "Fix src/sum.ts so the tests pass.");
    expect(developer.outcome).toMatchObject({ kind: "finished" });
    expect(env.files.get("src/sum.ts")).toContain("a + b");

    const tester = await runAgent(host, "tester", "Run the tests and report.");
    expect(tester.outcome).toMatchObject({ kind: "finished", output: expect.stringContaining("3 passed") });

    // env.run carried its idempotency key: (run id, step, tool-call id).
    expect(env.runs).toEqual([
      { agentId: "developer", command: "npm test", key: { runId: developer.runId, step: expect.any(Number), toolCallId: "d3" } },
      { agentId: "tester", command: "npm test", key: { runId: tester.runId, step: expect.any(Number), toolCallId: "t1" } },
    ]);
    // Each agent asked by its role as policy data; no model id was ever named.
    for (const { request } of requests) expect(request.model).toBeUndefined();
    // Each agent saw only its allowlisted env tools.
    const offered = (agent: string) => new Set(requests.filter((r) => r.agent === agent).flatMap((r) => (r.request.tools ?? []).map((t) => t.function.name)).filter((n) => n.startsWith("env_")));
    expect([...offered("coordinator")].sort()).toEqual(["env_fs_list", "env_fs_read", "env_services_status"]);
    expect(offered("tester").has("env_fs_write")).toBe(false);

    // Every event is stamped with the environment's correlation and its agent.
    expect(emitted.length).toBeGreaterThan(0);
    for (const event of emitted) expect(event).toMatchObject({ ...CORRELATION, agentId: expect.stringMatching(/^(coordinator|developer|tester)$/) });
    for (const event of tester.stream) expect(event.correlation).toEqual({ ...CORRELATION, agentId: "tester" });
    expect(tester.stream.at(-1)).toMatchObject({ type: HOST_EVENT.settled, payload: { kind: "finished" } });
  });

  it("refuses an out-of-allowlist tool with a typed refusal and a Shield event", async () => {
    const { host, env, emitted } = setup();
    const tester = await runAgent(host, "tester", "Run the tests and report.");
    expect(tester.outcome.kind).toBe("finished");
    expect(env.shield).toEqual([{ agentId: "tester", tool: "env.fs.write", reason: "agent.tool_not_allowed" }]);
    expect(env.files.get("src/sum.ts")).not.toBe("tampered");
    const dispatched = emitted.filter((e): e is Extract<RunEvent, { kind: "tool.dispatched" }> => e.kind === "tool.dispatched" && e.tool === "env_fs_write");
    expect(dispatched.map((e) => e.ok)).toEqual([false]);
    // The model read the typed refusal back.
    const row = JSON.stringify(tester.outcome.state.messages);
    expect(row).toContain("tool-not-allowed");
  });

  it("writes and sends no record holding the credential the run saw", async () => {
    const { host, persisted, emitted } = setup();
    const developer = await runAgent(host, "developer", "Fix src/sum.ts so the tests pass.");
    const tester = await runAgent(host, "tester", "Run the tests and report.");
    expect(persisted.length).toBeGreaterThan(0);
    for (const record of persisted) expect(record).not.toContain(SECRET);
    expect(JSON.stringify(emitted)).not.toContain(SECRET);
    expect(JSON.stringify([...developer.stream, ...tester.stream])).not.toContain(SECRET);
  });

  it("refuses an undeclared agent and a declaration naming a model instead of a role", async () => {
    const { host } = setup();
    await expect(host.start("reviewer", { task: "x", correlation: CORRELATION })).rejects.toThrow(/No agent "reviewer"/);
    expect(() => createEnvAgentHost({ ...baseDeps(), agents: [{ id: "dev", role: "gpt-4o.mini", tools: [] }] })).toThrow(/declared by role, never by model/);
  });
});

function baseDeps() {
  const { model } = scriptedModel();
  return {
    model,
    environment: () => fakeEnvironment().portFor(AGENTS[0]!),
    store: () => ({ load: () => undefined, save: () => undefined }),
    human: { ask: async () => ({ kind: "paused" as const }) },
    context: { pack: () => ({ focus: [], facts: [], recall: [] }) },
  };
}
