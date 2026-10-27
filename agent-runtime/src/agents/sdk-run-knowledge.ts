/**
 * sdk-run-knowledge — feeds a Claude Agent SDK (BuilderForce-V2) run's tool calls into
 * the SHARED run record (`RunKnowledgeLog`, `@builderforce/agent-tools`), the same one
 * the native loop and the knowledge loop (`infra/knowledge-loop.ts`) keep, so a V2 run
 * leaves a code map like every other runtime.
 *
 * The SDK reports a call (`tool_use`) and, a turn later, its outcome (`tool_result`).
 * A call is recorded only once its outcome is in and it did NOT error: a map claiming a
 * file was written when the write threw grounds every later run on a lie. The SDK's tool
 * names are PascalCase (`Read`, `Write`, `Edit`, `Grep`, `Glob`); the record's tool
 * vocabulary is lower-case, so names are lower-cased on the way in.
 */
import type { RunKnowledgeLog } from "@builderforce/agent-tools";

export interface SdkKnowledgeFeed {
  /** A call the model made; held until its outcome arrives. */
  toolUse(toolName: string, toolUseId: string, args: unknown): void;
  /** That call's outcome: recorded when it succeeded, dropped when it errored. */
  toolResult(toolUseId: string, isError: boolean): void;
}

/** The SDK's tool name in the shared record's vocabulary (`Read` → `read`). */
export function sdkToolName(name: string): string {
  return name.trim().toLowerCase();
}

export function sdkKnowledgeFeed(log: RunKnowledgeLog): SdkKnowledgeFeed {
  const pending = new Map<string, { name: string; args: unknown }>();
  return {
    toolUse(toolName, toolUseId, args) {
      if (toolUseId) pending.set(toolUseId, { name: sdkToolName(toolName), args });
    },
    toolResult(toolUseId, isError) {
      const call = pending.get(toolUseId);
      if (!call) return;
      pending.delete(toolUseId);
      if (!isError) log.record(call.name, call.args);
    },
  };
}
