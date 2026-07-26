import { describe, it, expect } from 'vitest';
import {
  approverRoleKeyForLaneAgent, builtinRoleKeyFromText, decideLaneAgentApproval, decideLaneApprovers,
  laneApprovalOwed, loadLaneStaffedAgents, resolveLaneApprovers,
  type LaneStaffedAgent, type StaffedLaneApprover,
} from './laneApprover';
import { swimlaneAgentAssignments } from '../../infrastructure/database/schema';

/**
 * These tests guard the fix for a TOTAL, SILENT failure of the accountability loop.
 *
 * Approval used to resolve required roles from `swimlane_requirements` alone. Measured in
 * production: 1 of 11 boards has any requirement rows, so on the other 10 the lane gate
 * returned before it ever dispatched a reviewer — `ticket_role_signoffs` was EMPTY
 * tenant-wide (487 required slots, 0 satisfied) and every sign-off-based gate downstream
 * was unsatisfiable by construction. This resolver adds the second tier (the lane's
 * STAFFED agent) while keeping the fall-through fail-closed.
 */

function agent(over: Partial<LaneStaffedAgent> = {}): LaneStaffedAgent {
  return {
    agentRef: 'agent-1',
    agentName: 'Review Bot',
    declaredRole: 'Review Bot',
    model: null,
    position: 0,
    capableRoleKeys: ['code-reviewer'],
    ...over,
  };
}

describe('builtinRoleKeyFromText', () => {
  it('maps an assignment role/name string to a builtin role key', () => {
    expect(builtinRoleKeyFromText('Code Reviewer')).toBe('code-reviewer');
    expect(builtinRoleKeyFromText('QA / Tester')).toBe('qa-tester');
  });

  it('matches on CONTAINMENT, because the column holds a display name not a role key', () => {
    // `resolveAssignedAgent` stores the chosen agent's display name in
    // `swimlane_agent_assignments.role`. The pre-existing `normalizeRoleText(role) ===
    // roleKey` equality check therefore matched almost nothing in practice — which is a
    // large part of why lane staffing never resolved a role at all.
    expect(builtinRoleKeyFromText('Aria the Architect')).toBe('architect');
    expect(builtinRoleKeyFromText('Full Stack Developer')).toBe('developer');
  });

  it('prefers the LONGEST match, so a Product Manager is not filed as Delivery Manager', () => {
    // "Product Manager" contains both `manager` (Delivery Manager) and `product manager`.
    // First-match-in-catalog-order would silently mis-classify every product manager.
    expect(builtinRoleKeyFromText('Product Manager')).toBe('product-manager');
    expect(builtinRoleKeyFromText('Delivery Manager')).toBe('manager');
  });

  it('returns null for text that names no role — never guesses', () => {
    expect(builtinRoleKeyFromText('Sparkle Bot 3000')).toBeNull();
    expect(builtinRoleKeyFromText('')).toBeNull();
    expect(builtinRoleKeyFromText(null)).toBeNull();
  });
});

describe('approverRoleKeyForLaneAgent', () => {
  it('uses the operator DECLARED role when the agent is capable of it', () => {
    const key = approverRoleKeyForLaneAgent(agent({
      declaredRole: 'Security Engineer',
      capableRoleKeys: ['security', 'code-reviewer'],
    }));
    expect(key).toBe('security');
  });

  it('IGNORES a declared role the agent cannot act as, and picks a capable one instead', () => {
    // The sign-off route is default-deny: `isAgentRefRoleCapable` 403s an agent signing
    // as a role it cannot fill. Resolving an incapable role would dispatch a paid run
    // whose final step is guaranteed to be refused — so capability is part of resolution.
    const key = approverRoleKeyForLaneAgent(agent({
      declaredRole: 'Code Reviewer',
      capableRoleKeys: ['product-manager', 'product-owner', 'business-analyst'],
    }));
    expect(key).toBe('product-owner'); // the review-shaped role among its capabilities
  });

  it('prefers a REVIEW-shaped role over a producing one — we are resolving an APPROVER', () => {
    const key = approverRoleKeyForLaneAgent(agent({
      declaredRole: 'Helper',
      capableRoleKeys: ['developer', 'qa-tester'],
    }));
    expect(key).toBe('qa-tester');
  });

  it('falls back to a PRODUCING role when the agent can review nothing', () => {
    // A producer's sign-off is still a real accountability record ("the developer
    // confirms this is done"), so a dev-only lane still closes the loop.
    const key = approverRoleKeyForLaneAgent(agent({
      declaredRole: 'Helper',
      capableRoleKeys: ['developer'],
    }));
    expect(key).toBe('developer');
  });

  it('accepts a tenant CUSTOM role key when no builtin applies, deterministically', () => {
    const key = approverRoleKeyForLaneAgent(agent({
      declaredRole: 'Helper',
      capableRoleKeys: ['zeta-custom', 'alpha-custom'],
    }));
    // Sorted, not insertion-ordered: the manifest slot's unique index is keyed on the
    // role, so a flapping choice would materialise duplicate required slots that can
    // never all be satisfied.
    expect(key).toBe('alpha-custom');
  });

  it('returns null for an agent capable of NOTHING — the fail-closed leaf', () => {
    expect(approverRoleKeyForLaneAgent(agent({ capableRoleKeys: [] }))).toBeNull();
  });
});

