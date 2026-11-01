/**
 * Conformance — the REAL cloud adapter ports under the one agent (PRD 35 §3.3 / WS3).
 *
 * The Durable Object runs one step per tick and resumes from the state its cursor saved. Here the agent runs with the
 * cloud's own port builders — the metered model transport, the timeline sink, the durable human channel, the pending-steer
 * source, the containment-wrapped provider and the platform-tool extension — and fakes only at the edge (the gateway, the
 * timeline writer, the trust / platform catalogs). A board-dispatched sign-off policy is in play. The same task run
 * continuously and one tick at a time must give the same trace, the same requests and the same outcome.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runAgent, type RunEvent, type RunOutcome, type RunPolicy, type RunPorts, type RunState, type RunTask } from '@builderforce/agent-run';

const h = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  turn: 0,
  script: [] as Array<{ content: string; toolCalls?: Array<{ id: string; name: string; arguments: string }> }>,
  /** The host `runCloudAgent` opens (a fake of the run's database-backed context) and what its tail was handed. */
  host: undefined as unknown,
  outcome: undefined as unknown,
  events: [] as unknown[],
  requests: [] as unknown[],
}));
// `runCloudAgent` is driven for real; only the two edges that need a database are faked: opening the run's host and settling its tail.
vi.mock('./cloudRunHost', () => ({ openCloudRunHost: async () => ({ host: h.host }) }));
vi.mock('./cloudRunTail', () => ({
  settleCloudRun: async (_host: unknown, outcome: { kind: string; state: unknown }) => { h.outcome = outcome; return { finished: outcome.kind === 'finished', state: outcome.state }; },
  releaseLeases: async () => undefined,
}));
// Observe the one call the cloud makes: the agent runs exactly as it would, with the timeline sink wrapped to copy the trace.
vi.mock('@builderforce/agent-run', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@builderforce/agent-run')>();
  return {
    ...actual,
    runAgent: (input: Parameters<typeof actual.runAgent>[0]) =>
      actual.runAgent({ ...input, ports: { ...input.ports, events: actual.teeEvents(input.ports.events, h.events as never) } }),
  };
});
vi.mock('./cloudToolEvents', () => ({ recordCloudToolEvent: async (_db: unknown, row: Record<string, unknown>) => { h.rows.push(row); } }));
// The outcome row is written by the ONE owner (`recordTerminalOutcome`) at the landing: its multi-row insert lands in the same timeline.
vi.mock('../shared/runTelemetryDatabase', () => ({
  runTelemetryDatabase: () => ({
    insert: () => ({
      values: (rows: unknown) => {
        const list = (Array.isArray(rows) ? rows : [rows]) as Array<Record<string, unknown>>;
        list.forEach((r) => h.rows.push(r));
        return Object.assign(Promise.resolve(undefined), { onConflictDoNothing: () => ({ returning: async () => list.map((r) => ({ executionId: r.executionId })) }) });
      },
    }),
  }),
}));
vi.mock('../provenance/finishClaimService', () => ({ recordTypedExecutionClaim: vi.fn(async () => ({ ok: true })) }));
vi.mock('./executionPause', () => ({ pauseExecutionForQuestion: vi.fn(async () => ({ approvalId: 'appr-1' })) }));
vi.mock('./cloudLoopControl', () => ({ applyPendingSteering: async () => [] }));
vi.mock('../trust/trustService', () => ({ inspectOutboundContent: async () => ({ ok: true }) }));
vi.mock('./cloudAgent/auditAnalysis', () => ({ ANALYZE_CODEBASE_TOOL: 'analyze_codebase', withSavedAnalysis: async (_d: unknown, _r: unknown, data: unknown) => data }));
vi.mock('../llm/builtinMcpService', () => ({
  callBuiltinTool: async () => ({ ok: true }),
  cloudAgentPlatformToolSchemas: () => [{ type: 'function', function: { name: 'builtin_kanban_signoff', description: 'sign off', parameters: { type: 'object', properties: {} } } }],
  resolveCloudAgentPlatformTool: (name: string) => (name === 'builtin_kanban_signoff' ? 'kanban.signoff' : null),
}));
vi.mock('../llm/vendors/registry', async (importOriginal) => ({ ...(await importOriginal<typeof import('../llm/vendors/registry')>()), catalogEntry: () => null }));
// The metering / trace write of a served turn: the fake gateway's answer is already parsed.
vi.mock('./cloudAgent/cloudLlmTurn', () => ({
  recordCloudLlmTurn: async (result: { script: { content: string; toolCalls?: Array<{ id: string; name: string; arguments: string }> } }) => ({
    ok: true,
    content: result.script.content,
    toolCalls: (result.script.toolCalls ?? []).map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } })),
    resolvedModel: 'fake-model',
  }),
}));

