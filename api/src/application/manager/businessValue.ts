/**
 * businessValue — the AI Manager's PURE business-value scoring core.
 *
 * "If a ticket is missing business value then we should add it." A ticket's value
 * is a 0-100 score with a one-line rationale. Two derivations, both routed through
 * the same normalization so the number means the same thing everywhere:
 *   • RICE-informed AI score — the manager asks the model for RICE components
 *     (reach / impact / confidence / effort) + a rationale; {@link deriveRiceScore}
 *     folds them into 0-100. This is the default backfill (source 'ai').
 *   • Deterministic heuristic — when the model is unavailable, derive a defensible
 *     score from the signals a ticket already carries (priority, story points, due
 *     date) so backfill ALWAYS completes and the sweep never hangs on the LLM.
 *
 * All functions here are pure (no IO, no clock unless injected) so the scoring math
 * is unit-tested without a live model. The service layer owns the LLM call + the DB
 * write; this module owns the prompt, the parse, and the math.
 */
import type { RankableTask, TaskPriorityTier } from './prioritize';

/** RICE components on the bounded, relative scales the manager prompt constrains. */
export interface RiceComponents {
  /** Relative reach, 1-10 (how many users / how often). */
  reach: number;
  /** Impact per user, 1-5 (massive→minimal). */
  impact: number;
  /** Confidence in the estimate, 0-1. */
  confidence: number;
  /** Relative effort, 1-10 (bigger = costlier). Floored at 1 to avoid divide-by-zero. */
  effort: number;
}

export interface ScoredValue {
  /** 0-100 business value. */
  score: number;
  /** One-line human-readable justification. */
  rationale: string;
  /** How it was derived:
   *   • 'rice'      — folded from a matching PMO {@link featureScores} row (a human's
   *                   deliberate RICE estimate; highest-trust non-manual source).
   *   • 'ai'        — RICE-informed model score (the LLM valued the ticket).
   *   • 'heuristic' — deterministic fallback from the signals a ticket already carries
   *                   (priority / points / due-date) when neither of the above applies.
   *   • 'manual'    — a human pinned the number on the board; the manager never
   *                   overwrites it. */
  source: 'ai' | 'rice' | 'heuristic' | 'manual';
}

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

/**
 * Fold RICE components into a bounded 0-100 score. Classic RICE is
 * (Reach × Impact × Confidence) / Effort; on the constrained scales above the raw
 * value ranges 0..50 (10×5×1÷1), so we normalize by 50 and clamp. Deterministic.
 */
export function deriveRiceScore(c: RiceComponents): number {
  const reach = clamp(Number(c.reach) || 0, 0, 10);
  const impact = clamp(Number(c.impact) || 0, 0, 5);
  const confidence = clamp(Number(c.confidence) || 0, 0, 1);
  const effort = Math.max(1, clamp(Number(c.effort) || 1, 1, 10));
  const raw = (reach * impact * confidence) / effort; // 0..50
  return clamp(Math.round((raw / 50) * 100), 0, 100);
}

const PRIORITY_BASE: Record<TaskPriorityTier, number> = {
  urgent: 85,
  high: 65,
  medium: 45,
  low: 25,
};

const DAY_MS = 86_400_000;

/**
 * Deterministic fallback value from the signals a ticket already carries. Anchored
 * on priority, nudged up for small/cheap tickets and imminent due dates, down for
 * large ones. Never the primary path — a safety net so every ticket gets a number.
 */
export function heuristicBusinessValue(task: RankableTask, now: number, storyPoints: number | null): ScoredValue {
  let score = PRIORITY_BASE[task.priority] ?? PRIORITY_BASE.medium;

  // Cheaper work is higher value-per-effort; expensive work slightly lower.
  if (storyPoints != null) {
    if (storyPoints <= 2) score += 6;
    else if (storyPoints >= 8) score -= 8;
  }

  // Imminent / overdue due dates lift value (getting it done matters more).
  const due = task.dueDate instanceof Date ? task.dueDate.getTime()
    : task.dueDate ? Date.parse(task.dueDate) : null;
  if (due != null && Number.isFinite(due)) {
    const daysUntil = (due - now) / DAY_MS;
    if (daysUntil <= 0) score += 10;
    else if (daysUntil <= 7) score += 5;
  }

  return {
    score: clamp(Math.round(score), 0, 100),
    rationale: `Derived from ${task.priority} priority${storyPoints != null ? `, ${storyPoints}pt effort` : ''}${due != null ? ', due-date urgency' : ''}.`,
    source: 'heuristic',
  };
}

