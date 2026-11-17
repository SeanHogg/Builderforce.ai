import { describe, expect, it, vi } from 'vitest';
import {
  RESIDENT_BUDGET_FRACTION,
  SessionResidency,
  residencyBudgetBytes,
  type SessionComponent,
} from './session-residency';

/**
 * The session budget accounts for live ORT sessions and never evicts one: a
 * session is freed only by its owning engine (releaseModel). Background work
 * reads the budget through isPressured() and headroomBytes().
 */

const MB = 1024 * 1024;
const PROBED = { kind: 'webgpu' as const, approxMemoryMb: null };

function fakeSession() {
  return { release: vi.fn(async () => {}) };
}

async function admitModel(
  residency: SessionResidency,
  modelId: string,
  sizesMb: Partial<Record<SessionComponent, number>>,
) {
  const sessions = {} as Record<SessionComponent, ReturnType<typeof fakeSession>>;
  const admitted = {} as Record<SessionComponent, boolean>;
  for (const component of Object.keys(sizesMb) as SessionComponent[]) {
    sessions[component] = fakeSession();
    const result = await residency.admit({
      modelId,
      component,
      bytes: sizesMb[component]! * MB,
      session: sessions[component],
    });
    admitted[component] = result.admitted;
  }
  return { sessions, admitted };
}

describe('SessionResidency', () => {
  it('charges admitted sessions against the budget: headroom = budget − resident bytes', async () => {
    const residency = new SessionResidency(PROBED, 1000 * MB);
    expect(residency.headroomBytes()).toBe(1000 * MB);
    await admitModel(residency, 'lcm-tiny-sd', { text_encoder: 200, unet: 300, vae_decoder: 100 });
    expect(residency.headroomBytes()).toBe(400 * MB);
  });

  it('never evicts a live session: an admission that does not fit is rejected instead', async () => {
    const residency = new SessionResidency(PROBED, 1000 * MB);
    const draft = await admitModel(residency, 'lcm-tiny-sd', { text_encoder: 200, unet: 300, vae_decoder: 100 });

    // 600 MB resident; a 700 MB UNet would only fit by evicting the draft.
    const refinement = await admitModel(residency, 'lcm-dreamshaper-v7', { unet: 700 });

    expect(refinement.admitted.unet).toBe(false);
    for (const component of ['text_encoder', 'unet', 'vae_decoder'] as const) {
      expect(draft.admitted[component]).toBe(true);
      expect(draft.sessions[component].release).not.toHaveBeenCalled();
    }
    expect(refinement.sessions.unet.release).not.toHaveBeenCalled();
    expect(residency.headroomBytes()).toBe(400 * MB);
  });

  it('never evicts a model\'s own sessions while it initialises', async () => {
    const residency = new SessionResidency(PROBED, 500 * MB);
    const own = await admitModel(residency, 'sd-turbo', { text_encoder: 200, unet: 250, vae_decoder: 100 });
    // The VAE does not fit beside the encoder + UNet: rejected, not evicting.
    expect(own.admitted).toEqual({ text_encoder: true, unet: true, vae_decoder: false });
    expect(own.sessions.text_encoder.release).not.toHaveBeenCalled();
    expect(own.sessions.unet.release).not.toHaveBeenCalled();
    expect(residency.headroomBytes()).toBe(50 * MB);
  });

  it('keeps both models resident when both fit', async () => {
    const residency = new SessionResidency(PROBED, 4000 * MB);
    const draft = await admitModel(residency, 'lcm-tiny-sd', { text_encoder: 200, unet: 300, vae_decoder: 100 });
    await admitModel(residency, 'lcm-dreamshaper-v7', { text_encoder: 200, unet: 700, vae_decoder: 100 });
    expect(residency.headroomBytes()).toBe((4000 - 1600) * MB);
    expect(draft.sessions.unet.release).not.toHaveBeenCalled();
  });

  it('reports pressure once resident sessions approach the budget', async () => {
    const residency = new SessionResidency(PROBED, 1000 * MB);
    await admitModel(residency, 'lcm-tiny-sd', { unet: 100 });
    expect(residency.isPressured()).toBe(false);
    await admitModel(residency, 'lcm-dreamshaper-v7', { unet: 800 });
    expect(residency.isPressured()).toBe(true);
  });

  it('releaseModel drops the budget entries and releases every session, swallowing errors', async () => {
    const residency = new SessionResidency(PROBED, 1000 * MB);
    const { sessions } = await admitModel(residency, 'lcm-tiny-sd', { text_encoder: 1, unet: 1, vae_decoder: 1 });
    sessions.unet.release.mockRejectedValueOnce(new Error('release threw'));
    await expect(
      residency.releaseModel('lcm-tiny-sd', [sessions.text_encoder, sessions.unet, sessions.vae_decoder, null]),
    ).resolves.toBeUndefined();
    expect(residency.headroomBytes()).toBe(1000 * MB);
    expect(sessions.text_encoder.release).toHaveBeenCalledTimes(1);
    expect(sessions.vae_decoder.release).toHaveBeenCalledTimes(1);
  });

  it('budgets a fraction of the probed memory', () => {
    expect(residencyBudgetBytes({ approxMemoryMb: 1000 })).toBe(Math.floor(1000 * MB * RESIDENT_BUDGET_FRACTION));
    expect(residencyBudgetBytes({ approxMemoryMb: null })).toBeGreaterThan(0);
  });
});
