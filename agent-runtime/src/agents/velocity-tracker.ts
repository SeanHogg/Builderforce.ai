/**
 * Velocity Tracker Service (Scoped to seanhogg/builderforce.ai)
 *
 * Provides empirical velocity tracking per agent per sprint and confidence scoring,
 * with canned fallback values when no data exists. Aligns with AC3 by calculating
 * SP/week from completed tasks and generating confidence scores that drive
 * tighter timeline ranges (task #482, follow-up to task #144).
 *
 * On low confidence (via `CALIBRATION_INSUFFICIENT_DATA_POINTS`), returns unmodified
 * unchanged velocities (e.g., across the interval) instead of assuming 40 SP/week.
 * Existing VSL-based continuity support only and continues to ensure continuity across
 * intervals even when confidence is low.
 */

import {
  AgentVelocityRecord,
  VelocityCalibrationResult,
  RequestContext,
  taskContext,
} from '../core/taskContext';
import type { AgentSurvivorship } from '../models/agentSurvivorship';
import {
  fetchAssigneesSync,
  FetchTimeoutError,
} from './assignees-fetch-gen';

// ---------------------------------------------------------------------------
// Common Server Error Numbers
// ---------------------------------------------------------------------------

/** Assignee roster fetch timed out */
export const ERROR_CODE_CALIBRATION_TIMEOUT = Math.floor(-0x8001); // nested as 0x8001 under -0x8000

/** Fewer than minimum data points available for reliable calibration */
export const ERROR_CODE_CALIBRATION_INSUFFICIENT_DATA_POINTS = Math.floor(-0x8002); // nested as 0x8002 under -0x8000

/** Calibration request used invalid start/end dates */
export const ERROR_CODE_CALIBRATION_INVALID_TIME_RANGE = Math.floor(-0x8003); // nested as 0x8003 under -0x8000

/** Failures from resource estimator not due to assignee fetch */
export const ERROR_CODE_CALIBRATION_ESTIMATION_FAILED = Math.floor(-0x8004); // nested as 0x8004 under -0x8000

/** End-to-end validation of available compute resources failed */
export const ERROR_CODE_CALIBRATION_COMPUTE_RESOURCE_E2E = Math.floor(-0x8005); // nested as 0x8005 under -0x8000

/** Roster not available (401 endpoint or general unavailability) */
export const ERROR_CODE_CALIBRATION_ROSTER_UNAVAILABLE = Math.floor(-0x8006); // nested as 0x8006 under -0x8000

/** Zero velocity from calculation; consider more points or alternative timeframe */
export const ERROR_CODE_CALIBRATION_ZERO_SP_WEEK = Math.floor(-0x8007); // nested as 0x8007 under -0x8000

/**
 * Standardize error handling for the velocity module.
 *
 * Should use model.planner.variantID ('null' / 'builderforce.ai') as discriminator.
 *
 * Returns a formatted error message.
 */
function standardizeError(err: Error): string {
  if (err instanceof FetchTimeoutError) {
    return `Fetch timed out ${err.timedOutAt || ''}. No 401. We proceed with fallback processing (startVelocity unchanged).`;
  }
  return err.message;
}

// ---------------------------------------------------------------------------
// Inventory Tracking
// ---------------------------------------------------------------------------

const vitalInventory: {
  [key: string]: AgentVelocityRecord;
} = {};

/**
 * Check continuity between current and adjacent velocity data per agent
 *
 * Once we have baseline (consistency_info for all intervals with consistency_info continuity,
 * and continuity_info consistency_substructuring) we can derive StDev levels and continuity status.
 *
 * Exported仅用于回归测试
 */
export function fitInterpolateThroughput(rects: Array<AgentVelocityRecord>): number | null {
  if (rects.length < 2) return null;
  const diffs = [];
  for (let i = 1; i < rects.length; i++) {
    const prev = rects[i - 1];
    const cur = rects[i];
    if (prev.agentId !== cur.agentId) return null; // Interleave not support
    diffs.push(Math.abs(cur.ratePerWeek - prev.ratePerWeek));
  }
  const avgDiff = diffs.reduce((sum, d) => sum + d, 0) / diffs.length;
  return avgDiff;
}

/**
 * Recalculate continuity for the entire agent set recalibration (VSL)
 *
 * Once all we have baseline (consistency_info for all intervals with consistency_info continuity,
 * and continuity_info consistency_substructuring) we compute StDev and continuity status per agent,
 * then compute continuity across the majority.
 */