/** A PMO feature-score row the manager can fold into a ticket's value (source 'rice'). */
export interface FeatureScoreRow {
  name: string;
  reach: number | null;
  impact: number | null;
  confidence: number | null;
  effort: number | null;
  /** The PMO's precomputed RICE score, if the row carries one. */
  score: number | null;
}

/** Normalize a free-text feature/ticket name for loose matching (case/space/punct-insensitive). */
export function normalizeFeatureName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Fold a matching PMO {@link featureScores} row into a 0-100 business value, relative
 * to the project's own score distribution (so the numbers are comparable across a
 * project without assuming any absolute RICE scale). `projectMaxScore` is the largest
 * `score` among the project's feature rows; when it is 0/absent we fall back to the
 * bounded {@link deriveRiceScore} fold of the raw components. Source is always 'rice'.
 */
export function riceBusinessValueFromFeature(row: FeatureScoreRow, projectMaxScore: number): ScoredValue {
  let score0to100: number;
  if (row.score != null && Number.isFinite(row.score) && projectMaxScore > 0) {
    score0to100 = clamp(Math.round((Math.max(0, row.score) / projectMaxScore) * 100), 0, 100);
  } else {
    score0to100 = deriveRiceScore({
      reach: row.reach ?? 0, impact: row.impact ?? 0,
      confidence: row.confidence ?? 0, effort: row.effort ?? 1,
    });
  }
  const parts = [
    row.reach != null ? `R${row.reach}` : null,
    row.impact != null ? `I${row.impact}` : null,
    row.confidence != null ? `C${row.confidence}` : null,
    row.effort != null ? `E${row.effort}` : null,
  ].filter(Boolean).join('·');
  return {
    score: score0to100,
    rationale: `From PMO RICE score "${row.name.slice(0, 60)}"${parts ? ` (${parts})` : ''}.`,
    source: 'rice',
  };
}

/**
 * The prompt the manager sends the model to value ONE ticket. Constrains the RICE
 * scales so {@link deriveRiceScore} stays bounded, and forces a compact JSON reply
 * so {@link parseValueResponse} can read it without free-text ambiguity.
 */
export function buildValuePrompt(input: { title: string; description?: string | null; priority: string }): string {
  return [
    'You are a delivery manager scoring the BUSINESS VALUE of a backlog ticket.',
    'Estimate its RICE components on these scales and reply with ONLY compact JSON:',
    '{"reach":1-10,"impact":1-5,"confidence":0-1,"effort":1-10,"rationale":"<=12 words"}',
    '- reach: how many users / how often (1=few, 10=all/constant)',
    '- impact: value per user (1=minimal, 3=high, 5=massive)',
    '- confidence: how sure you are (0=guess, 1=certain)',
    '- effort: relative cost to build (1=trivial, 10=huge)',
    '',
    `Title: ${input.title}`,
    input.description ? `Description: ${String(input.description).slice(0, 800)}` : 'Description: (none)',
    `Current priority: ${input.priority}`,
    '',
    'JSON:',
  ].join('\n');
}

/**
 * Parse the model's JSON reply into a scored value. Tolerant of code fences and
 * surrounding prose (extracts the first `{...}` block). Returns null when no usable
 * JSON with the RICE keys is present, so the caller falls back to the heuristic.
 */
export function parseValueResponse(raw: string): ScoredValue | null {
  if (!raw) return null;
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
  const num = (v: unknown): number | null => {
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
    return Number.isFinite(n) ? n : null;
  };
  const reach = num(obj.reach);
  const impact = num(obj.impact);
  const confidence = num(obj.confidence);
  const effort = num(obj.effort);
  if (reach == null || impact == null || confidence == null || effort == null) return null;

  const score = deriveRiceScore({ reach, impact, confidence, effort });
  const rationale = typeof obj.rationale === 'string' && obj.rationale.trim()
    ? obj.rationale.trim().slice(0, 160)
    : `RICE-scored (R${reach}·I${impact}·C${confidence}÷E${effort}).`;
  return { score, rationale, source: 'ai' };
}
