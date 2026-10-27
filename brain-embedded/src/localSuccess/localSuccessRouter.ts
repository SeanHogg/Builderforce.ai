/**
 * The `run.local-success` predictor Hybrid consults before a local attempt — trained on
 * this device from this device's own routed turns, and persisted through ONE port the
 * host lends ({@link LocalSuccessStore}: browser storage on the web and in Rovr, the
 * extension's global storage in VS Code).
 *
 * Everything ML here is the engine's (`@seanhogg/builderforce-memory-engine` ML task
 * catalog): the task row and its feature scaling (`LOCAL_SUCCESS_TASK`), the labelling of
 * an outcome — cloud fallbacks included, per the operator's "learns from the cloud"
 * decision (`localSuccessExamples`) — the ONE trainer (`trainMlTask`) and the ONE runner
 * (`runMlTask`). This module only keeps the history, decides when the answer is trusted
 * enough to act on, and persists.
 *
 * Cold start is today's behaviour: until the task has trained (its `minSamples`) AND the
 * fitted head beats a coin on its held-out tail, every turn tries local.
 */

import {
  InMemoryMlModels,
  LOCAL_SUCCESS_FEATURES,
  LOCAL_SUCCESS_TASK,
  LogisticModel,
  createMlRegistry,
  engineKey,
  fitLogistic,
  localSuccessExamples,
  runMlTask,
  trainMlTask,
  type LocalSuccess,
  type LocalSuccessOutcome,
  type LocalTurnFeatures,
} from '@seanhogg/builderforce-memory-engine';
import {
  fleetHeadWins,
  fleetRefreshDue,
  headTrusted,
  localSuccessContribution,
  parseFleetBase,
  pushDue,
  zeroHead,
  FLEET_REFRESH_MS,
  type FleetBase,
  type LocalSuccessFleetHead,
  type LocalSuccessScope,
} from './localSuccessFederation';
import { reportLocalSuccessFailure } from './localSuccessFailure';
import type { TurnFeaturesBase } from './turnFeatures';

type MaybePromise<T> = T | Promise<T>;

/** The host's persistence for the predictor — the ONE port, injected into `createHostModelStream`. */
export interface LocalSuccessStore {
  /** The stored snapshot, or undefined when none (validated here; a bad value reads as none). */
  load(): MaybePromise<unknown>;
  save(snapshot: LocalSuccessSnapshot): MaybePromise<void>;
}

/** One routed turn, as stored: the engine's outcome plus which local model it was about. */
export interface StoredLocalSuccessOutcome extends LocalSuccessOutcome {
  ref: string;
  at: number;
}

export interface LocalSuccessSnapshot {
  v: 1;
  /** Oldest first, bounded at {@link LOCAL_SUCCESS_HISTORY}. */
  outcomes: StoredLocalSuccessOutcome[];
  /** The trained head (logistic weights + biases), when the task has trained. */
  head?: { params: number[]; holdoutLoss: number | null; samples: number };
  /**
   * The project's merged fleet head this device last pulled — every refit warm-starts
   * from it, and a push is diffed against it (`localSuccessFederation.ts`).
   */
  fleet?: FleetBase;
  /** When this device last pushed a head delta (ms epoch) — the federation throttle. */
  pushedAt?: number;
}

/** Skip local only when the predictor says it FAILS with more confidence than this. */
export const LOCAL_SKIP_CONFIDENCE = 0.8;
/**
 * Of the turns the predictor would skip, the share still tried locally. Without it a
 * skipped turn only ever teaches through the cloud (a success there says nothing about
 * local), so a head that learned "fails" could never unlearn it.
 */
export const LOCAL_SKIP_EXPLORE = 0.1;
/** Routed turns kept for training, newest last. */
export const LOCAL_SUCCESS_HISTORY = 300;

/** The verdict for one turn. */
export interface LocalSuccessVerdict {
  /** The turn's full features (with the history-derived prior) — record the outcome with these. */
  turn: LocalTurnFeatures;
  skip: boolean;
  /** P(the local model succeeds), or null when the predictor is not trusted yet. */
  probability: number | null;
}

/**
 * `scope` is present only on a turn that may federate (Hybrid, signed in, with a
 * project — `hostModelStream.ts` decides): `assess` then refreshes the fleet head when
 * due, and `record` may push the refit's delta. Without it nothing leaves the device.
 */
