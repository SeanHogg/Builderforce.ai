/**
 * First-load triage for the Knowledge view: times each call the view's first paint waits on
 * (`scopes`, `lastSeen`, `load`, `baseline`, `syncStatus`, and the `rememberLastSeen` write after a
 * full load), with a load's phases (`partitions`, `index`, `nearDuplicates`, `build`, `pack`,
 * `server`, `notHere`). The latest {@link TRACE_CAPACITY} finished calls stay in a ring; a call still
 * running says which phase it is in and since when, so a stuck load names its phase. Each finished
 * call is one `timing` line in the output channel.
 *
 * Pure apart from the lag sampler (`reviewHostLag.ts`, a seam): no `vscode` here. The bridge owns ONE
 * recorder and threads a call's {@link LoadTimer} into `loadGraph`; a caller without one passes nothing.
 */

import type { KnowledgeHostLag, KnowledgeLoadInFlight, KnowledgeLoadPhase, KnowledgeLoadTrace, KnowledgeLoadTraceEntry } from "./knowledgeProtocol";
import { startHostLag, type HostLagMonitor, type LagSampler } from "./review/reviewHostLag";

/** Finished calls kept. */
export const TRACE_CAPACITY = 20;

/** Times one named phase of a call; a sync `run` stays sync, a promise is timed until it settles. */
export interface LoadTimer {
  phase<T>(name: string, run: () => T): T;
}

/** No timing: what `loadGraph` uses when its caller passes no timer. */
export const UNTIMED: LoadTimer = { phase: (_name, run) => run() };

/** The facts a finished call adds to its entry (counts, the branch that answered). */
export type TraceFields = Partial<Omit<KnowledgeLoadTraceEntry, "op" | "rootId" | "startedAt" | "durationMs" | "outcome" | "error" | "phases" | "hostLag">>;

export interface TracedCall {
  readonly timer: LoadTimer;
  set(fields: TraceFields): void;
}

export interface LoadTraceOptions {
  now?: () => number;
  /** One line per finished call (the bridge's `log("timing", …)`). */
  log?: (line: string) => void;
  /** The event-loop sampler for a `load` (default: node's); a seam for tests. */
  lagSampler?: LagSampler;
  capacity?: number;
}

export interface LoadTraceRecorder {
  /** Runs `fn` as one traced call; `describe` reads the counts off a non-null answer. Rethrows what `fn` throws. */
  run<T>(op: string, rootId: string | undefined, fn: (call: TracedCall) => Promise<T>, describe?: (result: NonNullable<T>) => TraceFields): Promise<T>;
  snapshot(): KnowledgeLoadTrace;
}

interface Running {
  op: string;
  rootId?: string;
  startedAt: number;
  active: Map<number, { phase: string; startedAt: number }>;
  lag?: HostLagMonitor;
}

const isThenable = (v: unknown): v is PromiseLike<unknown> => !!v && typeof (v as { then?: unknown }).then === "function";

/** `load root=… 1234ms ok partitions=12ms index=3ms … nodes=900 edges=2000`: one line, keys in a fixed order. */
export function traceLine(e: KnowledgeLoadTraceEntry): string {
  const parts = [e.op, ...(e.rootId ? [`root=${e.rootId}`] : []), `${e.durationMs}ms`, e.outcome];
  if (e.error) parts.push(`error=${JSON.stringify(e.error)}`);
  for (const p of e.phases) parts.push(`${p.phase}=${p.ms}ms`);
  const extra: [string, unknown][] = [
    ["via", e.via], ["nodes", e.nodes], ["edges", e.edges], ["sources", e.sources], ["truncated", e.truncated], ["focus", e.focus],
    ["maxNodes", e.maxNodes], ["count", e.count], ["nearDuplicates", e.nearDuplicates],
  ];
  for (const [k, v] of extra) if (v !== undefined) parts.push(`${k}=${String(v)}`);
  if (e.hostLag) parts.push(`lagMax=${e.hostLag.maxMs}ms lagP99=${e.hostLag.p99Ms}ms`);
  return parts.join(" ");
}

export function createLoadTrace(opts: LoadTraceOptions = {}): LoadTraceRecorder {
  const now = opts.now ?? Date.now;
  const capacity = opts.capacity ?? TRACE_CAPACITY;
  const entries: KnowledgeLoadTraceEntry[] = [];
  const running = new Set<Running>();
  let phaseSeq = 0;

  const keep = (entry: KnowledgeLoadTraceEntry): void => {
    entries.push(entry);
    if (entries.length > capacity) entries.splice(0, entries.length - capacity);
    opts.log?.(traceLine(entry));
  };

  return {
    async run(op, rootId, fn, describe) {
      const startedAt = now();
      const live: Running = { op, startedAt, active: new Map(), ...(rootId ? { rootId } : {}), ...(op === "load" ? { lag: startHostLag(opts.lagSampler) } : {}) };
      running.add(live);
      const phases: KnowledgeLoadPhase[] = [];
      let fields: TraceFields = {};
      // Set once the call's entry is written: a phase that settles later (a sibling of a rejected
      // `Promise.all`) is not appended to a finished entry.
      let finished = false;
      const timer: LoadTimer = {
        phase<T>(name: string, runPhase: () => T): T {
          const id = ++phaseSeq;
          const t0 = now();
          live.active.set(id, { phase: name, startedAt: t0 });
          const end = (): void => {
            live.active.delete(id);
            if (!finished) phases.push({ phase: name, ms: Math.max(0, now() - t0) });
          };
          let out: T;
          try {
            out = runPhase();
          } catch (error) {
            end();
            throw error;
          }
          if (!isThenable(out)) { end(); return out; }
          return Promise.resolve(out).then((v) => { end(); return v; }, (error: unknown) => { end(); throw error; }) as unknown as T;
        },
      };
      const finish = (outcome: KnowledgeLoadTraceEntry["outcome"], error?: string): void => {
        finished = true;
        running.delete(live);
        const hostLag: KnowledgeHostLag | undefined = live.lag?.read();
        live.lag?.stop();
        keep({
          op, ...(rootId ? { rootId } : {}), startedAt, durationMs: Math.max(0, now() - startedAt), outcome, ...(error ? { error } : {}),
          phases: [...phases], ...fields, ...(hostLag ? { hostLag } : {}),
        });
      };
      try {
        const result = await fn({ timer, set: (f) => { fields = { ...fields, ...f }; } });
        if (describe && result !== null && result !== undefined) {
          try { fields = { ...fields, ...describe(result as NonNullable<typeof result>) }; } catch { /* a count that cannot be read is left out */ }
        }
        finish(result === null || result === undefined ? "null" : "ok");
        return result;
      } catch (error) {
        finish("error", error instanceof Error ? error.message : String(error));
        throw error;
      }
    },
    snapshot() {
      const inFlight: KnowledgeLoadInFlight[] = [...running].map((r) => {
        const hostLag = r.lag?.read();
        return {
          op: r.op, ...(r.rootId ? { rootId: r.rootId } : {}), startedAt: r.startedAt,
          phases: [...r.active.values()].map((p) => ({ ...p })), ...(hostLag ? { hostLag } : {}),
        };
      });
      return { now: now(), entries: entries.map((e) => ({ ...e, phases: [...e.phases] })), inFlight };
    },
  };
}
