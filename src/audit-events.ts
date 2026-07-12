// @ts-check
/**
 * Audit of record_cloud_tool_event-style events into discovery-ready transcripts.
 *
 * This module ingests structured audit events from external logs (FR-1) and
 * flattens them into transcript-like string streams suitable for bottleneck
 * detection logic. Outputs a list of thread_candidates_bottlenecks (human_wait | coverage_gap)
 * after calculating msDuration where a resume is observed.
 *
 * Thread-based bottleneck inheritance:
 * - If a task resumes in a thread, all {thread_per_task} in that thread inherit the
 *   post-pause start timestamp to compute msDuration (BSS impact).
 * - If no resume, the entry is 'present unresolved' and msDuration becomes
 *   uncertain; still included for diagnostic triage and timeline diagnostics.
 *
 * Detecting human-gating vs automated:
 * - Human-gated is inferred when state equals one of PENDING_STATES.
 * - Fallback vs mandatory is determined by a `reason` field (system-supplied flags),
 *   otherwise we default to 'mandatory' and let downstream validation refine.
 *
 * For FR-1.2 and FR-1.3, parsers are kept generic to support JSON and CSV-like exports.
 *
 * Detecting coverage_gap vs capacity:
 * - A coverage_gap is triggered when agent_capabilities has no match for the
 *   task's capability labels and no available agents are detected.
 * - Hard gap: no agent exists with the required capabilities.
 * - Soft gap: agents exist but are marked 'unavailable' (constrained/busy).
 */

import { logger } from './logger/index.ts';
import type { TranscriptState } from './transcript-state-profile.ts';

// Reproducible search constants
const DEFAULT_HUMAN_WAIT_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_GAP_COUNT_THRESHOLD = 5;                 // 5 occurrences in rolling window
const DEFAULT_GAP_WINDOW_MS = 24 * 60 * 60 * 1000;     // 24 hours
const DEFAULT_GAP_CAPACITY_HEURISTIC = false;         // skip soft-gap capability heuristics initially

// Detecting specific surface PENDING_HUMAN/PAUSED states from tool event logs.
const TOOL_PENDING_STATES = new Set([
  'PENDING_HUMAN',
  'PENDING_HUMAN_AND_EXIT',
  'PAUSED',
  'AWAITING_APPROVAL',
] as const);

/**
 * Event shape from outbound audit sinks.
 */
export interface ToolAuditEvent {
  timestamp?: string;
  thread_id?: string;
  thread_role?: string;
  entry_id?: string;
  task_id?: string;
  state?: string;
  from_state?: string;
  to_state?: string;
  ms_duration?: string;
  assigned_agent?: string;
  reason?: string;
  priority?: 'low' | 'medium' | 'high';
  capability_labels?: string[];
  available_agents?: string[];
  human_wait_duration?: string;
}

/**
 * Flatten a tool audit event into a textual transcript line.
 * Expected format: [timestamp][state][ms_duration][assigned_agent][reason|investigate]|[joined|merged]
 * If format does not match, returns null (unlikely but kept safe).
 */
export function flattenToolEvent(e: ToolAuditEvent): string | null {
  const t = e.timestamp ?? new Date().toISOString();
  const s = e.to_state ?? e.state ?? '-';
  const d = e.ms_duration ?? '-';
  const a = e.assigned_agent ?? '-';
  const r = e.reason ?? '-';
  const fmt = e.entry_id || t.replace(/[:.]/g, '');
  // Append optional timeline markers only when specified in the event.
  const extras = [];
  if (e.thread_id) extras.push(`thread_id:${e.thread_id}`);
  if (e.thread_role) extras.push(`thread_role:${e.thread_role}`);
  if (fmt) extras.push(`key:${fmt}`);
  const extraPart = extras.length > 0 ? `|` + extras.join('|') : '';
  // Return in transcripts/audit-events.ts pattern
  return `${t}|${s}|${d}|${a}|${r}${extraPart}`;
}