export interface LocalSuccessRouter {
  assess(ref: string, base: TurnFeaturesBase, scope?: LocalSuccessScope): Promise<LocalSuccessVerdict>;
  /** Never rejects: a failure to record is reported inside (`localSuccessFailure.ts`). */
  record(ref: string, outcome: LocalSuccessOutcome, scope?: LocalSuccessScope): Promise<void>;
}

/** `router` with every call made under `scope` — what one federated Hybrid turn is lent. */
export function scopedLocalSuccessRouter(router: LocalSuccessRouter, scope: LocalSuccessScope | undefined): LocalSuccessRouter {
  if (!scope) return router;
  return {
    assess: (ref, base) => router.assess(ref, base, scope),
    record: (ref, outcome) => router.record(ref, outcome, scope),
  };
}

/** A tuning value: fixed, or read per turn (a host setting the person can change live). */
export type LocalSuccessTunable = number | (() => number | undefined);

/** The host's tuning of WHEN a confident "fails" verdict skips local — the editor's
 *  `builderforce.localModels.skipConfidence` / `.explore` settings. */
export interface LocalSuccessTuning {
  /** Skip local only when P(fails) exceeds this; default {@link LOCAL_SKIP_CONFIDENCE}. */
  skipConfidence?: LocalSuccessTunable;
  /** Of the turns that would skip, the share still tried locally; default {@link LOCAL_SKIP_EXPLORE}. */
  explore?: LocalSuccessTunable;
}

export interface LocalSuccessRouterOptions extends LocalSuccessTuning {
  random?: () => number;
  now?: () => number;
}

/** `value`'s current reading when it is a share in [0, 1], else `fallback`. */
function shareOf(value: LocalSuccessTunable | undefined, fallback: number): number {
  const v = typeof value === 'function' ? value() : value;
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? v : fallback;
}

const registry = createMlRegistry();
const ENGINE_KEY = engineKey(LOCAL_SUCCESS_TASK.engines[0]!);
const DIM = LOCAL_SUCCESS_FEATURES.length;
const CLASSES = LOCAL_SUCCESS_TASK.output.labels!.length;

function parseSnapshot(raw: unknown): LocalSuccessSnapshot {
  const empty: LocalSuccessSnapshot = { v: 1, outcomes: [] };
  if (!raw || typeof raw !== 'object' || (raw as { v?: unknown }).v !== 1) return empty;
  const s = raw as Partial<LocalSuccessSnapshot>;
  const outcomes = Array.isArray(s.outcomes)
    ? s.outcomes.filter((o): o is StoredLocalSuccessOutcome => !!o && typeof o.ref === 'string' && !!o.turn && typeof o.turn === 'object')
    : [];
  const head = s.head && Array.isArray(s.head.params) && s.head.params.length === DIM * CLASSES + CLASSES ? s.head : undefined;
  const fleet = parseFleetBase(s.fleet);
  return {
    v: 1,
    outcomes: outcomes.slice(-LOCAL_SUCCESS_HISTORY),
    ...(head ? { head } : {}),
    ...(fleet ? { fleet } : {}),
    ...(typeof s.pushedAt === 'number' ? { pushedAt: s.pushedAt } : {}),
  };
}

function logisticFrom(params: readonly number[]): LogisticModel {
  const model = new LogisticModel(DIM, CLASSES);
  model.importParams(params);
  return model;
}

function modelsFor(params: readonly number[]): InMemoryMlModels {
  const models = new InMemoryMlModels();
  models.set(LOCAL_SUCCESS_TASK.id, ENGINE_KEY, logisticFrom(params));
  return models;
}

/**
 * The task trained FROM `params` — the engine's warm start (`fitLogistic(…, init)`: "a
 * local round on top of a merged federated head") through the ONE trainer's own `fit`
 * seam, so the held-out measurement and refit stay `trainMlTask`'s. A fresh copy per fit.
 */
function warmStartTask(params: readonly number[]): typeof LOCAL_SUCCESS_TASK {
  return {
    ...LOCAL_SUCCESS_TASK,
    train: { ...LOCAL_SUCCESS_TASK.train!, fit: (samples) => fitLogistic(samples, { classes: CLASSES }, logisticFrom(params)) },
  };
}

/** A trained head acts only once it beats a coin (ln 2 nats) on its held-out tail. */
const trusted = headTrusted;

