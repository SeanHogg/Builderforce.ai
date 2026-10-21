/**
 * evermindMlHeads — the writer's half of FEDERATED ML HEADS: catalog-task heads (today
 * `run.local-success`, Hybrid's local-success predictor) that hosts train on their own
 * turns and send to the project coordinator as head deltas on the existing delta wire
 * (`target: 'ml:<task>'`). Operator decision 2026-10-20 (the engine's
 * `docs/ml-task-catalog.md` §6): the merge is the engine's eval-gated FedAvg,
 * `mergeMlHeadDeltas`, which fails CLOSED (`requireEval` true).
 *
 * A REGISTRY, not a branch: {@link mlHeadDoors} maps a delta target to what only its
 * head knows — its never-merged starting point, how its held-out rows look, and how a
 * candidate is scored. The LM door is untouched: an LM delta still parses with no target
 * (`parseDeltaLearnPayload` refuses any `ml:` target there) and merges through
 * `gateEvermindMerge`; a head delta never reaches it.
 *
 * THE EVAL SET. The writer holds no turns of its own, so a contribution carries the
 * held-out tail its producer measured (engine-scaled feature rows — counts and ratios,
 * no text). The writer keeps a rolling POOL of those rows per head; a round is scored on
 * the pool plus the round's own rows, so the first round is scorable and every later one
 * answers to what the rest of the fleet saw. A round whose loss rises is refused with
 * the delta door's own refusal shape (`mergeRegressionRefusal`).
 *
 * Pure — storage, batching and the HTTP edge are the coordinator's
 * (`infrastructure/relay/evermindMlHeadStore.ts`).
 */
import {
  LOCAL_SUCCESS_FEATURES,
  LOCAL_SUCCESS_TASK,
  LogisticModel,
  engineKey,
  mergeMlHeadDeltas,
  mlEvalLoss,
  mlHeadEntry,
  mlHeadParams,
  mlHeadTarget,
  parseDeltaLearnPayload,
  type DeltaLearnPayload,
  type EvermindMlHead,
  type MlSample,
  type MlTask,
} from '@seanhogg/builderforce-memory-engine';
import { deltaParseRefusal, mergeRegressionRefusal, type DeltaRefusal } from './evermindDeltaLearn';

/**
 * Held-out rows kept from ONE contribution (its newest), and in a head's rolling eval pool.
 * Bounded so a head's whole state — pool plus a full pending batch — stays well inside a
 * Durable Object storage value (128 KiB): a row is nine floats and a label.
 */
export const ML_HEAD_HOLDOUT_MAX = 32;
export const ML_HEAD_EVAL_POOL_MAX = 256;

/** One held-out row as sent and stored: scaled features, class index, label weight. */
export interface MlHeadEvalRow {
  x: number[];
  y: number;
  w?: number;
}

/** What only one federated head knows. */
export interface MlHeadDoor {
  /** The delta target it answers (`ml:<task>`). */
  target: string;
  /** The never-merged head — version 0, every parameter zero. */
  initial(): EvermindMlHead;
  /** A contribution's held-out rows, validated (bad rows dropped, newest {@link ML_HEAD_HOLDOUT_MAX} kept). */
  holdout(raw: unknown): MlHeadEvalRow[];
  /** Held-out loss of `params` on `rows`; null when unscorable (no rows). */
  score(params: ArrayLike<number>, rows: readonly MlHeadEvalRow[]): number | null;
}

/** A door for a classify task fitted by the classical logistic engine. */
function logisticDoor<I, O>(task: MlTask<I, O>, dim: number): MlHeadDoor {
  const classes = task.output.labels!.length;
  const engine = engineKey(task.engines[0]!);
  const rowOk = (r: unknown): r is MlHeadEvalRow => {
    if (!r || typeof r !== 'object') return false;
    const { x, y, w } = r as Record<string, unknown>;
    return Array.isArray(x) && x.length === dim && x.every((v) => typeof v === 'number' && Number.isFinite(v))
      && typeof y === 'number' && Number.isInteger(y) && y >= 0 && y < classes
      && (w === undefined || (typeof w === 'number' && Number.isFinite(w) && w > 0));
  };
  return {
    target: mlHeadTarget(task.id),
    initial: () => mlHeadEntry(task.id, engine, 0, new Float32Array(dim * classes + classes), { dim, classes }),
    holdout: (raw) => (Array.isArray(raw) ? raw.filter(rowOk).slice(-ML_HEAD_HOLDOUT_MAX).map((r) => ({ x: r.x, y: r.y, ...(r.w !== undefined ? { w: r.w } : {}) })) : []),
    score(params, rows) {
      const model = new LogisticModel(dim, classes);
      model.importParams(params);
      const samples: MlSample[] = rows.map((r) => ({ x: Float32Array.from(r.x), y: r.y, ...(r.w !== undefined ? { weight: r.w } : {}) }));
      return mlEvalLoss(task.kind, model, samples);
    },
  };
}

