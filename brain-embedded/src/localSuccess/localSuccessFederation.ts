/**
 * The `run.local-success` head FEDERATES: each signed-in Hybrid host trains its head on
 * its own routed turns (`localSuccessRouter.ts`), sends what a refit learned to its
 * project's Evermind coordinator as a head delta, and starts from the fleet's merged
 * head instead of a cold start. Operator decision (2026-10-20, the engine's
 * `docs/ml-task-catalog.md` §6): heads ride the EXISTING delta wire
 * (`target: ml:run.local-success`) and merge by the engine's eval-gated FedAvg
 * (`mergeMlHeadDeltas`) — no second wire, no second merge.
 *
 * This module is the client half's ONE port ({@link LocalSuccessFederation}, injected
 * alongside the `LocalSuccessStore` through `createHostModelStream`), the shared HTTP
 * adapter every host builds it from ({@link createLocalSuccessFederation} over the
 * host's own authed JSON request), and the pure rules the router applies:
 *
 *  - WHO sends: only a turn that may federate — Hybrid, signed in, with a project
 *    (`localSuccessScope`). Anonymous, Local only and Specific never reach the port.
 *  - WHEN (the throttle): a refit whose held-out loss improved on the previous head and
 *    beats a coin, at least {@link FEDERATE_MIN_NEW_OUTCOMES} new outcomes AND
 *    {@link FEDERATE_MIN_INTERVAL_MS} after the last push. The head is 20 floats, so the
 *    bound is about the coordinator's merge rate, not bandwidth: one push per device per
 *    hour at most, and only once a meaningful slice of new evidence arrived.
 *  - WHAT: the diff of the trained head against the fleet head it was warm-started
 *    from (`buildMlHeadDelta`), weighted by its sample count, plus its held-out tail as
 *    scaled feature rows — the coordinator's merge gate scores candidates on those
 *    (the turn features are counts and ratios; no text ever leaves the device).
 *  - ADOPTION: a pulled fleet head becomes the base every refit warm-starts from, and
 *    REPLACES the serving head when the local one is cold, untrusted, or worse.
 *
 * Fire-and-forget throughout: a push or pull that fails never affects a turn.
 */

import {
  LOCAL_SUCCESS_FEATURES,
  LOCAL_SUCCESS_TASK,
  buildMlHeadDelta,
  engineKey,
  localSuccessFeatures,
  mlHeadEntry,
  mlHeadTarget,
  type DeltaLearnPayload,
  type LocalTurnFeatures,
  type MlTrainExample,
} from '@seanhogg/builderforce-memory-engine';
import type { ProjectMemoryRequest } from '../evermindMemory';
import { reportLocalSuccessFailure } from './localSuccessFailure';

type MaybePromise<T> = T | Promise<T>;

/** The delta-wire target of this head (`ml:run.local-success`). */
export const LOCAL_SUCCESS_TARGET = mlHeadTarget(LOCAL_SUCCESS_TASK.id);
/** New outcomes since the last push before another may go. */
export const FEDERATE_MIN_NEW_OUTCOMES = 20;
/** Minimum time between two pushes from one device. */
export const FEDERATE_MIN_INTERVAL_MS = 60 * 60 * 1000;
/** How long a pulled fleet head is current before the next federated turn re-pulls it. */
export const FLEET_REFRESH_MS = 60 * 60 * 1000;
/** Held-out rows sent with one contribution (the newest of the tail) — the coordinator keeps at most this many. */
export const FEDERATE_HOLDOUT_MAX = 32;

const DIM = LOCAL_SUCCESS_FEATURES.length;
const CLASSES = LOCAL_SUCCESS_TASK.output.labels!.length;
/** Flat parameter count of the logistic head (weights then biases). */
export const LOCAL_SUCCESS_PARAMS = DIM * CLASSES + CLASSES;
const ENGINE_KEY = engineKey(LOCAL_SUCCESS_TASK.engines[0]!);

/** The project's merged head, as the coordinator serves it. */
export interface LocalSuccessFleetHead {
  /** The merged version (0 = nothing merged yet: the all-zero head). */
  version: number;
  params: number[];
  /** Held-out loss of this version on the fleet's eval pool (null when never scored). */
  evalLoss: number | null;
}

