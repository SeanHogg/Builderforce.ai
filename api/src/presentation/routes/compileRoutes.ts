/**
 * The compile primitive's HTTP front door: `POST /api/compile` and
 * `POST /api/compile/run` (compile primitive Phases C2/C4/C5,
 * `PRD-agent-compile-primitive.md`).
 *
 *   POST /api/compile      { need|needs, deploy?, engineId? } → { spec, plan? }
 *   POST /api/compile/run  { need|needs, sample? }            → { spec, plan, output }
 *
 * `/api/compile` lowers one or more needs (any modality) into the canonical
 * `AgentSpec` and, when a `deploy` surface is given, resolves the ready-to-dispatch
 * `DeployPlan`. `/api/compile/run` proves the spine end-to-end: it compiles, deploys
 * to `cloud-durable`, and drives a real first turn through the gateway with the
 * lowered system prompt — so "define a need in plain language → a running agent"
 * works in one call, on the machinery that already exists.
 *
 * The prose/diagnostic adapters need an LLM; it is injected here as a thin wrapper
 * over the free-pool `ideProxy`, keeping the adapters pure + unit-tested.
 */
import { Hono } from 'hono';
import type { AgentSurface } from '@builderforce/agent-tools';
import { authMiddleware } from '../middleware/authMiddleware';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import type { RuntimeService } from '../../application/runtime/RuntimeService';
import { compile, type LlmComplete, type Need } from '../../application/compile';
import type { RecallKnowledge } from '../../application/compile';
import { recallSops } from '../../application/knowledge/recallSops';
import { deploy, DEPLOY_SURFACES } from '../../application/deploy';
import { deployAndDispatch, type CloudRunDispatcher } from '../../application/deploy/dispatch';
import { dispatchCloudRunForTask } from './runtimeRoutes';
import { stampExecutionAuthority, humanDirected } from '../../application/runtime/executionAuthority';
import { gatewayExtractor } from '../../application/llm/gatewayExtractor';
import { completeForTenant } from '../../application/llm/tenantProxy';
import { readProxyChoice } from '../../application/llm/LlmProxyService';
import { MODALITIES } from '../../application/compile';
import { failResponse } from '../middleware/errorResponse';
import { parseBody, z, zOptionalString, zPositiveInt } from './requestBody';

const SOURCE = 'presentation/routes/compileRoutes.ts';

/** The modality adapters' LLM — the shared free-pool extractor. */
const compileExtractor = (env: HonoEnv['Bindings']): LlmComplete =>
  gatewayExtractor(env, { useCase: 'agent_compile' });

/** A tenant-scoped {@link RecallKnowledge} that grounds the diagnostic adapter in
 *  the tenant's own published SOPs/processes. */
function knowledgeRecaller(db: Db, tenantId: number): RecallKnowledge {
  return (query, topK) => recallSops(db, tenantId, query, topK);
}

/**
 * One need, admitted by its modality. The per-modality payload (`text`, `definition`,
 * `findings`, …) is validated by the adapter that lowers it, so the shape stays open
 * here — `z.looseObject` keeps every field the adapter reads.
 */
const NeedBody = z.looseObject({ modality: z.enum(MODALITIES) });

/** `need` OR `needs[]` — at least one. Shared by both routes. */
const NeedsFields = {
  need: NeedBody.optional(),
  needs: z.array(NeedBody).optional(),
  engineId: zOptionalString,
};
const needsPresent = (body: { need?: unknown; needs?: unknown[] }) => (body.needs?.length ?? 0) > 0 || !!body.need;
const NEEDS_REQUIRED = { message: 'need (or needs[]) is required', path: ['need'] };

const CompileBody = z.object({
  ...NeedsFields,
  deploy: z.enum(DEPLOY_SURFACES).optional(),
  taskId: zPositiveInt.optional(),
  cloudAgentRef: zOptionalString,
  projectId: zPositiveInt.optional(),
}).refine(needsPresent, NEEDS_REQUIRED);

const CompileRunBody = z.object({
  ...NeedsFields,
  sample: zOptionalString,
}).refine(needsPresent, NEEDS_REQUIRED);

/** The admitted body's needs as the `Need[]` the compiler takes. */
function readNeeds(body: { need?: unknown; needs?: unknown[] }): Need[] {
  return (Array.isArray(body.needs) && body.needs.length > 0 ? body.needs : [body.need]) as Need[];
}

