import { describe, it, expect } from 'vitest';
import { resolveTransitionActor, resolveCompletionActor } from './taskLifecycle';
import { parseMachineSubject, isMachineSubject } from '../../infrastructure/auth/machineSubject';
import { resolveMergeActor } from '../repos/mergeRecordedPr';
import { requestActor } from '../../presentation/middleware/authMiddleware';

/**
 * Lane-move attribution. Pure, so it is tested without a database.
 *
 * Two regressions are pinned here because both were live and neither is visible from
 * the surface that reads them: an agent's hop losing its identity, and a machine
 * caller's service subject being recorded as a person.
 */

describe('parseMachineSubject', () => {
  it('recovers the host id from an agent-host subject', () => {
    expect(parseMachineSubject('agentHost:5')).toEqual({ kind: 'agent_host', agentHostId: 5, suffix: '5' });
  });

  it('recognises a machine subject that names no specific agent', () => {
    expect(parseMachineSubject('agentHost:mcp')).toEqual({ kind: 'agent_host', agentHostId: null, suffix: 'mcp' });
    expect(parseMachineSubject('embed:kid-7')).toEqual({ kind: 'embed', agentHostId: null, suffix: 'kid-7' });
  });

  it('leaves an ordinary user id alone', () => {
    expect(parseMachineSubject('9d1f-user')).toBeNull();
    expect(parseMachineSubject(null)).toBeNull();
    expect(isMachineSubject('9d1f-user')).toBe(false);
    expect(isMachineSubject('embed:x')).toBe(true);
  });
});

describe('resolveTransitionActor', () => {
  it('records a signed-in person as human', () => {
    expect(resolveTransitionActor({ actorUserId: 'user-1' })).toEqual({ actorKind: 'human', actorRef: 'user-1' });
  });

  it('records the running cloud agent by ref', () => {
    expect(resolveTransitionActor({ actorAgentRef: 'manager-t1' }))
      .toEqual({ actorKind: 'cloud_agent', actorRef: 'manager-t1' });
  });

  it('records an on-prem host by its bare id, so resolveActorByRef can name it', () => {
    expect(resolveTransitionActor({ actorAgentHostId: 42 }))
      .toEqual({ actorKind: 'host_agent', actorRef: '42' });
  });

  it('does NOT record an agent-host service token as a person', () => {
    // The regression: `c.get('userId')` on a machine request is `agentHost:5`, which is
    // not a user id. Recording it as human invented a person AND inflated every
    // human-vs-agent autonomy ratio the platform reports.
    expect(resolveTransitionActor({ actorUserId: 'agentHost:5' }))
      .toEqual({ actorKind: 'host_agent', actorRef: '5' });
  });

  it('falls through to the explicit agent fields for a service subject that names nobody', () => {
    expect(resolveTransitionActor({ actorUserId: 'agentHost:mcp', actorAgentRef: 'ada-1' }))
      .toEqual({ actorKind: 'cloud_agent', actorRef: 'ada-1' });
    expect(resolveTransitionActor({ actorUserId: 'embed:kid-7' }))
      .toEqual({ actorKind: 'system', actorRef: null });
  });

  it('prefers the person when a human PATCH drove an agent-owned ticket', () => {
    expect(resolveTransitionActor({ actorUserId: 'user-1', actorAgentRef: 'ada-1', actorAgentHostId: 3 }))
      .toEqual({ actorKind: 'human', actorRef: 'user-1' });
  });

  it('leaves identity-less automation as system rather than guessing', () => {
    expect(resolveTransitionActor({})).toEqual({ actorKind: 'system', actorRef: null });
    expect(resolveTransitionActor({ actorUserId: '  ', actorAgentRef: '' }))
      .toEqual({ actorKind: 'system', actorRef: null });
  });

  it('truncates to the actor_ref column width instead of aborting the insert', () => {
    const long = 'a'.repeat(100);
    expect(resolveTransitionActor({ actorAgentRef: long }).actorRef).toHaveLength(64);
  });
});

describe('requestActor', () => {
  // A tiny stand-in for the Hono context: `requestActor` reads context variables only.
  const ctx = (vars: Record<string, unknown>) =>
    ({ get: (k: string) => vars[k] }) as unknown as Parameters<typeof requestActor>[0];

  it('credits the cloud agent a replayed platform-tool call acts as', () => {
    // The agent's ref sits in `sub` too (it is what `createdBy` records), so the signed
    // `agt` claim must WIN — otherwise the agent is read back as a person.
    expect(requestActor(ctx({ agentActorRef: 'ada-1', userId: 'ada-1' })))
      .toEqual({ actorAgentRef: 'ada-1' });
  });

  it('credits the on-prem host behind a machine token', () => {
    expect(requestActor(ctx({ machineActor: { kind: 'agent_host', agentHostId: 5, suffix: '5' }, userId: 'agentHost:5' })))
      .toEqual({ actorAgentHostId: 5 });
  });

  it('credits the signed-in person on an ordinary request', () => {
    expect(requestActor(ctx({ userId: 'user-1' }))).toEqual({ actorUserId: 'user-1' });
    expect(requestActor(ctx({}))).toEqual({ actorUserId: null });
  });

  it('composes with the writer: an agent replay is never stored as human', () => {
    expect(resolveTransitionActor(requestActor(ctx({ agentActorRef: 'ada-1', userId: 'ada-1' }))))
      .toEqual({ actorKind: 'cloud_agent', actorRef: 'ada-1' });
  });
});