/** One held-out row: the engine-scaled features, the class index, the label weight. */
export interface LocalSuccessHoldoutRow {
  x: number[];
  y: number;
  w?: number;
}

/** A head delta on the delta wire, plus the held-out rows the merge gate scores on. */
export interface LocalSuccessContribution extends DeltaLearnPayload {
  holdout: LocalSuccessHoldoutRow[];
}

/**
 * The host's federation transport — the ONE port, injected alongside the store. Each
 * host builds it from its own authed transport with {@link createLocalSuccessFederation}.
 */
export interface LocalSuccessFederation {
  /** Send a head contribution to `projectId`'s coordinator. Rejects on refusal. */
  push(projectId: number, contribution: LocalSuccessContribution): Promise<void>;
  /** `projectId`'s merged head; null when it has none yet. Rejects when the read failed. */
  pull(projectId: number): Promise<LocalSuccessFleetHead | null>;
  /**
   * The project a turn federates with when the call names none (Rovr's chats carry no
   * project; its Settings → project is the one memory stands behind). Absent = only a
   * call's own project.
   */
  project?(): MaybePromise<number | null | undefined>;
}

/** One turn's right to federate: the port and the project its head belongs to. */
export interface LocalSuccessScope {
  federation: LocalSuccessFederation;
  projectId: number;
}

/** The fleet head a device's refits start from, as persisted in its snapshot. */
export interface FleetBase extends LocalSuccessFleetHead {
  projectId: number;
  /** When it was pulled (ms epoch) — {@link FLEET_REFRESH_MS} after, the next turn re-pulls. */
  pulledAt: number;
}

/** The all-zero head — version 0 at a coordinator that has merged nothing yet. */
export function zeroHead(): LocalSuccessFleetHead {
  return { version: 0, params: new Array<number>(LOCAL_SUCCESS_PARAMS).fill(0), evalLoss: null };
}

/**
 * The turn's {@link LocalSuccessScope}, or undefined when it may not federate: no port,
 * or no project (the call's own, else the port's default). The caller decides the rest
 * (Hybrid, signed in) — see `hostModelStream.ts`.
 */
export async function localSuccessScope(
  federation: LocalSuccessFederation | undefined,
  callProjectId: number | null | undefined,
): Promise<LocalSuccessScope | undefined> {
  if (!federation) return undefined;
  let projectId: number | null | undefined = callProjectId;
  if (projectId == null) {
    try {
      projectId = await federation.project?.();
    } catch (error) {
      // The host's project setting is unreadable: this turn has no project to federate with.
      reportLocalSuccessFailure('pull', error);
      return undefined;
    }
  }
  return typeof projectId === 'number' && Number.isInteger(projectId) && projectId > 0 ? { federation, projectId } : undefined;
}

/** Whether a federated turn in `projectId` should (re)pull the fleet head first. */
export function fleetRefreshDue(fleet: FleetBase | undefined, projectId: number, now: number): boolean {
  return !fleet || fleet.projectId !== projectId || now - fleet.pulledAt >= FLEET_REFRESH_MS;
}

interface HeadLoss {
  holdoutLoss: number | null;
}

/** A head acts only once it beats a coin (ln 2 nats) on its held-out tail. */
export function headTrusted(head: HeadLoss | undefined): boolean {
  return !!head && head.holdoutLoss != null && head.holdoutLoss < Math.LN2;
}

/** Whether a pulled fleet head should REPLACE the serving head: the local one is cold, untrusted, or worse. */
export function fleetHeadWins(local: HeadLoss | undefined, fleet: LocalSuccessFleetHead): boolean {
  if (fleet.version <= 0 || fleet.evalLoss == null || fleet.evalLoss >= Math.LN2) return false;
  return !headTrusted(local) || fleet.evalLoss < local!.holdoutLoss!;
}

/**
 * Whether the refit that produced `next` (over a history whose timestamps are `ats`)
 * is worth sending: it improved on `prev` and beats a coin, and the throttle allows it.
 */
