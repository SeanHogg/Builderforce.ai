import { describe, it, expect } from 'vitest';
import { isProjectManaged, resolveEffectiveManagerPolicy, DEFAULT_MANAGER_POLICY, type ManagerConfigRow } from './managerPolicy';

const row = (over: Partial<ManagerConfigRow> = {}): ManagerConfigRow =>
  ({ enabled: true, ...over } as ManagerConfigRow);

/**
 * MANAGING A PROJECT IS OPT-IN, AND "ENABLED" CANNOT EXPRESS IT.
 *
 * `DEFAULT_MANAGER_POLICY.enabled` is `true` and the fold applies it to a project with
 * no row, so `resolveEffectiveManagerPolicy(null).enabled` is `true` — for a project
 * that has never heard of the manager. The old sweep matched `hasWork OR hasConfig`, so
 * the real rule was "any project with a board and an open ticket gets an AI manager".
 *
 * The row is the consent. These pin the distinction the fold cannot make on its own.
 */
describe('isProjectManaged — the opt-in', () => {
  it('is FALSE for a project with no config row, even though the policy says enabled', () => {
    expect(resolveEffectiveManagerPolicy(null).enabled).toBe(true);
    expect(DEFAULT_MANAGER_POLICY.enabled).toBe(true);
    // The whole point: the two answers differ, and only this one is consent.
    expect(isProjectManaged({ project: null })).toBe(false);
    expect(isProjectManaged({})).toBe(false);
  });

  it('is TRUE once a project has its own enabled row', () => {
    expect(isProjectManaged({ project: row() })).toBe(true);
  });

  it('honours the project master switch', () => {
    expect(isProjectManaged({ project: row({ enabled: false }) })).toBe(false);
  });

  /**
   * A workspace default shapes HOW an opted-in project is managed. It is not a licence
   * over projects that never opted in — otherwise setting any workspace default would
   * silently re-enable management across the whole instance, which is the opt-out
   * behaviour this replaced.
   */
  it('does not let a workspace default opt a project in on its behalf', () => {
    expect(isProjectManaged({ tenant: { enabled: true } as never, project: null })).toBe(false);
  });

  /**
   * Most-restrictive-wins still applies: a workspace that turned management OFF cannot
   * be overridden by a project row that says on.
   */
  it('still respects a workspace tier that disabled management', () => {
    // The project row alone would say yes — the workspace veto is what makes it no.
    expect(isProjectManaged({ project: row() })).toBe(true);
    expect(isProjectManaged({ tenant: { enabled: false } as never, project: row() })).toBe(false);
  });
});