/**
 * Compute bottleneck severity score (BSS) for a human_wait or coverage_gap.
 */
export function computeBottleneckSeverityScore(
  frequency: number,
  avgDurationMs: number,
  impactIndex: number, // 0..1 normalized
  weightFrequency = 0.5,
  weightDuration = 0.3,
  weightImpact = 0.2,
): number {
  const f = Math.min(frequency / 10, 1.0); // cap at 10x per period
  const d = Math.min(avgDurationMs / (60 * 60 * 1000), 1.0); // cap at 1 hour
  const i = impactIndex;
  return f * weightFrequency + d * weightDuration + i * weightImpact;
}

/**
 * Identify a 'coverage_gap' event from an audit event.
 */
export function identifyCoverageGap(
  e: ToolAuditEvent,
): { type: 'coverage_gap'; task_type: string; entry_id: string } | null {
  const labels = new Set(e.capability_labels ?? []);
  const available = new Set(e.available_agents ?? []);
  const hasMatch = labels.size > 0 && [...available].some(a => labels.has(a));

  // Only flag coverage_gap when no match AND at least one label is present.
  // Mark availability via reviewKind/hard_gap in output where possible from reason.
  if (!hasMatch && labels.size > 0) {
    const task_type = e.task_id ?? 'unknown_task';
    const entry_id = e.entry_id ?? task_type;
    return { type: 'coverage_gap', task_type, entry_id };
  }

  return null;
}

/**
 * Derive 'thread_per_task' list for a given event (for BSS duration inheritance).
 */
export function deriveThreadEvents(
  e: ToolAuditEvent,
): { thread_id: string; thread_role: string } | null {
  if (!e.thread_id || !e.thread_role) return null;
  return { thread_id: e.thread_id, thread_role: e.thread_role };
}

/**
 * Resolve into transcript-state-profile.ts TranscriptState times baseline on finalize.
 */
export function finalizeHumanWaitState(
  entry: TranscriptState,
  resumedEvent: ToolAuditEvent,
): TranscriptState {
  const durationMs = parseInt(resumedEvent.ms_duration ?? '0', 10);
  return {
    ...entry,
    exitedAt: resumedEvent.timestamp!,
    msDuration: durationMs,
  };
}

/**
 * Summarize human_gating_periods: resolved + unresolved (NO resume) for roll-up and diagnostics
 */
export interface HumanGatingPeriodSummary {
  entry: TranscriptState;
  resolvedMsDurationMs: number; // Only finite after resume (0 if still unresolved)
  reviewKind: 'mandatory' | 'fallback' | null;
  replayThroughputPerHour: number;
}

/**
 * Summarize coverage_gap_entries with availability.
 */
export interface CoverageGapEntry {
  task_type: string;
  required_capabilities: string;
  available_agents: string[];
  entry_id: string;
  hard_gap: boolean;
}

/**
 * Summarize BSS for each bottleneck.
 */
export interface BottleneckMetadata {
  bottleneck_type: 'human_wait' | 'coverage_gap';
  bottleneck_id: string;
  bottleneck_label: string;
  severity_score: number;
  impacted_thread_ids: string[];
  impact_distribution?: Record<string, number>; // thread_id -> count
  first_seen: string;
  last_seen: string;
  effects?: string[]; // warnings or warnings for FR-5.2 alerts
}

/** Output to pass to scanTranscriptsForBottlenecks */
export interface ThreadCandidatesBottlenecks {
  human_gating_periods: HumanGatingPeriodSummary[];
  coverage_gap_entries: CoverageGapEntry[];
  bottleneck_metadata: BottleneckMetadata[];
}

