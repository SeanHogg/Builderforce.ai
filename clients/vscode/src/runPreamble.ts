/**
 * What every editor run's system prompt opens with, ahead of the host prompt — ONE
 * composition both chat surfaces use (the panel's host-owned run and the native chat
 * participant), so the two cannot drift on what binds a run or in what order:
 *
 *   1. the tenant's governance gates (binding; the same rows the tool seam enforces), then
 *   2. the workspace's committed rules (`.builderforce/rules.md`), then
 *   3. the host prompt itself.
 */

import { renderPolicyDirectives, type PolicyGate } from "./policy";

/** Rules beyond this are cut: a rules file is guidance, not a second codebase map. */
const RULES_MAX = 16_000;

/** The workspace rules, rendered as a system-prompt section ('' when there are none). */
export function renderWorkspaceRules(rules: string): string {
  const body = rules.trim();
  if (!body) return "";
  const clipped = body.length <= RULES_MAX ? body : `${body.slice(0, RULES_MAX)}\n…(rules truncated)`;
  return `Workspace rules (from .builderforce/rules.md, committed with this repository — follow them on every task here):\n${clipped}`;
}

export function withRunPreamble(
  systemPrompt: string,
  preamble: { gates?: readonly PolicyGate[]; rules?: string },
): string {
  return [renderPolicyDirectives(preamble.gates), renderWorkspaceRules(preamble.rules ?? ""), systemPrompt]
    .filter(Boolean)
    .join("\n\n");
}