describe('resolveMergeActor', () => {
  it('decodes the manager designation an auto-merge stamps', () => {
    expect(resolveMergeActor('manager:c:manager-t1')).toMatchObject({ actorAgentRef: 'manager-t1' });
    expect(resolveMergeActor('manager:u:user-9')).toMatchObject({ actorUserId: 'user-9' });
    expect(resolveMergeActor('manager:h:4')).toMatchObject({ actorAgentHostId: 4 });
  });

  it('treats an in-product merge as the human who pressed the button', () => {
    expect(resolveMergeActor('user-3')).toEqual({ actorUserId: 'user-3' });
  });

  it('claims no actor for an out-of-band merge noticed by reconcile', () => {
    expect(resolveMergeActor('provider:reconcile')).toEqual({});
    expect(resolveMergeActor(null)).toEqual({});
  });
});

/**
 * WHO IS CREDITED WHEN A MERGE COMPLETES A TICKET.
 *
 * Measured on project 11 (2026-07-29, api 2026.7.178) — the first day work actually
 * landed: **5 tickets finished, 3 pull requests merged, and every one of the six agents
 * still reading `finished=0`** on the contributor table, beside honest run counts (Bob
 * Developer: 5,090 runs). The "finished today" list named owners; the contributor table
 * credited nobody. Both were reading the truth of what was stored.
 *
 * The stored truth was ANONYMOUS. `mergeRecordedPullRequest` derives the transition actor
 * from `mergedBy`, and the manager merges as `manager:<ref>` — but project 11 designates
 * no manager, so the ref is the literal `'system'`, which `resolveManagerAssignee` cannot
 * decode into any of the three identity columns. The result was `resolveTransitionActor({})`
 * = `('system', null)`: a terminal hop with nobody on it. The green-CI / post-deploy
 * webhook path had no actor to begin with and wrote the same row.
 *
 * The digest is right to refuse to credit an actor it cannot name — inventing a member
 * would be worse. So the fix is upstream: when the merge path has no identifiable actor,
 * credit the agent that PRODUCED the work.
 */
describe('resolveCompletionActor — a merge must not finish a ticket anonymously', () => {
  /** Minimal db double: one ordered `executions` row, or none. */
  const dbWith = (row: { cloudAgentRef: string | null; agentHostId: number | null } | null) => ({
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => Object.assign(Promise.resolve(row ? [row] : []), { catch: () => Promise.resolve(row ? [row] : []) }),
          }),
        }),
      }),
    }),
  }) as never;

  it('keeps a named human actor — the person who pressed Approve & Merge did it', async () => {
    const actor = await resolveCompletionActor(dbWith({ cloudAgentRef: 'ada-1', agentHostId: null }), {
      tenantId: 1, taskId: 1, actorUserId: 'user-9',
    });
    expect(actor).toEqual({ actorUserId: 'user-9', actorAgentRef: null, actorAgentHostId: null });
  });

  it('keeps a named agent manager — a designated manager gets its own credit', async () => {
    const actor = await resolveCompletionActor(dbWith({ cloudAgentRef: 'ada-1', agentHostId: null }), {
      tenantId: 1, taskId: 1, actorAgentRef: 'manager-t1',
    });
    expect(actor).toEqual({ actorUserId: null, actorAgentRef: 'manager-t1', actorAgentHostId: null });
  });

  /** THE REGRESSION: `manager:system` and the CI webhook both arrive with nothing. */
  it('falls back to the PRODUCING agent when the caller names nobody', async () => {
    expect(resolveMergeActor('manager:system')).toEqual({
      actorUserId: null, actorAgentRef: null, actorAgentHostId: null,
    });
    const actor = await resolveCompletionActor(dbWith({ cloudAgentRef: 'bob-dev-1', agentHostId: null }), {
      tenantId: 1, taskId: 1, ...resolveMergeActor('manager:system'),
    });
    expect(actor.actorAgentRef).toBe('bob-dev-1');
    // …and that ref is one `resolveTransitionActor` stores as a creditable agent, which
    // is the whole point — `('system', null)` credits nobody.
    expect(resolveTransitionActor(actor)).toEqual({ actorKind: 'cloud_agent', actorRef: 'bob-dev-1' });
  });

  it('credits an on-prem host agent the same way', async () => {
    const actor = await resolveCompletionActor(dbWith({ cloudAgentRef: null, agentHostId: 7 }), { tenantId: 1, taskId: 1 });
    expect(resolveTransitionActor(actor)).toEqual({ actorKind: 'host_agent', actorRef: '7' });
  });

  it('stays anonymous when the ticket genuinely never ran — it invents nobody', async () => {
    // A ticket completed with no execution behind it (a doc, a decision, a manual close)
    // has no producer to credit, and a fabricated one would be worse than a zero.
    const actor = await resolveCompletionActor(dbWith(null), { tenantId: 1, taskId: 1 });
    expect(resolveTransitionActor(actor)).toEqual({ actorKind: 'system', actorRef: null });
  });
});
