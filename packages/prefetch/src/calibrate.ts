/**
 * Per-action calibration: the tier-2 logistic head (`σ(w·x + b)`, the same binary family
 * as `difficulty-router/head.ts`), its ONLINE update from each outcome, and the answer /
 * prefetch thresholds derived from logged outcomes.
 *
 * Not `difficulty-router`'s head itself: that one is batch-fitted by an injected trainer
 * over its own feature contract, while this one learns one outcome at a time on the
 * device. The family (and the cold-start rule — conservative until evidence) is shared.
 *
 * Every function returns a NEW state; nothing here mutates its input. Pure.
 */

import { LEXICAL_FEATURES } from './lexical.js';
import type { ActionHead, ActionThreshold, CalibrationState, GateOutcome, LoggedOutcome } from './types.js';

/** Cold-start thresholds — the floors a threshold never drops below before {@link MIN_CALIBRATION_N}. */
export const COLD_START = Object.freeze({ answer: 0.9, prefetch: 0.6 });
/** Logged outcomes an action needs before its threshold may drop below the cold floor. */
export const MIN_CALIBRATION_N = 30;
/** Precision a threshold must hold above it: an answer replaces the model, so it is stricter. */
export const TARGET_PRECISION = Object.freeze({ answer: 0.95, prefetch: 0.8 });
/** Absolute bounds: no evidence lowers a threshold past these, and a failing action is parked at the cap. */
const BOUNDS = Object.freeze({ answer: { min: 0.5, cap: 0.99 }, prefetch: { min: 0.3, cap: 0.95 } });
/** Outcomes at or above a candidate threshold needed before it can be chosen. */
const MIN_SUPPORT = 5;
/** Outcomes kept per action. */
const MAX_LOGGED = 200;
const LEARNING_RATE = 0.1;
const STATE_VERSION = 1;

/**
 * The untrained head: a near-copy of an example (best similarity ~1) scores ≈ 0.99, a
 * request sharing half its words with the closest example ≈ 0.45 — nothing decides on
 * vague overlap until outcomes say it may.
 */
export const COLD_HEAD: Readonly<ActionHead> = Object.freeze({ weights: [6, 2, 2], bias: -5, n: 0 });

export function emptyCalibration(): CalibrationState {
  return { heads: {}, thresholds: {}, outcomes: {} };
}

export function headOf(state: CalibrationState | undefined, id: string): ActionHead {
  const head = state?.heads[id];
  return head && head.weights.length === LEXICAL_FEATURES ? head : COLD_HEAD;
}

export function thresholdOf(state: CalibrationState | undefined, id: string): ActionThreshold {
  return state?.thresholds[id] ?? { answer: COLD_START.answer, prefetch: COLD_START.prefetch, n: 0 };
}

function sigmoid(z: number): number {
  if (z >= 0) return 1 / (1 + Math.exp(-z));
  const e = Math.exp(z);
  return e / (1 + e);
}

/** P(the action settles this request) from its head. 0 for features of the wrong shape. */
export function predict(head: ActionHead, features: readonly number[]): number {
  if (features.length !== head.weights.length) return 0;
  let z = head.bias;
  for (let i = 0; i < features.length; i++) z += head.weights[i]! * features[i]!;
  return sigmoid(z);
}

/**
 * One outcome folded in: an SGD step on the action's head (when the outcome carries
 * tier-2 features), the outcome logged (tier 2/3 only — a slash or rule match is p = 1
 * and says nothing about where a threshold belongs), and that action's threshold redone.
 */
export function updateHead(state: CalibrationState, outcome: GateOutcome): CalibrationState {
  const id = outcome.actionId;
  const heads = { ...state.heads };
  if (outcome.features.length === LEXICAL_FEATURES) {
    const head = headOf(state, id);
    const err = (outcome.accepted ? 1 : 0) - predict(head, outcome.features);
    heads[id] = {
      weights: head.weights.map((w, i) => w + LEARNING_RATE * err * outcome.features[i]!),
      bias: head.bias + LEARNING_RATE * err,
      n: head.n + 1,
    };
  }
  const outcomes = { ...(state.outcomes ?? {}) };
  if (outcome.tier !== 1 && outcome.route !== 'llm') {
    const entry: LoggedOutcome = [outcome.p, outcome.accepted ? 1 : 0, outcome.route];
    outcomes[id] = [...(outcomes[id] ?? []), entry].slice(-MAX_LOGGED);
  }
  const next: CalibrationState = { heads, thresholds: { ...state.thresholds }, outcomes };
  next.thresholds[id] = thresholdFrom(outcomes[id] ?? []);
  return next;
}

