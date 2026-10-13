/**
 * Record a canvas act on the outcome ledger.
 *
 * ── WHY THIS IS NOT INSIDE EACH ACT ─────────────────────────────────────────
 * An act returns a DESCRIPTION of what changed (`CardActOutcome`). The runner
 * is the one place the board is mutated on an act's behalf; it is also the one
 * place a successful act is written to the ledger. Putting `recordOutcome` in
 * `ideaActs` / `formActs` / every other entry would be thirteen copies of the
 * same started+terminal pair, and the copy that forgot the `started` event is
 * the one that silently tanks correlation coverage.
 *
 * The mapping itself lives in `@builderforce/creation-canvas-contract` so the
 * methodology ratchet and a test that never mounts React can both read it.
 *
 * Measurement is best-effort: a lost write must not fail the act the person
 * just saw succeed. The API derives tenant and actor; we never invent them.
 */

import {
  canvasActionOutcomes,
  canvasOutcomeReachable,
} from '@builderforce/creation-canvas-contract';
import { creationSessionsApi } from './builderforceApi';

export interface CanvasActRecordInput {
  sessionId: string | null | undefined;
  kind: string;
  action: string;
  objectId: string;
  patch?: Record<string, unknown> | null;
  extra?: {
    metricKey?: string;
    metricValue?: number;
    unit?: string;
    metadata?: Record<string, unknown>;
  };
}

export interface CanvasActOutcomeBody {
  correlationId: string;
  action: string;
  phase: 'started' | 'succeeded' | 'failed' | 'validated' | 'reused';
  artifactId: string;
  metadata: Record<string, unknown>;
  metricKey?: string;
  metricValue?: number;
  unit?: string;
}

/** The POST bodies one successful canvas act produces. Pure — tests read this. */
export function canvasActOutcomeBodies(input: CanvasActRecordInput): CanvasActOutcomeBody[] {
  const specs = canvasActionOutcomes(input.kind, input.action);
  const correlationId = `act:${input.objectId}:${input.kind}.${input.action}`;
  const bodies: CanvasActOutcomeBody[] = [];
  for (const spec of specs) {
    const url = spec.reachableField && input.patch ? input.patch[spec.reachableField] : undefined;
    const reachable = spec.reachableField ? canvasOutcomeReachable(url) : undefined;
    const metadata: Record<string, unknown> = {
      kind: input.kind,
      canvasAction: input.action,
      ...(spec.targetKey ? { targetKey: spec.targetKey } : {}),
      ...(typeof url === 'string' && url.trim() ? { url: url.trim() } : {}),
      ...(reachable !== undefined ? { reachable } : {}),
      ...input.extra?.metadata,
    };
    const common = {
      correlationId,
      action: spec.action,
      artifactId: input.objectId,
      metadata,
      ...(input.extra?.metricKey ? { metricKey: input.extra.metricKey } : {}),
      ...(input.extra?.metricValue !== undefined ? { metricValue: input.extra.metricValue } : {}),
      ...(input.extra?.unit ? { unit: input.extra.unit } : {}),
    };
    bodies.push({ ...common, phase: 'started' });
    bodies.push({ ...common, phase: spec.successPhase });
  }
  return bodies;
}

/** Fire-and-forget. No-ops without a session. Never throws to the caller. */
export function recordCanvasActOutcomes(input: CanvasActRecordInput): void {
  if (!input.sessionId) return;
  for (const body of canvasActOutcomeBodies(input)) {
    void creationSessionsApi.recordOutcome(input.sessionId, body).catch(() => undefined);
  }
}