/** The local success rate of `ref` over the history, or undefined when it never ran locally. */
function priorRate(outcomes: readonly StoredLocalSuccessOutcome[], ref: string): number | undefined {
  let ran = 0;
  let ok = 0;
  for (const o of outcomes) {
    if (o.ref !== ref || !o.local) continue;
    ran++;
    if (o.local === 'succeeded') ok++;
  }
  return ran > 0 ? ok / ran : undefined;
}

export function createLocalSuccessRouter(store: LocalSuccessStore, opts: LocalSuccessRouterOptions = {}): LocalSuccessRouter {
  const random = opts.random ?? Math.random;
  const now = opts.now ?? Date.now;
  let snapshot: LocalSuccessSnapshot = { v: 1, outcomes: [] };
  let models: InMemoryMlModels | null = null;
  const loaded = (async () => {
    try {
      snapshot = parseSnapshot(await store.load());
      models = snapshot.head ? modelsFor(snapshot.head.params) : null;
    } catch (e) {
      // Storage unreadable — start cold, exactly as today.
      reportLocalSuccessFailure('load', e);
    }
  })();
  let writes: Promise<void> = loaded;
  /** Pulls of the fleet head in flight / backed off after a failure (in memory: a reload retries). */
  let pulling = false;
  let pullRetryAt = 0;

  return {
    async assess(ref, base, scope) {
      await loaded;
      if (scope) refreshFleet(scope);
      const prior = priorRate(snapshot.outcomes, ref);
      const turn: LocalTurnFeatures = { ...base, ...(prior != null ? { priorLocalSuccessRate: prior } : {}) };
      if (!models || !trusted(snapshot.head)) return { turn, skip: false, probability: null };
      try {
        const { output } = await runMlTask<LocalSuccess>(LOCAL_SUCCESS_TASK.id, turn, { registry, mode: 'local-only', models });
        const skipConfidence = shareOf(opts.skipConfidence, LOCAL_SKIP_CONFIDENCE);
        const explore = shareOf(opts.explore, LOCAL_SKIP_EXPLORE);
        const skip = 1 - output.probability > skipConfidence && random() >= explore;
        return { turn, skip, probability: output.probability };
      } catch {
        return { turn, skip: false, probability: null };
      }
    },

    record(ref, outcome, scope) {
      // Serialized: two turns settling at once must not each append to the same history.
      // A failure is reported here, once, and resolves — it never rejects the caller or
      // breaks the chain the next turn's write waits on.
      const done = writes
        .then(() => append(ref, outcome, scope))
        .catch((e: unknown) => reportLocalSuccessFailure('record', e));
      writes = done;
      return done;
    },
  };

  /**
   * A federated turn re-pulls its project's fleet head when due (first time, another
   * project, or {@link FLEET_REFRESH_MS} old) — off the turn: serialized behind the
   * writes, never awaited by `assess`.
   */
  function refreshFleet(scope: LocalSuccessScope): void {
    if (pulling || now() < pullRetryAt || !fleetRefreshDue(snapshot.fleet, scope.projectId, now())) return;
    pulling = true;
    writes = writes
      .then(async () => adopt(scope.projectId, (await scope.federation.pull(scope.projectId)) ?? zeroHead()))
      .catch(pullFailed)
      .finally(() => {
        pulling = false;
      });
  }

  /** The pull failed (offline, signed out mid-session, refused): wait a refresh window before retrying. */
  function pullFailed(reason: unknown): void {
    pullRetryAt = now() + FLEET_REFRESH_MS;
    reportLocalSuccessFailure('pull', reason);
  }

  /**
   * Take `pulled` as `projectId`'s fleet base — the head every refit warm-starts from and
   * every push is diffed against — and SERVE it when the local head is cold, untrusted
   * or worse (`fleetHeadWins`). Local outcomes keep training on top from the next refit.
   */
  async function adopt(projectId: number, pulled: LocalSuccessFleetHead): Promise<void> {
    const wins = fleetHeadWins(snapshot.head, pulled);
    snapshot = {
      ...snapshot,
      fleet: { ...pulled, projectId, pulledAt: now() },
      ...(wins ? { head: { params: pulled.params, holdoutLoss: pulled.evalLoss, samples: 0 } } : {}),
    };
    if (wins) models = modelsFor(pulled.params);
    await persist();
  }

  /** Save the snapshot; a refused save is reported and the in-memory head still serves this session. */
  async function persist(): Promise<void> {
    try {
      await store.save(snapshot);
    } catch (e) {
      // Storage full or blocked — the in-memory head still serves this session.
      reportLocalSuccessFailure('save', e);
    }
  }

  /** A push was refused (a stale base above all — the fleet merged meanwhile): re-pull on the next federated turn. */
  function pushRefused(reason: unknown): void {
    if (snapshot.fleet) snapshot = { ...snapshot, fleet: { ...snapshot.fleet, pulledAt: 0 } };
    reportLocalSuccessFailure('push', reason);
  }

  async function append(ref: string, outcome: LocalSuccessOutcome, scope?: LocalSuccessScope): Promise<void> {
    const outcomes = [...snapshot.outcomes, { ...outcome, ref, at: now() }].slice(-LOCAL_SUCCESS_HISTORY);
    const examples = localSuccessExamples(outcomes);
    const fleet = snapshot.fleet;
    const prev = snapshot.head;
    const fresh = new InMemoryMlModels();
    let head: LocalSuccessSnapshot['head'];
    let nextModels: InMemoryMlModels | null = null;
    try {
      // Refit on the whole bounded history (a few hundred rows × nine features — cheap),
      // after the turn, off its critical path. Two classes always, so a history of only
      // failures still fits a head the right shape to persist and federate. With a fleet
      // head pulled, the fit continues FROM it, so the diff is a FedAvg contribution.
      const fit = await trainMlTask(fleet ? warmStartTask(fleet.params) : LOCAL_SUCCESS_TASK, examples, {
        models: fresh,
        classical: { logistic: { classes: CLASSES } },
      });
      const params = fit?.predictor.exportParams?.();
      if (fit && params) {
        head = { params: Array.from(params), holdoutLoss: fit.holdoutLoss, samples: fit.samples };
        nextModels = fresh;
      }
    } catch {
      // A failed refit keeps the last good head.
      head = snapshot.head;
      nextModels = models;
    }
    snapshot = {
      v: 1,
      outcomes,
      ...(head ? { head } : {}),
      ...(snapshot.fleet ? { fleet: snapshot.fleet } : {}),
      ...(snapshot.pushedAt != null ? { pushedAt: snapshot.pushedAt } : {}),
    };
    models = nextModels;
    // Federate: a refit that improved, on a turn allowed to, against THIS project's base,
    // when the throttle allows (`pushDue`). Fire-and-forget — the push never holds the
    // history's writes, and a refusal only re-pulls the base.
    if (scope && head && head !== prev && fleet && fleet.projectId === scope.projectId && pushDue(prev, head, outcomes.map((o) => o.at), snapshot.pushedAt, now())) {
      snapshot = { ...snapshot, pushedAt: now() };
      void scope.federation.push(scope.projectId, localSuccessContribution(fleet, head.params, examples, head.samples)).catch(pushRefused);
    }
    await persist();
  }
}

