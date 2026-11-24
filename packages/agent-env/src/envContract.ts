/**
 * The webcontainers W12 contract, structurally (`@seanhogg/builderforce-webcontainers-core` `agents/contract.ts` and the browser's
 * `createEnvironmentToolPort`). This package is source-only and declares no install, so it mirrors the shapes rather than import the
 * built runtime; the idempotency key and the `env.*` mutation table are `idempotentTools.ts`'s, the ONE copy here.
 */
import { ENV_TOOL_MUTATES, type IdempotencyKey } from "./idempotentTools.js";

/** The environment tools an agent may be allowed, in the core contract's order. */
export const ENV_TOOL_KEYS = Object.keys(ENV_TOOL_MUTATES) as readonly string[];

/** A typed refusal of an environment tool call. Mirrors core `EnvToolRefusal`. */
export interface EnvToolRefusal {
  code: "tool-not-allowed" | "shield-denied" | "timeout";
  tool: string;
  detail: string;
}

export type EnvToolResult = { ok: true; result: unknown } | { ok: false; refusal: EnvToolRefusal };

/**
 * The browser runtime's `env.*` chokepoint, bound to one agent (its allowlist, the environment's own services, the Security
 * Shield). Mirrors the browser's `EnvironmentToolPort`: it refuses, typed, and reports the refusal itself.
 */
export interface EnvironmentToolPort {
  call(tool: string, args: unknown, key?: IdempotencyKey): Promise<EnvToolResult>;
}

/** Ties an event or record to its environment, runtime and agent. Mirrors core `EnvCorrelation`. */
export interface EnvCorrelation {
  environmentId: string;
  runtimeId: string;
  agentId?: string;
  correlationId?: string;
}

/** One event of an agent run as the runtime observes it. Mirrors core `AgentHostEvent`. */
export interface AgentHostEvent {
  readonly type: string;
  readonly correlation: EnvCorrelation;
  readonly payload: unknown;
  readonly ts: number;
}

/** What the runtime asks of the host that runs agents. Mirrors core `AgentHostPort`. */
export interface AgentHostPort {
  start(agentId: string, input: { task: string; correlation: EnvCorrelation }): Promise<{ runId: string }>;
  steer(runId: string, message: string): Promise<void>;
  cancel(runId: string): Promise<void>;
  events(runId: string): AsyncIterable<AgentHostEvent>;
}
