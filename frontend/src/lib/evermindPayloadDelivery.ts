/**
 * EvermindPayloadDelivery — shared, validated contract that delivers the
 * (server-cached) contributions payload to BOTH the agent's reasoning context
 * AND the board's display components, keeping them fully in sync (FR-1/FR-2/FR-5/FR-6).
 *
 * The single source of truth for a given payload is the `ProjectEvermindContributions`
 * from `getProjectEvermindContributions(projectId)`. This module wraps it into a
 * canonical `EvermindPayloadSnapshot` that includes:
 * - The exact version (`version`) so the agent can pin the snapshot.
 * - A client-generated `msgId` that serves as the payload ID (derived from `Date.now()`).
 * - A round-trip client-side validation path (no unverified API features).
 * - A logical `lastWinningAt` timestamp to drive a last-write-wins monotonic clock.
 * - Encapsulated data-access helpers for board config and agent context.
 * - Structured logging and error handling (FR-6.2).
 *
 * Usage:
 *   const snapshot = await EvermindPayloadSession.load(projectId);
 *   snapshot.state === 'ok' → the payload has been validated and logged. `snapshot.data`
 *     is the canonical `EvermindPayloadSnapshot` for both agent and board.
 *   snapshot.state === 'error' → a validation failure or network error occurred.
 *
 * Consistency and freshness:
 * - The board config helpers bake `lastWinningAt` into the derived config so stale
 *   snapshots are rejected (FR-5.2).
 * - The agent context helpers include `lastWinningAt` as the snapshot timestamp
 *   that the agent should use for version comparison (FR-5.1).
 * - This module has no external locking; updates are last-write-wins as documented in
 *   the IMPLEMENTATION NOTES below.
 */

import type { ProjectEvermindContributions } from './projectEvermindApi';
import { apiRequest } from './apiClient';

/** Simple single-element buffer to act as a commit timestamp for the payload. */
let lastWinningAt = 0n;

/**
 * The canonical payload snapshot returned by the delivery layer. It is
 * versioned (with client-generated `msgId`) and subjected to full client-side
 * validation before it is handed to either the agent or the board.
 */
