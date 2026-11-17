/**
 * SessionResidency — the VRAM/RAM budget for live ORT sessions.
 *
 * Owns a `createMemoryManager` from `@seanhogg/builderforce-webcontainers/ml`.
 * Every ORT session a DiffusionEngine creates is admitted as one resident
 * (`${modelId}/${component}`, group = modelId) charged at the byte size of the
 * weights it was built from (model + external-data sidecar). When an admission
 * does not fit, the manager evicts residents; this class then tells the owning
 * engine (so it drops its reference) and calls `release()` on the evicted
 * session — release errors are swallowed exactly as DiffusionEngine's own
 * teardown always has.
 *
 * One instance is shared between a VideoEngine's draft and refinement engines,
 * which is what enforces the max(draft, refinement) rule: admitting refinement
 * sessions evicts (and releases) draft sessions whenever both cannot fit.
 *
 * A model's sessions are admitted PINNED while that model initialises — the
 * manager evicts same-group residents first, so unpinned it would evict the
 * text encoder to fit the UNet of the SAME engine. `settle(modelId)` unpins
 * them once init completes, making them evictable by the next model.
 * `whileInUse(modelId, work)` re-pins them for the duration of one run, so a
 * concurrent admission cannot evict + release a session a denoise is using.
 *
 * An admission that cannot fit even after evicting every unpinned resident is
 * rejected by the manager; the session still exists and stays owned by its
 * engine (released by `releaseModel`), it is simply not budget-tracked.
 */

import {
  createMemoryManager,
  estimateReloadCostMs,
  probeRamBytes,
  type AdmitResult,
  type MemoryManager,
  type TrackedEntry,
} from '@seanhogg/builderforce-webcontainers/ml';
import type { ProbedDevice } from '../device-router';

/** The three ORT sessions a lcm-diffusion engine holds. */
export type SessionComponent = 'text_encoder' | 'unet' | 'vae_decoder';

const SESSION_COMPONENTS: readonly SessionComponent[] = ['text_encoder', 'unet', 'vae_decoder'];

/** What residency needs from a session: just the ability to free it. */
export interface ReleasableSession {
  release(): Promise<void>;
}

const MIB = 1024 * 1024;

/**
 * Fraction of the probed memory the resident sessions may occupy. The other
 * 20 % is headroom for what the budget does not count: latents, UNet
 * activations, ORT's per-run workspace, the tokenizer and the page itself.
 * Applied to `probed.approxMemoryMb` when the device reports it, otherwise to
 * `probeRamBytes()` (navigator.deviceMemory, else the manager's 4 GiB default).
 */
export const RESIDENT_BUDGET_FRACTION = 0.8;

/** Byte budget for one device — see {@link RESIDENT_BUDGET_FRACTION}. */
export function residencyBudgetBytes(probed: Pick<ProbedDevice, 'approxMemoryMb'>): number {
  const total = probed.approxMemoryMb !== null ? probed.approxMemoryMb * MIB : probeRamBytes();
  return Math.max(1, Math.floor(total * RESIDENT_BUDGET_FRACTION));
}

/** Resident id of one session — `${modelId}/${component}`. */
export function sessionResidentId(modelId: string, component: SessionComponent): string {
  return `${modelId}/${component}`;
}

export interface AdmitSessionArgs {
  modelId: string;
  component: SessionComponent;
  /** Downloaded weight bytes the session was created from, sidecars included. */
  bytes: number;
  session: ReleasableSession;
  /** Called when the budget evicts this session, BEFORE it is released, so the
   *  owner can drop its reference. */
  onEvicted: () => void;
}

export class SessionResidency {
  private readonly manager: MemoryManager;
  private readonly tier: 'vram' | 'ram';
  /** Eviction callbacks of the currently tracked sessions, by resident id. */
  private readonly owners = new Map<string, () => void>();
  /** In-flight {@link whileInUse} runs per model id. */
  private readonly holds = new Map<string, number>();