/**
 * A {@link LocalSuccessStore} over `localStorage` (the web app; any page with Web
 * Storage). Guarded: a blocked or partitioned store reads as empty and saves nothing.
 */
export function webStorageLocalSuccessStore(key = 'bf.ml.run.local-success'): LocalSuccessStore {
  return {
    load() {
      try {
        const raw = globalThis.localStorage?.getItem(key);
        return raw ? (JSON.parse(raw) as unknown) : undefined;
      } catch {
        return undefined;
      }
    },
    save(snapshot) {
      try {
        globalThis.localStorage?.setItem(key, JSON.stringify(snapshot));
      } catch (e) {
        // Storage blocked or full — the in-memory head still serves this session.
        reportLocalSuccessFailure('save', e);
      }
    },
  };
}

/** One router per store, so a host that builds its stream per turn still trains one history. */
const routers = new WeakMap<LocalSuccessStore, LocalSuccessRouter>();

/** The router for `store`, created on first use with the host's `tuning` (a getter-valued
 *  tuning is read per turn, so one router follows the host's live settings). */
export function localSuccessRouterFor(store: LocalSuccessStore, tuning: LocalSuccessTuning = {}): LocalSuccessRouter {
  let r = routers.get(store);
  if (!r) {
    r = createLocalSuccessRouter(store, tuning);
    routers.set(store, r);
  }
  return r;
}