import { cloudModelPort } from './cloudAdapterModel';
import { durableHuman, pendingSteering, timelineSink } from './cloudAdapterPorts';
import { buildExecutionRepository } from '../../buildExecutionRepository';
import { ExecutionStatus, asExecutionId } from '../../domain/shared/types';
import { containProvider, platformTools } from './cloudAdapterTools';

const REFS = { tenantId: 1, projectId: 2, taskId: 3, executionId: 4, agentLabel: 'Reviewer' };
const TASK: RunTask = { prompt: 'Review the change.', persona: 'You are the reviewer.', ticketId: 3, dispatch: { source: 'lane-entry', approvalId: 'appr-0' } };
const POLICY: RunPolicy = {
  entryPoint: 'cloud', toolScope: 'ticket', role: 'code', levers: [], budgets: {}, inference: 'hybrid', verify: 'none',
  signoff: { roleKey: 'qa-tester' }, approvalGates: [], delegation: { requested: false, readsBeforeNudge: 6 },
  modelStart: { model: 'fake-model', strict: false },
};
const SIGNOFF_ARGS = '{"roleKey":"qa-tester","verdict":"approved"}';
const SCRIPT = [
  { content: '', toolCalls: [{ id: 'c1', name: 'finish', arguments: '{"summary":"fine"}' }] },
  { content: '', toolCalls: [{ id: 'c2', name: 'builtin_kanban_signoff', arguments: SIGNOFF_ARGS }] },
  { content: '', toolCalls: [{ id: 'c3', name: 'finish', arguments: '{"summary":"Approved."}' }] },
  { content: 'Approved.' },
];

function ports(store: { saved?: RunState }, requests: unknown[]): RunPorts {
  const proxy = {
    complete: async (body: unknown) => {
      requests.push(JSON.parse(JSON.stringify(body)));
      return { response: { status: 200 }, script: h.script[h.turn++] };
    },
  };
  const model = cloudModelPort({
    env: {} as never, db: {} as never, proxy: proxy as never, routing: { effectivePlan: 'free', premiumOverride: false } as never,
    run: { ...REFS, meterExecutionId: 4 }, runRole: 'code', pickedModel: 'fake-model', genParams: {},
    cost: { beforeTurn: async () => null, recordTurn: async () => undefined, turnFields: () => ({}) } as never,
    declaredLimits: undefined, footprint: () => ({ files: 0, repositories: 0 }), progress: () => '', fallbackSurface: null, startStep: store.saved?.step ?? 0,
  });
  return {
    model,
    capabilities: containProvider({ capabilities: new Set() }, { db: {} as never, tenantId: 1, executionId: 4, declared: undefined, writtenPaths: new Set(), repositories: 0 }),
    store: { load: () => store.saved, save: (s) => { store.saved = JSON.parse(JSON.stringify(s)) as RunState; } },
    events: timelineSink({} as never, REFS, () => null),
    human: durableHuman({} as never, {} as never, REFS),
    steering: pendingSteering({} as never, REFS, model.currentStep),
    context: { pack: () => ({ focus: [], facts: [], recall: [] }), turnSections: () => ['## affect\ncalm'] },
    extensions: platformTools({ env: {} as never, db: {} as never, tenantId: 1, projectId: 2, meterExecutionId: 4, executionId: 4 }),
  };
}