  constructor(probed: Pick<ProbedDevice, 'kind' | 'approxMemoryMb'>, byteBudget = residencyBudgetBytes(probed)) {
    const onGpu = probed.kind === 'webgpu' || probed.kind === 'webnn';
    this.tier = onGpu ? 'vram' : 'ram';
    this.manager = createMemoryManager({ byteBudget, vramBudgetBytes: onGpu ? byteBudget : 0 });
  }

  /** Admit one freshly created session (pinned until {@link settle}), then
   *  release whatever the admission evicted. */
  async admit(args: AdmitSessionArgs): Promise<AdmitResult> {
    const id = sessionResidentId(args.modelId, args.component);
    const result = await this.manager.admit(
      {
        id,
        group: args.modelId,
        component: args.component,
        bytes: args.bytes,
        // An evicted session is rebuilt from the IndexedDB weight store.
        reloadCostMs: estimateReloadCostMs({ bytes: args.bytes, from: 'storage' }),
        // A live engine runs every one of its sessions on every frame.
        reuseProbability: 1,
        tier: this.tier,
        payload: args.session,
      },
      { pin: true, spill: false },
    );
    if (result.admitted) this.owners.set(id, args.onEvicted);
    await this.releaseEvicted(result.evicted);
    return result;
  }

  /** Init of `modelId` finished: unpin its sessions so a later model's
   *  admissions may evict them (unless a run currently holds them). */
  settle(modelId: string): void {
    if (!this.holds.has(modelId)) this.setPinned(modelId, false);
  }

  /** Run `work` with `modelId`'s sessions pinned, so no admission can evict
   *  (and release) a session mid-run. Re-entrant: the last run out unpins. */
  async whileInUse<T>(modelId: string, work: () => Promise<T>): Promise<T> {
    this.holds.set(modelId, (this.holds.get(modelId) ?? 0) + 1);
    this.setPinned(modelId, true);
    try {
      return await work();
    } finally {
      const left = (this.holds.get(modelId) ?? 1) - 1;
      if (left > 0) this.holds.set(modelId, left);
      else {
        this.holds.delete(modelId);
        this.setPinned(modelId, false);
      }
    }
  }

  private setPinned(modelId: string, pinned: boolean): void {
    for (const id of this.manager.residentIds()) {
      if (this.manager.peek(id)?.group !== modelId) continue;
      if (pinned) this.manager.pin(id);
      else this.manager.unpin(id);
    }
  }

  /** Drop every resident of `modelId` from the budget and release `sessions`
   *  (the engine's own references — it may hold sessions the budget rejected).
   *  Release errors are swallowed so one bad session cannot block the rest. */
  async releaseModel(modelId: string, sessions: ReadonlyArray<ReleasableSession | null>): Promise<void> {
    for (const component of SESSION_COMPONENTS) {
      const id = sessionResidentId(modelId, component);
      this.owners.delete(id);
      await this.manager.release(id);
    }
    await Promise.all(sessions.map((s) => releaseQuietly(s)));
  }

  /** Whether the budget is under memory pressure right now — background work
   *  (the refinement weight warm) backs off while it is. */
  isPressured(): boolean {
    return this.manager.pressure().pressured;
  }

  /** Ids currently charged against the budget. */
  residentIds(): string[] {
    return this.manager.residentIds();
  }

  private async releaseEvicted(evicted: readonly TrackedEntry[]): Promise<void> {
    await Promise.all(
      evicted.map(async (entry) => {
        const onEvicted = this.owners.get(entry.id);
        this.owners.delete(entry.id);
        onEvicted?.();
        await releaseQuietly(entry.payload as ReleasableSession | undefined);
      }),
    );
  }
}

async function releaseQuietly(session: ReleasableSession | null | undefined): Promise<void> {
  if (!session) return;
  try {
    await session.release();
  } catch {
    // release() can throw if the session was never fully created; we still
    // want to continue tearing down the other resources.
  }
}