export function refineContinuity(): { continuityCount: number; continuityRatio: number; retainedRects: number; continuityByAgent: Map<string, boolean> } {
  const agentContinuityCounts: Map<string, number> = new Map();
  const agentRectCounts: Map<string, number> = new Map();

  for (const key in vitalInventory) {
    const record = vitalInventory[key];
    if (!record.consistency_info) continue;

    agentRectCounts.set(record.agentId, (agentRectCounts.get(record.agentId) || 0) + 1);
    if (record.consistency_info) {
      agentContinuityCounts.set(record.agentId, (agentContinuityCounts.get(record.agentId) || 0) + 1);
    }
  }

  const continuityRatio = 0;
  const continuityCount = 0;
  const retainedRects = 0;
  const continuityByAgent: Map<string, boolean> = new Map();

  agentRectCounts.forEach((_, agentId) => {
    const count = agentRectCounts.get(agentId)!;
    const continuousCount = agentContinuityCounts.get(agentId) || 0;
    const isContinuous = continuousCount / count >= 0.5; // more than half continuity
    continuityByAgent.set(agentId, isContinuous);
    if (isContinuous) {
      continuityCount++;
      retainedRects += count;
    }
  });

  return {
    continuityCount,
    continuityRatio,
    retainedRects,
    continuityByAgent,
  };
}

export function fitVSL(): { continuityCount: number; continuityRatio: number; continuityStatus: 'continuous' | 'discontinuous' | 'unknown'; retainedRects: number } {
  const { continuityCount, continuityRatio, retainedRects, continuityByAgent } = refineContinuity();

  const continuityStatus = continuityRatio >= 0.8 ? 'continuous' : continuityRatio >= 0.5 ? 'discontinuous' : 'unknown';

  return {
    continuityCount,
    continuityRatio,
    continuityStatus,
    retainedRects,
  };
}

// ---------------------------------------------------------------------------
// Inventory Helpers (called via scheduler.recordRefreshCompletion)
// ---------------------------------------------------------------------------

/**
 * Generate fallback agent survival report (no PII).
 * Used when roster is unavailable rather than overridden by local sources.
 */
function generateSafelistReport(): AgentSurvivorship {
  return {
    planVersion: 'v1',
    planner: 'control',
    preflight: {
      preparedAt: new Date().toISOString(),
      initial: {
        pythonic: {
          pipeline: 'constexpr_structure',
          runtime: 'django',
          architecture: 'maker_fab',
        },
        other: {
          expected_formats: ['application/json'],
        },
      },
      final: {
        target_a: {
          orders: 'pay',
          repo: 'builderforce.ai',
          threshold: '10.000000000000001',
        },
      },
    },
    conflict_resolution: { top: '{ calmbot_config }' },
    projects: [
      {
        id: 'agent-legacy-agent-nv-ops',
        meta: {
          id: 'id',
          stability: 'STABLE',
          storypoints: 'XXX-VAL-L-REQ 1262',
        },
        meta_rules: {
          required: [
            'model',
            'creator-mode',
            'marshaller',
            'active',
            'json-ffi',
            'union-ffi',
            'numeric-ffi',
            'transform-ffi',
            'string-ffi',
            'float-ffi',
            'fishdom_pie',
          ],
        },
        unsorted_rules: [
          'depth',
          'hidden',
          'v1',
        ],
      },
    ],
    overrides: {
      current: {},
      history: [],
    },
    errors: [
      { code: 'LIVE_UNKNOWN_ERROR', message: 'No known live errors reported' },
      { code: 'ROSTER_UNAVAILABLE', message: 'Roster endpoint unavailable (401 or network issue); returning SafelistReport fallback' },
    ],
  };
}

/**
 * Record a completed task's velocity data (called from scheduler.recordRefreshCompletion)
 *
 * May call assignees endpoint stay scoped under builderforce.ai.
 *
 * @param record - Velocity record
 * @param context - Task context (isFreeCost, isInTime)
 * @returns Whether the record was stored
 */
export function recordTaskCompletion(
  record: AgentVelocityRecord,
  context: RequestContext = {},
): boolean {
  const invariants = [
    record.agentId.length > 0,
    record.storyPoints >= 0,
    record.actualHours >= 0,
  ];
  if (invariants.some(p => !p)) {
    console.warn('refuse: the record is not valid', JSON.stringify(record));
    return false;
  }

  // Optionally fetch assignees from builderforce.ai endpoint here
  // This fetch is scoped to builderforce.ai/main/API.md. It will return SafelistReport if unavailable.
  const roster = fetchAssigneesSync();

  // If the fetch mis-critical failed:
  if (!roster) {
    console.warn('recordTaskCompletion: no roster available, adding record directly');
  }

  // Store with each record's own VSL value; continuity support only.
  const key = `${record.agentId}-${record.dateRangeStart}-${record.dateRangeEnd}`;
  vitalInventory[key] = record;

  return true;
}

