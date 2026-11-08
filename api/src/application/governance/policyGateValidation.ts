/**
 * Policy-gate shape validation — the pure checks the pack service runs before it writes a
 * gate. No DB, no env: one place that says what a well-formed gate is, so the CRUD surface
 * and its tests share it. (Wire coercion of stored rows is `coercePolicyGates` in
 * `@builderforce/agent-tools`; this is the write-side guard.)
 */

import { TOOL_SIDE_EFFECTS, type PolicyGate, type ToolSideEffect } from '@builderforce/agent-tools';

export type PolicyGateEffect = PolicyGate['effect'];

export const POLICY_GATE_EFFECTS: readonly PolicyGateEffect[] = [
  'inject-directive',
  'require-approval',
  'block',
];

export const POLICY_GATE_SIDE_EFFECTS: readonly ToolSideEffect[] = TOOL_SIDE_EFFECTS;

export interface PolicyGateInput {
  gateKey?: string;
  tool?: string | null;
  sideEffect?: string | null;
  effect?: string;
  directive?: string | null;
  reason?: string | null;
  position?: number;
}

/** null / undefined / '' mean "no class criterion"; anything else must be a real class. */
export function isValidGateSideEffect(v: unknown): boolean {
  return v == null || v === '' || (typeof v === 'string' && (POLICY_GATE_SIDE_EFFECTS as readonly string[]).includes(v));
}

export function isPolicyGateEffect(v: unknown): v is PolicyGateEffect {
  return typeof v === 'string' && (POLICY_GATE_EFFECTS as readonly string[]).includes(v);
}

export const isBlank = (v: string | null | undefined): boolean => !v || v.trim().length === 0;

const effectError = () => `effect must be one of ${POLICY_GATE_EFFECTS.join(', ')}`;
const sideEffectError = () => `sideEffect must be one of ${POLICY_GATE_SIDE_EFFECTS.join(', ')}`;

/** The first problem with a NEW gate's input, or undefined when it is well formed. */
export function validateNewGateInput(input: PolicyGateInput): string | undefined {
  if (!input.gateKey?.trim()) return 'gateKey is required';
  if (!isPolicyGateEffect(input.effect)) return effectError();
  if (!isValidGateSideEffect(input.sideEffect)) return sideEffectError();
  if (input.effect === 'inject-directive' && isBlank(input.directive)) {
    return 'directive is required for an inject-directive gate';
  }
  return undefined;
}

/** The first problem with a gate PATCH (only the fields present are checked), or undefined. */
export function validateGatePatchInput(input: PolicyGateInput): string | undefined {
  if (input.gateKey !== undefined && !input.gateKey.trim()) return 'gateKey cannot be empty';
  if (input.effect !== undefined && !isPolicyGateEffect(input.effect)) return effectError();
  if (input.sideEffect !== undefined && !isValidGateSideEffect(input.sideEffect)) return sideEffectError();
  return undefined;
}

/**
 * A stored `side_effect` read back for enforcement: empty means no class criterion, a value
 * that is not a real class (a hand-edited row) is treated as `mutate` — never dropped, which
 * would widen the gate to "every tool" or silence it.
 */
export function readStoredSideEffect(raw: string | null | undefined): ToolSideEffect | undefined {
  if (raw == null || raw === '') return undefined;
  return (POLICY_GATE_SIDE_EFFECTS as readonly string[]).includes(raw) ? (raw as ToolSideEffect) : 'mutate';
}