export function pushDue(
  prev: HeadLoss | undefined,
  next: HeadLoss,
  ats: readonly number[],
  pushedAt: number | undefined,
  now: number,
): boolean {
  if (!headTrusted(next)) return false;
  if (prev?.holdoutLoss != null && !(next.holdoutLoss! < prev.holdoutLoss)) return false;
  if (pushedAt != null && now - pushedAt < FEDERATE_MIN_INTERVAL_MS) return false;
  const fresh = pushedAt == null ? ats.length : ats.filter((at) => at > pushedAt).length;
  return fresh >= FEDERATE_MIN_NEW_OUTCOMES;
}

/**
 * The contribution for a head trained from `base`: the delta-wire payload (the engine's
 * `buildMlHeadDelta`) and the newest rows of the chronological tail the trainer held
 * out (`holdoutFraction`, as `trainMlTask` measures it).
 */
export function localSuccessContribution(
  base: LocalSuccessFleetHead,
  trained: readonly number[],
  examples: readonly MlTrainExample<LocalTurnFeatures>[],
  samples: number,
): LocalSuccessContribution {
  const entry = mlHeadEntry(LOCAL_SUCCESS_TASK.id, ENGINE_KEY, base.version, base.params, { dim: DIM, classes: CLASSES });
  const tail = Math.min(FEDERATE_HOLDOUT_MAX, Math.floor(examples.length * (LOCAL_SUCCESS_TASK.train?.holdoutFraction ?? 0.2)));
  const holdout = examples.slice(examples.length - tail).map((e) => ({
    x: localSuccessFeatures(e.input),
    y: e.label,
    ...(e.weight != null && e.weight !== 1 ? { w: e.weight } : {}),
  }));
  return { ...buildMlHeadDelta(entry, trained, samples, `ml head ${LOCAL_SUCCESS_TASK.id}`), holdout };
}

/** A coordinator's head read, validated; null for none yet or a malformed answer. */
export function parseFleetHead(raw: unknown): LocalSuccessFleetHead | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { version?: unknown; params?: unknown; evalLoss?: unknown };
  if (typeof r.version !== 'number' || !Number.isInteger(r.version) || r.version <= 0) return null;
  if (!Array.isArray(r.params) || r.params.length !== LOCAL_SUCCESS_PARAMS || !r.params.every((p) => typeof p === 'number' && Number.isFinite(p))) return null;
  const evalLoss = typeof r.evalLoss === 'number' && Number.isFinite(r.evalLoss) ? r.evalLoss : null;
  return { version: r.version, params: r.params as number[], evalLoss };
}

/** A persisted {@link FleetBase}, validated; undefined for none or a malformed value. */
export function parseFleetBase(raw: unknown): FleetBase | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const f = raw as Partial<FleetBase>;
  if (typeof f.projectId !== 'number' || typeof f.pulledAt !== 'number' || typeof f.version !== 'number' || !Number.isInteger(f.version) || f.version < 0) return undefined;
  if (!Array.isArray(f.params) || f.params.length !== LOCAL_SUCCESS_PARAMS || !f.params.every((p) => typeof p === 'number' && Number.isFinite(p))) return undefined;
  return { projectId: f.projectId, version: f.version, params: f.params, evalLoss: typeof f.evalLoss === 'number' ? f.evalLoss : null, pulledAt: f.pulledAt };
}

/**
 * The port over a host's authed JSON transport — the same `ProjectMemoryRequest` the
 * project memory hooks take (`apiRequest` on the web, `bfApiRequest` in the editor,
 * Rovr's `portRequest`). The routes are the project Evermind's: the delta door
 * (`POST …/evermind/learn`, which routes a head target to its own merge) and the head
 * read (`GET …/evermind/ml-head`). Under the web's Local only both are refused by the
 * request gate (`/api/projects/*\/evermind` is a connected feature carrying content).
 */
export function createLocalSuccessFederation(
  request: ProjectMemoryRequest,
  opts: { project?: () => MaybePromise<number | null | undefined> } = {},
): LocalSuccessFederation {
  return {
    async push(projectId, contribution) {
      await request(`/api/projects/${projectId}/evermind/learn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(contribution),
      });
    },
    async pull(projectId) {
      return parseFleetHead(await request(`/api/projects/${projectId}/evermind/ml-head?target=${encodeURIComponent(LOCAL_SUCCESS_TARGET)}`));
    },
    ...(opts.project ? { project: opts.project } : {}),
  };
}
