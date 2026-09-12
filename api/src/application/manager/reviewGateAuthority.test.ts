import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { decideReviewGate, managerHoldsReviewGate, reviewCloseActor } from './reviewGateAuthority';
import { diagnoseStall, STALL_AFTER_MS, type StallInput } from './stallTriage';
import { censusDiagnose, type CensusTicketFacts } from './stallCensus';
import { resolveTieredManagerPolicy, DEFAULT_MANAGER_POLICY } from './managerPolicy';
import { TaskStatus } from '../../domain/shared/types';

/**
 * THE OPERATOR DECISION (2026-09-12): whether the autonomous manager may review and close
 * a ticket through a human-gated review lane is an account-admin, per-workspace setting
 * (`managerMayCloseReviewedTickets`), default OFF.
 *
 * What these tests pin is that the setting means ONE thing everywhere — the conduct step
 * that closes tickets, the triage that escalates them and the census that counts them all
 * ask `decideReviewGate`, so none can close (or report) past a gate the others honour.
 */

const ON = { managerMayCloseReviewedTickets: true };
const OFF = { managerMayCloseReviewedTickets: false };

describe('decideReviewGate', () => {
  it('leaves an auto-gated or non-review lane open regardless of the setting', () => {
    for (const s of [ON, OFF]) {
      expect(decideReviewGate({ status: TaskStatus.IN_REVIEW, laneGate: 'auto', ...s })).toBe('open');
      expect(decideReviewGate({ status: TaskStatus.IN_REVIEW, laneGate: null, ...s })).toBe('open');
      // A human gate OFF the review lane (the staging backlog) was never delegated.
      expect(decideReviewGate({ status: TaskStatus.BACKLOG, laneGate: 'human', ...s })).toBe('open');
    }
  });

  it('holds a human-gated review lane for a person when the setting is OFF (the default)', () => {
    expect(decideReviewGate({ status: TaskStatus.IN_REVIEW, laneGate: 'human', ...OFF })).toBe('held_for_human');
    expect(managerHoldsReviewGate({ status: TaskStatus.IN_REVIEW, laneGate: 'human', ...OFF })).toBe(false);
  });

  it('hands a human-gated review lane to the manager when the admin turns it ON', () => {
    expect(decideReviewGate({ status: TaskStatus.IN_REVIEW, laneGate: 'human', ...ON })).toBe('manager_authorized');
    expect(managerHoldsReviewGate({ status: TaskStatus.IN_REVIEW, laneGate: 'human', ...ON })).toBe(true);
  });
});

describe('reviewCloseActor — the ledger credits an agent, never a person', () => {
  const executor = { actorAgentRef: 'exec-agent', actorAgentHostId: null };
  it('credits a named agent manager', () => {
    expect(reviewCloseActor('c:mgr-agent', executor)).toEqual({ actorAgentRef: 'mgr-agent' });
    expect(reviewCloseActor('h:7', executor)).toEqual({ actorAgentHostId: 7 });
  });
  it('falls back to the executor for the system service or a human-designated manager', () => {
    expect(reviewCloseActor(null, executor)).toEqual({ actorAgentRef: 'exec-agent', actorAgentHostId: null });
    expect(reviewCloseActor('u:someone', executor)).toEqual({ actorAgentRef: 'exec-agent', actorAgentHostId: null });
  });
});

describe('the setting is workspace-only and OFF by default', () => {
  it('defaults to false with no opinion anywhere', () => {
    expect(DEFAULT_MANAGER_POLICY.managerMayCloseReviewedTickets).toBe(false);
    expect(resolveTieredManagerPolicy({}).managerMayCloseReviewedTickets).toBe(false);
  });
  it('is granted by the workspace tier', () => {
    expect(resolveTieredManagerPolicy({ tenant: { managerMayCloseReviewedTickets: true } })
      .managerMayCloseReviewedTickets).toBe(true);
  });
  it('ignores a project tier entirely — it can neither grant nor withhold', () => {
    expect(resolveTieredManagerPolicy({ project: { managerMayCloseReviewedTickets: true } })
      .managerMayCloseReviewedTickets).toBe(false);
    expect(resolveTieredManagerPolicy({
      tenant: { managerMayCloseReviewedTickets: true }, project: { managerMayCloseReviewedTickets: false },
    }).managerMayCloseReviewedTickets).toBe(true);
  });
});