/** The lowest p above which the logged outcomes hold `target` precision (with support), else undefined. */
function lowestPrecise(log: readonly LoggedOutcome[], target: number): number | undefined {
  const sorted = [...log].sort((a, b) => b[0] - a[0]);
  let accepted = 0;
  let best: number | undefined;
  for (let i = 0; i < sorted.length; i++) {
    accepted += sorted[i]![1];
    const boundary = i === sorted.length - 1 || sorted[i + 1]![0] !== sorted[i]![0];
    if (boundary && i + 1 >= MIN_SUPPORT && accepted / (i + 1) >= target) best = sorted[i]![0];
  }
  return best;
}

function routeThreshold(log: readonly LoggedOutcome[], route: 'answer' | 'prefetch'): number {
  const mine = log.filter((o) => o[2] === route);
  const floor = COLD_START[route];
  if (mine.length < MIN_SUPPORT) return floor;
  const { min, cap } = BOUNDS[route];
  const precise = lowestPrecise(mine, TARGET_PRECISION[route]);
  // Enough evidence and none of it precise: park the action until it earns its way back.
  if (precise === undefined) return cap;
  const lower = mine.length >= MIN_CALIBRATION_N ? min : floor;
  return Math.min(cap, Math.max(lower, precise));
}

function thresholdFrom(log: readonly LoggedOutcome[]): ActionThreshold {
  return { answer: routeThreshold(log, 'answer'), prefetch: routeThreshold(log, 'prefetch'), n: log.length };
}

/** Every action's thresholds redone from its logged outcomes. */
export function recalibrate(state: CalibrationState): CalibrationState {
  const thresholds: Record<string, ActionThreshold> = {};
  for (const [id, log] of Object.entries(state.outcomes ?? {})) thresholds[id] = thresholdFrom(log);
  return { heads: { ...state.heads }, thresholds, outcomes: { ...(state.outcomes ?? {}) } };
}

export function serializeCalibration(state: CalibrationState): string {
  return JSON.stringify({ v: STATE_VERSION, ...state });
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** A stored state, validated row by row; an unreadable value (or another version) is a cold start. */
export function deserializeCalibration(raw: unknown): CalibrationState {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try { value = JSON.parse(raw); } catch { return emptyCalibration(); }
  }
  const s = value as { v?: unknown; heads?: unknown; outcomes?: unknown } | null;
  if (!s || typeof s !== 'object' || s.v !== STATE_VERSION) return emptyCalibration();
  const heads: Record<string, ActionHead> = {};
  for (const [id, h] of Object.entries((s.heads ?? {}) as Record<string, Partial<ActionHead>>)) {
    if (Array.isArray(h?.weights) && h.weights.length === LEXICAL_FEATURES && h.weights.every(finite) && finite(h.bias) && finite(h.n)) {
      heads[id] = { weights: [...h.weights], bias: h.bias, n: h.n };
    }
  }
  const outcomes: Record<string, LoggedOutcome[]> = {};
  for (const [id, log] of Object.entries((s.outcomes ?? {}) as Record<string, unknown>)) {
    if (!Array.isArray(log)) continue;
    outcomes[id] = log.filter((o): o is LoggedOutcome =>
      Array.isArray(o) && finite(o[0]) && (o[1] === 0 || o[1] === 1) && (o[2] === 'answer' || o[2] === 'prefetch')).slice(-MAX_LOGGED);
  }
  // Thresholds are derived, never trusted from storage: a stored value is recomputed.
  return recalibrate({ heads, thresholds: {}, outcomes });
}
