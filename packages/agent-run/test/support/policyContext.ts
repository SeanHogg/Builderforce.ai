/**
 * A `PolicyContext` for unit tests of one policy function: a fresh run's state, a chat
 * policy, empty ports. Each field can be overridden; tool names become schemas.
 */
import type { ToolSchema } from "@builderforce/agent-tools";
import type { RunMessage, RunPolicy, RunPorts, RunTask } from "../../src/contract.js";
import type { PolicyContext } from "../../src/policy/hooks.js";
import { freshState } from "../../src/runState.js";

export const TEST_POLICY: RunPolicy = {
  entryPoint: "vscode",
  toolScope: "chat-work",
  role: "general",
  levers: [],
  budgets: {},
  inference: "hybrid",
  verify: "none",
  approvalGates: [],
  delegation: { requested: false, readsBeforeNudge: 6 },
};

export const TEST_TASK: RunTask = { prompt: "Fix the handler", dispatch: { source: "chat" } };

export function schemas(names: readonly string[]): ToolSchema[] {
  return names.map((name) => ({ type: "function" as const, function: { name, description: "", parameters: { type: "object" as const } } }));
}

export function policyCtx(over: {
  policy?: Partial<RunPolicy>;
  task?: RunTask;
  messages?: RunMessage[];
  tools?: readonly string[];
  ports?: Partial<RunPorts>;
} = {}): PolicyContext {
  const policy = { ...TEST_POLICY, ...over.policy };
  const task = over.task ?? TEST_TASK;
  return {
    task,
    policy,
    state: freshState(policy, task),
    ports: { ...(over.ports ?? {}) } as RunPorts,
    step: 1,
    turn: 1,
    messages: over.messages ?? [],
    tools: schemas(over.tools ?? []),
  };
}