export function createCompileRoutes(db: Db, runtimeService: RuntimeService): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // Compile one or more needs → AgentSpec (+ optional deploy plan; + live dispatch
  // when a deploy surface is given and the run can be started server-side).
  router.post('/', async (c) => {
    const body = await parseBody(c, CompileBody);
    const needs = readNeeds(body);

    let spec;
    try {
      spec = await compile(needs, {
        llm: compileExtractor(c.env),
        recallKnowledge: knowledgeRecaller(db, c.get('tenantId') as number),
      });
    } catch (error) {
      return failResponse(c, error, { source: SOURCE, operation: 'compile-needs' });
    }

    const surface = body.deploy;
    if (!surface) return c.json({ spec });

    // A cloud dispatcher that starts a run against a board task, carrying the spec's
    // governance gates in the payload so the cloud loop enforces them.
    const dispatchCloudRun: CloudRunDispatcher = (params) =>
      dispatchCloudRunForTask(c.env as Env, db, runtimeService, (p) => c.executionCtx.waitUntil(p), {
        ...params,
        // A compile/deploy performs no lifecycle role, so a managed board would refuse it
        // outright. The person who clicked IS the authority: it is declared, recorded, and
        // the run is admitted lifecycle-neutral — it deploys, it cannot advance the lane.
        payload: stampExecutionAuthority(
          params.payload,
          humanDirected(c.get('userId'), 'Compile/deploy started from the compile surface.'),
        ),
        submittedBy: `user:${c.get('userId') ?? 'compile'}`,
        // A person clicked Compile/Deploy — the same explicit override Run-now uses,
        // so the failure breaker and re-run cooldown do not apply.
        force: true,
      });

    const dispatched = await deployAndDispatch(spec, surface, {
      db,
      tenantId: c.get('tenantId') as number,
      projectId: body.projectId ?? null,
      cloudAgentRef: body.cloudAgentRef ?? null,
      taskId: body.taskId,
      dispatchCloudRun,
      deployOptions: body.engineId ? { engineId: body.engineId } : {},
    });
    if (!dispatched.ok) return c.json({ spec, error: dispatched.error }, 400);
    const { ok: _ok, plan, ...rest } = dispatched;
    return c.json({ spec, plan, dispatch: rest });
  });

  // Compile → deploy(cloud-durable) → run a real first turn through the gateway.
  router.post('/run', async (c) => {
    const body = await parseBody(c, CompileRunBody);
    const needs = readNeeds(body);

    const tenantId = c.get('tenantId') as number;

    let spec;
    try {
      spec = await compile(needs, {
        llm: compileExtractor(c.env),
        recallKnowledge: knowledgeRecaller(db, tenantId),
      });
    } catch (error) {
      return failResponse(c, error, { source: SOURCE, operation: 'compile-needs' });
    }

    // A step-bearing spec (a process chart / a diagnostic's improvement flow) is a
    // RUNNABLE workflow — instantiate it for real on the workflow surface, rather than
    // chatting a single turn. The existing claim/relay + cloud-workflow cron advance it.
    if ((spec.steps?.length ?? 0) > 0) {
      const dispatched = await deployAndDispatch(spec, 'workflow-node', { db, tenantId });
      if (!dispatched.ok) return c.json({ spec, error: dispatched.error }, 400);
      const plan = deploy(spec, 'workflow-node', body.engineId ? { engineId: body.engineId } : {});
      return c.json({
        spec,
        plan,
        ...(dispatched.kind === 'workflow' ? { workflow: { workflowId: dispatched.workflowId, taskCount: dispatched.taskCount } } : {}),
      });
    }

    // The surface is chosen from the spec's OWN allow-list, so `deploy` refusing it
    // is an invariant failure: it throws to the global handler.
    const surface: AgentSurface = (spec.surfaces?.find((s) => s === 'cloud-durable') ?? spec.surfaces?.[0] ?? 'cloud-durable') as AgentSurface;
    const plan = deploy(spec, surface, body.engineId ? { engineId: body.engineId } : {});

    const sample = body.sample ?? 'Briefly introduce yourself and what you can do for me.';
    try {
      // The compiled agent's first real turn → run on the tenant's connected BYO
      // account when present; the compiled `runInput.model` is honored only when it
      // preempts the BYO seed (its own account), else the connected flagship leads.
      const result = await completeForTenant(c.env, tenantId, {
        messages: [
          { role: 'system', content: plan.runInput.systemPrompt },
          { role: 'user', content: sample },
        ],
        temperature: plan.execParams.temperature ?? 0.5,
        max_tokens: 600,
        useCase: 'agent_compile_run',
      }, { meterUseCase: 'agent_compile_run', explicitModel: plan.runInput.model });
      if (result.response.status >= 400) return c.json({ spec, plan, error: `gateway ${result.response.status}` }, 502);
      const { content } = await readProxyChoice(result);
      return c.json({ spec, plan, output: content });
    } catch (error) {
      return failResponse(c, error, { source: SOURCE, operation: 'run-compiled-agent' }, { spec, plan });
    }
  });

  return router;
}
