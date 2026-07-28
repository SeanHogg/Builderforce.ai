import { describe, it, expect } from 'vitest';
import {
  agentRoleKeys, agentIsRoleCapable, buildRoleRoster, isAgentRefRoleCapable, personaForRole,
  producerRoleForActionType, type RoleCapableAgentRow, type RoleRosterData,
} from './roleCapability';
import { ideAgents } from '../../infrastructure/database/schema';

describe('producerRoleForActionType', () => {
  it('maps coding action types to developer', () => {
    for (const t of ['sql', 'frontend_ui', 'backend_api', 'refactor', 'bugfix', 'data_migration']) {
      expect(producerRoleForActionType(t)).toBe('developer');
    }
  });
  it('maps non-coding action types to their producer role', () => {
    expect(producerRoleForActionType('tests')).toBe('qa-tester');
    expect(producerRoleForActionType('docs')).toBe('tech-writer');
    expect(producerRoleForActionType('devops_ci')).toBe('devops');
  });
  it('imposes no constraint for ambiguous/other', () => {
    expect(producerRoleForActionType('other')).toBeUndefined();
    expect(producerRoleForActionType(null)).toBeUndefined();
    expect(producerRoleForActionType(undefined)).toBeUndefined();
  });
});

describe('agentRoleKeys / agentIsRoleCapable (#467 regression)', () => {
  // Ada — a built-in Product Manager agent. She must NEVER be developer-capable, so
  // she can never be auto-dispatched to write code on an Implementation stage.
  const ada: RoleCapableAgentRow = { id: 'product-manager-t1', name: 'Ada', title: 'Sr. Product Manager', skills: '["product-management","roadmapping"]', builtinKind: 'product_manager', roleKeys: null };

  it('a Product Manager agent is product-capable but NOT developer-capable', () => {
    const keys = agentRoleKeys(ada);
    expect(keys.has('product-manager')).toBe(true);
    expect(keys.has('product-owner')).toBe(true);
    expect(agentIsRoleCapable(ada, 'developer')).toBe(false);
    expect(agentIsRoleCapable(ada, 'product-manager')).toBe(true);
  });

  it('generic coding skills do not turn a built-in Product Manager into a Developer', () => {
    const configuredAda: RoleCapableAgentRow = {
      ...ada,
      skills: '["product-management","github","coding-agent","code-creator"]',
    };
    expect(agentIsRoleCapable(configuredAda, 'developer')).toBe(false);
    expect(agentIsRoleCapable(configuredAda, 'business-analyst')).toBe(true);
  });

  it('explicit role_keys make an agent capable', () => {
    const dev: RoleCapableAgentRow = { id: 'a2', name: 'Builder', title: null, skills: null, builtinKind: null, roleKeys: ['developer'] };
    expect(agentIsRoleCapable(dev, 'developer')).toBe(true);
    expect(agentIsRoleCapable(dev, 'security')).toBe(false);
  });

  it('builtin_kind validator is capable of review/validation roles', () => {
    const v: RoleCapableAgentRow = { id: 'validator-t1', name: 'Validator', title: null, skills: null, builtinKind: 'validator', roleKeys: null };
    expect(agentIsRoleCapable(v, 'validator')).toBe(true);
    expect(agentIsRoleCapable(v, 'code-reviewer')).toBe(true);
    expect(agentIsRoleCapable(v, 'team-lead')).toBe(true);
  });

  it('fuzzy title/skill match is the last-resort fallback', () => {
    const fuzzy: RoleCapableAgentRow = { id: 'a3', name: 'Security Bot', title: 'Security Engineer', skills: null, builtinKind: null, roleKeys: null };
    expect(agentIsRoleCapable(fuzzy, 'security')).toBe(true);
  });

  it('empty roleKey imposes no constraint', () => {
    expect(agentIsRoleCapable(ada, '')).toBe(true);
    expect(agentIsRoleCapable(ada, null)).toBe(true);
  });
});

/**
 * THE EMPTY SIGN-OFF LEDGER. Measured 2026-07-26 across all 767 tickets: **0 rows in
 * `ticket_role_signoffs` against 1,030 reviewer runs (442 completed)**, 2,288 required
 * manifest slots stuck `assigned`, and only 7 tickets ever reaching Done from review.
 *
 * The cause was an asymmetry between the SELECTOR and the GATE. `resolveRoleCapableAgents`
 * dispatches a reviewer via four paths, the first being an explicit
 * `project_role_assignments` pin. `isAgentRefRoleCapable` — which the sign-off route,
 * the managed-execution guard and the auto-run evaluator all gate on — read only the
 * derived capability (role_keys ∪ builtin_kind ∪ fuzzy) and never the pin. An agent
 * dispatched BECAUSE it was pinned was then refused with
 * `403 not authorized to sign off as role '<key>'`.
 */
