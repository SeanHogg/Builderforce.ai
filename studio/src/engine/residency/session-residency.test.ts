import { describe, expect, it, vi } from 'vitest';
import {
  RESIDENT_BUDGET_FRACTION,
  SessionResidency,
  residencyBudgetBytes,
  sessionResidentId,
  type SessionComponent,
} from './session-residency';

/**
 * The max(draft, refinement) VRAM rule: one SessionResidency is shared by the
 * draft and refinement engines, so admitting refinement sessions that do not
 * fit beside the draft's evicts AND releases draft sessions.
 */

const MB = 1024 * 1024;
const PROBED = { kind: 'webgpu' as const, approxMemoryMb: null };

function fakeSession() {
  return { release: vi.fn(async () => {}) };
}

async function admitModel(
  residency: SessionResidency,
  modelId: string,
  sizesMb: Record<SessionComponent, number>,
) {
  const sessions = {} as Record<SessionComponent, ReturnType<typeof fakeSession>>;
  const evicted = {} as Record<SessionComponent, ReturnType<typeof vi.fn>>;
  for (const component of Object.keys(sizesMb) as SessionComponent[]) {
    sessions[component] = fakeSession();
    evicted[component] = vi.fn();
    await residency.admit({
      modelId,
      component,
      bytes: sizesMb[component] * MB,
      session: sessions[component],
      onEvicted: evicted[component],
    });
  }
  residency.settle(modelId);
  return { sessions, evicted };
}

describe('SessionResidency', () => {
  it('evicts and releases draft sessions when a refinement admit exceeds the budget', async () => {
    const residency = new SessionResidency(PROBED, 1000 * MB);
    const draft = await admitModel(residency, 'lcm-tiny-sd', { text_encoder: 200, unet: 300, vae_decoder: 100 });
    expect(residency.residentIds()).toHaveLength(3);

    // 600 MB draft resident; a 700 MB refinement UNet only fits once draft
    // sessions go.
    const refinement = await admitModel(residency, 'lcm-dreamshaper-v7', {
      text_encoder: 200,
      unet: 700,
      vae_decoder: 100,
    });

    const draftIds = (['text_encoder', 'unet', 'vae_decoder'] as const).map((c) => sessionResidentId('lcm-tiny-sd', c));
    expect(residency.residentIds().some((id) => draftIds.includes(id))).toBe(false);
    for (const component of ['text_encoder', 'unet', 'vae_decoder'] as const) {
      expect(draft.evicted[component]).toHaveBeenCalledTimes(1);
      expect(draft.sessions[component].release).toHaveBeenCalledTimes(1);
      expect(refinement.sessions[component].release).not.toHaveBeenCalled();
    }
    expect(residency.residentIds()).toEqual(
      expect.arrayContaining([
        sessionResidentId('lcm-dreamshaper-v7', 'text_encoder'),
        sessionResidentId('lcm-dreamshaper-v7', 'unet'),
        sessionResidentId('lcm-dreamshaper-v7', 'vae_decoder'),
      ]),
    );
  });

  it('never evicts a model\'s own sessions while that model is still initialising', async () => {
    const residency = new SessionResidency(PROBED, 500 * MB);
    const own = await admitModel(residency, 'sd-turbo', { text_encoder: 200, unet: 250, vae_decoder: 100 });
    // The VAE does not fit beside the pinned encoder + UNet: rejected, not evicting.
    expect(own.evicted.text_encoder).not.toHaveBeenCalled();
    expect(own.evicted.unet).not.toHaveBeenCalled();
    expect(own.sessions.text_encoder.release).not.toHaveBeenCalled();
  });

  it('keeps the draft resident when both models fit', async () => {
    const residency = new SessionResidency(PROBED, 4000 * MB);
    const draft = await admitModel(residency, 'lcm-tiny-sd', { text_encoder: 200, unet: 300, vae_decoder: 100 });
    await admitModel(residency, 'lcm-dreamshaper-v7', { text_encoder: 200, unet: 700, vae_decoder: 100 });
    expect(residency.residentIds()).toHaveLength(6);
    expect(draft.sessions.unet.release).not.toHaveBeenCalled();
  });

  it('rejects an admit that would evict a session in use, and never releases it', async () => {
    const residency = new SessionResidency(PROBED, 1000 * MB);
    const draft = await admitModel(residency, 'lcm-tiny-sd', { text_encoder: 200, unet: 300, vae_decoder: 100 });

    let refinementAdmit: Awaited<ReturnType<SessionResidency['admit']>> | undefined;
    await residency.whileInUse('lcm-tiny-sd', async () => {
      // Mid-denoise: a 700 MB UNet only fits by evicting the draft's sessions.
      refinementAdmit = await residency.admit({
        modelId: 'lcm-dreamshaper-v7',
        component: 'unet',
        bytes: 700 * MB,
        session: fakeSession(),
        onEvicted: vi.fn(),
      });
    });

    expect(refinementAdmit?.admitted).toBe(false);
    for (const component of ['text_encoder', 'unet', 'vae_decoder'] as const) {
      expect(draft.evicted[component]).not.toHaveBeenCalled();
      expect(draft.sessions[component].release).not.toHaveBeenCalled();
    }

    // Once the run ends the draft is evictable again.
    const retry = await residency.admit({
      modelId: 'lcm-dreamshaper-v7',
      component: 'unet',
      bytes: 700 * MB,
      session: fakeSession(),
      onEvicted: vi.fn(),
    });
    expect(retry.admitted).toBe(true);
    expect(Object.values(draft.sessions).some((s) => s.release.mock.calls.length > 0)).toBe(true);
  });

  it('releaseModel drops the budget entries and releases every session, swallowing errors', async () => {
    const residency = new SessionResidency(PROBED, 1000 * MB);
    const { sessions } = await admitModel(residency, 'lcm-tiny-sd', { text_encoder: 1, unet: 1, vae_decoder: 1 });
    sessions.unet.release.mockRejectedValueOnce(new Error('release threw'));
    await expect(
      residency.releaseModel('lcm-tiny-sd', [sessions.text_encoder, sessions.unet, sessions.vae_decoder, null]),
    ).resolves.toBeUndefined();
    expect(residency.residentIds()).toEqual([]);
    expect(sessions.text_encoder.release).toHaveBeenCalledTimes(1);
    expect(sessions.vae_decoder.release).toHaveBeenCalledTimes(1);
  });

  it('budgets a fraction of the probed memory', () => {
    expect(residencyBudgetBytes({ approxMemoryMb: 1000 })).toBe(Math.floor(1000 * MB * RESIDENT_BUDGET_FRACTION));
    expect(residencyBudgetBytes({ approxMemoryMb: null })).toBeGreaterThan(0);
  });
});