async function drive(maxSteps?: number): Promise<{ outcome: RunOutcome; trace: string[]; requests: unknown[] }> {
  h.turn = 0;
  h.rows.length = 0;
  const store: { saved?: RunState } = {};
  const requests: unknown[] = [];
  const step = maxSteps !== undefined ? { maxSteps } : {};
  let outcome = await runAgent({ task: TASK, policy: POLICY, ports: ports(store, requests), ...step });
  for (let tick = 0; outcome.kind === 'yielded'; tick += 1) {
    if (tick > 50) throw new Error('never finished');
    outcome = await runAgent({ task: TASK, policy: POLICY, ports: ports(store, requests), resume: store.saved, ...step });
  }
  // The run LANDS through the repository's one terminal transition; its hook (wired in the composition root) is what records the outcome row.
  const landedRow = { id: 4, taskId: 3, agentId: null, agentRegistrationId: null, agentHostId: null, tenantId: 1, submittedBy: 'u', sessionId: null, status: 'completed', payload: null, source: 'agent', cloudAgentRef: null, result: null, errorMessage: null, produced: null, startedAt: null, completedAt: null, createdAt: new Date(0), updatedAt: new Date(0) };
  const landingDb = { update: () => ({ set: () => ({ where: () => ({ returning: async () => [landedRow] }) }) }) } as never;
  await buildExecutionRepository(landingDb).land(asExecutionId(4), ExecutionStatus.COMPLETED);
  // The timeline the adapter wrote: the rows' names in order (durations are measured, so not compared).
  return { outcome, trace: h.rows.map((r) => `${String(r.toolName)}`), requests };
}

beforeEach(() => { h.script = SCRIPT; });

describe('cloud adapter conformance — the real port builders', () => {
  it('a tick-per-step run gives the same timeline, requests and outcome as a continuous run', async () => {
    const continuous = await drive();
    const stepped = await drive(1);
    expect(stepped.trace).toEqual(continuous.trace);
    expect(stepped.requests).toEqual(continuous.requests);
    expect(stepped.outcome.kind).toBe('finished');
    expect(continuous.outcome.kind).toBe('finished');
  });

  it('refuses the first finish for the owed sign-off, runs the platform tool, then finishes — all on the timeline', async () => {
    const { outcome, trace } = await drive(1);
    if (outcome.kind !== 'finished') throw new Error(`expected finished, got ${outcome.kind}`);
    expect(outcome.state.finish.reviewVerdictRecorded).toBe(true);
    expect(trace).toContain('builtin_kanban_signoff');
    expect(trace).toContain('run.started');
    expect(trace).toContain('run.outcome');
  });

  it('every request opens with the persona as system and the task as the first user turn, and ends with the affect tail', async () => {
    const { requests } = await drive(1);
    for (const body of requests as Array<{ messages: Array<{ role: string; content: string }> }>) {
      expect(body.messages[0]).toEqual({ role: 'system', content: 'You are the reviewer.' });
      expect(body.messages[1]).toEqual({ role: 'user', content: 'Review the change.' });
      expect(body.messages[body.messages.length - 1]?.content).toContain('## affect');
    }
  });
});

import { CONFORMANCE_ANSWER, CONFORMANCE_PROMPT, CONFORMANCE_SCRIPT, CONFORMANCE_TRACE, conformanceCapabilities, conformanceTrace } from '@builderforce/agent-run';
import { runCloudAgent, policyOf, taskOf } from './cloudAdapter';
import type { CloudRunHost } from './cloudRunHost';
import type { CloudEngineContext } from './cloudAgentEngine';

