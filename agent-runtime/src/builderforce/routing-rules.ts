/**
 * Hybrid local/cloud routing rules for the multi-agent orchestrator (P3-2).
 *
 * RoutingRule lets operators declaratively describe which tasks should run
 * on a local model (ollama, llama), be forwarded to a remote agentNode, or be
 * sent to a cloud provider.
 *
 * Rules are evaluated in descending priority order; the first matching rule
 * wins. If no rule matches, the default cloud/anthropic target is used.
 */

import type { Task } from "./orchestrator.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type RoutingCondition =
  | { type: "role"; matches: string | RegExp }
  | { type: "inputLength"; gt?: number; lt?: number }
  | { type: "capability"; requires: string[] }
  | { type: "always" };

export type RoutingTarget =
  | { type: "local"; provider: "ollama" | "llama"; model?: string }
  | { type: "cloud"; provider: "anthropic" | "openai" | "openrouter"; model?: string }
  | { type: "remote"; agentNodeId?: string; capabilities?: string[] };

export interface RoutingRule {
  condition: RoutingCondition;
  target: RoutingTarget;
  /** Higher priority rules are evaluated first. Default: 0. */
  priority: number;
}

// ── Default rules ─────────────────────────────────────────────────────────────

/**
 * Sensible default routing rules:
 * - Long inputs (>8000 chars) → cloud (Anthropic) — better long-context handling
 * - Role containing "local" → local Ollama
 * - Catch-all → cloud Anthropic
 */
export const DEFAULT_ROUTING_RULES: RoutingRule[] = [
  {
    priority: 100,
    condition: { type: "inputLength", gt: 8000 },
    target: { type: "cloud", provider: "anthropic" },
  },
  {
    priority: 50,
    condition: { type: "role", matches: /local/i },
    target: { type: "local", provider: "ollama" },
  },
  {
    priority: 0,
    condition: { type: "always" },
    target: { type: "cloud", provider: "anthropic" },
  },
];

// ── Condition evaluators ──────────────────────────────────────────────────────

function evaluateCondition(condition: RoutingCondition, task: Task): boolean {
  switch (condition.type) {
    case "always":
      return true;

    case "role": {
      const { matches } = condition;
      if (typeof matches === "string") {
        return task.agentRole === matches;
      }
      return matches.test(task.agentRole);
    }

    case "inputLength": {
      const len = task.input.length;
      if (condition.gt !== undefined && len <= condition.gt) {
        return false;
      }
      if (condition.lt !== undefined && len >= condition.lt) {
        return false;
      }
      return true;
    }

    case "capability":
      // Capability matching is resolved at dispatch time by the fleet API.
      // At rule-evaluation time we only check if the task role signals capability requirements.
      // If the task role explicitly uses "remote:auto[cap1,cap2]" we defer to remote dispatch logic.
      return condition.requires.length === 0;

    default:
      return false;
  }
}

// ── Main resolver ─────────────────────────────────────────────────────────────

const DEFAULT_TARGET: RoutingTarget = { type: "cloud", provider: "anthropic" };

/**
 * Evaluate the list of routing rules against a task and return the first
 * matching target, sorted by descending priority.
 * Falls back to `{ type: "cloud", provider: "anthropic" }` when no rule matches.
 */
export function resolveRouting(task: Task, rules: RoutingRule[]): RoutingTarget {
  // Sort descending by priority (stable sort preserves declaration order for ties)
  const sorted = [...rules].toSorted((a, b) => b.priority - a.priority);

  for (const rule of sorted) {
    if (evaluateCondition(rule.condition, task)) {
      return rule.target;
    }
  }

  return DEFAULT_TARGET;
}

// ── JSON deserialization ──────────────────────────────────────────────────────

/**
 * Parse a RoutingRule JSON array read from `.builderforce/routing-rules.json`.
 * String patterns in `condition.matches` are compiled to RegExp when they
 * start and end with `/` (e.g. `"/local/i"`).
 */
export function parseRoutingRules(raw: unknown): RoutingRule[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const result: RoutingRule[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const r = item as Record<string, unknown>;
    const condition = r["condition"] as Record<string, unknown> | undefined;
    const target = r["target"] as Record<string, unknown> | undefined;
    if (!condition || !target) {
      continue;
    }

    // Compile RegExp patterns from JSON string notation "/pattern/flags"
    if (condition["type"] === "role" && typeof condition["matches"] === "string") {
      const matchesStr = condition["matches"];
      const m = /^\/(.+)\/([gimsuy]*)$/.exec(matchesStr);
      if (m) {
        try {
          const flags = m[2] !== "" ? m[2] : undefined;
          condition["matches"] = new RegExp(m[1], flags);
        } catch {
          // invalid regex — keep as string
        }
      }
    }

    result.push({
      condition: condition as unknown as RoutingCondition,
      target: target as unknown as RoutingTarget,
      priority: typeof r["priority"] === "number" ? r["priority"] : 0,
    });
  }
  return result;
}
