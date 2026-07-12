/**
 * EvermindPayloadDelivery — shared, strictly-typed delivery layer that passes the server-cached ProjectEvermindContributions payload to BOTH the agent's reasoning context and the board's display components.
 *
 * The single source of truth for a given payload is ProjectEvermindContributions from getProjectEvermindContributions(projectId).
 * This module wraps it into a canonical structure, applies client-side validation, and logs validation+delivery events (FR-1 / FR-2 / FR-5 / FR-6).
 *
 * Usage:
 *   const result = await loadEvermindPayload(projectId);
 *   result.state === 'ok' → payload is validated and derived contexts are available.
 *   result.state === 'error' → a validation/network error occurred (FR-1.3).
 */

import type { ProjectEvermindContributions } from './projectEvermindApi';

/**
 * Errors that occur during payload delivery or validation.
 */
export class PayloadDeliveryError extends Error {
  constructor(
    public readonly issue: 'validation' | 'network' | 'timeout',
    msg: string,
  ) {
    super(msg);
    this.name = 'PayloadDeliveryError';
  }
}

/** Cached per-client monotonic version for race handling (last-win or queued). */
let lastWinningTs = 0n;

/**
 * Logs a structured event for observability.
 */
function logEvent(event: {
  type: 'validate' | 'deliver';
  msgId?: string;
  version?: number;
  lastWinningAt?: number;
  issue?: 'malformed' | 'concurrent' | 'retconn';
}): void {
  console.debug('[EvermindPayloadDelivery]', { ...event, clientTs: Date.now() });
}

/**
 * Validates ProjectEvermindContributions on the client in a deterministic way.
 */
function validateContributions(contribs: ProjectEvermindContributions): string[] {
  const errs: string[] = [];
  if (!Number.isInteger(contribs.version) || contribs.version < 1) {
    errs.push('version must be a positive integer');
  }
  if (typeof contribs.seeded !== 'boolean') {
    errs.push('seeded must be a boolean');
  }
  if (!['connected', 'offline-frozen'].includes(contribs.mode)) {
    errs.push(`mode must be 'connected' or 'offline-frozen', got "${contribs.mode}"`);
  }
  if (typeof contribs.contributions !== 'number' || contribs.contributions < 0) {
    errs.push('contributions must be a non-negative integer');
  }
  if (typeof contribs.inferenceEnabled !== 'boolean') {
    errs.push('inferenceEnabled must be a boolean');
  }
  if (typeof contribs.teacherModel !== 'string' && contribs.teacherModel !== null) {
    errs.push('teacherModel must be a string or null');
  }
  if (!(contribs.lastLearnedAt instanceof Date) && (contribs.lastLearnedAt !== null)) {
    errs.push('lastLearnedAt must be Date or null');
  }
  if (typeof contribs.pending !== 'number' || contribs.pending < 0) {
    errs.push('pending must be a non-negative integer');
  }
  if (!Array.isArray(contribs.recent) || !contribs.recent.every((r) => typeof r.id === 'number')) {
    errs.push('recent must be an array of entries with numeric id');
  }
  if (!Array.isArray(contribs.training) || !contribs.training.every((t) => typeof t.version === 'number')) {
    errs.push('training must be an array of entries with numeric version');
  }
  if (contribs.eval !== null) {
    // eval is optional (ProjectEvermindEvalPoint)
    if (!(typeof contribs.eval.version === 'number') || contribs.eval.version < 0) {
      errs.push('eval.version must be a non-negative integer');
    }
  }
  const limbicFormat = 'valence/arousal/driveCuriosity/driveCaution/driveEffort/driveSocial/attention/exploration';
  if (contribs.affect?.state) {
    Object.keys(contribs.affect.state).forEach((k) => {
      if (!limbicFormat.includes(k)) {
        errs.push(`invalid limbic dim "${k}"; allowed: ${limbicFormat}`);
      }
    });
  }
  return errs;
}

/**
 * Converts raw issues into a PayloadDeliveryError.
 */
function toError(issues: string[], clientTs: number): PayloadDeliveryError {
  const joined = issues.join('; ');
  // Interpret first issue to classify as validation.
  const severity: 'validation' | 'network' | 'timeout' = issues[0]?.includes('must be')
    ? 'validation'
    : 'network';
  return new PayloadDeliveryError(severity, `Client validation failed at ${clientTs}: ${joined}`);
}