describe('decideLaneApprovers — the documented precedence', () => {
  it('(a) requirement rows own the lane and are handed back unchanged', () => {
    const d = decideLaneApprovers({ requirementRoleKeys: ['architect', 'qa-tester'], laneAgents: [] });
    expect(d.tier).toBe('requirements');
    expect(d.reason).toBe('requirement_rows');
    expect(d.approverResolved).toBe(true);
    expect(d.approvers.map((a) => a.roleKey)).toEqual(['architect', 'qa-tester']);
    // agentRef stays null: the existing gate resolves the agent for a required role via
    // its own staffed→role-capable resolver, and that path must stay untouched.
    expect(d.approvers.every((a) => a.agentRef === null)).toBe(true);
    expect(d.approvers[0]?.roleName).toBe('Architect');
  });

  it('(a) BEATS staffing — a templated board behaves exactly as before', () => {
    // The whole point of tiering: adding the staffing fallback must not change any
    // decision on the one board that is actually configured with requirements.
    const d = decideLaneApprovers({
      requirementRoleKeys: ['architect'],
      laneAgents: [agent({ agentRef: 'agent-9', capableRoleKeys: ['code-reviewer'] })],
    });
    expect(d.tier).toBe('requirements');
    expect(d.approvers.map((a) => a.roleKey)).toEqual(['architect']);
  });

  it('(a) deduplicates repeated requirement refs', () => {
    const d = decideLaneApprovers({ requirementRoleKeys: ['architect', 'architect'], laneAgents: [] });
    expect(d.approvers).toHaveLength(1);
  });

  it('(b) resolves the lane STAFFING when no requirement applies — the 10-of-11-boards fix', () => {
    const d = decideLaneApprovers({
      requirementRoleKeys: [],
      laneAgents: [agent({ agentRef: 'agent-7', agentName: 'Rev', declaredRole: 'Code Reviewer', model: 'opus' })],
    });
    expect(d.tier).toBe('lane_agents');
    expect(d.reason).toBe('lane_agents');
    expect(d.approverResolved).toBe(true);
    expect(d.approvers).toEqual([{
      roleKey: 'code-reviewer', roleName: 'Code Reviewer',
      agentRef: 'agent-7', agentName: 'Rev', model: 'opus',
    }]);
  });

  it('(b) yields one approver PER ROLE, lowest lane position winning a shared role', () => {
    // The ledger and the manifest are both role-keyed, so two agents sharing a role could
    // never be tracked as two slots — collapsing them keeps the required-slot count
    // honest (and stops the gate demanding a sign-off nothing can ever record).
    const d = decideLaneApprovers({
      requirementRoleKeys: [],
      laneAgents: [
        agent({ agentRef: 'second', position: 2, declaredRole: 'Code Reviewer', capableRoleKeys: ['code-reviewer'] }),
        agent({ agentRef: 'first', position: 1, declaredRole: 'Code Reviewer', capableRoleKeys: ['code-reviewer'] }),
        agent({ agentRef: 'sec-agent', position: 3, declaredRole: 'Security', capableRoleKeys: ['security'] }),
      ],
    });
    expect(d.approvers.map((a) => [a.roleKey, a.agentRef])).toEqual([
      ['code-reviewer', 'first'],
      ['security', 'sec-agent'],
    ]);
  });

  it('(c) FAILS CLOSED on an unstaffed lane — no approver is not implicit approval', () => {
    const d = decideLaneApprovers({ requirementRoleKeys: [], laneAgents: [] });
    expect(d.tier).toBe('none');
    expect(d.reason).toBe('lane_unstaffed');
    expect(d.approverResolved).toBe(false);
    expect(d.approvers).toEqual([]);
  });

  it('(c) FAILS CLOSED when every staffed agent is role-capable of nothing', () => {
    // Distinct reason from `lane_unstaffed` so an operator can tell "staff this lane"
    // apart from "give that agent a role" — and, critically, still resolves to NO
    // approver rather than picking an agent whose sign-off the route would 403.
    const d = decideLaneApprovers({
      requirementRoleKeys: [],
      laneAgents: [agent({ capableRoleKeys: [] }), agent({ agentRef: 'agent-2', capableRoleKeys: [] })],
    });
    expect(d.tier).toBe('none');
    expect(d.reason).toBe('lane_agents_not_role_capable');
    expect(d.approverResolved).toBe(false);
  });
});