// The ONE scripted task every entry point is held to (`@builderforce/agent-run` conformanceTask.ts), through `runCloudAgent` itself:
// the cloud's own port builders, its `policyOf(host)` and `taskOf(host, rc)`, and its `cloudPolicyModules` - continuously and one
// step per tick. Only the two database edges (opening the host, settling the tail) are faked.
describe('cloud adapter conformance - the shared scripted task through runCloudAgent', () => {
  const RC = { env: {}, db: {}, executionId: 4, taskRow: { id: 3, title: 'Greet', description: null }, tenantId: 1, projectId: 2, agentLabel: 'Reviewer', isCancelled: async () => false } as unknown as CloudEngineContext;

  function fakeHost(over: { requiredSignoff?: { roleKey: string }; maxSteps?: number; resume?: unknown }): CloudRunHost {
    const proxy = {
      complete: async (body: unknown) => {
        h.requests.push(JSON.parse(JSON.stringify(body)));
        return { response: { status: 200 }, script: h.script[h.turn++] };
      },
    };
    return {
      env: {}, db: {}, refs: REFS, taskRow: RC.taskRow, meterExecutionId: 4, systemPrompt: 'You are the reviewer.', userContent: CONFORMANCE_PROMPT,
      opts: { ...(over.maxSteps !== undefined ? { maxSteps: over.maxSteps } : {}), ...(over.resume ? { resume: over.resume } : {}), ...(over.requiredSignoff ? { requiredSignoff: over.requiredSignoff } : {}) },
      repoCtx: null, repoMiss: '', routing: { effectivePlan: 'free', premiumOverride: false }, writtenPaths: new Set<string>(), writtenHashes: new Map(),
      provider: conformanceCapabilities(), declaredLimits: undefined, proxy, pick: { model: 'fake-model', strict: false }, runRole: 'code', verifyPin: undefined,
      fallbackSurface: null, ladder: { candidates: [], rankOf: () => 0 }, features: () => ({}), genParams: {},
      cost: { beforeTurn: async () => null, recordTurn: async () => undefined, turnFields: () => ({}), budgetNote: () => '' },
      cancel: { controller: new AbortController(), stop: () => undefined },
    } as unknown as CloudRunHost;
  }

  /** The run as the Durable Object drives it: `maxSteps` per tick, the cursor's saved state fed to the next. */
  async function driveCloud(script: typeof h.script, over: { requiredSignoff?: { roleKey: string }; maxSteps?: number } = {}) {
    h.turn = 0;
    h.rows.length = 0;
    h.events.length = 0;
    h.requests.length = 0;
    h.script = script;
    let resume: unknown;
    let outcome: { kind: string; output?: string; state: RunState } | undefined;
    for (let tick = 0; tick < 50; tick += 1) {
      h.host = fakeHost({ ...over, ...(resume ? { resume } : {}) });
      await runCloudAgent(RC, { model: undefined, systemPrompt: 'You are the reviewer.', userContent: CONFORMANCE_PROMPT }, (h.host as CloudRunHost).opts);
      outcome = h.outcome as typeof outcome;
      if (outcome!.kind !== 'yielded') break;
      resume = { run: outcome!.state };
    }
    return { outcome: outcome!, events: h.events as RunEvent[], requests: h.requests };
  }
  const SHARED = CONFORMANCE_SCRIPT.map((c) => ({ content: c.content, ...(c.toolCalls ? { toolCalls: [...c.toolCalls] } : {}) }));

  it('emits the shared RunEvent trace and the shared answer when run continuously', async () => {
    const { outcome, events } = await driveCloud(SHARED);
    expect(conformanceTrace(events)).toEqual(CONFORMANCE_TRACE);
    expect(outcome).toMatchObject({ kind: 'finished', output: CONFORMANCE_ANSWER });
  });

  it('emits the same trace, answer and requests one step per tick', async () => {
    const continuous = await driveCloud(SHARED);
    const stepped = await driveCloud(SHARED, { maxSteps: 1 });
    expect(conformanceTrace(stepped.events)).toEqual(CONFORMANCE_TRACE);
    expect(stepped.outcome).toMatchObject({ kind: 'finished', output: CONFORMANCE_ANSWER });
    expect(stepped.requests).toEqual(continuous.requests);
  });

  it('takes its task and policy from the adapter: the ticket prompt, the cloud label, and the sign-off the board compiled', () => {
    const host = fakeHost({ requiredSignoff: { roleKey: 'qa-tester' } });
    expect(taskOf(host, RC)).toMatchObject({ prompt: CONFORMANCE_PROMPT, persona: 'You are the reviewer.', ticketId: 3, dispatch: { source: 'lane-entry' } });
    expect(policyOf(host)).toMatchObject({ entryPoint: 'cloud', toolScope: 'ticket', signoff: { roleKey: 'qa-tester' }, approvalGates: [] });
  });

  it('a board-dispatched run with a required sign-off refuses the first finish, takes the verdict from the platform tool, then finishes', async () => {
    const { outcome, events } = await driveCloud(SCRIPT, { requiredSignoff: { roleKey: 'qa-tester' }, maxSteps: 1 });
    expect(outcome.kind).toBe('finished');
    expect(conformanceTrace(events)).toContain('tool.dispatched:builtin_kanban_signoff:ok');
    const finishes = conformanceTrace(events).filter((fact) => fact.startsWith('tool.dispatched:finish'));
    expect(finishes).toEqual(['tool.dispatched:finish:error', 'tool.dispatched:finish:ok']);
    expect((outcome as { state: RunState }).state.finish.reviewVerdictRecorded).toBe(true);
  });
});

export type { RunEvent };