/**
 * Core detection routine: feeds transcripts and returns candidates ready for scoring.
 *
 * This function accepts a list of transcript lines flattened via flattenToolEvent.
 * It first identifies timeline candidates, then resolves human waits where resume events are present.
 * For unresolved waits, human_wait_duration is unknown, and they are surfaced for diagnostics
 * (msDuration = unknown) rather than scoring, unless fallback heuristic is enabled.
 *
 * @param lines - recently ingested flat strings from flattenToolEvent
 */
export function scanTranscriptsForBottlenecks(
  lines: string[],
): ThreadCandidatesBottlenecks {
  const humanGatingPeriods: HumanGatingPeriodSummary[] = [];
  const coverageGapEntries: CoverageGapEntry[] = [];
  const bottleneckMetadata: BottleneckMetadata[] = [];

  const pendingLookup = new Map<string, TranscriptState>();
  const resolvedLookup = new Map<string, {entry: TranscriptState; resumed: ToolAuditEvent}>();

  // First pass: ingest pending states and allocate pendingLookup.
  for (const line of lines) {
    const e: ToolAuditEvent = JSON.parse(line);
    if (!ToolAuditEvent.isInstance(e)) continue;

    const entry = createTranscriptState(e);
    if (!entry) continue;

    if (entry.state) {
      pendingLookup.set(entry.id, entry);
    }

    const gap = identifyCoverageGap(e);
    if (gap) {
      const availableList = e.available_agents ?? [];
      const hardGap = availableList.length === 0;
      coverageGapEntries.push({
        task_type: gap.task_type,
        required_capabilities: JSON.stringify(e.capability_labels ?? []),
        available_agents: availableList,
        entry_id: gap.entry_id,
        hard_gap: hardGap,
      });
    }
  }

  // Second pass: resolve human waits if a resume entry is present.
  // We allow a future resume event to resume the wait that started earlier.
  // For resolved waits, we compute msDuration from resumedEntry.ms_duration.
  for (const line of lines) {
    const e: ToolAuditEvent = JSON.parse(line);
    if (!ToolAuditEvent.isInstance(e)) continue;

    const entry = createTranscriptState(e);
    if (!entry) continue;

    // Resolve a pending wait that aligns timeline-wise (not ordered in the sample; we accept any frame with matching thread_id)
    if (entry.state && pendingLookup.has(entry.id)) {
      const pending = pendingLookup.get(entry.id)!;
      const resumedEntry: ToolAuditEvent = {
        timestamp: e.timestamp,
        to_state: e.to_state ?? 'RESUMED',
        ms_duration: e.ms_duration ?? '0',
        assigned_agent: e.assigned_agent,
        reason: 'resume',
        thread_id: e.thread_id,
        thread_role: e.thread_role,
        entry_id: e.entry_id,
      };

      const resolved = finalizeHumanWaitState(pending, resumedEntry);
      pendingLookup.delete(entry.id);
      resolvedLookup.set(entry.id, { entry: resolved, resumed: resumedEntry });
    }
  }

  // Build summary schedule for human_gating_periods.
  // We include both resolved and unresolved pending entries for reportability.
  for (const line of lines) { // Iterate all lines again to correlate instance
    const e: ToolAuditEvent = JSON.parse(line);
    const entry = createTranscriptState(e);
    if (!entry) continue;

    const thread = deriveThreadEvents(e);
    const resolved = resolvedLookup.get(entry.id);

    // unresolved case: msDuration unknown; still surfaced for diagnostics
    if (entry.state && !resolved) {
      const pending = pendingLookup.get(entry.id);
      if (!pending) continue; // missed in first pass

      // Unknown msDuration to_signal: unknown wait state, not updatable after intake
      const unresolvedDurationMs = -1;

      humanGatingPeriods.push({
        entry: pending,
        resolvedMsDurationMs: unresolvedDurationMs,
        reviewKind: e.reason === 'fallback' ? 'fallback' : 'mandatory',
        replayThroughputPerHour: calculateApparentThroughput(humanGatingPeriods, entry.transcriptId),
      });
    } else if (resolved) {
      const { entry: resolvedEntry } = resolved;
      if (resolvedEntry.exitedAt) {
        humanGatingPeriods.push({
          entry: resolvedEntry,
          resolvedMsDurationMs: resolvedEntry.msDuration,
          reviewKind: resolved.resumed.reason === 'fallback' ? 'fallback' : 'mandatory',
          replayThroughputPerHour: calculateApparentThroughput(humanGatingPeriods, entry.transcriptId),
        });
      }
    }
  }

  // After summaries for human waits, compute BSS in a third pass to avoid double counting.
  for (const summary of humanGatingPeriods) {
    const { entry } = summary;
    if (entry.msDuration < 0) continue; // skip unresolved for BSS

    // BSS inputs
    const avgMs = summary.resolvedMsDurationMs; // single-point for this resolution, not an average for now
    const peopleImpFactors = countImpactedThreads(humanGatingPeriods, entry.transcriptId);
    const impactIndex = peopleImpFactors / Math.max(humanGatingPeriods.length, 1);

    const bss = computeBottleneckSeverityScore(
      summary.replayThroughputPerHour,
      avgMs,
      impactIndex,
    );

    bottleneckMetadata.push({
      bottleneck_type: 'human_wait',
      bottleneck_id: `human_wait:${entry.transcriptId}_${entry.participantName}`,
      bottleneck_label: `human_wait:${entry.participantName}`,
      severity_score: bss,
      impacted_thread_ids: roughlyDeriveThreadIds(entry, humanGatingPeriods),
      first_seen: entry.enteredAt,
      last_seen: entry.exitedAt ?? entry.enteredAt,
      effects: [],
    });
  }

  return {
    human_gating_periods: humanGatingPeriods,
    coverage_gap_entries: coverageGapEntries,
    bottleneck_metadata: bottleneckMetadata,
  };
}

