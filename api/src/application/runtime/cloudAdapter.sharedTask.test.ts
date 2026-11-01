/**
 * Conformance - the cloud under the ONE shared task, through `runCloudAgent` itself (PRD 35 section 3.3 / WS3).
 *
 * The cloud's production call is driven for real: its own port builders (the metered model transport, the timeline sink, the durable
 * human channel, the pending-steer source, the containment-wrapped provider and the platform-tool extension), its `policyOf(host)`
 * and `taskOf(host, rc)`, and its `cloudPolicyModules`. Only the two edges that need a database are faked: opening the run's host
 * (`openCloudRunHost`) and settling its tail (`settleCloudRun`), plus the gateway and the trust / platform catalogs. The same task
 * run continuously and one tick at a time gives the golden trace, the same requests and the same outcome; a board-dispatched run with
 * a required sign-off refuses the first finish until the verdict is recorded. (The hand-built-ports cases of the earlier WS3 file stay
 * in `cloudAdapter.conformance.test.ts`, unchanged.)
 */
import { describe, expect, it, vi } from 'vitest';
import type { RunEvent, RunState } from '@builderforce/agent-run';

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

const REFS = { tenantId: 1, projectId: 2, taskId: 3, executionId: 4, agentLabel: 'Reviewer' };
const SIGNOFF_ARGS = '{"roleKey":"qa-tester","verdict":"approved"}';
const SCRIPT = [
  { content: '', toolCalls: [{ id: 'c1', name: 'finish', arguments: '{"summary":"fine"}' }] },
  { content: '', toolCalls: [{ id: 'c2', name: 'builtin_kanban_signoff', arguments: SIGNOFF_ARGS }] },
  { content: '', toolCalls: [{ id: 'c3', name: 'finish', arguments: '{"summary":"Approved."}' }] },
  { content: 'Approved.' },
];

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