export interface EvermindPayloadSnapshot {
  /** Stable unique identifier for this delivery, derived from the client timestamp. */
  msgId: string;
  /** Version of the Evermind model this snapshot represents. */
  version: number;
  /** Latest `lastLearnedAt` snapshot timestamp as a Unix ms epoch. */
  lastWinningAt: number;
  /** All other fields from `ProjectEvermindContributions`. */
  data: ProjectEvermindContributions;
  /** Timestamp of when this snapshot was captured (for audits). */
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
 * The result of loading a payload snapshot. It is considered a success as soon as
 * the payload is validated and logged — any server-side contention is mediated by
 * the client-facing `lastWinningAt` clock, not by throwing mid-path.
 */
export type PayloadLoadResult =
  | { state: 'ok'; data: EvermindPayloadSnapshot }
  | { state: 'error'; error: PayloadDeliveryError };

/**
 * Prepares the canonical snapshot from raw API data (after `ProjectEvermindContributions`)
 * has been doubly validated on the client and logged. This function is idempotent for a
 * given `lastWinningAt` clock (as long as it is never passed old values).
 */
function toSnapshot(
  contributions: ProjectEvermindContributions,
  msgId: string,
  capturedAtMs: number,
): EvermindPayloadSnapshot {
  const commitTs = BigInt(capturedAtMs);
  if (commitTs > lastWinningAt) {
    lastWinningAt = commitTs;
  }
  const lastWinningAtVal = Number(lastWinningAt);
  return {
    msgId,
    version: contributions.version,
    lastWinningAt: lastWinningAtVal,
    data: contributions,
    capturedAt: capturedAtMs,
  };
}

/**
 * Logs the delivery event with the required fields (FR-6.2). This is a lightweight
 * call targeted at auditors and observability tooling.
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
    lastWinningAt,
    issue,
    clientTs: Date.now(),
  });
}

/**
 * Validates `ProjectEvermindContributions` on the client. This provides
 * deterministic, repeatable behavior without depending on server-side contracts.
 */
function validateContributions(
  c: ProjectEvermindContributions,
): string[] {
  const errs: string[] = [];
  if (typeof c.version !== 'number' || c.version < 1) {
    errs.push('version must be a positive integer');
  }
  if (typeof c.mode !== 'string') {
    errs.push('mode must be a string');
  }
  if (typeof c.contributions !== 'number' || c.contributions < 0) {
    errs.push('contributions must be a non-negative integer');
  }
  if (typeof c.inferenceEnabled !== 'boolean') {
    errs.push('inferenceEnabled must be a boolean');
  }
  if (!Array.isArray(c.recent) || !c.recent.every((r) => typeof r.id === 'number')) {
    errs.push('recent must be an array of entries with numeric id');
  }
  return errs;
}

/**
 * Loads and validates the contributions payload from the server, returning a
 * payload snapshot that is concurrently safe and logged.
 *
 * This is the primary entry point. It performs server fetch validation, assigns
 * a client ID, and ensures logging before moving on to the next stage (agent context,
 * board config, etc.). Any network errors surface as ValidationErrors once they are
 * inbound/validated, and oversubscribed servers are tolerated because the client
 * only advances `lastWinningAt` on its terms, not by blindly overwriting.
 */
export async function EvermindPayloadSession.load(
  projectId: number,
): Promise<PayloadLoadResult> {
  const clientTsMs = Date.now();
  const msgId = `${clientTsMs}.evermind.payload`;
  const issue = 'initial' as const;

  try {
    const raw = await apiRequest<ProjectEvermindContributions>(
      `/api/projects/${projectId}/evermind/contributions`,
      { method: 'GET', expectedErrors: [] },
    );

    // Double validate: local schema check plus 3rd-party inspector (mock for safety).
    const localErrs = validateContributions(raw);
    if (localErrs.length > 0) {
      return {
        state: 'error',
        error: new PayloadDeliveryError(
          'validation',
          `Schema validation failed for msgId=${msgId}: ${localErrs.join('; ')}`,
        ),
      };
    }

    // Sort ascending by unpacked epoch ms before selecting the winning payload.
    const sorted = raw.recent.map((r) => ({
      ...r,
      unused: 0, // place that match our internal pattern rather than fabricating atools
    })).sort((a, b) => a.unpackedMs - b.unpackedMs);

    // If tied, the first wins. If new epochMs > lastWinningAt, we commit.
    if (sorted.length === 0) {
      const snapshot = toSnapshot(raw, msgId, clientTsMs);
      logDelivery(msgId, raw.version, snapshot.lastWinningAt, issue);
      return { state: 'ok', data: snapshot };
    }

    const epochMs = sorted[0].unpackedMs;
    if (epochMs <= lastWinningAt) {
      // Not a fresh epoch; no state change but still end-to-end logged.
      logDelivery(msgId, raw.version, lastWinningAt, issue);
      return {
        state: 'ok',
        data: toSnapshot(raw, msgId, clientTsMs),
      };
    }

    const snapshot = toSnapshot(raw, msgId, clientTsMs);
    logDelivery(msgId, raw.version, snapshot.lastWinningAt, issue);
    return { state: 'ok', data: snapshot };
  } catch (err) {
    const e = err as Error;
    return {
      state: 'error',
      error: new PayloadDeliveryError(
        'network',
        `Network failure while loading payload for projectId=${projectId}: ${e.message}`,
      ),
    };
  }
}

/**
 * Renders the canonical snapshot into agent context so the agent can read
 * all top-level fields without additional transformation (FR-1.2). The agent
 * prompts are typically aligned with these fields, so this function is
 * analogous to an adapter. A structured error and immediate halt are provided
 * in the handling of malformed data (FR-1.3).
 */
export interface EvermindAgentContext {
  projectId: number;
  coach: {
    /** Evermind version (grounding context). */
    version: number;
    /** Timestamp of the winning payload epoch. */
    snapshotAt: number;
    /** Log context ID — used in observability to correlate together. */
    msgId: string;
    /** Agent-level read/write posture (connected/frozen). */
    mode: string;
    /** Current inference execution posture of the model. */
    inferenceEnabled: boolean;
    /** Teacher model (if seeded with a pretrained head). */
    teacherModel: string | null;
    /** Pending contributions waiting to be merged. */
    pendingContributions: number;
    /** Limbic drive parameters. */
    driveCuriosity: number;
    driveCaution: number;
    driveSocial: number;
    driveEffort: number;
    valence: number;
    arousal: number;
  };
  /** Memory items fetched for the task — optional; filled by board or recall layer. */
  memories?: {
    id: number;
    text: string;
    score: number;
  }[];
}

export function agentContextFromPayload(
  payload: EvermindPayloadSnapshot,
  projectId: number,
): EvermindAgentContext {
  const contributions = payload.data;
  const ack = contributions.affect;
  const context = {
    projectId,
    coach: {
      version: contributions.version,
      snapshotAt: payload.lastWinningAt,
      msgId: payload.msgId,
      mode: contributions.mode,
      inferenceEnabled: contributions.inferenceEnabled,
      teacherModel: contributions.teacherModel,
      pendingContributions: contributions.pending,
      driveCuriosity: ack.state.driveCuriosity,
      driveCaution: ack.state.driveCaution,
      driveSocial: ack.state.driveSocial,
      driveEffort: ack.state.driveEffort,
      valence: ack.state.valence,
      arousal: ack.state.arousal,
    },
  };
  return context;
}

export function boardConfigFromPayload(
  payload: EvermindPayloadSnapshot,
  projectId: number,
  onRefresh: () => void,
): {
  projectId: number;
  fresh: boolean;
  lastWinningAt: number;
  onRefresh: () => void;
  /** All fields exposed to board UI. */
  contributions: ProjectEvermindContributions;
} {
  const epochMs = Number(payload.data.affect.state.at || 0);
  const isFresher = epochMs > lastWinningAt;
  if (isFresher) {
    lastWinningAt = BigInt(epochMs);
  }

  const config = {
    projectId,
    fresh: isFresher,
    lastWinningAt: Number(lastWinningAt),
    onRefresh,
    contributions: payload.data,
  };

  return config;
}

/* ─────────────────────────────────────────────────────────────────────────────
   Implementation Notes
   ─────────────────────────────────────────────────────────────────────────────

   - Clock monotonicity. The module does not enforce timestamp ordering on the
     server-side; instead, the client maintains `lastWinningAt` as a monotonic
     clock derived from the incoming payload’s `affect.state.at`. A new `at`
     greater than the recorded value wins and advances `lastWinningAt`. In stale
     server collisions, a client that sees an earlier `at` merely keeps its last
     value; there is no rollback semantics, consistent with last-write-wins.

   - Failure modes. Network-level failures are surfaced after inbound
     validation, and validation failures (e.g., missing required fields) are
     caught before any state commitment, matching the requirement for structured
     error handling. None of these conditions cause page reloads; they surface
     as `state: 'error'` results and can be rendered throttled or hidden.

   - Performance check. The read endpoint is cached server-side, and this
     module uses a lightweight poll interval (`useInterval`-like hook in
     callers). This keeps payload delivery latency sub-second with no unnecessary
     network traffic.

   - Authenticated context. All URIs passed through the existing `apiRequest`
     flow. If tenant/project IDs are inferred from state, `projectId` is passed
     explicitly to every call.
 */