describe('decideLaneAgentApproval — what the lane gate does this hop', () => {
  const reviewer: StaffedLaneApprover = {
    roleKey: 'code-reviewer', roleName: 'Code Reviewer',
    agentRef: 'agent-7', agentName: 'Review Bot', model: null,
  };
  const decide = (over: Partial<Parameters<typeof decideLaneAgentApproval>[0]> = {}) =>
    decideLaneAgentApproval({
      approvers: [reviewer],
      stateByRole: new Map([['code-reviewer', 'in_progress']]),
      answered: new Set<string>(),
      hasLiveRun: false,
      requirementGate: 'soft',
      ...over,
    });

  it('asks the lane agent to sign off once its work has RUN, and holds the lane meanwhile', () => {
    const d = decide();
    expect(d.owed).toEqual(['code-reviewer']);
    expect(d.ask?.agentRef).toBe('agent-7');
    expect(d.blocked).toBe(true);
    expect(d.flagged).toBe(true);
  });

  it.each(['pending', 'assigned', 'unstaffed'])(
    'NEVER preempts the work: a slot in state %s owes nothing and does not block',
    (state) => {
      // THE regression this guards. Tier (b) now applies to 10 of 11 boards; if a
      // not-yet-run slot counted as owed, the first entry into every staffed lane would
      // dispatch a REVIEW of work that does not exist and `blocked` would suppress the
      // implementation run that should have happened.
      const d = decide({ stateByRole: new Map([['code-reviewer', state]]) });
      expect(d.owed).toEqual([]);
      expect(d.ask).toBeNull();
      expect(d.blocked).toBe(false);
      expect(d.flagged).toBe(false);
    },
  );

  it.each(['completed', 'waived', 'skipped'])('owes nothing once the slot is satisfied (%s)', (state) => {
    expect(decide({ stateByRole: new Map([['code-reviewer', state]]) }).owed).toEqual([]);
  });

  it('owes nothing when no slot was materialised at all — the fail-closed leaf', () => {
    // No slot ⇒ nothing to ask about here; the empty manifest is what keeps
    // `decideSignoffGate` shut, rather than this path inventing an approval.
    const d = decide({ stateByRole: new Map() });
    expect(d.owed).toEqual([]);
    expect(d.blocked).toBe(false);
  });

  it('never piles a second run on a ticket that already has a live one', () => {
    const d = decide({ hasLiveRun: true });
    expect(d.owed).toEqual(['code-reviewer']);
    expect(d.ask).toBeNull();
    // Still flagged (the lane IS unmet) but the soft gate does not block — the live run
    // already owns the ticket, so there is nothing to suppress.
    expect(d.flagged).toBe(true);
    expect(d.blocked).toBe(false);
  });

  it('stops re-asking a role that already recorded a verdict — loop safety', () => {
    // Mirrors the requirement-row path's `!latest.has(ref)` guard. Without it every lane
    // re-entry would spawn another paid review run for the same unanswered question.
    const d = decide({ answered: new Set(['code-reviewer']) });
    expect(d.owed).toEqual(['code-reviewer']);
    expect(d.ask).toBeNull();
  });

  it('treats changes_requested as an unmet lane, re-asked by the manager not by lane hops', () => {
    const d = decide({
      stateByRole: new Map([['code-reviewer', 'changes_requested']]),
      answered: new Set(['code-reviewer']),
    });
    expect(d.owed).toEqual(['code-reviewer']);
    expect(d.ask).toBeNull();
    expect(d.flagged).toBe(true);
  });

  it('asks ONE approver per hop even when several are owed', () => {
    // Sign-offs are sequential judgements; a burst would spend N paid runs answering one
    // question. The unasked roles stay in `owed`, so the lane is still reported unmet.
    const security: StaffedLaneApprover = { ...reviewer, roleKey: 'security', roleName: 'Security', agentRef: 'agent-9' };
    const d = decide({
      approvers: [reviewer, security],
      stateByRole: new Map([['code-reviewer', 'in_progress'], ['security', 'in_progress']]),
    });
    expect(d.owed).toEqual(['code-reviewer', 'security']);
    expect(d.ask?.roleKey).toBe('code-reviewer');
  });

  it('a HARD gate holds the lane even when nobody can be asked', () => {
    const d = decide({ hasLiveRun: true, requirementGate: 'hard' });
    expect(d.ask).toBeNull();
    expect(d.blocked).toBe(true);
  });

  it('laneApprovalOwed is the SAME rule the full decision applies (the gate pre-checks with it)', () => {
    const stateByRole = new Map([['code-reviewer', 'in_progress']]);
    expect(laneApprovalOwed([reviewer], stateByRole).map((a) => a.roleKey))
      .toEqual(decide({ stateByRole }).owed);
    expect(laneApprovalOwed([reviewer], new Map([['code-reviewer', 'assigned']]))).toEqual([]);
  });
});

