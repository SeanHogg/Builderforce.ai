/**
 * The coordinator's FEDERATED ML-HEAD store — the single writer's half of
 * `application/llm/evermindMlHeads.ts`, over the coordinator DO's storage.
 *
 * Kept out of `ProjectEvermindCoordinatorDO` so the LM merge and the head merges stay
 * separate: the DO only routes `/learn-head`, `/ml-head` and its alarm here. Per head
 * target it keeps ONE value — the merged head, the rolling eval pool, the queued
 * contributions and the last round's outcome — and merges a debounced BATCH on the
 * DO's alarm (the same debounce as LM learns), so contributions that arrive together
 * really are FedAvg'd together rather than each one overwriting the head in turn.
 *
 * Admission is synchronous and answers the producer in the delta door's shapes: a
 * malformed body or wrong target 400, a frozen project 423, a stale base 409 +
 * `headVersion`. The merge's own refusal (a round whose held-out loss rose) has no
 * caller left to answer; it is kept on the head as `lastRound` and served by the read.
 */
import {
  mergeMlHeadRound,
  mlHeadDoors,
  mlHeadDoorFor,
  mlHeadView,
  parseMlHeadContribution,
  type MlHeadContribution,
  type MlHeadDoor,
  type MlHeadEvalRow,
} from '../../application/llm/evermindMlHeads';
import { frozenRefusal, staleBaseRefusal } from '../../application/llm/evermindDeltaLearn';
import type { EvermindMlHead } from '@seanhogg/builderforce-memory-engine';

/**
 * Queued head contributions kept per target (oldest dropped past this) — the cost guard,
 * sized with `ML_HEAD_HOLDOUT_MAX` so one target's state fits ONE storage value. A device
 * pushes at most hourly, so a debounce window rarely holds more than a handful.
 */
const MAX_PENDING_HEAD = 16;

/** The storage this store needs — a subset of `DurableObjectStorage`. */
export interface MlHeadStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  getAlarm(): Promise<number | null>;
  setAlarm(scheduledTime: number): Promise<void>;
}

export interface MlHeadStoreDeps {
  /** The debounce before a queued batch merges (the coordinator's LM debounce). */
  debounceMs: number;
  /** The project's Evermind learning mode (`offline-frozen` refuses every learn). */
  mode(tenantId: number, projectId: number): Promise<string>;
  /** A round was accepted — the read cache's version is bumped here. */
  onMerged(owner: MlHeadOwner, target: string): Promise<void>;
  now?: () => number;
}

export interface MlHeadOwner {
  tenantId: number;
  projectId: number;
}

/** The last merge round, as the read reports it. */
export interface MlHeadLastRound {
  at: number;
  accepted: boolean;
  merged: number;
  /** The refusal body (`{ ok: false, error, baseLoss?, newLoss? }`) when refused. */
  refusal?: Record<string, unknown>;
  rejected: { index: number; reason: string }[];
}

interface MlHeadState {
  owner?: MlHeadOwner;
  head: EvermindMlHead;
  pool: MlHeadEvalRow[];
  pending: MlHeadContribution[];
  lastRound?: MlHeadLastRound;
}

/** An answer for the DO to send verbatim. */
export interface MlHeadAnswer {
  status: number;
  body: Record<string, unknown>;
}

const stateKey = (target: string): string => `mlhead:${target}`;

export class EvermindMlHeadStore {
  private readonly now: () => number;

  constructor(private readonly storage: MlHeadStorage, private readonly deps: MlHeadStoreDeps) {
    this.now = deps.now ?? Date.now;
  }

  private async load(door: MlHeadDoor): Promise<MlHeadState> {
    return (await this.storage.get<MlHeadState>(stateKey(door.target))) ?? { head: door.initial(), pool: [], pending: [] };
  }

  /** `POST /learn-head` — admit one head contribution and queue it for the next merge. */
  async learn(raw: unknown): Promise<MlHeadAnswer> {
    const body = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
    if (!body || typeof body.tenantId !== 'number' || typeof body.projectId !== 'number') {
      return { status: 400, body: { ok: false, error: 'tenantId, projectId, target, diff, baseVersion, holdout required' } };
    }
    const door = mlHeadDoorFor(body.target);
    if (!door) return { status: 400, body: { ok: false, error: `target ${String(body.target ?? '(model)')} is not a federated ML head` } };
    const parsed = parseMlHeadContribution(body, door);
    if (!parsed.ok) return parsed.refusal;
    const owner: MlHeadOwner = { tenantId: body.tenantId, projectId: body.projectId };
    const frozen = frozenRefusal(await this.deps.mode(owner.tenantId, owner.projectId));
    if (frozen) return frozen;

    const state = await this.load(door);
    const stale = staleBaseRefusal(parsed.contribution.payload.baseVersion, state.head.version);
    if (stale) return stale;
    const pending = [...state.pending, parsed.contribution];
    const dropped = pending.length > MAX_PENDING_HEAD ? pending.splice(0, pending.length - MAX_PENDING_HEAD).length : 0;
    await this.storage.put(stateKey(door.target), { ...state, owner, pending } satisfies MlHeadState);
    // The same debounce as an LM learn: only arm when no merge is already scheduled.
    if ((await this.storage.getAlarm()) == null) await this.storage.setAlarm(this.now() + this.deps.debounceMs);
    return { status: 200, body: { ok: true, target: door.target, queued: pending.length, baseVersion: state.head.version, ...(dropped ? { dropped } : {}) } };
  }

  /** `GET /ml-head?target=` — the merged head (flat params) and the last round's outcome. */
  async read(target: string | null): Promise<MlHeadAnswer> {
    const door = mlHeadDoorFor(target);
    if (!door) return { status: 400, body: { ok: false, error: `target ${target ?? '(none)'} is not a federated ML head` } };
    const state = await this.load(door);
    return { status: 200, body: { ...mlHeadView(door, state.head), pending: state.pending.length, ...(state.lastRound ? { lastRound: state.lastRound } : {}) } };
  }

  /** The alarm's half: merge every head's queued batch. Returns the targets whose round was accepted. */
  async drain(): Promise<string[]> {
    const merged: string[] = [];
    for (const door of mlHeadDoors().values()) {
      const state = await this.storage.get<MlHeadState>(stateKey(door.target));
      if (!state || state.pending.length === 0) continue;
      const round = mergeMlHeadRound(door, state.head, state.pending, state.pool);
      const lastRound: MlHeadLastRound = {
        at: this.now(),
        accepted: round.accepted,
        merged: state.pending.length - round.rejected.length,
        rejected: round.rejected,
        ...(round.refusal ? { refusal: round.refusal.body } : {}),
      };
      // The batch is consumed either way: re-merging a refused batch would regress again,
      // and a stale contribution is its producer's to rebase.
      await this.storage.put(stateKey(door.target), { ...state, head: round.head, pool: round.pool, pending: [], lastRound } satisfies MlHeadState);
      if (round.accepted) {
        merged.push(door.target);
        if (state.owner) await this.deps.onMerged(state.owner, door.target);
      }
    }
    return merged;
  }
}