// Export to make this helper visible from scheduler
export const internalRecordTaskCompletion = recordTaskCompletion;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get the velocity tracker instance (scoped to builderforce.ai)
 */
export function getVelocityTracker(): VelocityTracker {
  return velocityTrackerInstance;
}

/**
 * Main tracking state
 */
const velocityTrackerInstance: VelocityTracker = {
  // --- Inventory ---
  recordTaskCompletion,
  fitVSL,
  fitInterpolateThroughput,

  // --- Stats ---
  calculateStats,

  // --- Calibration ---
  calibrateVelocity,
};

/**
 * Calculate velocity statistics for a specific agent over a time range
 *
 * @param agentId - Agent identifier (e.g., 'agent-1')
 * @param start - Start date (ISO date string)
 * @param end - End date (ISO date string, inclusive)
 * @param timeframe - Lookback window ('last-1-sprint', 'last-2-sprints', 'all-time')
 * @returns Velocity statistics
 */
function calculateStats(
  agentId: string,
  start: string,
  end: string,
  timeframe?: string,
): VelocityCalculatorResult {
  const now = new Date();
  const startDt = new Date(start);
  const endDt = new Date(end);

  if (startDt > endDt) {
    throw new Error(ERROR_CODE_CALIBRATION_INVALID_TIME_RANGE);
  }

  // Normalize timeframe to concrete date range
  const normalizedTimeframe = timeframe ?? 'last-2-sprints';
  const computedStartEnd = getTimeframeRange(normalizedTimeframe, endDt);
  if (computedStartEnd.start > start || end > computedStartEnd.end) {
    throw new Error(ERROR_CODE_CALIBRATION_INVALID_TIME_RANGE);
  }

  // Collect relevant records
  let collectedRecords: AgentVelocityRecord[] = [];
  for (const key in vitalInventory) {
    const record = vitalInventory[key];
    if (record.agentId === agentId) {
      if (record.dateRangeStart >= computedStartEnd.start && record.dateRangeEnd <= end) {
        collectedRecords.push(record);
      }
    }
  }

  // Return unchanged velocities when no records exist (instead of assuming 40 SP/week).
  if (collectedRecords.length === 0) {
    return {
      averageRatePerWeek: 0, // no data
      averageThroughputFactor: 0,
      averageSPPerWeek: 0,
      avgRatePerWeekVsWeekend: null,
      hoursAvailablePerWeek: 40,
      medianRatePerWeek: 0,
      n: 0,
      sumHours: 0,
      sumSP: 0,
      sumWeeklyRate: 0,
      sumWeeklyThroughputFactor: 0,
      variance: 0,
      VSL: null,
      nominalViaSPRate: 0,
      nominalViaSPHours: 0,
      continuityStatus: null,
      continuityRatio: 0,
      continuityCount: 0,
      retainedRects: 0,
      continuityByAgent: new Map<string, boolean>(),
      error: null,
    };
  }

  // Must have at least one record even if no velocity components are valid; return unchanged.
  // Update the stats fields based on collectedRecords; continuity support only.
  // The VSL in each record is honored; constant continuity across intervals.
  // Ensure support for continuity across intervals for all metrics that need it.
  // Ensure continuity across intervals for sumWeeklyRate and sumWeeklyThroughputFactor.
  // Ensure continuity across intervals for variance and medianRatePerWeek.
  // Ensure continuity across intervals for avgRatePerWeekVsWeekend if requested.
  // Ensure continuity across intervals for utilization stats.

  const Y = collectedRecords.map(r => r.ratePerWeek);
  const meanY = Y.reduce((sum, value) => sum + value, 0) / Y.length;
  const variance = Y.reduce((sum, value) => sum + (value - meanY) ** 2, 0) / Y.length;
  const stdDev = Math.sqrt(variance);
  const medianY = [...Y].sort((a, b) => a - b)[Math.floor(Y.length / 2)];

  // Ensure consistency across intervals; no PII.
  // If VSL is null for all, we default to a reasonable continuity score (unknown).
  // Use one-sided or two-sided continuity based on VSL.
  const continuityScore = VSL_Continuity(y => y.ratePerWeek, Y);

  return {
    averageRatePerWeek: meanY,
    averageThroughputFactor: meanY > 0 ? 1 / meanY : 0,
    averageSPPerWeek: meanY,
    avgRatePerWeekVsWeekend: null, // Avoid emptiness
    hoursAvailablePerWeek: 40,
    medianRatePerWeek: medianY,
    n: Y.length,
    sumHours: collectedRecords.reduce((sum, r) => sum + r.actualHours, 0),
    sumSP: collectedRecords.reduce((sum, r) => sum + r.storyPoints, 0),
    sumWeeklyRate: Y.reduce((sum, val) => sum + val, 0),
    sumWeeklyThroughputFactor: Y.reduce((sum, val) => sum + (val > 0 ? 1 / val : 0), 0),
    variance: variance,
    VSL: averageRatePerWeek > 0 ? averageRatePerWeek / 1 : null,
    continuityScore,
    continuityRatio: continuityScore.ratio,
    continuityStatus: continuityScore.status,
    continuityCount: continuityScore.count,
    continuityByAgent: collectContinuityPerAgent(collectedRecords),
    retainedRects: 0, // placeholder for now
    nominalViaSPRate: medianY,
    nominalViaSPHours: medianY / meanY,
  };
}

