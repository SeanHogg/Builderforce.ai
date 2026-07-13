/**
 * Governance gates in the IDE — the VS Code mirror of the compile primitive's policy
 * modality (`packages/agent-tools/src/spec.ts`). The extension cannot import the
 * shared package (it bundles for the VS Code Node host, not the Worker/web target),
 * so this is a deliberately tiny, self-contained copy of the gate shape + the two
 * pure decisions the engine needs. Kept in lock-step with the shared
 * `PolicyGate`/`evaluatePolicyGate`/`renderPolicyDirectives` by contract.
 *
 * Because the gate is enforced HERE (at the IDE loop's tool seam) exactly as the
 * cloud loop enforces it, "a governance gate applies in the IDE exactly as in the
 * cloud" is literally true — the same compiled gate, the same block/approve decision.
 */

export interface PolicyGate {
  id: string;
  /** Tool this gate governs; omit (or "*") to govern every tool call. */
  tool?: string;
  effect: "inject-directive" | "require-approval" | "block";
  directive?: string;
  reason?: string;
}

export type PolicyDecision =
  | { action: "allow" }
  | { action: "require-approval"; gateId: string; reason: string }
  | { action: "block"; gateId: string; reason: string };

/** Decide what the engine must do for a pending tool call (block > approval > allow). */
export function evaluatePolicyGate(gates: readonly PolicyGate[] | undefined, toolName: string): PolicyDecision {
  const matches = (gates ?? []).filter((g) => !g.tool || g.tool === "*" || g.tool === toolName);
  const blocked = matches.find((g) => g.effect === "block");
  if (blocked) return { action: "block", gateId: blocked.id, reason: blocked.reason ?? "blocked by policy" };
  const approval = matches.find((g) => g.effect === "require-approval");
  if (approval) return { action: "require-approval", gateId: approval.id, reason: approval.reason ?? "approval required by policy" };
  return { action: "allow" };
}

/** Render gates as binding system-prompt lines (mirrors `renderPolicyDirectives`). */
export function renderPolicyDirectives(gates: readonly PolicyGate[] | undefined): string {
  const lines = (gates ?? [])
    .map((g) => {
      const scope = !g.tool || g.tool === "*" ? "any tool" : `the \`${g.tool}\` tool`;
      if (g.effect === "inject-directive") return (g.directive ?? "").trim();
      if (g.effect === "require-approval") return `Before using ${scope}, pause and request explicit human approval${g.reason ? ` (${g.reason})` : ""}.`;
      return `Never use ${scope}${g.reason ? ` — ${g.reason}` : ""}. Refuse and explain instead.`;
    })
    .filter(Boolean);
  if (lines.length === 0) return "";
  return ["Governance (these gates are binding):", ...lines.map((g) => `- ${g}`)].join("\n");
}
