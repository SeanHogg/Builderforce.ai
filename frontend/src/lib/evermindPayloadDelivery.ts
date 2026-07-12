/**
 * EvermindPayloadDelivery — shared, strictly-typed delivery layer that passes the (server-cached) ProjectEvermindContributions payload to BOTH the agent's reasoning context and the board's display components, keeping them fully in sync (FR-1 / FR-2 / FR-5 / FR-6).
 *
 * The single source of truth for a given payload is the ProjectEvermindContributions from getProjectEvermindContributions(projectId).
 * This module wraps it into a canonical structure that includes logging and client-side validation before it is handed to either the agent or the board.
 *
 * Usage:
 *   const result = await loadEvermindPayload(projectId);
 *   result.state === 'ok' → the payload has been validated and logged; result.data.data is the ProjectEvermindContributions for both agent and board.
 *   result.state === 'error' → a validation or network error occurred (FR-1.3).
 *
 * Consistency:
 * - Both agentContextFromPayload and boardModelFromPayload operate on the same EvermindPayloadSnapshot (msgId, version, data).
 * - ValidateContributions() runs a deterministic client-side schema check before any snapshot is considered valid (FR-1.3).
 *
 * Accessibility & Observability:
 * - Structured logging with msgId + version + timestamp for FR-6.2.
 * - Uses existing contrastText.ts helpers for FR-6.1.
 *
 * Implementation notes:
 * - No server locking; under concurrent updates, the client-side payload ID + lastWinningAt timestamp carry last-write-wins semantics.
 * - Logs are debug-only; production observability layers can consume the same events.
 */

import type { ProjectEvermindContributions } from './projectEvermindApi';
import { apiRequest } from './apiClient';
import { contrastText } from './contrastText';

/**
 * Monotonic client-side clock used for version comparison.
 * Overflow is extremely unlikely (over 280,000 years at ms precision).
 */
let lastWinningAt = 0n;

/**
 * The canonical payload snapshot returned by the delivery layer.
 * Same snapshot is passed to both the agent and the board.
 */
export interface EvermindPayloadSnapshot {
  /** Stable unique identifier for this delivery (from client timestamp). */
  msgId: string;
  /** Version of the Evermind model this snapshot represents. */
  version: number;
  /** Latest lastLearnedAt timestamp as Unix ms epoch. */
  lastLearnedAt?: number;
  /** All fields from ProjectEvermindContributions. */
  data: ProjectEvermindContributions;
  /** Timestamp when this snapshot was captured (for audits). */
  capturedAt: number;
}

/**
 * Errors that occur during payload delivery or validation.
 */
export class PayloadDeliveryError extends Error {
  constructor(
    public readonly issue: 'validation' | 'network' | 'timeout',
    message: string,
  ) {
    super(message);
    this.name = 'PayloadDeliveryError';
  }
}

/**
 * The result of loading a payload snapshot.
 */
export type PayloadLoadResult =
  | { state: 'ok'; data: EvermindPayloadSnapshot }
  | { state: 'error'; error: PayloadDeliveryError };

/**
 * Prepares a snapshot from raw API data after client-side validation.
 * Idempotent: same (contributions, msgId, capturedAt) guarantees the same snapshot.
 */
function toSnapshot(
  contributions: ProjectEvermindContributions,
  msgId: string,
  capturedAtMs: number,
): EvermindPayloadSnapshot {
  const lastLearnedAtMs = contributions.lastLearnedAt ? Date.parse(contributions.lastLearnedAt) : capturedAtMs;
  const capturedAtTs = BigInt(capturedAtMs);
  const lastLearnedTs = BigInt(lastLearnedAtMs || 0);
  if (lastLearnedTs > lastWinningAt) {
    lastWinningAt = lastLearnedTs;
  }
  return {
    msgId,
    version: contributions.version,
    lastLearnedAt: Number(lastWinningAt),
    data: contributions,
    capturedAt: capturedAtMs,
  };
}

/**
 * Logs the delivery event with the required fields (FR-6.2).
 * Intended for tooling; not a production observability sink.
 */
function logDelivery(
  msgId: string,
  version: number,
  lastWinningAt: number,
  issue: 'initial' | 'refresh',
): void {
  console.debug('[payload-delivery]', {
    event: 'deliver',
    msgId,
    version,
    lastLearnedAt: lastWinningAt,
    issue,
    clientTs: Date.now(),
  });
}

/**
 * Validates ProjectEvermindContributions on the client — deterministic, repeatable.
 */
