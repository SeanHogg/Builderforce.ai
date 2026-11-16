/**
 * `a2a-serve` — expose THIS BuilderForce agent as an A2A endpoint, so other
 * agents (Claude Code, LangGraph, Google ADK, …) can send it messages and read
 * its replies over HTTP.
 *
 * One surface is registered: an HTTP `/a2a` endpoint (via the plugin
 * HTTP-route seam) that accepts a POSTed A2A envelope
 * `{ message: { parts:[{text}] } }` and either returns a one-shot JSON reply
 * or streams Server-Sent Events — matching the client in
 * `packages/agent-tools/src/a2a.ts`. (The old stdio bridge to the `claude` CLI
 * was removed; talking to Claude Code is the `a2a-send` tool's job.)
 */
import { createA2AHttpHandler } from "@builderforce/agent-tools/a2a.js";
import type { A2ARequest } from "@builderforce/agent-tools/a2a.js";
import type { BuilderForceAgentsPluginApi } from "@seanhogg/builderforce-agents/plugin-sdk";
import { getA2aRuntime } from "./runtime.js";

type RunEmbeddedAgentFn = (params: Record<string, unknown>) => Promise<{ payloads?: Array<{ text?: string }> }>;

/** The runner's contract (`RunEmbeddedAgentParams`) requires a stable `runId` and a `timeoutMs`. */
const RUN_TIMEOUT_MS = 120_000;

/**
 * Test-only override for the embedded runner, which `loadRunEmbeddedAgent`
 * resolves via a dynamic import that `vi.mock` cannot intercept. Production
 * code never sets this; it exists so the handler's contract with the runner
 * (`runId`/`timeoutMs`) can be asserted without a real build.
 */
let testRunnerOverride: RunEmbeddedAgentFn | null = null;

export function __setA2aTestRunner(fn: RunEmbeddedAgentFn | null): void {
  testRunnerOverride = fn;
}

async function loadRunEmbeddedAgent(): Promise<RunEmbeddedAgentFn> {
  if (testRunnerOverride) {
    return testRunnerOverride;
  }
  const candidates = [
    "../../../src/agents/embedded-runner.js",
    "../../../../dist/agents/embedded-runner.js",
  ];
  for (const candidate of candidates) {
    try {
      const mod = (await import(candidate)) as Record<string, unknown>;
      const fn = mod.runEmbeddedAgent;
      if (typeof fn === "function") {
        return fn as RunEmbeddedAgentFn;
      }
    } catch {
      // try next candidate
    }
  }
  throw new Error("a2a-serve: embedded agent runner is not available in this build");
}

function partsToText(req: A2ARequest): string {
  return req.message.parts
    .map((p) => (typeof p.text === "string" ? p.text : ""))
    .join("\n")
    .trim();
}

async function runLocalAgent(prompt: string, sessionId?: string): Promise<string> {
  const api = getA2aRuntime();
  const runEmbeddedAgent = await loadRunEmbeddedAgent();
  const result = await runEmbeddedAgent({
    sessionId: sessionId ?? `a2a-${Date.now()}`,
    sessionFile: api.resolvePath(`a2a/${sessionId ?? Date.now()}.json`),
    workspaceDir: api.config?.agents?.defaults?.workspace ?? process.cwd(),
    config: api.config,
    prompt,
    disableMessageTool: true,
    // The runner's contract requires these (RunEmbeddedAgentParams); without
    // them the A2A serve path would not type-check / would hang unbounded.
    runId: `a2a-${Date.now().toString(36)}`,
    timeoutMs: RUN_TIMEOUT_MS,
  });
  const text = (result.payloads ?? [])
    .map((p) => (typeof p.text === "string" ? p.text : ""))
    .filter((t) => t.length > 0)
    .join("\n")
    .trim();
  if (!text) {
    throw new Error("a2a-serve: the local agent produced an empty reply");
  }
  return text;
}

/**
 * Build the A2A handler that backs both the HTTP endpoint and the stdio
 * bridge. Shared so the two surfaces behave identically.
 */
export function buildA2AHandler() {
  return async (req: A2ARequest) => {
    const text = partsToText(req);
    if (!text) {
      return {
        kind: "reply" as const,
        status: "error",
        message: {
          role: "agent" as const,
          parts: [{ type: "text" as const, text: "a2a: empty message body" }],
        },
      };
    }
    const replyText = await runLocalAgent(text, req.sessionId);
    return {
      kind: "reply" as const,
      message: {
        role: "agent" as const,
        parts: [{ type: "text" as const, text: replyText }],
      },
      sessionId: req.sessionId,
    };
  };
}

/**
 * Serve the A2A endpoint on the plugin's HTTP surface. Returns a disposer.
 */
export function serveA2AHttp(api: BuilderForceAgentsPluginApi): () => void {
  const handler = createA2AHttpHandler(buildA2AHandler(), { path: "/a2a" });
  let disposed = false;
  // "gateway": no auth of its own; A2A callers authenticate by sending the
  // gateway token as a Bearer token (packages/agent-tools/src/a2a.ts supports `token`).
  api.registerHttpHandler(
    async (req, res) => {
      if (disposed) return false;
      return handler(req as never, res as never);
    },
    { auth: "gateway" },
  );
  return () => {
    disposed = true;
  };
}