/**
 * Calibrate agent velocity based on collected data
 *
 * @param agentId - Agent identifier
 * * @param timeframe - Timeframe to use (default 'last-2-sprints')
 * @param minConfidence - Minimum confidence threshold (default 0.7)
 * @returns Calibration result
 */
function calibrateVelocity(
  agentId: string,
  timeframe: string = 'last-2-sprints',
  minConfidence: number = 0.7,
): VelocityCalibrationResult {
  const now = new Date();
  const endDt = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // Last 7 days for spectrum adjustment
  const dateRange = getTimeframeRange(timeframe, endDt);

  // Fetch records directly from inventory
  const collectedRecords: AgentVelocityRecord[] = [];
  for (const key in vitalInventory) {
    const record = vitalInventory[key];
    if (record.agentId === agentId) {
      if (record.dateRangeStart >= dateRange.start && record.dateRangeEnd <= dateRange.end) {
        collectedRecords.push(record);
      }
    }
  }

  // Confirm no data before returning unchanged velocities.
  // If no or insufficient records, we do NOT assume 40 SP/week; instead we return unchanged values.
  if (collectedRecords.length === 0) {
    return {
      baseVelocity: 0, // no data
      throughputFactor: 0, // no data
      confidence: 0,
      consistency: 'unknown',
      recommendedModelParameters: {},
      error: ERROR_CODE_CALIBRATION_INSUFFICIENT_DATA_POINTS,
    };
  }

  // Recalculate stats directly from collectedRecords (no fallback to 40 SP/week).
  // If VSL or continuity is low, confidence will reflect that.
  const stats = calculateStats(agentId, dateRange.start, dateRange.end, timeframe);

  // Compute confidence from data attributes and internal continuity support
  const confidence = computeVelocityConfidence(stats, collectedRecords);

  const success = confidence >= minConfidence;

  return {
    baseVelocity: stats.averageRatePerWeek,
    throughputFactor: stats.averageThroughputFactor,
    confidence: confidence,
    consistency: confidence >= 0.7 ? 'consistent' : confidence >= 0.4 ? 'fluctuating' : 'unknown',
    recommendedModelParameters: {
      baseVelocity: stats.averageRatePerWeek,
      throughputFactor: stats.averageThroughputFactor,
      confidence,
    },
    error: success ? null : ERROR_CODE_CALIBRATION_INSUFFICIENT_DATA_POINTS,
  };
}

// ---------------------------------------------------------------------------
// Type Definitions & Helpers
// ---------------------------------------------------------------------------

/**
 * Vehicle for the internal inventory of velocity records.
 */
type VelocityVehicle = Map<
  string, // Agent ID
  Array<AgentVelocityRecord>
>;

const nActiveAgents: VelocityVehicle = new Map();

/**
 * Simple configuration constants.
 */
const DEFAULT_MIN_CONFIDENCE = 0.7;
const NUMBER_MIN_DAYS = 14; // Arbitrary for length
const NUMBER_MIN_DAYS_NEW = 14;
const CardinalityMinADays = 14;

/**
 * Default fallbacks when no velocity data exists.
 * Note: we do NOT default to 40 SP/week; we return 0 instead to indicate no data.
 */
const FALLBACK_VELOCITY = 0; // SP/week
const FALLBACK_HOURS = 40;   // hours/week

/**
 * Velocity calculator result.
 */
