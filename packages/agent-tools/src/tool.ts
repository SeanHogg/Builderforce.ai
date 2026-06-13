/**
 * The unified tool contract. ONE shape, defined once, runnable on every surface.
 *
 * A {@link ToolDefinition} pairs an OpenAI-compatible function schema (what the
 * model sees) with a `requires` capability list (what surface can run it) and a
 * pure-ish `execute` that reaches the runtime ONLY through the injected
 * {@link ToolContext} — never through a Worker `Env`, `node:fs`, or a closure over
 * one runtime. That indirection is what lets the SAME definition run in the cloud
 * Worker, the cloud Container, and on-prem Node (Dependency Inversion: the tool
 * depends on the capability abstraction, the surface supplies the concretion).
 */

import type { Capability, CapabilityProvider } from "./capabilities.js";

/** An OpenAI-compatible function-tool schema (the wire format every provider in the
 *  gateway pool accepts). Kept structural rather than importing a vendor type so the
 *  shared package stays dependency-free. */
export interface ToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties?: Record<string, unknown>;
      required?: string[];
    };
  };
}

/** What a tool handler receives. The capability provider is the surface; `signal`
 *  lets a tool cooperate with run cancellation; `emit` records a timeline event. */
export interface ToolContext {
  readonly caps: CapabilityProvider;
  readonly signal?: AbortSignal;
  /** Absolute path of the working tree, when the surface has one on a real
   *  filesystem (on-prem Node, the cloud Container). Runtime-agnostic tools never
   *  read this — they go through {@link CapabilityProvider}. It exists for
   *  surface-NATIVE tool definitions (e.g. the Node code-intelligence tools that
   *  shell out to `git`/`rg` against the checked-out repo) that are registered only
   *  on a filesystem-backed surface and would otherwise have no path to operate on. */
  readonly workspaceRoot?: string;
  /** Optional structured logging/telemetry sink (a no-op when unset). */
  readonly emit?: (event: { level?: "debug" | "info" | "warn"; message: string; detail?: unknown }) => void;
}

/**
 * A tool's return. `data` is JSON-serialized as the tool message the model reads.
 * `control` lets a tool ask the ENGINE to do something orchestration-level that a
 * tool must not do itself (end the run, pause for a human) — keeping loop policy
 * (finish gates, pause/park) in the engine while the tool stays a thin adapter.
 */
export interface ToolResult {
  /** The payload serialized back to the model. */
  data: Record<string, unknown>;
  /** Optional control signal for the engine to interpret after this call. */
  control?: ToolControl;
}

export type ToolControl =
  | { kind: "finish"; summary: string }
  | { kind: "ask_human"; approvalId?: string; question: string };

/**
 * One tool: schema + capability requirements + handler. `args` is the parsed JSON
 * arguments from the model's tool call (validated against the schema by the loop).
 */
export interface ToolDefinition {
  readonly name: string;
  readonly schema: ToolSchema;
  /** Capabilities the surface MUST advertise for this tool to be offered. Empty =
   *  always available (e.g. `finish`). */
  readonly requires: readonly Capability[];
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

/** Small helper to build a {@link ToolDefinition} with the schema name kept in sync
 *  with `name` (one source of truth). */
export function defineTool(def: {
  name: string;
  description: string;
  parameters: ToolSchema["function"]["parameters"];
  requires?: readonly Capability[];
  execute: ToolDefinition["execute"];
}): ToolDefinition {
  return {
    name: def.name,
    requires: def.requires ?? [],
    schema: {
      type: "function",
      function: { name: def.name, description: def.description, parameters: def.parameters },
    },
    execute: def.execute,
  };
}