let doors: ReadonlyMap<string, MlHeadDoor> | undefined;

/**
 * Every federated head, by its delta target. Adding a head is one row. Built on first
 * use, so importing the coordinator costs nothing until a head is touched.
 */
export function mlHeadDoors(): ReadonlyMap<string, MlHeadDoor> {
  return (doors ??= new Map([logisticDoor(LOCAL_SUCCESS_TASK, LOCAL_SUCCESS_FEATURES.length)].map((door) => [door.target, door])));
}

/** The door for a body's `target`, or undefined when it names no federated head (the LM door's, then). */
export function mlHeadDoorFor(target: unknown): MlHeadDoor | undefined {
  return typeof target === 'string' ? mlHeadDoors().get(target) : undefined;
}

/** A parsed head contribution: the delta-wire payload plus its held-out rows. */
export interface MlHeadContribution {
  payload: DeltaLearnPayload;
  holdout: MlHeadEvalRow[];
}

/**
 * Parse a head contribution at `door`: the engine's delta contract with the door's target
 * (a body aimed elsewhere is refused there, in the delta door's refusal shape), plus at
 * least one held-out row — a contribution the gate could not score is refused up front.
 */
export function parseMlHeadContribution(raw: unknown, door: MlHeadDoor): { ok: true; contribution: MlHeadContribution } | { ok: false; refusal: DeltaRefusal } {
  const parsed = parseDeltaLearnPayload(raw, { target: door.target });
  if (!parsed.ok) return { ok: false, refusal: deltaParseRefusal(parsed) };
  const holdout = door.holdout((raw as { holdout?: unknown } | null)?.holdout);
  if (holdout.length === 0) {
    return { ok: false, refusal: { status: 400, body: { ok: false, error: `holdout (held-out rows for ${door.target}'s merge gate) is required` } } };
  }
  return { ok: true, contribution: { payload: parsed.payload, holdout } };
}

/** One merge round's result. */
export interface MlHeadRound {
  /** The head after the round: version + 1 when accepted, unchanged when refused. */
  head: EvermindMlHead;
  accepted: boolean;
  /** Why the round was refused, in the delta door's refusal shape. */
  refusal?: DeltaRefusal;
  /** Contributions left out by the engine (wrong target, stale base, malformed diff). */
  rejected: { index: number; reason: string }[];
  /** The eval pool after the round — the round's rows joined, accepted or not. */
  pool: MlHeadEvalRow[];
}

/**
 * FedAvg `contributions` onto `head` through the engine's `mergeMlHeadDeltas`, scored on
 * `pool` plus the round's own held-out rows; a round whose loss rises (or that nothing
 * could score) is refused and the head stays where it was.
 */
export function mergeMlHeadRound(
  door: MlHeadDoor,
  head: EvermindMlHead,
  contributions: readonly MlHeadContribution[],
  pool: readonly MlHeadEvalRow[],
): MlHeadRound {
  const fresh = contributions.flatMap((c) => c.holdout);
  const evalSet = [...pool, ...fresh];
  const outcome = mergeMlHeadDeltas(head, contributions.map((c) => c.payload), (params) => door.score(params, evalSet));
  const nextPool = evalSet.slice(-ML_HEAD_EVAL_POOL_MAX);
  if (outcome.merge.accepted) return { head: outcome.head, accepted: true, rejected: outcome.rejected, pool: nextPool };
  const refusal: DeltaRefusal = outcome.merge.refusedReason === 'nothing-merged'
    ? { status: 400, body: { ok: false, error: 'no contribution in the round was usable', rejected: outcome.rejected } }
    : mergeRegressionRefusal(outcome.merge);
  return { head, accepted: false, refusal, rejected: outcome.rejected, pool: nextPool };
}

/** A head as the read serves it: flat parameters, never base64 (null before the first merge). */
export interface MlHeadView {
  target: string;
  version: number;
  params: number[] | null;
  evalLoss: number | null;
}

export function mlHeadView(door: MlHeadDoor, head: EvermindMlHead): MlHeadView {
  return {
    target: door.target,
    version: head.version,
    params: head.version > 0 ? Array.from(mlHeadParams(head)) : null,
    evalLoss: head.evalLoss ?? null,
  };
}