describe('stall triage: a delegated review gate is not a standing escalation', () => {
  const stalledInput = (over: Partial<StallInput> = {}): StallInput => ({
    status: TaskStatus.IN_REVIEW, isTerminal: false, idleMs: STALL_AFTER_MS * 10, everRan: true,
    autoRunReason: 'human_gate', hasLiveRun: false, readiness: null, pr: null, mergeWithheld: false,
    ...over,
  });

  it('still escalates a human gate the workspace did NOT delegate (unchanged behaviour)', () => {
    expect(diagnoseStall(stalledInput())).toMatchObject({ stalled: true, cause: 'human_gate', remedy: 'escalate_human' });
    expect(diagnoseStall(stalledInput({ reviewGateDelegated: false }))).toMatchObject({ cause: 'human_gate' });
  });

  it('reports a delegated, passing (or not-yet-reviewed) ticket as moving, not escalated', () => {
    expect(diagnoseStall(stalledInput({ reviewGateDelegated: true })).stalled).toBe(false);
    expect(diagnoseStall(stalledInput({ reviewGateDelegated: true, readiness: 'complete' })).stalled).toBe(false);
  });

  it('keeps the REAL review-side stall when the manager\'s review found one', () => {
    expect(diagnoseStall(stalledInput({ reviewGateDelegated: true, readiness: 'return_to_implementation' })))
      .toMatchObject({ stalled: true, cause: 'missing_deliverable' });
    expect(diagnoseStall(stalledInput({ reviewGateDelegated: true, readiness: 'return_build_failed' })))
      .toMatchObject({ stalled: true, cause: 'build_failed' });
  });
});

describe('census: stops counting the human_gate cohort for a workspace with the setting on', () => {
  const facts = (over: Partial<CensusTicketFacts> = {}): CensusTicketFacts => ({
    taskId: 1, status: TaskStatus.IN_REVIEW, source: null, assignedAgentRef: null,
    idleMs: STALL_AFTER_MS * 10, everRan: true, hasLiveRun: false, consecutiveFailures: 0, totalRuns: 1,
    lane: { gate: 'human', isTerminal: false, staffed: false },
    managedProducerResolvable: null, managedLaneAuthorityTier: null, stageOwedRoles: [],
    ...over,
  });

  it('counts it as human_gate when the setting is off', () => {
    expect(censusDiagnose(facts(), { requireSignoff: false, ...OFF }).cause).toBe('human_gate');
  });
  it('does not count it as stalled when the setting is on', () => {
    expect(censusDiagnose(facts(), { requireSignoff: false, ...ON }).stalled).toBe(false);
  });
  it('still counts a human gate on a NON-review lane — that gate was never delegated', () => {
    expect(censusDiagnose(facts({ status: TaskStatus.BACKLOG }), { requireSignoff: false, ...ON }).cause).toBe('human_gate');
  });
});

describe('the conduct step asks the gate before it closes anything', () => {
  const source = readFileSync(fileURLToPath(new URL('./ManagerService.ts', import.meta.url).href), 'utf8');
  const conduct = source.slice(source.indexOf('async function coordinatePullRequests'));

  it('closes only through the gated wrapper, never the raw completion write', () => {
    expect(conduct).toMatch(/closeTicketAutomatically\(env, db, \{[\s\S]*?source: 'manager_review'/);
    expect(source).not.toMatch(/completeTaskOnMerge\(/);
  });

  it('does nothing further with a ticket the gate held (or could not read)', () => {
    expect(conduct).toMatch(/if \(!close\.closed\) continue;/);
  });
});
