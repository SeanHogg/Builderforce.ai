/**
 * The wiring that makes the policy-pack store LIVE.
 *
 * `evaluatePolicyGate` was already hard-enforced at the engine's tool seam, but it
 * only ever saw `[]` because nothing put gates on a run's payload. `submit` is the
 * ONE funnel every execution passes through (board auto-run, manual dispatch, agent
 * handoff), so it stamps the tenant's resolved gates there. These tests pin that
 * contract — including the two ways it must NOT interfere: an explicit spec-compiled
 * gate set wins, and a resolver failure never blocks a dispatch.
 */
import { describe, it, expect } from 'vitest';
import { RuntimeService } from './RuntimeService';
import { Task } from '../../domain/task/Task';
import { Execution } from '../../domain/execution/Execution';
import { TaskStatus, TaskPriority, TaskType } from '../../domain/shared/types';
import { parsePolicyGates } from './cloudDispatch';
import type { PolicyGate } from '@builderforce/agent-tools';
import type { IExecutionRepository } from '../../domain/execution/IExecutionRepository';
import type { ITaskRepository } from '../../domain/task/ITaskRepository';
import type { IAgentRepository } from '../../domain/agent/IAgentRepository';
import type { IAuditRepository } from '../../domain/audit/IAuditRepository';

const PROJECT_ID = 3;

function buildTask(): Task {
  const now = new Date();
  return Task.reconstitute({
    id: 7 as never, projectId: PROJECT_ID as never, key: 'P-001', title: 't', description: null,
    status: TaskStatus.TODO, priority: TaskPriority.MEDIUM, taskType: TaskType.TASK, parentTaskId: null,
    assignedAgentType: null, githubIssueNumber: null, githubIssueUrl: null, githubPrUrl: null,
    githubPrNumber: null, assignedAgentHostId: null, assignedAgentRef: null, assignedUserId: null,
    gitBranch: null, explicitRepoId: null, sprintId: null, releaseId: null, storyPoints: null,
    businessValue: null, businessValueRationale: null, businessValueSource: null, managerRank: null,
    reviewCount: 0, lastReviewedAt: null, lastReviewVerdict: null, gapOriginTaskId: null,
    startDate: null, dueDate: null,
    persona: null, archived: false, createdAt: now, updatedAt: now,
  });
}

type Scope = { tenantId: number; projectId: number | null; agentRef: string | null };

function makeService(resolver?: (s: Scope) => Promise<PolicyGate[]>) {
  let savedPayload: string | null = null;
  const scopes: Scope[] = [];

  const executions = {
    save: async (e: Execution) => {
      savedPayload = (e as unknown as { payload: string | null }).payload;
      return e;
    },
  } as unknown as IExecutionRepository;
  const tasks = { findById: async () => buildTask() } as unknown as ITaskRepository;
  const agents = {} as IAgentRepository;
  const audit = { save: async () => undefined } as unknown as IAuditRepository;

  const wrapped = resolver
    ? async (s: Scope) => { scopes.push(s); return resolver(s); }
    : undefined;

  const svc = new RuntimeService(
    executions, tasks, agents, audit,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    wrapped,
  );
  return { svc, getPayload: () => savedPayload, scopes };
}

const submit = (svc: RuntimeService, payload?: string) =>
  svc.submit({ taskId: 7, tenantId: 1, submittedBy: 'system:lane-auto', payload });

describe('RuntimeService.submit — governance gate stamping', () => {
  it('stamps the resolved gates onto the payload so the engine enforces them', async () => {
    const gate: PolicyGate = { id: 'no-shell', tool: 'run_command', effect: 'block', reason: 'prod safety' };
    const { svc, getPayload } = makeService(async () => [gate]);

    await submit(svc, JSON.stringify({ cloudAgentRef: 'ada' }));

    // Read back through the SAME parser the cloud loop uses.
    expect(parsePolicyGates(getPayload() ?? undefined)).toEqual([gate]);
  });

  it('resolves for the ticket’s project and the run’s agent', async () => {
    const { svc, scopes } = makeService(async () => []);

    await submit(svc, JSON.stringify({ cloudAgentRef: 'ada' }));

    expect(scopes).toEqual([{ tenantId: 1, projectId: PROJECT_ID, agentRef: 'ada' }]);
  });

  it('preserves the rest of the payload it augments', async () => {
    const { svc, getPayload } = makeService(async () => [{ id: 'g', effect: 'block' }]);

    await submit(svc, JSON.stringify({ cloudAgentRef: 'ada', model: 'opus', laneKey: 'in_progress' }));

    expect(JSON.parse(getPayload()!)).toMatchObject({
      cloudAgentRef: 'ada', model: 'opus', laneKey: 'in_progress',
    });
  });

  it('stamps onto a run submitted with NO payload at all', async () => {
    const { svc, getPayload } = makeService(async () => [{ id: 'g', effect: 'block' }]);

    await submit(svc);

    expect(parsePolicyGates(getPayload() ?? undefined).map((g) => g.id)).toEqual(['g']);
  });

  it('leaves the payload untouched when nothing resolves (the ungated default)', async () => {
    const { svc, getPayload } = makeService(async () => []);
    const payload = JSON.stringify({ cloudAgentRef: 'ada' });

    await submit(svc, payload);

    expect(getPayload()).toBe(payload);
  });

  it('does not override gates a deploy()-compiled spec already carried', async () => {
    const { svc, getPayload } = makeService(async () => [{ id: 'ambient', effect: 'block' }]);
    const payload = JSON.stringify({ policyGates: [{ id: 'from-spec', effect: 'require-approval' }] });

    await submit(svc, payload);

    expect(parsePolicyGates(getPayload() ?? undefined).map((g) => g.id)).toEqual(['from-spec']);
  });

  it('never blocks a dispatch when the resolver throws', async () => {
    const { svc, getPayload } = makeService(async () => { throw new Error('kv down'); });
    const payload = JSON.stringify({ cloudAgentRef: 'ada' });

    await expect(submit(svc, payload)).resolves.toBeDefined();
    expect(getPayload()).toBe(payload);
  });

  it('is a no-op when no resolver is wired (unchanged legacy behaviour)', async () => {
    const { svc, getPayload } = makeService();

    await submit(svc, JSON.stringify({ cloudAgentRef: 'ada' }));

    expect(parsePolicyGates(getPayload() ?? undefined)).toEqual([]);
  });
});
