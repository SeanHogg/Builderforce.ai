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
  localSuccessExamples,
  runMlTask,
  trainMlTask,
  type LocalSuccess,
  type LocalSuccessOutcome,
  type LocalTurnFeatures,
} from '@seanhogg/builderforce-memory-engine';
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

export interface LocalSuccessRouter {
  assess(ref: string, base: TurnFeaturesBase): Promise<LocalSuccessVerdict>;
  record(ref: string, outcome: LocalSuccessOutcome): Promise<void>;
}

export interface LocalSuccessRouterOptions {
  random?: () => number;
  now?: () => number;
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
  return { v: 1, outcomes: outcomes.slice(-LOCAL_SUCCESS_HISTORY), ...(head ? { head } : {}) };
}

function modelsFor(params: readonly number[]): InMemoryMlModels {
  const model = new LogisticModel(DIM, CLASSES);
  model.importParams(params);
  const models = new InMemoryMlModels();
  models.set(LOCAL_SUCCESS_TASK.id, ENGINE_KEY, model);
  return models;
}

/** A trained head acts only once it beats a coin (ln 2 nats) on its held-out tail. */
function trusted(head: LocalSuccessSnapshot['head']): boolean {
  return !!head && head.holdoutLoss != null && head.holdoutLoss < Math.LN2;
}

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
    } catch {
      /* storage unreadable — start cold, exactly as today */
    }
  })();
  let writes: Promise<void> = loaded;

  return {
    async assess(ref, base) {
      await loaded;
      const prior = priorRate(snapshot.outcomes, ref);
      const turn: LocalTurnFeatures = { ...base, ...(prior != null ? { priorLocalSuccessRate: prior } : {}) };
      if (!models || !trusted(snapshot.head)) return { turn, skip: false, probability: null };
      try {
        const { output } = await runMlTask<LocalSuccess>(LOCAL_SUCCESS_TASK.id, turn, { registry, mode: 'local-only', models });
        const skip = 1 - output.probability > LOCAL_SKIP_CONFIDENCE && random() >= LOCAL_SKIP_EXPLORE;
        return { turn, skip, probability: output.probability };
      } catch {
        return { turn, skip: false, probability: null };
      }
    },

    record(ref, outcome) {
      // Serialized: two turns settling at once must not each append to the same history.
      const done = writes.then(() => append(ref, outcome));
      writes = done.catch(() => undefined);
      return done;
    },
  };

  async function append(ref: string, outcome: LocalSuccessOutcome): Promise<void> {
    const outcomes = [...snapshot.outcomes, { ...outcome, ref, at: now() }].slice(-LOCAL_SUCCESS_HISTORY);
    const fresh = new InMemoryMlModels();
    let head: LocalSuccessSnapshot['head'];
    let nextModels: InMemoryMlModels | null = null;
    try {
      // Refit on the whole bounded history (a few hundred rows × nine features — cheap),
      // after the turn, off its critical path. Two classes always, so a history of only
      // failures still fits a head the right shape to persist and federate.
      const fit = await trainMlTask(LOCAL_SUCCESS_TASK, localSuccessExamples(outcomes), {
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
    snapshot = { v: 1, outcomes, ...(head ? { head } : {}) };
    models = nextModels;
    try {
      await store.save(snapshot);
    } catch {
      /* storage full or blocked — the in-memory head still serves this session */
    }
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
      } catch {
        /* storage blocked or full */
      }
    },
  };
}

/** One router per store, so a host that builds its stream per turn still trains one history. */
const routers = new WeakMap<LocalSuccessStore, LocalSuccessRouter>();

/** The router for `store`, created on first use. */
export function localSuccessRouterFor(store: LocalSuccessStore): LocalSuccessRouter {
  let r = routers.get(store);
  if (!r) {
    r = createLocalSuccessRouter(store);
    routers.set(store, r);
  }
  return r;
}
