/**
 * Whether a run is HELD at its finalize gate, or was released (PRD 41 §12.5) — read from ONE place: the run's execution
 * record (`hold`, `waiver`, written by `runRecovery.recordRunHeld` / `recordRunReleased`). A run-delta record never says
 * it on its own: a delta can be stored and its run still complete (a verdict given first), or the run can be held with no
 * delta stored at all (unmeasured, fail-closed). Every card (`run-delta/card`, `run-delta/get`) and the audit's held
 * report read the state from here, so the Release button exists exactly when the hold does.
 */

import type { ExecutionValue, LocalFirstStore, LocalFirstTransaction } from "@builderforce/local-first";
import type { RunDeltaCardPayload, RunDeltaHeld } from "@builderforce/run-delta/contract";
import { isRunDeltaHold, RUN_DELTA_UNMEASURED } from "../runRecovery";

export interface RunHoldState {
  blocked: RunDeltaHeld;
  /** A person released the hold (its waiver is on the execution). */
  released: boolean;
}

/** The finalize-gate hold of one execution: held (`awaiting_input`), released (a waiver), or none. */
export function holdStateOf(run: ExecutionValue | undefined): RunHoldState | undefined {
  if (!run || !isRunDeltaHold(run.hold)) return undefined;
  const released = !!run.waiver;
  if (!released && run.status !== "awaiting_input") return undefined;
  const blocked: RunDeltaHeld = { rules: [...run.hold.rules], ...(run.hold.reason === RUN_DELTA_UNMEASURED ? { unmeasured: true } : {}) };
  return { blocked, released };
}

/** The hold states of these runs (only the held or released ones are in the map). */
export async function readRunHolds(tx: Pick<LocalFirstTransaction, "get">, runIds: Iterable<string>): Promise<Map<string, RunHoldState>> {
  const out = new Map<string, RunHoldState>();
  for (const runId of new Set(runIds)) {
    const state = holdStateOf((await tx.get<ExecutionValue>("execution", runId))?.payload);
    if (state) out.set(runId, state);
  }
  return out;
}

/** One run's hold state. */
export function readRunHold(store: LocalFirstStore, runId: string): Promise<RunHoldState | undefined> {
  return store.read(async (tx) => (await readRunHolds(tx, [runId])).get(runId));
}

/**
 * The card with its run's hold state, and only that: a `blocked` / `released` the card arrived with (an older record's own
 * flag) is dropped. A progress card shows a hold only once its computation `failed` (a pending card is never held yet).
 */
export function withHold<C extends RunDeltaCardPayload>(card: C, state: RunHoldState | undefined): C {
  const { blocked: _blocked, released: _released, ...rest } = card;
  if (!state || card.status === "pending") return rest as C;
  return { ...rest, blocked: { ...state.blocked, rules: [...state.blocked.rules] }, ...(state.released ? { released: true } : {}) } as C;
}

/** Cards with their runs' hold states, read in one transaction. */
export async function withHolds<C extends RunDeltaCardPayload>(store: LocalFirstStore, cards: readonly C[]): Promise<C[]> {
  if (cards.length === 0) return [];
  const holds = await store.read((tx) => readRunHolds(tx, cards.map((c) => c.runId)));
  return cards.map((card) => withHold(card, holds.get(card.runId)));
}
