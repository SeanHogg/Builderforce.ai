import { describe, expect, it } from 'vitest';
import { TenantRole } from '../../domain/shared/types';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { tasks, projectManagerConfigs, tenantManagerDefaults } from '../../infrastructure/database/schema';
import { coordinationGate } from './coordinationGate';

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
 *
 * The policy store is REAL. Under this package's Vitest 4 + threads pool, `vi.mock` of
 * `managerPolicyStore` does not replace the binding `coordinationGate` imported, so the
 * tests drive the store through a table-aware drizzle stub instead: `tasks` for the
 * ticket lookup, `project_manager_configs` for the opt-in column (migration 1177).
 * `env` is omitted so the workspace-defaults read does not go through the KV cache.
 */

const PROJECT_ID = 12;
const args = { tenantId: 5, taskId: 9 };

function dbFor(opts: {
  taskRows?: Array<{ projectId: number }>;
  projectRows?: Array<{ coordinationRequiresManager: boolean }>;
  allowPolicy?: boolean;
}): Db {
  return {
    select: () => ({
      from: (table: unknown) => {
        const rows =
          table === tasks ? (opts.taskRows ?? [])
          : table === projectManagerConfigs ? (opts.allowPolicy === false
            ? (() => { throw new Error('policy must not be read'); })()
            : (opts.projectRows ?? []))
          : table === tenantManagerDefaults ? (opts.allowPolicy === false
            ? (() => { throw new Error('policy must not be read'); })()
            : [])
          : [];
        return { where: () => ({ limit: async () => rows }) };
      },
    }),
  } as unknown as Db;
}

describe('coordinationGate', () => {
  it('refuses below the working-team floor, without reading the project policy', async () => {
    const db = dbFor({ allowPolicy: false, taskRows: [{ projectId: PROJECT_ID }] });
    for (const role of [TenantRole.VIEWER, TenantRole.CONTRIBUTOR, null, undefined, 'nonsense' as never]) {
      const verdict = await coordinationGate(db, undefined, { ...args, role });
      expect(verdict).toEqual({
        ok: false, status: 403, error: 'manager role required',
        remedy: 'coordination needs the working-team tier', projectId: 0,
      });
    }
  });

  it('admits a manager as `manager` without reading the project policy', async () => {
    const db = dbFor({ allowPolicy: false, taskRows: [{ projectId: PROJECT_ID }] });
    for (const role of [TenantRole.MANAGER, TenantRole.OWNER]) {
      expect(await coordinationGate(db, undefined, { ...args, role }))
        .toEqual({ ok: true, authority: 'manager' });
    }
  });

  it('admits a developer as `open` when the project has not opted in', async () => {
    const db = dbFor({ taskRows: [{ projectId: PROJECT_ID }], projectRows: [] });
    const verdict = await coordinationGate(db, undefined, { ...args, role: TenantRole.DEVELOPER });
    expect(verdict).toEqual({ ok: true, authority: 'open' });
  });

  it('refuses a developer with an actionable remedy once the project opts in', async () => {
    const db = dbFor({
      taskRows: [{ projectId: PROJECT_ID }],
      projectRows: [{ coordinationRequiresManager: true }],
    });

    const verdict = await coordinationGate(db, undefined, { ...args, role: TenantRole.DEVELOPER });

    expect(verdict).toEqual({
      ok: false, status: 403, error: 'manager role required', projectId: PROJECT_ID,
      remedy: `coordination_requires_manager is on for project ${PROJECT_ID} — a manager can turn it off with `
        + `manager.configure { projectId: ${PROJECT_ID}, coordinationRequiresManager: false }`,
    });
  });

  it('accepts the wire spelling of a role, not only the enum', async () => {
    expect(await coordinationGate(dbFor({ allowPolicy: false }), undefined, { ...args, role: 'manager' }))
      .toEqual({ ok: true, authority: 'manager' });
  });

  it('refuses a ticket this workspace does not have, and says THAT', async () => {
    const db = dbFor({ allowPolicy: false, taskRows: [] });
    const verdict = await coordinationGate(db, undefined as unknown as Env, { ...args, role: TenantRole.DEVELOPER });

    expect(verdict).toMatchObject({ ok: false, status: 403, projectId: 0, remedy: 'ticket 9 is not on this workspace' });
  });
});
