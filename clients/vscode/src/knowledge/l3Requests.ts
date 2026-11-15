/**
 * The L3 gate's request bookkeeping (`l3Gate.ts`), split out so the gate keeps only the pass itself: which scopes a person
 * asked for (`""`: the whole root; else a sub-folder root's relative path), how each settled, and the single-flight drive —
 * a request, the tick and a reconcile's end never run two attempts at once.
 *
 * An EXPLICIT request (`builderforce.knowledge.retryAnalyzers`: the person asked to analyse again) runs a pass even when the
 * analysis looks current, and no view closing ({@link L3Requests.withdraw}) drops it; it ends only when it settles.
 */

export interface L3RequestOptions {
  /** The person explicitly asked to analyse again: forced past "current", immune to a view's withdrawal. */
  explicit?: boolean;
}

export class L3Requests {
  /** The scopes asked for that have not settled yet, and whether each ask is explicit. */
  private readonly pending = new Map<string, { explicit: boolean }>();
  /** The last answer of each scope that settled: true when its analysis is current. */
  private readonly answers = new Map<string, boolean>();
  /** The attempt in progress. */
  private driving: Promise<void> | undefined;

  constructor(
    /** One attempt over the pending scopes; `direct` false ⇒ the caller's idle gate applies. */
    private readonly attemptAll: (direct: boolean) => Promise<void>,
    private readonly onError: (error: unknown) => void,
  ) {}

  get size(): number { return this.pending.size; }

  /** The pending scopes, the whole root first. */
  scopes(): string[] { return [...this.pending.keys()].sort(); }

  has(scope: string): boolean { return this.pending.has(scope); }

  /** Whether the pending ask of `scope` is explicit (forced past "current"). */
  explicit(scope: string): boolean { return this.pending.get(scope)?.explicit ?? false; }

  /** A new ask of `scope`; an explicit ask stays explicit until it settles. */
  add(scope: string, opts: L3RequestOptions = {}): void {
    this.answers.delete(scope);
    this.pending.set(scope, { explicit: !!opts.explicit || this.explicit(scope) });
  }

  /** A view stopped looking: a pending ask is dropped — unless it is explicit. */
  withdraw(scope: string): void {
    if (!this.explicit(scope)) this.pending.delete(scope);
  }

  /** `scope` ended: current (it ran, or had nothing to do) or not (refused, failed). */
  settle(scope: string, current: boolean): void {
    this.pending.delete(scope);
    this.answers.set(scope, current);
  }

  /** How `scope` last settled; false when it has not (it is still pending, or was withdrawn). */
  answer(scope: string): boolean { return this.answers.get(scope) ?? false; }

  /** ONE attempt at a time: a direct ask queues behind the one in progress; an indirect retry (the tick) joins it. */
  drive(direct: boolean): Promise<void> {
    if (this.driving) return direct ? this.driving.then(() => this.drive(true)) : this.driving;
    const run = this.attemptAll(direct).catch(this.onError);
    this.driving = run.finally(() => { this.driving = undefined; });
    return this.driving;
  }
}
