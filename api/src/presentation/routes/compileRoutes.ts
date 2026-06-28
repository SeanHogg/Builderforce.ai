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
import { deploy, DEPLOY_SURFACES } from '../../application/deploy';
import { deployAndDispatch, type CloudRunDispatcher } from '../../application/deploy/dispatch';
import { dispatchCloudRunForTask } from './runtimeRoutes';
import { ideProxy } from '../../application/llm/LlmProxyService';
import { MODALITIES } from '../../application/compile';

/** A gateway-backed {@link LlmComplete} for the modality adapters (free pool). */
function gatewayExtractor(env: HonoEnv['Bindings']): LlmComplete {
  return async (messages) => {
    const result = await ideProxy(env).complete({
      messages,
      temperature: 0,
      max_tokens: 700,
      useCase: 'agent_compile',
    });
    if (result.response.status >= 400) throw new Error(`gateway ${result.response.status}`);
    const raw = (await result.response.json().catch(() => null)) as
      | { choices?: Array<{ message?: { content?: unknown } }> }
      | null;
    const content = raw?.choices?.[0]?.message?.content;
    return typeof content === 'string' ? content : '';
  };
}

function isModality(m: unknown): m is Need['modality'] {
  return typeof m === 'string' && (MODALITIES as readonly string[]).includes(m);
}

/** Validate + normalise the request body's needs into a `Need[]`. */
function readNeeds(body: { need?: unknown; needs?: unknown }): Need[] | { error: string } {
  const raw = Array.isArray(body.needs) ? body.needs : body.need ? [body.need] : [];
  if (raw.length === 0) return { error: 'need (or needs[]) is required' };
  for (const n of raw) {
    if (!n || typeof n !== 'object' || !isModality((n as { modality?: unknown }).modality)) {
      return { error: `each need must have a modality of: ${MODALITIES.join(', ')}` };
    }
  }
  return raw as Need[];
}

function readSurface(v: unknown): AgentSurface | null {
  return typeof v === 'string' && (DEPLOY_SURFACES as readonly string[]).includes(v) ? (v as AgentSurface) : null;
}

export function createCompileRoutes(db: Db, runtimeService: RuntimeService): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // Compile one or more needs → AgentSpec (+ optional deploy plan; + live dispatch
  // when a deploy surface is given and the run can be started server-side).
  router.post('/', async (c) => {
    type Body = { need?: unknown; needs?: unknown; deploy?: unknown; engineId?: string; taskId?: number; cloudAgentRef?: string; projectId?: number };
    const body = await c.req.json<Body>().catch((): Body => ({}));
    const needs = readNeeds(body);
    if ('error' in needs) return c.json(needs, 400);

    let spec;
    try {
      spec = await compile(needs, { llm: gatewayExtractor(c.env) });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'compile failed' }, 502);
    }

    const surface = readSurface(body.deploy);
    if (body.deploy && !surface) {
      return c.json({ error: `deploy surface must be one of: ${DEPLOY_SURFACES.join(', ')}` }, 400);
    }
    if (!surface) return c.json({ spec });

    // A cloud dispatcher that starts a run against a board task, carrying the spec's
    // governance gates in the payload so the cloud loop enforces them.
    const dispatchCloudRun: CloudRunDispatcher = (params) =>
      dispatchCloudRunForTask(c.env as Env, db, runtimeService, (p) => c.executionCtx.waitUntil(p), {
        ...params,
        submittedBy: `user:${c.get('userId') ?? 'compile'}`,
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
    type Body = { need?: unknown; needs?: unknown; sample?: string; engineId?: string };
    const body = await c.req.json<Body>().catch((): Body => ({}));
    const needs = readNeeds(body);
    if ('error' in needs) return c.json(needs, 400);

    let spec;
    try {
      spec = await compile(needs, { llm: gatewayExtractor(c.env) });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'compile failed' }, 502);
    }

    const tenantId = c.get('tenantId') as number;

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

    const surface: AgentSurface = (spec.surfaces?.find((s) => s === 'cloud-durable') ?? spec.surfaces?.[0] ?? 'cloud-durable') as AgentSurface;
    let plan;
    try {
      plan = deploy(spec, surface, body.engineId ? { engineId: body.engineId } : {});
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'deploy failed' }, 400);
    }

    const sample = (typeof body.sample === 'string' && body.sample.trim()) || 'Briefly introduce yourself and what you can do for me.';
    try {
      const result = await ideProxy(c.env).complete({
        messages: [
          { role: 'system', content: plan.runInput.systemPrompt },
          { role: 'user', content: sample },
        ],
        ...(plan.runInput.model ? { model: plan.runInput.model } : {}),
        temperature: plan.execParams.temperature ?? 0.5,
        max_tokens: 600,
        useCase: 'agent_compile_run',
      });
      if (result.response.status >= 400) return c.json({ spec, plan, error: `gateway ${result.response.status}` }, 502);
      const raw = (await result.response.json().catch(() => null)) as
        | { choices?: Array<{ message?: { content?: unknown } }> }
        | null;
      const output = raw?.choices?.[0]?.message?.content;
      return c.json({ spec, plan, output: typeof output === 'string' ? output : '' });
    } catch (err) {
      return c.json({ spec, plan, error: err instanceof Error ? err.message : 'run failed' }, 502);
    }
  });

  return router;
}