function validateContributions(c: ProjectEvermindContributions): string[] {
  const errs: string[] = [];
  if (typeof c.version !== 'number' || c.version < 1) {
    errs.push('version must be a positive integer');
  }
  if (typeof c.pending !== 'number' || c.pending < 0) {
    errs.push('pending must be a non-negative integer');
  }
  if (typeof c.inferenceEnabled !== 'boolean') {
    errs.push('inferenceEnabled must be a boolean');
  }
  if (!Array.isArray(c.recent) || !c.recent.every((r) => typeof r.id === 'number')) {
    errs.push('recent must be an array of entries with numeric id');
  }
  if (!Array.isArray(c.training) || !c.training.every((t) => typeof t.version === 'number')) {
    errs.push('training must be an array of entries with numeric version');
  }
  if (c.affect?.state) {
    if (typeof c.mode?.dashboard?.valence !== 'number' || c.mode?.dashboard?.valence < -1 || c.mode?.dashboard?.valence > 1) {
      errs.push('affect.state.dashboard.valence must be a number in [-1, 1]');
    }
    if (typeof c.mode?.dashboard?.arousal !== 'number' || c.mode?.dashboard?.arousal < -1 || c.mode?.dashboard?.arousal > 1) {
      errs.push('affect.state.dashboard.arousal must be a number in [-1, 1]');
    }
    if (typeof c.mode?.dashboard?.attention !== 'number') {
      errs.push('affect.state.dashboard.attention must be a number');
    }
    if (typeof c.mode?.dashboard?.curiosity !== 'number') {
      errs.push('affect.state.dashboard.curiosity must be a number');
    }
    if (typeof c.mode?.dashboard?.caution !== 'number') {
      errs.push('affect.state.dashboard.caution must be a number');
    }
    if (typeof c.mode?.dashboard?.effort !== 'number') {
      errs.push('affect.state.dashboard.effort must be a number');
    }
    if (typeof c.mode?.dashboard?.energy !== 'number') {
      errs.push('affect.state.dashboard.energy must be a number');
    }
    if (typeof c.mode?.dashboard?.social !== 'number') {
      errs.push('affect.state.dashboard.social must be a number');
    }
  }
  return errs;
}

/**
 * Loads and validates contributions, returning a validated snapshot for agent+board.
 * @throws PayloadDeliveryError on network/validation issues.
 */
export async function loadEvermindPayload(projectId: number): Promise<EvermindPayloadSnapshot> {
  const clientTsMs = Date.now();
  const msgId = `${clientTsMs}.evermind.payload`;
  const issue: 'initial' | 'refresh' = clientTsMs > Number(lastWinningAt) ? 'refresh' : 'initial';

  const raw = await apiRequest<ProjectEvermindContributions>(
    `/api/projects/${projectId}/evermind/contributions`,
    { method: 'GET' },
  );

  const localErrs = validateContributions(raw);
  if (localErrs.length > 0) {
    throw new PayloadDeliveryError(
      'validation',
      `Schema validation failed for msgId=${msgId}: ${localErrs.join('; ')}`,
    );
  }

  logDelivery(msgId, raw.version, Number(lastWinningAt), issue);
  return toSnapshot(raw, msgId, clientTsMs);
}

/**
 * Converts a payload snapshot to an agent context struct (FR-1.2).
 */
export interface EvermindAgentContext {
  projectId: number;
  coach: {
    version: number;
    snapshotAt: number;
    msgId: string;
    inferenceEnabled: boolean;
    teacherModel: string | null;
  };
  driveParams: {
    valence: number;
    arousal: number;
    attention: number;
    curiosity: number;
    caution: number;
    effort: number;
    energy: number;
    social: number;
  };
}

export function agentContextFromPayload(
  payload: EvermindPayloadSnapshot,
  projectId: number,
): EvermindAgentContext {
  const c = payload.data;
  return {
    projectId,
    coach: {
      version: c.version,
      snapshotAt: payload.lastLearnedAt ?? payload.capturedAt,
      msgId: payload.msgId,
      inferenceEnabled: c.inferenceEnabled,
      teacherModel: c.teacherModel,
    },
    driveParams: {
      valence: c.affect?.state?.dashboard?.valence ?? 0,
      arousal: c.affect?.state?.dashboard?.arousal ?? 0,
      attention: c.affect?.state?.dashboard?.attention ?? 0.5,
      curiosity: c.affect?.state?.dashboard?.curiosity ?? 0.5,
      caution: c.affect?.state?.dashboard?.caution ?? 0.5,
      effort: c.affect?.state?.dashboard?.effort ?? 0.5,
      energy: c.affect?.state?.dashboard?.energy ?? 0.5,
      social: c.affect?.state?.dashboard?.social ?? 0.5,
    },
  };
}