// Helper: Extract string sub-definition from ToolAuditEvent { timestamp, to_state, ms_duration, assigned_agent, reason, thread_id, thread_role, entry_id }
const TOOL_AUDIT_EVENT_FIELDS: (keyof ToolAuditEvent)[] = [
  'timestamp', 'to_state', 'ms_duration', 'assigned_agent', 'reason', 'thread_id', 'thread_role', 'entry_id',
];
ToolAuditEvent.isInstance = (e: any): e is ToolAuditEvent => {
  // Very lightweight type guard; simple grid check
  for (const k of TOOL_AUDIT_EVENT_FIELDS) {
    if (k !== 'initial_severity' && k !== 'tags' && !(k in e)) {
      return false;
    }
  }
  return true;
};

/** approx known throughput per hour in this line set (no expensive window) */
function calculateApparentThroughput(summaries: HumanGatingPeriodSummary[], transcriptId: string): number {
  const matches = summaries.filter(s => s.entry.transcriptId === transcriptId);
  if (matches.length === 0) return 0;
  // Count non-zero durations as 'acts' in the period; don't divide by time to avoid quanta noise
  const acts = matches.filter(s => s.resolvedMsDurationMs > 0).length;
  return acts;
}

/** Map transcriptId -> impacted thread count; used to estimate impact factor */
function countImpactedThreads(summaries: HumanGatingPeriodSummary[], transcriptId: string): number {
  let inv = 0;
  for (const s of summaries) {
    if (s.entry.transcriptId === transcriptId && s.resolvedMsDurationMs > 0) inv++;
  }
  return inv;
}

/** Rough heuristic to derive affected thread_ids from resolution patterns */
function roughlyDeriveThreadIds(entry: TranscriptState, all: HumanGatingPeriodSummary[]): string[] {
  const candidates = new Set<string>();
  for (const s of all) {
    if (s.entry.transcriptId === entry.transcriptId && s.resolvedMsDurationMs > 0) {
      if (s.entry.entryAfter) candidates.add(s.entry.entryAfter);
    }
  }
  return Array.from(candidates);
}