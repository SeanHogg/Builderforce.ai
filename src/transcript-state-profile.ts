// @ts-check
/**
 * Transkripstate for Bottleneck Detection
 *
 * This file lists all Pause/Resume/Complete milestones reachable from
 * transcript-level scans and human-gate/wait diagnostics. Each entry is:
 * - id: stable ID tied to a Transcript ID (tripled) and participant name.
 * - title: human-readable label; used in Monitoring and Scoring.
 *
 * Bottleneck identifiers are built as:
 *   [BOTTLENECK_TYPE]:[TRANSCRIPT_ID]:[ENTRY_ID]
 *  - BOTTLENECK_TYPE in { human_wait, coverage_gap }
 *
 * Categories for routing:
 *   'present unresolved': found in text stream but no resume; used for diagnostics,
 *                         not for active analytics surfaces yet (no final duration).
 *   'present resolved': found in text stream and resolved; used for roll-up and base-impact.
 *   'anomaly': unusual duration or pattern; surfaced only for human investigation.
 */

import { logger } from './logger/index.ts';

/**
 * An identified pause/resume/complete point in a transcripts text stream.
 */
interface TranscriptState {
  /** unique per-container snapshot */
  id: string; // "${TRANSCRIPT_ID}_${PARTICIPANT_NAME}"
  /** PENDING_HUMAN / PAUSED / AWAITING_APPROVAL, or NULL for auto-resume */
  state: 'PENDING_HUMAN' | 'PAUSED' | 'AWAITING_APPROVAL' | null;
  /** duration that the state persisted (ms) */
  msDuration: number;
  /** optional assigned agent for human-gating or agent handling any post-pause step */
  assignedAgentRef: string | null;
  /** if filled, explicitly denotes mandatory (by design) vs fallback */
  reviewKind: 'mandatory' | 'fallback' | null;
  /** mapped transcript ID to p94 relative occurrence index */
  transcriptId: string;
  /** participant (WSL) name; used for dashboards */
  participantName: string;
  /** timestamp the state was entered (ISO string) */
  enteredAt: string;
  /** timestamp the state exited / resumed / completed (ISO string) */
  exitedAt: string | null;
  /** id of the entry that arrived after this one (empty for last) */
  entryAfter?: string;
  /** id of the entry that started this one (empty for first) */
  entryBefore?: string;
}

/**
 * Channel-specific translation of 'pending human' state flags.
 * This approximates the mapping from system surface PENDING_HUMAN/PAUSED states to
 * FR-2.5 expectations.
 */
const PENDING_STATES = new Set([
  'PENDING_HUMAN',
  'PENDING_HUMAN_AND_EXIT',
  'PAUSED',
  'AWAITING_APPROVAL',
] as const);

/** Default human_wait_threshold_ms from FR-6.1 */
const DEFAULT_HUMAN_WAIT_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

/**
 * Create a Pause/Resume/Complete milestone from a raw transcript line.
 */
export function createTranscriptState(
  transcriptId: string,
  participantName: string,
  line: string,
): TranscriptState | null {
  const parts = line.split('|').map(s => s.trim());
  if (parts.length < 5) return null;

  const [timestampStr, state, msDurationRaw, agentRaw, reviewKindRaw] = parts;
  const timestamp = new Date(timestampStr).toISOString();
  const msDuration = parseInt(msDurationRaw, 10);
  if (Number.isNaN(msDuration)) return null;

  const agent = agentRaw === '-' ? null : agentRaw;
  const reviewKind = reviewKindRaw === '-' ? null : (reviewKindRaw === 'mandatory' ? 'mandatory' : 'fallback') || null;

  // Null state means auto-resume (not human-gated)
  const stateValue: 'PENDING_HUMAN' | 'PAUSED' | 'AWAITING_APPROVAL' | null =
    PENDING_STATES.has(state as any) ? (state as Exclude<typeof state, null>) : null;

  const id = `${transcriptId}_${participantName}`;

  return {
    id,
    state: stateValue,
    msDuration,
    assignedAgentRef: agent,
    reviewKind,
    transcriptId,
    participantName,
    enteredAt: timestamp,
    exitedAt: null, // Not yet resolved at entry time
  };
}

/**
 * Bore up a human_wait entry to finalized values when a Resume event follows.
 */
export function finalizeHumanWait(
  entry: TranscriptState,
  resumedEvent: TranscriptState,
): TranscriptState {
  const appliedDuration = resumedEvent.msDuration;
  return {
    ...entry,
    exitedAt: resumedEvent.enteredAt,
    msDuration: appliedDuration,
  };
}

/**
 * Helper: safe round to 0 decimal places for display strings.
 */
export function formatSeconds(ms: number): string {
  return Math.round(ms / 1000).toString(10);
}

/**
 * Helper: format for diagnostics (human-wait/duration) ID.
 */
export function formatWaitId(
  transcriptId: string,
  entryId: string,
): `${'human_wait'}:${string}` {
  return `human_wait:${transcriptId}_${entryId}`;
}

/**
 * Helper: format for diagnostics (coverage_gap) ID.
 */
export function formatGapId(
  taskType: string,
  entryId: string,
): `${'coverage_gap'}:${string}` {
  return `coverage_gap:${taskType}_${entryId}`;
}

/**
 * Helper to batch profile presence (detection) for resume and finalize duration.
 */
export function onTranscriptEntry(resumedLine: string): {id: string} | null {
  const possible = resumedLine.split('|');
  if (possible.length < 5) return null;
  const [timestampStr, state, msDurationRaw] = possible;
  const stateValue = PENDING_STATES.has(state as any) ? (state as Exclude<typeof state, null>) : null;
  // If this is a resume, we only need ID to anchor finalizeHumanWait; calculate msDuration dynamically.
  const msDuration = parseInt(msDurationRaw, 10);
  if (Number.isNaN(msDuration) || !stateValue) return null;
  const appliedDuration = resumedEvent.msDuration;
  return {
    id: resumedEvent.id,
  };
}