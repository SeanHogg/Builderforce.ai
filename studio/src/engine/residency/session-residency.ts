/**
 * SessionResidency — the VRAM/RAM budget for live ORT sessions.
 *
 * Owns a `createMemoryManager` from `@seanhogg/builderforce-webcontainers/ml`.
 * Every ORT session a DiffusionEngine creates is admitted as one resident
 * (`${modelId}/${component}`, group = modelId) charged at the byte size of the
 * weights it was built from (model + external-data sidecar).
 *
 * Sessions are admitted PINNED for their whole life, so the manager never
 * evicts a live session: a session is only ever freed by its owning engine,
 * through {@link SessionResidency.releaseModel} (dispose, or a failed init).
 * An admission that does not fit beside the pinned residents is rejected by
 * the manager; the session still exists and stays owned by its engine
 * (released by `releaseModel`), it is simply not budget-tracked.
 *
 * One instance is shared between a VideoEngine's draft and refinement engines.
 * The max(draft, refinement) rule is enforced by the VideoEngine itself — the
 * refinement pass disposes the draft engine before creating the refinement
 * one — so the budget only ever holds one model's sessions at a time. What the
 * budget is for is reporting: {@link SessionResidency.isPressured} and
 * {@link SessionResidency.headroomBytes} let background work (the refinement
 * weight warm) back off from memory the live sessions need.
 */

import {
  createMemoryManager,
  estimateReloadCostMs,
  probeRamBytes,
  type AdmitResult,
  type MemoryManager,
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
 * Fraction of the device memory hint the resident sessions may occupy. The
 * other 20 % is headroom for what the budget does not count: latents, UNet
 * activations, ORT's per-run workspace, the tokenizer and the page itself.
 * The hint is the probed VRAM (`probed.approxMemoryMb`) when the device
 * reports it, otherwise `probeRamBytes()` — navigator.deviceMemory, else the
 * manager's 4 GiB default.
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
}

export class SessionResidency {
  private readonly manager: MemoryManager;
  private readonly tier: 'vram' | 'ram';

  constructor(probed: Pick<ProbedDevice, 'kind' | 'approxMemoryMb'>, byteBudget = residencyBudgetBytes(probed)) {
    const onGpu = probed.kind === 'webgpu' || probed.kind === 'webnn';
    this.tier = onGpu ? 'vram' : 'ram';
    this.manager = createMemoryManager({ byteBudget, vramBudgetBytes: onGpu ? byteBudget : 0 });
  }

  /** Charge one freshly created session against the budget. Pinned for its
   *  whole life: the manager never evicts it. */
  async admit(args: AdmitSessionArgs): Promise<AdmitResult> {
    return this.manager.admit(
      {
        id: sessionResidentId(args.modelId, args.component),
        group: args.modelId,
        component: args.component,
        bytes: args.bytes,
        reloadCostMs: estimateReloadCostMs({ bytes: args.bytes, from: 'storage' }),
        // A live engine runs every one of its sessions on every frame.
        reuseProbability: 1,
        tier: this.tier,
        payload: args.session,
      },
      { pin: true, spill: false },
    );
  }

  /** Drop every resident of `modelId` from the budget and release `sessions`
   *  (the engine's own references — it may hold sessions the budget rejected).
   *  Release errors are swallowed so one bad session cannot block the rest. */
  async releaseModel(modelId: string, sessions: ReadonlyArray<ReleasableSession | null>): Promise<void> {
    for (const component of SESSION_COMPONENTS) {
      await this.manager.release(sessionResidentId(modelId, component));
    }
    await Promise.all(sessions.map((s) => releaseQuietly(s)));
  }

  /** Whether the budget is under memory pressure right now — background work
   *  (the refinement weight warm) pauses while it is. */
  isPressured(): boolean {
    return this.manager.pressure().pressured;
  }

  /** Budget bytes not charged to a live session (never negative). */
  headroomBytes(): number {
    const { byteBudget, usedBytes } = this.manager.stats();
    return Math.max(0, byteBudget - usedBytes);
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