// ── IO layer ────────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

/** Minimal Drizzle stand-in that records how many `select()` chains were built. */
function makeDb(assignments: Row[], agents: Row[]) {
  const calls = { select: 0, assignments: 0, agents: 0 };
  const db = {
    select: () => {
      calls.select += 1;
      return {
        from: (table: unknown) => ({
          where: async () => {
            if (table === swimlaneAgentAssignments) { calls.assignments += 1; return assignments; }
            calls.agents += 1;
            return agents;
          },
        }),
      };
    },
  } as never;
  return { db, calls };
}

describe('loadLaneStaffedAgents', () => {
  it('joins staffing to capability in ONE batched agent read (never a lookup per agent)', async () => {
    // This runs on every lane entry and inside the autonomous sweep. A capability query
    // per staffed agent would be an N+1 directly on the hot path.
    const { db, calls } = makeDb(
      [
        { swimlaneId: 'lane-1', agentRef: 'a1', name: 'Rev', role: 'Code Reviewer', model: 'opus', position: 0 },
        { swimlaneId: 'lane-1', agentRef: 'a2', name: 'Sec', role: 'Security', model: null, position: 1 },
        { swimlaneId: 'lane-1', agentRef: 'a3', name: 'Dev', role: 'Developer', model: null, position: 2 },
      ],
      [
        { id: 'a1', name: 'Rev', title: 'Code Reviewer', skills: null, builtinKind: null, roleKeys: ['code-reviewer'] },
        { id: 'a2', name: 'Sec', title: null, skills: null, builtinKind: 'security', roleKeys: null },
        { id: 'a3', name: 'Dev', title: 'Developer', skills: null, builtinKind: null, roleKeys: null },
      ],
    );
    const staffed = await loadLaneStaffedAgents(db, 1, 'lane-1');
    expect(calls.assignments).toBe(1);
    expect(calls.agents).toBe(1);
    expect(calls.select).toBe(2);
    expect(staffed.map((s) => s.agentRef)).toEqual(['a1', 'a2', 'a3']);
    expect(staffed[1]?.capableRoleKeys).toContain('security');
  });

  it('leaves an agent with no capability row uncapable, so the lane fails closed', async () => {
    // The `ide_agents` read filters to `active`, so a retired agent still pinned to a
    // lane resolves to no role instead of burning a run dispatching something that is
    // gone. Same for a dangling ref.
    const { db } = makeDb(
      [{ swimlaneId: 'lane-1', agentRef: 'ghost', name: 'Ghost', role: 'Code Reviewer', model: null, position: 0 }],
      [],
    );
    const staffed = await loadLaneStaffedAgents(db, 1, 'lane-1');
    expect(staffed[0]?.capableRoleKeys).toEqual([]);
    expect(decideLaneApprovers({ requirementRoleKeys: [], laneAgents: staffed }).approverResolved).toBe(false);
  });

  it('skips assignment rows with no agent_ref and never queries when none remain', async () => {
    const { db, calls } = makeDb([{ swimlaneId: 'lane-1', agentRef: null, name: null, role: 'Reviewer', model: null, position: 0 }], []);
    expect(await loadLaneStaffedAgents(db, 1, 'lane-1')).toEqual([]);
    expect(calls.agents).toBe(0);
  });
});

describe('resolveLaneApprovers', () => {
  it('short-circuits tier (a) with ZERO queries', async () => {
    // A templated lane must not pay for a staffing read it will never use — and this is
    // also what proves tier (a) is decided without touching the fallback at all.
    const exploding = {
      select: () => { throw new Error('tier (a) must not query the database'); },
    } as never;
    const d = await resolveLaneApprovers(exploding, {
      tenantId: 1, swimlaneId: 'lane-1', requirementRoleKeys: ['architect'],
    });
    expect(d.tier).toBe('requirements');
  });

  it('reads staffing for tier (b) and returns the resolved approver', async () => {
    const { db } = makeDb(
      [{ swimlaneId: 'lane-1', agentRef: 'a1', name: 'Rev', role: 'Code Reviewer', model: 'sonnet', position: 0 }],
      [{ id: 'a1', name: 'Rev', title: 'Code Reviewer', skills: null, builtinKind: null, roleKeys: null }],
    );
    const d = await resolveLaneApprovers(db, { tenantId: 1, swimlaneId: 'lane-1', requirementRoleKeys: [] });
    expect(d.tier).toBe('lane_agents');
    expect(d.approvers[0]).toMatchObject({ roleKey: 'code-reviewer', agentRef: 'a1', model: 'sonnet' });
  });
});
