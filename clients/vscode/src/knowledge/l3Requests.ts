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

/** One ask of a scope, as an attempt takes it up. */
export interface L3Ticket { readonly explicit: boolean; readonly id: number }

export class L3Requests {
  /** The scopes asked for that have not settled yet, whether each ask is explicit, and its ticket (a new ask, a new ticket). */
  private readonly pending = new Map<string, L3Ticket>();
  private tickets = 0;
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

  /** The pending ask of `scope` an attempt takes up: its ticket says, at settle time, whether a newer ask came meanwhile. */
  ticket(scope: string): L3Ticket | undefined { return this.pending.get(scope); }

  /**
   * A new ask of `scope`, with a new ticket; an explicit ask stays explicit until it settles. An explicit ask that arrives
   * while an unforced attempt of the same scope runs is NOT absorbed by that attempt's settle: it gets its own forced pass.
   */
  add(scope: string, opts: L3RequestOptions = {}): void {
    this.answers.delete(scope);
    this.pending.set(scope, { explicit: !!opts.explicit || this.explicit(scope), id: ++this.tickets });
  }

  /** A view stopped looking: a pending ask is dropped — unless it is explicit. */
  withdraw(scope: string): void {
    if (!this.explicit(scope)) this.pending.delete(scope);
  }

  /**
   * `scope` ended: current (it ran, or had nothing to do) or not (refused, failed). With the `ticket` the attempt took up: when
   * a newer EXPLICIT ask came meanwhile and this attempt was not forced, that ask stays pending for its own forced pass (and
   * the answer waits for it); a newer plain ask is served by this attempt.
   */
  settle(scope: string, current: boolean, ticket?: L3Ticket): void {
    const now = this.pending.get(scope);
    if (ticket && now && now.id !== ticket.id && now.explicit && !ticket.explicit) return;
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
