import { classifyTool, isMutatingTool, normalizeAction, toolSideEffect } from "@builderforce/agent-tools";

/**
 * Mutation heuristics for the ON-PREM catalog (write/edit/exec/message/...), used for
 * action fingerprints. Names the shared catalog classifies
 * (`@builderforce/agent-tools` `TOOL_SIDE_EFFECT`) are answered by it; everything else
 * FAILS CLOSED (mutating) unless it is one of the explicit read-only names or a
 * read-only `action` below.
 */


const PROCESS_MUTATING_ACTIONS = new Set(["write", "send_keys", "submit", "paste", "kill"]);

const MESSAGE_MUTATING_ACTIONS = new Set([
  "send",
  "reply",
  "thread_reply",
  "threadreply",
  "edit",
  "delete",
  "react",
  "pin",
  "unpin",
]);

export type ToolMutationState = {
  mutatingAction: boolean;
  actionFingerprint?: string;
};

export type ToolActionRef = {
  toolName: string;
  meta?: string;
  actionFingerprint?: string;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

const normalizeActionName = normalizeAction;

function normalizeFingerprintValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized ? normalized.toLowerCase() : undefined;
  }
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") {
    return String(value).toLowerCase();
  }
  return undefined;
}

export function isLikelyMutatingToolName(toolName: string): boolean {
  const normalized = toolName.trim().toLowerCase();
  const shared = toolSideEffect(normalized);
  if (shared) {
    return shared === "mutate";
  }
  // Name only (no args): anything not explicitly read-only is treated as mutating.
  return isMutatingTool(normalized);
}

export function isMutatingToolCall(toolName: string, args: unknown): boolean {
  const normalized = toolName.trim().toLowerCase();
  const record = asRecord(args);
  const action = normalizeActionName(record?.action);
  const shared = toolSideEffect(normalized);
  if (shared) {
    return shared === "mutate";
  }

  switch (normalized) {
    case "write":
    case "edit":
    case "apply_patch":
    case "exec":
    case "bash":
    case "sessions_send":
      return true;
    case "process":
      return action != null && PROCESS_MUTATING_ACTIONS.has(action);
    case "message":
      return (
        (action != null && MESSAGE_MUTATING_ACTIONS.has(action)) ||
        typeof record?.content === "string" ||
        typeof record?.message === "string"
      );
    case "session_status":
      return typeof record?.model === "string" && record.model.trim().length > 0;
    default: {
      if (normalized === "cron" || normalized === "gateway" || normalized === "canvas") {
        return classifyTool(normalized, undefined, record) !== "read";
      }
      if (normalized === "nodes") {
        return action == null || action !== "list";
      }
      if (normalized.endsWith("_actions")) {
        return classifyTool(normalized, undefined, record) !== "read";
      }
      if (normalized.startsWith("message_") || normalized.includes("send")) {
        return true;
      }
      // Unknown to the shared catalog: the ONE classifier decides (host read-only names, a read-only `action`), else fail closed.
      return classifyTool(normalized, undefined, record) !== "read";
    }
  }
}

export function buildToolActionFingerprint(
  toolName: string,
  args: unknown,
  meta?: string,
): string | undefined {
  if (!isMutatingToolCall(toolName, args)) {
    return undefined;
  }
  const normalizedTool = toolName.trim().toLowerCase();
  const record = asRecord(args);
  const action = normalizeActionName(record?.action);
  const parts = [`tool=${normalizedTool}`];
  if (action) {
    parts.push(`action=${action}`);
  }
  for (const key of [
    "path",
    "filePath",
    "oldPath",
    "newPath",
    "to",
    "target",
    "messageId",
    "sessionKey",
    "jobId",
    "id",
    "model",
  ]) {
    const value = normalizeFingerprintValue(record?.[key]);
    if (value) {
      parts.push(`${key.toLowerCase()}=${value}`);
    }
  }
  const normalizedMeta = meta?.trim().replace(/\s+/g, " ").toLowerCase();
  if (normalizedMeta) {
    parts.push(`meta=${normalizedMeta}`);
  }
  return parts.join("|");
}

export function buildToolMutationState(
  toolName: string,
  args: unknown,
  meta?: string,
): ToolMutationState {
  const actionFingerprint = buildToolActionFingerprint(toolName, args, meta);
  return {
    mutatingAction: actionFingerprint != null,
    actionFingerprint,
  };
}

export function isSameToolMutationAction(existing: ToolActionRef, next: ToolActionRef): boolean {
  if (existing.actionFingerprint != null || next.actionFingerprint != null) {
    // For mutating flows, fail closed: only clear when both fingerprints exist and match.
    return (
      existing.actionFingerprint != null &&
      next.actionFingerprint != null &&
      existing.actionFingerprint === next.actionFingerprint
    );
  }
  return existing.toolName === next.toolName && (existing.meta ?? "") === (next.meta ?? "");
}
