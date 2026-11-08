/**
 * Lowering for clients that predate `PolicyGate.sideEffect`.
 *
 * A client that drops `sideEffect` reads a tool-less class gate as "every tool" — a
 * `{ sideEffect: "mutate", effect: "block" }` gate would block reads too. So the server sends
 * the COMPACT form only to a client that says it understands it; every other client gets the
 * same policy spelled out per tool from the ONE classification table. This is the one place
 * that lowering lives, and {@link gatesForWireLevel} is the one place a route decides.
 *
 * Limits of the expanded form, by construction: it names the catalog's tools, so a tool
 * added to the catalog after the gate was served, or a host-only tool, is not covered until
 * the next fetch (the compact form fails closed for those; this one cannot). It never names
 * the run-control tools, exactly as the compact form never touches them.
 */

import { normalizeToolName } from "./toolAliases.js";
import { classScopedDirective, classifyTool, CONTROL_TOOL_NAMES, HOST_MUTATING_TOOLS, HOST_READ_ONLY_TOOLS, TOOL_SIDE_EFFECT, type ToolSideEffect } from "./tool-side-effect.js";
import { coercePolicyGates, type PolicyGate } from "./spec.js";

/** The wire level that understands `sideEffect` gates; a client declares it (`?gates=2`). */
export const SIDE_EFFECT_GATES_WIRE_LEVEL = 2;

/** True when the client declared (query/header value) a wire level that reads compact class gates. */
export function understandsSideEffectGates(declaredLevel: string | number | null | undefined): boolean {
  const level = typeof declaredLevel === "number" ? declaredLevel : Number.parseInt(String(declaredLevel ?? ""), 10);
  return Number.isFinite(level) && level >= SIDE_EFFECT_GATES_WIRE_LEVEL;
}

const CONTROL: ReadonlySet<string> = new Set(CONTROL_TOOL_NAMES);

/** Tools of one class an old host could name, minus the run-control tools: the catalog plus the on-prem names (`read`, `exec`, …). */
function toolsOf(effect: ToolSideEffect): string[] {
  const catalog = Object.entries(TOOL_SIDE_EFFECT)
    .filter(([name, e]) => e === effect && !CONTROL.has(name))
    .map(([name]) => name);
  if (effect === "read") return [...catalog, ...HOST_READ_ONLY_TOOLS];
  if (effect === "mutate") return [...catalog, ...HOST_MUTATING_TOOLS];
  return catalog;
}

/**
 * Expand each `sideEffect` gate into explicit per-tool gates (same effect, paths, reason and
 * directive; id `<id>:<tool>`, and `baseGateId` = the authored gate's id, which is what a decision, an
 * approval key and the UI name). An `inject-directive` gate names no tool, so it keeps its text once,
 * unscoped, with its class written into the text. A gate that NAMES a tool keeps that tool when the
 * tool's class (the one classification) is the gate's class, and lowers to nothing otherwise, exactly
 * as the compact form would not match it. Gates without `sideEffect` pass through untouched.
 */
export function lowerSideEffectGates(gates: readonly PolicyGate[]): PolicyGate[] {
  const out: PolicyGate[] = [];
  for (const gate of gates) {
    const { sideEffect, ...rest } = gate;
    if (!sideEffect) {
      out.push(gate);
      continue;
    }
    if (gate.effect === "inject-directive") {
      out.push({ ...rest, ...(gate.directive ? { directive: classScopedDirective(gate.directive, sideEffect) } : {}) });
      continue;
    }
    const baseGateId = gate.baseGateId ?? gate.id;
    const emit = (tool: string, name = tool) => out.push({ ...rest, id: `${gate.id}:${name}`, baseGateId, tool });
    if (gate.tool && gate.tool !== "*") {
      const named = normalizeToolName(gate.tool);
      if (classifyTool(gate.tool) === sideEffect || classifyTool(named) === sideEffect) emit(gate.tool, named);
      continue;
    }
    for (const tool of toolsOf(sideEffect)) emit(tool);
  }
  return out;
}

/** The ONE negotiation: compact gates for a client that declared the wire level, the lowered form for everyone else. */
export function gatesForWireLevel(gates: readonly PolicyGate[], declaredLevel: string | number | null | undefined): PolicyGate[] {
  return understandsSideEffectGates(declaredLevel) ? [...gates] : lowerSideEffectGates(gates);
}

/**
 * A dispatch frame (`task.assign` / `task.broadcast`) as it must leave for a host that has NOT declared the wire level:
 * the `policyGates` inside its JSON `payload` spelled out per tool. A frame for a host that has, or one carrying no class
 * gate, is returned as it is. Done where the frame is SENT to the host (the relay), never where the run is built, so a cloud
 * run keeps the compact form.
 */
export function lowerFrameGates<T>(frame: T, hostLevel: string | number | null | undefined): T {
  if (understandsSideEffectGates(hostLevel)) return frame;
  const payload = (frame as { payload?: unknown } | null)?.payload;
  if (typeof payload !== "string") return frame;
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(payload) as Record<string, unknown>; } catch { return frame; }
  if (!parsed || !Array.isArray(parsed.policyGates)) return frame;
  const gates = coercePolicyGates(parsed.policyGates);
  if (!gates.some((g) => g.sideEffect)) return frame;
  return { ...frame, payload: JSON.stringify({ ...parsed, policyGates: lowerSideEffectGates(gates) }) };
}
