import { describe, it, expect } from 'vitest';
import { resolveTransitionActor } from './taskLifecycle';
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