function dbWithPin(agentRow: Record<string, unknown> | null, pins: Array<{ ref: string }>) {
  const reads = { agents: 0, pins: 0 };
  const db = {
    select: () => ({
      from: (table: unknown) => {
        const isAgents = table === ideAgents;
        if (isAgents) reads.agents += 1; else reads.pins += 1;
        const rows = isAgents
          ? (agentRow ? [agentRow] : [])
          : pins.map((p) => ({ projectId: 7, roleKey: 'code-reviewer', assigneeRef: p.ref, assigneeName: null }));
        // The roster loader awaits `.where(...)` directly; older narrow reads chained
        // `.limit()`. Both resolve to the same rows.
        const result = Promise.resolve(rows) as Promise<unknown[]> & { limit: () => Promise<unknown[]> };
        result.limit = async () => rows;
        return { where: () => result };
      },
    }),
  } as never;
  return { db, reads };
}

const PM_ROW = { id: 'product-manager-t1', name: 'Ada', title: 'Sr. Product Manager', skills: null, builtinKind: 'product_manager', roleKeys: null };

describe('isAgentRefRoleCapable — the GATE must accept what the SELECTOR dispatches', () => {
  it('honours an explicit project_role_assignments pin the derived capability does NOT grant', async () => {
    // Exactly the production shape: a built-in Product Manager pinned as the reviewer.
    // `agentRoleKeys` returns EARLY for a builtin_kind row (no fuzzy widening), so the
    // pin is the ONLY thing that can authorize it — and the pin was never read.
    expect(agentIsRoleCapable(PM_ROW as RoleCapableAgentRow, 'code-reviewer')).toBe(false);
    const { db } = dbWithPin(PM_ROW, [{ ref: 'product-manager-t1' }]);
    expect(await isAgentRefRoleCapable(db, 1, 'product-manager-t1', 'code-reviewer', 7)).toBe(true);
  });

  it('still DENIES an agent with neither derived capability nor a pin (default-deny holds)', async () => {
    const { db } = dbWithPin(PM_ROW, []);
    expect(await isAgentRefRoleCapable(db, 1, 'product-manager-t1', 'code-reviewer', 7)).toBe(false);
  });

  it('accepts derived capability with no pin at all', async () => {
    const validator = { id: 'validator-t1', name: 'Validator', title: null, skills: null, builtinKind: 'validator', roleKeys: null };
    const { db } = dbWithPin(validator, []);
    expect(await isAgentRefRoleCapable(db, 1, 'validator-t1', 'code-reviewer', 7)).toBe(true);
  });

  /**
   * A FOURTH instance of the same asymmetry, resolved the other way. The gate used to
   * honour a pin naming an agent that is not on the ACTIVE roster; the selector always
   * dropped it (`if (!a) continue`). One oracle cannot hold both opinions, and the
   * selector's is the correct one: a retired agent cannot be dispatched, so a pin to one
   * must not keep a stage looking staffed. The gate is now fail-closed on it.
   */
  it('refuses a pin naming an agent that is not on the active roster', async () => {
    const { db } = dbWithPin(null, [{ ref: 'ghost' }]);
    expect(await isAgentRefRoleCapable(db, 1, 'ghost', 'code-reviewer', 7)).toBe(false);
  });

  it('keeps the cheap guards: empty roleKey passes, empty agentRef fails, with NO reads', async () => {
    const { db, reads } = dbWithPin(PM_ROW, [{ ref: 'product-manager-t1' }]);
    expect(await isAgentRefRoleCapable(db, 1, 'product-manager-t1', '', 7)).toBe(true);
    expect(await isAgentRefRoleCapable(db, 1, '', 'code-reviewer', 7)).toBe(false);
    expect(reads.agents + reads.pins).toBe(0);
  });

  /**
   * THE COST PROPERTY. The oracle answers for the whole roster at once, so binding every
   * role on a board costs ONE load — the thing that makes selector↔guard parity
   * affordable on a 675-ticket census instead of an N+1 per role per lane.
   */
  it('answers every role from ONE roster load', async () => {
    const validator = { id: 'validator-t1', name: 'Validator', title: null, skills: null, builtinKind: 'validator', roleKeys: null };
    const data: RoleRosterData = { agents: [validator as RoleCapableAgentRow], pins: [] };
    const roster = buildRoleRoster(data, 7);
    for (const key of ['code-reviewer', 'qa-tester', 'validator', 'business-analyst']) {
      expect(roster.candidates(key).map((c) => c.ref)).toEqual(['validator-t1']);
    }
    expect(roster.candidates('developer')).toEqual([]);
  });
});

describe('personaForRole', () => {
  it('aliases kanban role keys to runtime personas', () => {
    expect(personaForRole('developer')).toBe('code-creator');
    expect(personaForRole('qa-tester')).toBe('test-generator');
    expect(personaForRole('architect')).toBe('architecture-advisor');
    expect(personaForRole('code-reviewer')).toBe('code-reviewer');
    expect(personaForRole('validator')).toBe('validator-agent');
  });
});