/**
 * The canonical snapshot returned by the delivery layer.
 * Same snapshot is passed to both agent and board; only descriptor fields are added.
 */
export interface EvermindPayloadSnapshot {
  /** Payload version identifier. */
  version: number;
  /** Termination timestamp used to stitch snapshots together (lastWrite-wins). */
  lastWinningAt: number;
  /** All fields from ProjectEvermindContributions. */
  data: ProjectEvermindContributions;
  /** Captured timestamp for audit. */
  capturedAt: number;
}

/**
 * Coordinates a single payload elevation, validating and returning a snapshot.
 * For live projects this is effectively the getProjectEvermindContributions fetch + validation.
 */
export async function loadEvermindPayload(projectId: number): Promise<EvermindPayloadSnapshot> {
  const clientTs = Date.now();
  const serverContribs = await getProjectEvermindContributions(projectId);
  const issues = validateContributions(serverContribs);
  if (issues.length > 0) {
    logEvent({ type: 'validate', msgId: `${clientTs}.ev.p`, version: serverContribs.version, issue: 'malformed' });
    throw toError(issues, clientTs);
  }
  const lastWinningTsMs = Number(lastWinningTs);
  const snapshot: EvermindPayloadSnapshot = {
    version: serverContribs.version,
    lastWinningAt: serverContribs.lastLearnedAt instanceof Date
      ? serverContribs.lastLearnedAt.getTime()
      : lastWinningTsMs,
    data: serverContribs,
    capturedAt: clientTs,
  };
  if (snapshot.lastWinningAt > lastWinningTsMs) {
    lastWinningTs = BigInt(snapshot.lastWinningAt);
  }
  logEvent({
    type: 'deliver', msgId: snapshot.lastWinningAt.toString(), version: serverContribs.version, lastWinningAt: snapshot.lastWinningAt
  });
  return snapshot;
}

/**
 * Converts a payload snapshot into an agent context (FR-1.2, FR-2.1).
 */
export interface EvermindAgentContext {
  /** Project ID this payload is for. */
  projectId: number;
  driverAffect: Record<string, number>;
  targetMode: string;
  lastLearnedAt: number | null;
  inferenceEnabled: boolean;
}

export function agentContextFromPayload(
  payload: EvermindPayloadSnapshot,
  projectId: number,
): EvermindAgentContext {
  const d = payload.data;
  return {
    projectId,
    driverAffect: d.affect?.state ?? {},
    targetMode: d.mode,
    lastLearnedAt: d.lastLearnedAt instanceof Date ? d.lastLearnedAt.getTime() : null,
    inferenceEnabled: d.inferenceEnabled,
  };
}

/**
 * Board payload model with human-friendly labels (FR-3).
 */
export interface EvermindBoardPayloadModel {
  version: number;
  seeded: boolean;
  mode: 'connected' | 'offline-frozen';
  contributions: number;
  pending: number;
  inferenceEnabled: boolean;
  teacherModel: string | null;
  lastLearnedAt: string;
  recentCount: number;
  trainingPoints: number;
  nextEval?: { version: number; delta: number } | null;
  limbic: Record<string, number>;
  armed: boolean;
}

export function boardModelFromPayload(payload: EvermindPayloadSnapshot): EvermindBoardPayloadModel {
  const d = payload.data;
  const lastLearnedAt = d.lastLearnedAt?.toISOString() ?? 'never';
  const nextEval = d.eval
    ? { version: d.eval.version, delta: d.eval.delta }
    : null;
  return {
    version: d.version,
    seeded: d.seeded,
    mode: d.mode,
    contributions: d.contributions,
    pending: d.pending,
    inferenceEnabled: d.inferenceEnabled,
    teacherModel: d.teacherModel,
    lastLearnedAt,
    recentCount: d.recent.length,
    trainingPoints: d.training.length,
    nextEval,
    limbic: d.affect?.state ?? {},
    armed: !!d.eval,
  };
}

/** Human-readable labels for payload fields (FR-3.3). */
export const PayloadLabels: Record<string, string> = {
  version: 'Evermind version',
  seeded: 'Seeded model',
  mode: 'Learning mode',
  contributions: 'Accepted learnings',
  pending: 'Queued learnings',
  inferenceEnabled: 'Inference (run on Evermind)',
  teacherModel: 'Teacher model',
  lastLearnedAt: 'When last merged',
  recentCount: 'Recent entries (0–30)',
  trainingPoints: 'Training cycles',
  armed: 'Regression check armed (▲/▼)',
} as const;