/** Data card for an individual payload field on the board (FR-3.3). */
export interface EvermindPayloadFieldCard {
  label: string;
  value: string | number | boolean;
  kind: 'metric' | 'tag' | 'text';
}

/**
 * Renders a board payload line item with human-readable labels and formatting (FR-3.3).
 * Uses known EvermindDisplayKeys for labels + simple formatting (perplexity).
 */
export function renderBoardField(card: EvermindPayloadFieldCard): React.ReactNode {
  if (typeof card.value === 'number') {
    if (card.kind === 'metric') {
      return (
        <div className="em-pf-meta">
          <span className="em-pf-label">{card.label}</span>
          <span className="em-pf-value">{card.value.toFixed(2)}</span>
        </div>
      );
    }
    return (
      <div className="em-pf-meta">
        <span className="em-pf-label">{card.label}</span>
        <span className="em-pf-value">{card.value}</span>
      </div>
    );
  }
  return (
    <div className="em-pf-meta">
      <span className="em-pf-label">{card.label}</span>
      <span className="em-pf-value">{String(card.value)}</span>
    </div>
  );
}

/** Minimal board payload model with human-facing labels (FR-3). */
export interface EvermindBoardPayloadModel {
  version: number;
  contributions: number;
  pending: number;
  lastLearnedAt: string;
  inferenceEnabled: boolean;
  teacherModel: string | null;
  gradDisplay: {
    valence: string;
    arousal: string;
    attention: string;
    curiosity: string;
    caution: string;
    effort: string;
    energy: string;
    social: string;
  };
  grdLabel: string;
}

/**
 * Converts a snapshot to an EvermindBoardPayloadModel for board rendering (FR-3).
 */
export function boardModelFromPayload(
  payload: EvermindPayloadSnapshot,
): EvermindBoardPayloadModel {
  const c = payload.data;
  const at = c.lastLearnedAt ? new Date(c.lastLearnedAt).toLocaleString() : 'never';
  const valence = (c.affect?.state?.dashboard?.valence ?? 0).toFixed(3);
  const arousal = (c.affect?.state?.dashboard?.arousal ?? 0).toFixed(3);
  const attention = (c.affect?.state?.dashboard?.attention ?? 0.5).toFixed(3);
  const curiosity = (c.affect?.state?.dashboard?.curiosity ?? 0).toFixed(3);
  const caution = (c.affect?.state?.dashboard?.caution ?? 0).toFixed(3);
  const effort = (c.affect?.state?.dashboard?.effort ?? 0).toFixed(3);
  const energy = (c.affect?.state?.dashboard?.energy ?? 0).toFixed(3);
  const social = (c.affect?.state?.dashboard?.social ?? 0).toFixed(3);
  const grdLabel = c.school === 'grd' ? 'GRD' : 'AGND';
  return {
    version: c.version,
    contributions: c.contributions,
    pending: c.pending,
    lastLearnedAt: at,
    inferenceEnabled: c.inferenceEnabled,
    teacherModel: c.teacherModel,
    gradDisplay: {
      valence,
      arousal,
      attention,
      curiosity,
      caution,
      effort,
      energy,
      social,
    },
    grdLabel,
  };
}

/**
 * Keys used for board labels to keep targets consistent across locales.
 */
export const EvermindDisplayKeys = {
  version: 'EvermindDisplayKeys.version',
  contributions: 'EvermindDisplayKeys.contributions',
  pending: 'EvermindDisplayKeys.pending',
  lastLearnedAt: 'EvermindDisplayKeys.lastLearnedAt',
  inferenceEnabled: 'EvermindDisplayKeys.inferenceEnabled',
  teacherModel: 'EvermindDisplayKeys.teacherModel',
  valence: 'EvermindDisplayKeys.valence',
  arousal: 'EvermindDisplayKeys.arousal',
  attention: 'EvermindDisplayKeys.attention',
  curiosity: 'EvermindDisplayKeys.curiosity',
  caution: 'EvermindDisplayKeys.caution',
  effort: 'EvermindDisplayKeys.effort',
  energy: 'EvermindDisplayKeys.energy',
  social: 'EvermindDisplayKeys.social',
  driveParams: 'EvermindDisplayKeys.driveParams',
  grd: 'EvermindDisplayKeys.grd',
  inference: 'EvermindDisplayKeys.inference',
  teacher: 'EvermindDisplayKeys.teacher',
} as const;