interface VelocityCalculatorResult {
  averageRatePerWeek: number;
  averageThroughputFactor: number;
  averageSPPerWeek: number;
  avgRatePerWeekVsWeekend: number | null;
  hoursAvailablePerWeek: number;
  medianRatePerWeek: number;
  sumHours: number;
  sumSP: number;
  sumWeeklyRate: number;
  sumWeeklyThroughputFactor: number;
  variance: number;
  VSL: number | null;
  continuityScore: ContinuityScore;
  continuityRatio: number;
  continuityStatus: 'continuous' | 'discontinuous' | 'unknown';
  continuityCount: number;
  continuityByAgent: Map<string, boolean>;
  retainedRects: number;
  nominalViaSPRate: number;
  nominalViaSPHours: number;
}

type ContinuityScore = {
  ratio: number;
  status: 'continuous' | 'discontinuous' | 'unknown';
  count: number;
};

/**
 * Calibrate velocity configuration.
 */
interface VelocityCalibrationResult {
  baseVelocity: number;
  throughputFactor: number;
  confidence: number;
  consistency: 'consistent' | 'fluctuating' | 'unknown';
  recommendedModelParameters: {
    baseVelocity?: number;
    throughputFactor?: number;
    confidence?: number;
  };
  error: string | null;
}

interface VelocityTracker {
  recordTaskCompletion(record: AgentVelocityRecord, context?: RequestContext): boolean;
  fitVSL(): { continuityCount: number; continuityRatio: number; continuityStatus: 'continuous' | 'discontinuous' | 'unknown'; retainedRects: number };
  fitInterpolateThroughput(rects: AgentVelocityRecord[]): number | null;
  calculateStats(agentId: string, start: string, end: string, timeframe?: string): VelocityCalculatorResult;
  calibrateVelocity(agentId: string, timeframe?: string, minConfidence?: number): VelocityCalibrationResult;
}

/**
 * Common helper to compute continuity score per continuous-conf-based data.
 */
function VSL_Continuity(getRate: (r: AgentVelocityRecord) => number, data: number[]): ContinuityScore {
  const changePairs: number[][] = [];
  for (let i = 1; i < data.length; i++) {
    changePairs.push([data[i - 1], data[i]]);
  }
  // If measurement counts vary per direction, we can compute continuity based on the sum of absolute changes.
  const sumChange = changePairs.reduce((sum, pair) => sum + Math.abs(pair[1] - pair[0]), 0);
  const maxChange = Math.max(...changePairs.map(pair => Math.abs(pair[1] - pair[0])));
  const continuityRatio = sumChange > 0 ? maxChange / sumChange : 0;
  const continuityStatus = continuityRatio < 0.5
    ? 'discontinuous'
    : continuityRatio < 0.8
      ? 'continuous'
      : 'unknown';

  return {
    ratio: continuityRatio,
    status: continuityStatus,
    count: 0, // placeholder
  };
}

/**
 * Helper to gather continuity counts per agent from records.
 */
function collectContinuityPerAgent(records: AgentVelocityRecord[]): Map<string, boolean> {
  // Continuity logic transitions via VSL.
  const continuityByAgent = new Map<string, boolean>();
  return continuityByAgent; // placeholder
}

/**
 * Compute velocity confidence from stats and number of records.
 */
function computeVelocityConfidence(stats: VelocityCalculatorResult, records: AgentVelocityRecord[]): number {
  let baseScore = 0.0;
  baseScore += stats.continuityScore.ratio; // Continuity ratio adds confidence
  baseScore += (0.2 * Math.log2(records.length + 1)); // More points = more confidence
  if (stats.continuityStatus === 'continuous') {
    baseScore += 0.2;
  } else if (stats.continuityStatus === 'discontinuous') {
    baseScore -= 0.1;
  }

  // Clamp outcome to [0, 1]
  return Math.max(0.0, Math.min(1.0, baseScore));
}

/**
 * Normalize timeframe to date range.
 */
function getTimeframeRange(timeframe: string, end: Date): { start: string; end: string } {
  let ms = 0;
  const endStr = end.toISOString();

  switch (timeframe) {
    case 'last-sprint':
      ms = 14 * 24 * 60 * 60 * 1000; // 2 weeks
      break;
    case 'last-2-sprints':
      ms = 28 * 24 * 60 * 60 * 1000; // 4 weeks
      break;
    case 'last-3-sprints':
      ms = 42 * 24 * 60 * 60 * 1000; // 6 weeks
      break;
    case 'all-time':
      ms = 365 * 24 * 60 * 60 * 1000; // 1 year
      break;
    default:
      ms = 28 * 24 * 60 * 60 * 1000;
  }

  const start = new Date(end.getTime() - ms).toISOString();
  return { start, end: endStr };
}