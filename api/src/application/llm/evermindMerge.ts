/**
 * Evermind weight-delta MERGE — the conflict resolver for concurrent learning.
 *
 * Many agents adapt their LOCAL replica of the same project model (the same base
 * version) and each pushes a row-sparse weight delta (produced by the engine's
 * `diffCheckpoints(base, adapted)`). The ProjectEvermindCoordinator folds N such
 * deltas into one canonical update here, then republishes.
 *
 * Merge policy = **FedAvg over contributors** (federated averaging): each delta
 * stores the contributor's ABSOLUTE new values for the rows it touched, so the
 * merged value for an element is the (optionally sample-weighted) MEAN of the
 * contributors that touched it. Rows only one agent touched take that agent's
 * value; rows several agents touched are averaged — the standard, drift-free way
 * to combine independent local updates. Non-touchers do NOT vote the base value
 * back in (a lone real update is kept, not diluted toward base).
 *
 * Pure, GPU-free, deterministic (no Date.now/random) and unit-tested — the math
 * lives here, isolated from the Durable Object's R2/orchestration concerns.
 */
import {
  deserializeRowDelta,
  serializeRowDelta,
  applyCheckpointDiff,
  verifyCrcTrailer,
  type RowDelta,
} from '@seanhogg/builderforce-memory-engine';

export interface MergeResult {
  /** The new canonical checkpoint (base + merged delta), ready to repackage. */
  checkpoint: ArrayBuffer;
  /** How many distinct rows the merged delta touches (telemetry). */
  mergedRows: number;
  /** How many contributor deltas were folded in. */
  contributors: number;
  /** L2 norm of the ACTUAL weight movement base→merged (Σ(merged−base)²)^½ — an
   *  honest "how far the neocortex weights moved this merge" magnitude. 0 when the
   *  merge touched nothing. Telemetry for the Knowledge Map's training readout. */
  deltaNorm: number;
}

/** Per-element weighted accumulator while merging. */
interface Acc {
  /** Σ wᵢ·valueᵢ for this element. */
  sum: number;
  /** Σ wᵢ for this element. */
  weight: number;
}

/**
 * Fold contributor weight-deltas (each a serialized RowDelta vs the SAME base)
 * into one merged checkpoint by FedAvg-over-contributors.
 *
 * @param baseCheckpoint  the canonical EVL0 checkpoint the deltas were diffed against
 * @param diffs           serialized RowDelta buffers (from `diffCheckpoints`)
 * @param weights         optional per-diff sample weights (default 1 each = plain mean)
 */
export function mergeCheckpointDiffs(
  baseCheckpoint: ArrayBuffer,
  diffs: ArrayBuffer[],
  weights?: number[],
): MergeResult {
  if (diffs.length === 0) {
    return { checkpoint: baseCheckpoint, mergedRows: 0, contributors: 0, deltaNorm: 0 };
  }
  if (weights && weights.length !== diffs.length) {
    throw new Error(`mergeCheckpointDiffs: weights length ${weights.length} != diffs length ${diffs.length}`);
  }

  const parsed: RowDelta[] = diffs.map((d) => deserializeRowDelta(d));
  // `diffCheckpoints` always emits element-granular (rowSize 1) deltas, which is
  // what makes element-wise FedAvg exact: every "row" is a single weight, so a
  // partially-overlapping merge can never leave an untouched column zeroed.
  for (const rd of parsed) {
    if (rd.rowSize !== 1) {
      throw new Error(`mergeCheckpointDiffs: expected element-granular deltas (rowSize 1), got ${rd.rowSize}`);
    }
  }

  // Accumulate per element index → weighted mean across the contributors that
  // touched it (FedAvg-over-contributors).
  const acc = new Map<number, Acc>();
  parsed.forEach((rd, k) => {
    const w = weights ? weights[k]! : 1;
    if (!(w > 0)) return; // a zero/negative-weight contributor is ignored
    rd.rows.forEach((idx, i) => {
      const value = rd.data[i]!;
      const prev = acc.get(idx);
      if (prev) { prev.sum += w * value; prev.weight += w; }
      else { acc.set(idx, { sum: w * value, weight: w }); }
    });
  });

  if (acc.size === 0) {
    return { checkpoint: baseCheckpoint, mergedRows: 0, contributors: parsed.length, deltaNorm: 0 };
  }

  const rows = [...acc.keys()].sort((a, b) => a - b);
  const data = new Float32Array(rows.length);
  rows.forEach((idx, i) => {
    const a = acc.get(idx)!;
    data[i] = a.sum / a.weight;
  });

  // Honest weight-movement magnitude: the merged delta stores ABSOLUTE new values,
  // so the actual movement is (merged − base) at each touched element. The base body
  // (trailer stripped) is the same f32 vector the merge indexes into.
  const baseBody = new Float32Array(verifyCrcTrailer(baseCheckpoint).body);
  let sumSq = 0;
  rows.forEach((idx, i) => {
    const moved = data[i]! - (baseBody[idx] ?? 0);
    sumSq += moved * moved;
  });
  const deltaNorm = Math.sqrt(sumSq);

  const merged: RowDelta = { rowSize: 1, rows, data };
  const checkpoint = applyCheckpointDiff(baseCheckpoint, serializeRowDelta(merged));
  return { checkpoint, mergedRows: rows.length, contributors: parsed.length, deltaNorm };
}
