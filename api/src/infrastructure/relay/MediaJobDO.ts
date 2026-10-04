/**
 * MediaJobDO — owns ONE media job (a generated clip or a server-rendered movie)
 * and advances it on its own alarm.
 *
 * Every decision is `advanceMediaJob`'s (application/llm/video/mediaJob.ts).
 * This class only persists the state, wires the real dependencies (vendor keys,
 * R2, the usage ledger, the cooldown store, the render container) and
 * schedules the next step. A step may hold a vendor connection for minutes
 * (Pollinations renders while the request is open), which is why it runs in an
 * alarm — 15 minutes of wall time — and never in a user request.
 *
 *   POST /start  { job, publicOrigin }  → stores the job, schedules step 1
 *   GET  /status                        → the stored job (the route checks tenancy)
 *
 * One instance per job: `idFromName('media-job:<jobId>')`.
 */

import type { Env } from '../../env';
import { buildDatabase } from '../database/connection';
import { storeTenantAsset } from '../../application/assets/tenantAssetStore';
import { recordUsageRow } from '../../application/llm/usageLedger';
import { loadCooldowns, recordFailure } from '../auth/cooldownStore';
import type { VendorId } from '../../application/llm/vendors';
import { VIDEO_REGISTRY } from '../../application/llm/videoVendors/registry';
import { VIDEO_SECOND_TOKEN_COST } from '../../application/llm/mediaProducts';
import { advanceMediaJob, type MediaJobDeps, type MediaJobState, type MovieRenderRequest } from '../../application/llm/video/mediaJob';
import { createDurableErrorReporter, type DurableErrorReporter } from '../../application/observability/durableErrorReporter';

interface StartBody { job: MediaJobState; publicOrigin: string }

const JOB_KEY = 'job';
const ORIGIN_KEY = 'publicOrigin';

/** Cooldown keys are namespaced `video:<vendor>` so they never collide with the
 *  chat or image vendor of the same name. */
const videoCooldownVendor = (model: string): VendorId => `video:${VIDEO_REGISTRY.vendorFor(model)}` as VendorId;

export class MediaJobDO implements DurableObject {
  declare readonly '__DURABLE_OBJECT_BRAND': never;
  private readonly reportError: DurableErrorReporter;

  constructor(private readonly state: DurableObjectState, private readonly env: Env) {
    this.reportError = createDurableErrorReporter('infrastructure/relay/MediaJobDO.ts', env, state);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname.endsWith('/start')) {
      const body = (await request.json().catch(() => null)) as StartBody | null;
      if (!body?.job?.id) return new Response('bad request', { status: 400 });
      await this.state.storage.put(JOB_KEY, body.job);
      await this.state.storage.put(ORIGIN_KEY, body.publicOrigin);
      await this.state.storage.setAlarm(Date.now());
      return Response.json({ ok: true }, { status: 202 });
    }
    if (request.method === 'GET' && url.pathname.endsWith('/status')) {
      const job = await this.state.storage.get<MediaJobState>(JOB_KEY);
      return job ? Response.json(job) : new Response('not found', { status: 404 });
    }
    return new Response('not found', { status: 404 });
  }

  async alarm(): Promise<void> {
    const job = await this.state.storage.get<MediaJobState>(JOB_KEY);
    if (!job) return;
    const publicOrigin = (await this.state.storage.get<string>(ORIGIN_KEY)) ?? 'https://api.builderforce.ai';
    try {
      const step = await advanceMediaJob(job, this.deps(job, publicOrigin));
      await this.state.storage.put(JOB_KEY, step.state);
      if (step.nextStepInMs !== null) await this.state.storage.setAlarm(Date.now() + step.nextStepInMs);
    } catch (error) {
      // advanceMediaJob classifies vendor errors itself; anything that escapes is
      // infrastructure (R2, DB). Fail the job visibly rather than retrying forever.
      this.reportError(error, { operation: 'alarm', context: { jobId: job.id, kind: job.kind } });
      await this.state.storage.put(JOB_KEY, {
        ...job, status: 'failed', updatedAt: Date.now(),
        error: 'The video could not be saved. Try again in a moment.',
      } satisfies MediaJobState);
    }
  }

  private deps(job: MediaJobState, publicOrigin: string): MediaJobDeps {
    const env = this.env;
    return {
      vendorEnv: env,
      now: () => Date.now(),
      storeMedia: async (bytes, mimeType, fileName) => {
        const stored = await storeTenantAsset(env.UPLOADS, new File([bytes], fileName, { type: mimeType }), {
          tenantId: job.tenantId,
          userId: job.userId ?? 'media-job',
        });
        if ('error' in stored) throw new Error(`media storage refused the file (${stored.error})`);
        return { url: `${publicOrigin}/api/assets/${stored.key}`, storageKey: stored.key };
      },
      recordClipUsage: async (current, model, seconds) => {
        await recordUsageRow(buildDatabase(env), env, {
          tenantId: current.tenantId,
          userId: current.userId,
          llmProduct: current.product,
          model,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: seconds * VIDEO_SECOND_TOKEN_COST },
          useCase: current.useCase,
          metadata: { mediaJobId: current.id, videoSeconds: seconds },
          surface: 'web',
        });
      },
      recordFailure: (model, status) => recordFailure(env, videoCooldownVendor(model), model, status),
      cooledModels: async (chain) => {
        const cooled = await loadCooldowns(env, chain.map((model) => ({ vendor: videoCooldownVendor(model), model })));
        return new Set(chain.filter((model) => cooled.has(`${videoCooldownVendor(model)}/${model}`)));
      },
      renderMovie: (request) => this.renderMovie(job.id, request),
    };
  }

  private async renderMovie(jobId: string, request: MovieRenderRequest): Promise<{ bytes: ArrayBuffer; mimeType: string }> {
    const ns = this.env.MEDIA_RENDER_CONTAINER;
    if (!ns) throw new Error('server rendering is not configured on this deployment');
    const stub = ns.get(ns.idFromName(`media-render:${jobId}`));
    const res = await stub.fetch('https://media-render/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!res.ok) throw new Error((await res.text()).slice(0, 300) || `render container answered ${res.status}`);
    return { bytes: await res.arrayBuffer(), mimeType: res.headers.get('Content-Type') ?? 'video/mp4' };
  }
}
