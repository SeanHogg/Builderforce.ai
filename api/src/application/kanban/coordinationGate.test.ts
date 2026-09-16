import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TenantRole } from '../../domain/shared/types';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

/**
 * The gate itself, without a router.
 *
 * Three things it must never get wrong:
 *   • the FLOOR is absolute — no project setting lets a viewer or a canvas contributor
 *     staff a ticket, which is why `coordinationRequiresManager` can only ever tighten;
 *   • a manager is admitted without a policy read, because every coordination route calls
 *     this and the common case must not pay for a round-trip that cannot change the answer;
 *   • a refusal carries a REMEDY. `403 manager role required` on its own is what a model
 *     retries; a sentence naming the setting is what it acts on.
 */

const mocks = vi.hoisted(() => ({
  getEffectiveManagerPolicy: vi.fn(async () => ({ coordinationRequiresManager: false })),
}));
vi.mock('../manager/managerPolicyStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../manager/managerPolicyStore')>()),
  getEffectiveManagerPolicy: mocks.getEffectiveManagerPolicy,
}));

const { coordinationGate } = await import('./coordinationGate');

const PROJECT_ID = 12;

/** A db that answers the one `select projectId from tasks` the gate makes. */
function dbFor(rows: Array<{ projectId: number }>): Db {
  return {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => rows }) }) }),
  } as unknown as Db;
}

const env = {} as Env;
const args = { tenantId: 5, taskId: 9 };

beforeEach(() => {
  mocks.getEffectiveManagerPolicy.mockClear();
  mocks.getEffectiveManagerPolicy.mockResolvedValue({ coordinationRequiresManager: false });
});

describe('coordinationGate', () => {
  it('refuses below the working-team floor, without reading the project policy', async () => {
    for (const role of [TenantRole.VIEWER, TenantRole.CONTRIBUTOR, null, undefined, 'nonsense' as never]) {
      const verdict = await coordinationGate(dbFor([{ projectId: PROJECT_ID }]), env, { ...args, role });
      expect(verdict).toEqual({
        ok: false, status: 403, error: 'manager role required',
        remedy: 'coordination needs the working-team tier', projectId: 0,
      });
    }
    expect(mocks.getEffectiveManagerPolicy).not.toHaveBeenCalled();
  });

  it('admits a manager as `manager` without reading the project policy', async () => {
    for (const role of [TenantRole.MANAGER, TenantRole.OWNER]) {
      expect(await coordinationGate(dbFor([{ projectId: PROJECT_ID }]), env, { ...args, role }))
        .toEqual({ ok: true, authority: 'manager' });
    }
    expect(mocks.getEffectiveManagerPolicy).not.toHaveBeenCalled();
  });

  it('admits a developer as `open` when the project has not opted in', async () => {
    const verdict = await coordinationGate(dbFor([{ projectId: PROJECT_ID }]), env, { ...args, role: TenantRole.DEVELOPER });

    expect(verdict).toEqual({ ok: true, authority: 'open' });
    expect(mocks.getEffectiveManagerPolicy).toHaveBeenCalledWith(expect.anything(), 5, PROJECT_ID, env);
  });

  it('refuses a developer with an actionable remedy once the project opts in', async () => {
    mocks.getEffectiveManagerPolicy.mockResolvedValue({ coordinationRequiresManager: true });

    const verdict = await coordinationGate(dbFor([{ projectId: PROJECT_ID }]), env, { ...args, role: TenantRole.DEVELOPER });

    expect(verdict).toEqual({
      ok: false, status: 403, error: 'manager role required', projectId: PROJECT_ID,
      remedy: `coordination_requires_manager is on for project ${PROJECT_ID} — a manager can turn it off with `
        + `manager.configure { projectId: ${PROJECT_ID}, coordinationRequiresManager: false }`,
    });
  });

  it('accepts the wire spelling of a role, not only the enum', async () => {
    expect(await coordinationGate(dbFor([{ projectId: PROJECT_ID }]), env, { ...args, role: 'manager' }))
      .toEqual({ ok: true, authority: 'manager' });
  });

  it('refuses a ticket this workspace does not have, and says THAT', async () => {
    const verdict = await coordinationGate(dbFor([]), env, { ...args, role: TenantRole.DEVELOPER });

    expect(verdict).toMatchObject({ ok: false, status: 403, projectId: 0, remedy: 'ticket 9 is not on this workspace' });
    expect(mocks.getEffectiveManagerPolicy).not.toHaveBeenCalled();
  });
});
