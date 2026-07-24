/**
 * IDE (Builderforce) routes — project files, datasets, training, workforce agents.
 * Projects are the unified API projects (projects table). Project files in R2 under ide/projects/{projectId}/.
 */
import { Hono } from 'hono';
import { neon } from '@neondatabase/serverless';
import type { Env, HonoEnv } from '../../env';
import { authMiddleware } from '../middleware/authMiddleware';
import { invalidateCached, getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import {
  type AgentDescriptor,
  resolveInferenceMode,
  buildAgentSystemPrompt,
  applyAgentSystem,
} from '../../application/agent/agentPrompt';
import { recallAgentKnowledge, ingestAgentKnowledge } from '../../application/agent/agentKnowledge';
import {
  importRepoToWorkspace,
  commitWorkspaceToRepo,
  createRemoteRepo,
  getRepoStatus,
  enableGitHubDeploys,
} from '../../application/ide/repoBridge';
import { PUBLIC_LIST_CACHE_KEY } from './workforceRoutes';
import {
  ideProxy,
  readProxyChoice,
  newTraceId,
  type ChatCompletionRequest,
} from '../../application/llm/LlmProxyService';
import { logTrace } from '../../application/llm/traceLogger';
import { evaluateFinetuneOutputs } from '../../application/finetune/evaluateFinetune';
import { tenantProxyForPlan } from '../../application/llm/tenantProxy';
import {
  IDE_PREFIX,
  ensureProjectTemplate,
  ensureRunnableScaffold,
  templateLooksUnseeded,
  templateNeedsBackfill,
  type SeedableProject,
} from '../../application/project/projectTemplate';
import {
  listWorkspaceFiles,
  readWorkspaceFile,
  writeWorkspaceFile,
  deleteWorkspaceFile,
} from '../../application/ide/workspaceStore';
import { HOSTING_APEX } from '../../application/ide/siteHosting';
import { publishStaticSite, assetsFromFormData } from '../../application/ide/publishStaticSite';

function generateId(): string {
  return crypto.randomUUID();
}

function parseProjectIdInt(param: string): number {
  const n = Number(param);
  if (!Number.isInteger(n) || n < 1) throw new Error('Invalid project id');
  return n;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveProjectId(env: HonoEnv['Bindings'], param: string): Promise<number> {
  if (UUID_RE.test(param)) {
    const rows = await neon(env.NEON_DATABASE_URL)`SELECT id FROM projects WHERE public_id = ${param} LIMIT 1`;
    const row = rows[0] as { id: number } | undefined;
    if (!row) throw new Error('Project not found');
    return row.id;
  }
  return parseProjectIdInt(param);
}

/** Fetch the fields the template-seeding decision needs, by numeric project id. */
async function fetchSeedableProject(env: HonoEnv['Bindings'], id: number): Promise<SeedableProject | null> {
  const rows = await neon(env.NEON_DATABASE_URL)`
    SELECT template, modality, source_control_repo_full_name, github_repo_url
    FROM projects WHERE id = ${id} LIMIT 1`;
  const row = rows[0] as {
    template: string | null;
    modality: string | null;
    source_control_repo_full_name: string | null;
    github_repo_url: string | null;
  } | undefined;
  if (!row) return null;
  return {
    id,
    template: row.template,
    modality: row.modality,
    sourceControlRepoFullName: row.source_control_repo_full_name,
    githubRepoUrl: row.github_repo_url,
  };
}

/** Parse AI response for dataset JSON array. */
function parseDatasetResponse(text: string): { instruction: string; input: string; output: string }[] {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end === -1) throw new Error('AI response did not contain a valid JSON array');
  const raw = JSON.parse(cleaned.slice(start, end + 1)) as unknown[];
  return raw
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map(item => ({
      instruction: String(item['instruction'] ?? ''),
      input: String(item['input'] ?? ''),
      output: String(item['output'] ?? ''),
    }))
    .filter(ex => ex.instruction.length > 0 && ex.output.length > 0);
}

export function createIdeRoutes(): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  const sql = (env: HonoEnv['Bindings']) => neon(env.NEON_DATABASE_URL);
  const storage = (env: HonoEnv['Bindings']) => env.UPLOADS;
  const r2 = (c: { env: HonoEnv['Bindings'] }) => storage(c.env);
  const getSql = (c: { env: HonoEnv['Bindings'] }) => sql(c.env);

  /**
   * Ownership gate for every project-scoped IDE resource. Files, sites, datasets,
   * training jobs and agents are tenant-owned ONLY via projects.tenant_id, so a
   * request-supplied projectId (or a resource's project_id) MUST be checked — else a
   * caller could read/overwrite another tenant's source, datasets, models or sites by
   * guessing an id. Returns false when the project is missing or another tenant's.
   */
  const projectInTenant = async (c: { env: HonoEnv['Bindings']; get: (k: 'tenantId') => unknown }, projectId: number): Promise<boolean> => {
    if (!Number.isInteger(projectId) || projectId < 1) return false;
    const [row] = await getSql(c)`SELECT 1 FROM projects WHERE id = ${projectId} AND tenant_id = ${c.get('tenantId') as number} LIMIT 1`;
    return !!row;
  };

  /** Ownership gate for a training job (and its logs), via its project's tenant. */
  const trainingJobInTenant = async (c: { env: HonoEnv['Bindings']; get: (k: 'tenantId') => unknown }, jobId: string): Promise<boolean> => {
    const [job] = await getSql(c)`SELECT project_id FROM ide_training_jobs WHERE id = ${jobId} LIMIT 1`;
    return !!job && projectInTenant(c, Number(job.project_id));
  };

  // ---------- Project files (R2) — projectId accepts integer or public UUID ----
  // All object access goes through application/ide/workspaceStore — the single
  // tested contract for keys, path validation, missing-vs-empty, and the
  // structural content guard. Routes only do auth/lookup + HTTP mapping.
  router.get('/projects/:projectId/files', async (c) => {
    const projectId = await resolveProjectId(c.env, c.req.param('projectId'));
    const bucket = r2(c);
    if (!bucket) return c.json({ error: 'Storage not configured' }, 503);
    if (!(await projectInTenant(c, projectId))) return c.json({ error: 'Project not found' }, 404);
    let rel = await listWorkspaceFiles(bucket, projectId);

    // Lazy self-heal: projects created before template seeding (or via the
    // scaffold/upsert paths that historically didn't seed) open with their
    // template files missing or empty. The cheap in-memory `templateNeedsBackfill`
    // gate runs first, so healthy projects never incur the project lookup or any
    // writes — only a freshly-, un-, or PARTIALLY-seeded project does.
    const hasRealPackageJson = (objs: { path: string; size: number }[]) =>
      objs.some((o) => o.path === 'package.json' && o.size > 0);

    if (templateNeedsBackfill(rel)) {
      const tenantId = c.get('tenantId') as number;
      // getRepoStatus is cached (~30s), so a healthy repo-backed project pays only
      // this — no Neon read — on the hot file-list path.
      const repoStatus = await getRepoStatus(c.env as Env, tenantId, projectId).catch(() => ({ linked: false as const }));

      if (repoStatus.linked && repoStatus.repoId) {
        // Prefer importing a linked repo's files (open an existing repo-mapped
        // project like VS Code) — but only for a brand-new/fully-empty workspace,
        // so we never clobber a repo project's real files.
        if (templateLooksUnseeded(rel)) {
          const imported = await importRepoToWorkspace(c.env as Env, tenantId, projectId, repoStatus.repoId).catch(() => null);
          if (imported?.ok && imported.imported > 0) rel = await listWorkspaceFiles(bucket, projectId);
        }
        // Guarantee runnability. A repo-linked project whose backing repo was
        // effectively empty (auto-created README-only, or a first push that found
        // R2 empty and bailed) would otherwise import a near-empty tree and —
        // because seeding is skipped for repo-linked projects — be left with
        // nothing runnable. THIS is the wipe. Only touch it when there's STILL no
        // real package.json, so a genuine imported repo skips the Neon read too.
        if (!hasRealPackageJson(rel)) {
          const project = await fetchSeedableProject(c.env, projectId);
          if (project && (await ensureRunnableScaffold(bucket, project, rel)) > 0) {
            rel = await listWorkspaceFiles(bucket, projectId);
          }
        }
      } else {
        // Non-repo project: seed the modality scaffold's missing/empty files
        // (also heals the partial-empty "blank editor" case).
        const project = await fetchSeedableProject(c.env, projectId);
        if (project && (await ensureProjectTemplate(bucket, project, rel)) > 0) {
          rel = await listWorkspaceFiles(bucket, projectId);
        }
      }
    }

    return c.json(rel.map((f) => ({ path: f.path, type: 'file' as const, content: '' })));
  });

  router.get('/projects/:projectId/files/*', async (c) => {
    const projectId = await resolveProjectId(c.env, c.req.param('projectId'));
    const path = c.req.param('*') || '';
    const bucket = r2(c);
    if (!bucket) return c.json({ error: 'Storage not configured' }, 503);
    if (!(await projectInTenant(c, projectId))) return c.json({ error: 'Project not found' }, 404);
    const content = await readWorkspaceFile(bucket, projectId, path);
    // Missing is 404, NOT an empty 200 — a blank body for a file that was never
    // written let callers cache '' as if it were real content, which is how
    // silent-empty states propagated into saves.
    if (content === null) return c.json({ error: 'File not found' }, 404);
    return c.text(content);
  });

  router.put('/projects/:projectId/files/*', async (c) => {
    const projectId = await resolveProjectId(c.env, c.req.param('projectId'));
    const path = c.req.param('*') || '';
    const bucket = r2(c);
    if (!bucket) return c.json({ error: 'Storage not configured' }, 503);
    if (!(await projectInTenant(c, projectId))) return c.json({ error: 'Project not found' }, 404);
    // The store enforces the path + structural-content contracts, so no caller
    // (editor, agent, script) can persist a traversal path or another file's
    // content (JSON into .js, source into .html) — 400/422 with the reason.
    const result = await writeWorkspaceFile(bucket, projectId, path, await c.req.text());
    if (!result.ok) return c.json({ error: result.reason }, result.status);
    return c.json({ success: true });
  });

  router.delete('/projects/:projectId/files/*', async (c) => {
    const projectId = await resolveProjectId(c.env, c.req.param('projectId'));
    const path = c.req.param('*') || '';
    const bucket = r2(c);
    if (!bucket) return c.json({ error: 'Storage not configured' }, 503);
    if (!(await projectInTenant(c, projectId))) return c.json({ error: 'Project not found' }, 404);
    await deleteWorkspaceFile(bucket, projectId, path);
    return c.json({ success: true });
  });

  // ---------- Designer ↔ repo bridge (import / commit / create / status) ----------
  // R2 is the working store; these sync it with a linked git repo using the shared
  // cloud-native repo helpers (no on-prem host). All tenant-scoped via projectInTenant.

  const repoStatusKey = (projectId: number) => `ide:repo-status:${projectId}`;

  // GET status — the linked default repo + import baseline (cached; invalidated on
  // any import/commit/create below).
  router.get('/projects/:projectId/repo-status', async (c) => {
    const projectId = await resolveProjectId(c.env, c.req.param('projectId'));
    if (!(await projectInTenant(c, projectId))) return c.json({ error: 'Project not found' }, 404);
    const tenantId = c.get('tenantId') as number;
    const status = await getOrSetCached(
      c.env as Env,
      repoStatusKey(projectId),
      () => getRepoStatus(c.env as Env, tenantId, projectId),
      { kvTtlSeconds: 30 },
    );
    return c.json(status);
  });

  // POST import — pull a repo's files into the R2 workspace so it opens in the IDE.
  router.post('/projects/:projectId/import', async (c) => {
    const projectId = await resolveProjectId(c.env, c.req.param('projectId'));
    if (!(await projectInTenant(c, projectId))) return c.json({ error: 'Project not found' }, 404);
    const tenantId = c.get('tenantId') as number;
    const body = await c.req.json<{ repoId?: string; ref?: string }>().catch(() => ({} as { repoId?: string; ref?: string }));
    if (!body.repoId) return c.json({ error: 'repoId is required' }, 400);
    const result = await importRepoToWorkspace(c.env as Env, tenantId, projectId, body.repoId, body.ref);
    if (!result.ok) return c.json({ error: result.error }, result.status as 400);
    await invalidateCached(c.env as Env, repoStatusKey(projectId));
    return c.json(result);
  });

  // POST commit — push R2 workspace edits back to the repo as a branch + PR.
  router.post('/projects/:projectId/commit', async (c) => {
    const projectId = await resolveProjectId(c.env, c.req.param('projectId'));
    if (!(await projectInTenant(c, projectId))) return c.json({ error: 'Project not found' }, 404);
    const tenantId = c.get('tenantId') as number;
    const body = await c.req.json<{ repoId?: string; message?: string; branch?: string }>().catch(() => ({} as { repoId?: string; message?: string; branch?: string }));
    if (!body.repoId) return c.json({ error: 'repoId is required' }, 400);
    const result = await commitWorkspaceToRepo(c.env as Env, tenantId, projectId, body.repoId, { message: body.message, branch: body.branch });
    if (!result.ok) return c.json({ error: result.error }, result.status as 400);
    await invalidateCached(c.env as Env, repoStatusKey(projectId));
    return c.json(result);
  });

  // POST create-repo — make a clean remote repo, bind it, push the workspace.
  router.post('/projects/:projectId/create-repo', async (c) => {
    const projectId = await resolveProjectId(c.env, c.req.param('projectId'));
    if (!(await projectInTenant(c, projectId))) return c.json({ error: 'Project not found' }, 404);
    const tenantId = c.get('tenantId') as number;
    const body = await c.req.json<{ provider?: string; name?: string; private?: boolean; credentialId?: string }>().catch(() => ({} as { provider?: string; name?: string; private?: boolean; credentialId?: string }));
    if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400);
    if (!body.credentialId) return c.json({ error: 'credentialId is required' }, 400);
    const result = await createRemoteRepo(c.env as Env, tenantId, projectId, {
      provider: body.provider, name: body.name, private: body.private, credentialId: body.credentialId,
    });
    if (!result.ok) return c.json({ error: result.error }, result.status as 400);
    await invalidateCached(c.env as Env, repoStatusKey(projectId));
    return c.json(result);
  });

  // POST enable-deploys — write the GitHub Actions deploy workflow into the repo,
  // switching this project from "build in the browser and upload" to "GitHub
  // builds every push and deploys". Returns the committed workflow so the UI can
  // show exactly what was added.
  router.post('/projects/:projectId/enable-deploys', async (c) => {
    const projectId = await resolveProjectId(c.env, c.req.param('projectId'));
    if (!(await projectInTenant(c, projectId))) return c.json({ error: 'Project not found' }, 404);
    const tenantId = c.get('tenantId') as number;
    const body = await c.req
      .json<{ repoId?: string; subdomain?: string; distDir?: string }>()
      .catch(() => ({} as { repoId?: string; subdomain?: string; distDir?: string }));

    // Default to the repo already bound to this project, so the common case
    // needs no argument at all.
    const repoId = body.repoId
      ?? (await getRepoStatus(c.env as Env, tenantId, projectId)).repoId;
    if (!repoId) {
      return c.json({ error: 'Connect a GitHub repository to this project first.' }, 400);
    }

    // The runner posts back to whichever origin served this request, so a
    // preview/staging API writes a workflow pointing at itself, not production.
    const apiOrigin = new URL(c.req.url).origin;
    const result = await enableGitHubDeploys(c.env as Env, tenantId, projectId, repoId, {
      apiOrigin,
      subdomain: body.subdomain ?? null,
      distDir: body.distDir,
    });
    if (!result.ok) return c.json({ error: result.error }, result.status as 400);
    await invalidateCached(c.env as Env, repoStatusKey(projectId));
    const { ok: _ok, ...enabled } = result;
    return c.json(enabled);
  });

  // ---------- Site hosting (publish a Designer project to a subdomain) ----------

  // GET /projects/:projectId/site — current published-site record (or null).
  router.get('/projects/:projectId/site', async (c) => {
    const projectId = await resolveProjectId(c.env, c.req.param('projectId'));
    if (!(await projectInTenant(c, projectId))) return c.json({ error: 'Project not found' }, 404);
    const [row] = await getSql(c)`
      SELECT subdomain, mode, status, version_token, asset_count, total_bytes, published_at
      FROM project_sites WHERE project_id = ${projectId} LIMIT 1`;
    if (!row) return c.json({ site: null });
    return c.json({
      site: {
        subdomain: row.subdomain,
        mode: row.mode,
        status: row.status,
        versionToken: row.version_token,
        assetCount: row.asset_count,
        totalBytes: row.total_bytes,
        publishedAt: row.published_at,
        url: `https://${row.subdomain}.${HOSTING_APEX}`,
        pathUrl: `/api/sites/${row.subdomain}/`,
      },
    });
  });

  // POST /projects/:projectId/publish — deploy built static assets to a subdomain.
  // Body: multipart/form-data — optional `subdomain` field + one file part per
  // asset, the part NAME being the dist-relative path (e.g. `assets/app.4f3a.js`).
  router.post('/projects/:projectId/publish', async (c) => {
    const projectId = await resolveProjectId(c.env, c.req.param('projectId'));
    const bucket = r2(c);
    if (!bucket) return c.json({ error: 'Storage not configured' }, 503);

    const tenantId = c.get('tenantId') as number;
    const [proj] = await getSql(c)`SELECT tenant_id, name FROM projects WHERE id = ${projectId} LIMIT 1`;
    if (!proj) return c.json({ error: 'Project not found' }, 404);
    if (Number(proj.tenant_id) !== tenantId) return c.json({ error: 'Forbidden' }, 403);

    const form = await c.req.formData();

    // Subdomain claiming, stale-asset cleanup, the project_sites upsert and cache
    // invalidation all live in the shared core, so a browser publish and a GitHub
    // Actions deploy produce an identical site.
    const result = await publishStaticSite({
      env: c.env,
      sql: getSql(c),
      bucket,
      projectId,
      tenantId,
      projectName: String(proj.name ?? ''),
      requestedSubdomain: form.get('subdomain') as string | null,
      assets: assetsFromFormData(form, ['subdomain']),
    });
    if (!result.ok) return c.json({ error: result.error }, result.status);

    const { ok: _ok, ...body } = result;
    return c.json(body, 201);
  });

  // ---------- Datasets (project_id = API project id, integer) ----------
  router.get('/datasets', async (c) => {
    const raw = c.req.query('projectId');
    if (!raw) return c.json({ error: 'projectId query parameter is required' }, 400);
    const projectId = parseProjectIdInt(raw);
    if (!(await projectInTenant(c, projectId))) return c.json({ error: 'Project not found' }, 404);
    const rows = await getSql(c)`
      SELECT * FROM ide_datasets WHERE project_id = ${projectId} ORDER BY created_at DESC
    `;
    return c.json(rows);
  });

  router.get('/datasets/:id', async (c) => {
    const [row] = await getSql(c)`SELECT * FROM ide_datasets WHERE id = ${c.req.param('id')}`;
    if (!row || !(await projectInTenant(c, Number(row.project_id)))) return c.json({ error: 'Dataset not found' }, 404);
    return c.json(row);
  });

  router.get('/datasets/:id/download', async (c) => {
    const [row] = await getSql(c)`SELECT r2_key, status, project_id FROM ide_datasets WHERE id = ${c.req.param('id')}`;
    if (!row || !(await projectInTenant(c, Number(row.project_id)))) return c.json({ error: 'Dataset not found' }, 404);
    if (row.status !== 'ready') return c.json({ error: 'Dataset is not ready' }, 409);
    const bucket = r2(c);
    if (!bucket) return c.json({ error: 'Storage not configured' }, 503);
    const key = IDE_PREFIX + (row.r2_key as string);
    const obj = await bucket.get(key);
    if (!obj) return c.json({ error: 'Dataset file not found' }, 404);
    return new Response(await obj.text(), {
      headers: { 'Content-Type': 'application/jsonl', 'Cache-Control': 'no-cache' },
    });
  });

  router.post('/datasets/generate', async (c) => {
    const body = await c.req.json<{
      projectId: string | number;
      capabilityPrompt: string;
      name: string;
      exampleCount?: number;
    }>();
    if (body.projectId == null || !body.capabilityPrompt || !body.name) {
      return c.json({ error: 'projectId, capabilityPrompt, and name are required' }, 400);
    }
    const projectId = typeof body.projectId === 'number' ? body.projectId : parseProjectIdInt(String(body.projectId));
    if (!(await projectInTenant(c, projectId))) return c.json({ error: 'Project not found' }, 404);
    const id = generateId();
    const exampleCount = Math.min(body.exampleCount ?? 50, 200);
    await getSql(c)`
      INSERT INTO ide_datasets (id, project_id, name, capability_prompt, r2_key, status)
      VALUES (${id}, ${projectId}, ${body.name}, ${body.capabilityPrompt}, '', 'generating')
    `;

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const emit = (data: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        try {
          emit({ type: 'status', message: `Generating ${exampleCount} examples` });
          if (!c.env.OPENROUTER_API_KEY) {
            emit({ type: 'error', message: 'OPENROUTER_API_KEY not configured' });
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
            return;
          }
          // Dataset generation is the tenant's own training work → prefer their
          // connected BYO account (connected flagship leads), else the operator pool.
          const { proxy: service } = await tenantProxyForPlan(c.env, c.get('tenantId') as number);
          const systemPrompt = `You are an expert AI trainer. Generate instruction-tuning examples. Return ONLY a valid JSON array of objects: {"instruction":"...","input":"...","output":"..."}. No other text.`;
          const userPrompt = `Generate ${exampleCount} diverse examples for: ${body.capabilityPrompt}. Return ONLY the JSON array.`;
          const datasetTraceId = newTraceId();
          const datasetReqBody = {
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            stream: false,
            max_tokens: 4096,
          } as ChatCompletionRequest;
          const result = await service.complete(datasetReqBody, undefined, datasetTraceId);
          // Diagnostic trace for dataset generation (surface `dataset-gen`) so training-
          // data synthesis is attributable in the superadmin trace view alongside chat.
          logTrace(c.env, c.executionCtx, {
            traceId: datasetTraceId, surface: 'dataset-gen',
            tenantId: c.get('tenantId') ?? null,
            userId: c.get('userId') ?? null,
            result, streamed: false,
            requestIp: c.req.header('cf-connecting-ip') ?? null,
            origin: c.req.header('Origin') ?? null,
            userAgent: c.req.header('User-Agent') ?? null,
            requestBody: datasetReqBody as unknown as Record<string, unknown>,
            responseBody: null, errorMessage: null,
          });
          const json = await result.response.json() as { choices?: Array<{ message?: { content?: string } }> };
          const content = json.choices?.[0]?.message?.content ?? '';
          const examples = parseDatasetResponse(content);
          const jsonl = examples.map(ex => JSON.stringify(ex)).join('\n');
          const r2Key = `datasets/${String(projectId)}/${id}.jsonl`;
          const bucket = r2(c);
          if (bucket) await bucket.put(IDE_PREFIX + r2Key, jsonl, { httpMetadata: { contentType: 'application/jsonl' } });
          await getSql(c)`
            UPDATE ide_datasets SET r2_key = ${r2Key}, example_count = ${examples.length}, status = 'ready', updated_at = NOW() WHERE id = ${id}
          `;
          const [dataset] = await getSql(c)`SELECT * FROM ide_datasets WHERE id = ${id}`;
          emit({ type: 'done', dataset });
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Dataset generation failed';
          await getSql(c)`UPDATE ide_datasets SET status = 'error', updated_at = NOW() WHERE id = ${id}`;
          emit({ type: 'error', message: msg });
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    return new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Transfer-Encoding': 'chunked' },
    });
  });

  // ---------- Training (project_id = API project id, integer) ----------
  router.get('/training', async (c) => {
    const raw = c.req.query('projectId');
    if (!raw) return c.json({ error: 'projectId query parameter is required' }, 400);
    const projectId = parseProjectIdInt(raw);
    if (!(await projectInTenant(c, projectId))) return c.json({ error: 'Project not found' }, 404);
    const rows = await getSql(c)`
      SELECT * FROM ide_training_jobs WHERE project_id = ${projectId} ORDER BY created_at DESC
    `;
    return c.json(rows);
  });

  router.post('/training', async (c) => {
    const body = await c.req.json<{
      projectId: string | number;
      datasetId?: string;
      baseModel: string;
      loraRank?: number;
      epochs?: number;
      batchSize?: number;
      learningRate?: number;
    }>();
    if (body.projectId == null || !body.baseModel) return c.json({ error: 'projectId and baseModel are required' }, 400);
    const projectId = typeof body.projectId === 'number' ? body.projectId : parseProjectIdInt(String(body.projectId));
    if (!(await projectInTenant(c, projectId))) return c.json({ error: 'Project not found' }, 404);
    const id = generateId();
    await getSql(c)`
      INSERT INTO ide_training_jobs (id, project_id, dataset_id, base_model, lora_rank, epochs, batch_size, learning_rate)
      VALUES (${id}, ${projectId}, ${body.datasetId ?? null}, ${body.baseModel},
        ${body.loraRank ?? 8}, ${body.epochs ?? 3}, ${body.batchSize ?? 4}, ${body.learningRate ?? 0.0002})
    `;
    await getSql(c)`INSERT INTO ide_training_logs (id, job_id, message) VALUES (${generateId()}, ${id}, 'Training job created')`;
    const [row] = await getSql(c)`SELECT * FROM ide_training_jobs WHERE id = ${id}`;
    return c.json(row, 201);
  });

  router.get('/training/:id', async (c) => {
    const [row] = await getSql(c)`SELECT * FROM ide_training_jobs WHERE id = ${c.req.param('id')}`;
    if (!row || !(await projectInTenant(c, Number(row.project_id)))) return c.json({ error: 'Training job not found' }, 404);
    return c.json(row);
  });

  router.put('/training/:id', async (c) => {
    const body = await c.req.json<{
      status?: string;
      currentEpoch?: number;
      currentLoss?: number;
      r2ArtifactKey?: string;
      errorMessage?: string;
    }>();
    const id = c.req.param('id');
    if (!(await trainingJobInTenant(c, id))) return c.json({ error: 'Training job not found' }, 404);
    const [row] = await getSql(c)`
      UPDATE ide_training_jobs
      SET status = COALESCE(${body.status ?? null}, status),
          current_epoch = COALESCE(${body.currentEpoch ?? null}, current_epoch),
          current_loss = COALESCE(${body.currentLoss ?? null}, current_loss),
          r2_artifact_key = COALESCE(${body.r2ArtifactKey ?? null}, r2_artifact_key),
          error_message = COALESCE(${body.errorMessage ?? null}, error_message),
          updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;
    if (!row) return c.json({ error: 'Training job not found' }, 404);
    return c.json(row);
  });

  router.get('/training/:id/logs', async (c) => {
    if (!(await trainingJobInTenant(c, c.req.param('id')))) return c.json({ error: 'Training job not found' }, 404);
    const rows = await getSql(c)`
      SELECT * FROM ide_training_logs WHERE job_id = ${c.req.param('id')} ORDER BY created_at ASC
    `;
    return c.json(rows);
  });

  router.post('/training/:id/logs', async (c) => {
    const body = await c.req.json<{ epoch?: number; step?: number; loss?: number; message: string }>();
    if (!body.message) return c.json({ error: 'message is required' }, 400);
    const jobId = c.req.param('id');
    if (!(await trainingJobInTenant(c, jobId))) return c.json({ error: 'Training job not found' }, 404);
    const [row] = await getSql(c)`
      INSERT INTO ide_training_logs (id, job_id, epoch, step, loss, message)
      VALUES (${generateId()}, ${jobId}, ${body.epoch ?? null}, ${body.step ?? null}, ${body.loss ?? null}, ${body.message})
      RETURNING *
    `;
    return c.json(row!, 201);
  });

  router.get('/training/:id/logs/stream', async (c) => {
    const jobId = c.req.param('id');
    if (!(await trainingJobInTenant(c, jobId))) return c.json({ error: 'Training job not found' }, 404);
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        let afterTimestamp = new Date(0).toISOString();
        let complete = false;
        while (!complete) {
          const jobRows = await getSql(c)`SELECT status FROM ide_training_jobs WHERE id = ${jobId}`;
          if (jobRows.length === 0) break;
          const currentJob = jobRows[0];
          if (!currentJob) break;
          complete = (currentJob.status as string) === 'completed' || (currentJob.status as string) === 'failed';
          const logRows = await getSql(c)`
            SELECT * FROM ide_training_logs WHERE job_id = ${jobId} AND created_at > ${afterTimestamp} ORDER BY created_at ASC
          `;
          for (const row of logRows) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(row)}\n\n`));
            afterTimestamp = row.created_at as string;
          }
          if (!complete) await new Promise(r => setTimeout(r, 1000));
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    return new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Transfer-Encoding': 'chunked' },
    });
  });

  router.post('/training/:id/artifact', async (c) => {
    const jobId = c.req.param('id');
    const [job] = await getSql(c)`SELECT project_id FROM ide_training_jobs WHERE id = ${jobId}`;
    if (!job || !(await projectInTenant(c, Number(job.project_id)))) return c.json({ error: 'Training job not found' }, 404);
    const projectId = Number(job.project_id);
    const body = await c.req.arrayBuffer();
    if (!body || body.byteLength === 0) return c.json({ error: 'Empty artifact body' }, 400);
    const r2Key = `artifacts/${String(projectId)}/${jobId}/adapter.bin`;
    const bucket = r2(c);
    if (!bucket) return c.json({ error: 'Storage not configured' }, 503);
    await bucket.put(IDE_PREFIX + r2Key, body, {
      httpMetadata: { contentType: 'application/octet-stream' },
      customMetadata: { jobId, projectId: String(projectId), uploadedAt: new Date().toISOString() },
    });
    await getSql(c)`UPDATE ide_training_jobs SET r2_artifact_key = ${r2Key}, updated_at = NOW() WHERE id = ${jobId}`;
    await getSql(c)`INSERT INTO ide_training_logs (id, job_id, message) VALUES (${generateId()}, ${jobId}, ${'LoRA adapter uploaded: ' + r2Key})`;
    return c.json({ r2Key }, 201);
  });

  router.post('/training/:id/evaluate', async (c) => {
    const jobId = c.req.param('id');
    const [job] = await getSql(c)`SELECT * FROM ide_training_jobs WHERE id = ${jobId}`;
    if (!job || !(await projectInTenant(c, Number(job.project_id)))) return c.json({ error: 'Training job not found' }, 404);
    let examples: { instruction: string; input: string; output: string }[] = [];
    if (job.dataset_id) {
      const [ds] = await getSql(c)`SELECT r2_key FROM ide_datasets WHERE id = ${job.dataset_id}`;
      if (ds?.r2_key) {
        const bucket = r2(c);
        const key = IDE_PREFIX + (ds.r2_key as string);
        const obj = bucket ? await bucket.get(key) : null;
        if (obj) {
          const text = await obj.text();
          examples = text.split('\n').filter(Boolean).slice(0, 10).map(line => {
            try { return JSON.parse(line) as { instruction: string; input: string; output: string }; } catch { return null; }
          }).filter((ex): ex is { instruction: string; input: string; output: string } => ex !== null);
        }
      }
    }
    const service = ideProxy(c.env);
    const modelOutputs: string[] = [];
    if (c.env.OPENROUTER_API_KEY && examples.length > 0) {
      for (const ex of examples) {
        try {
          const result = await service.complete({
            messages: [
              { role: 'system', content: `You are answering as a fine-tuned agent for: ${job.base_model}. Provide a high-quality output.` },
              { role: 'user', content: ex.instruction + (ex.input ? `\nContext: ${ex.input}` : '') },
            ],
            stream: false,
            max_tokens: 512,
          } as ChatCompletionRequest);
          const { content } = await readProxyChoice(result);
          modelOutputs.push(content || '(no output)');
        } catch {
          modelOutputs.push('(Error generating output)');
        }
      }
    }
    // Real AI-judge scoring against the dataset's expected outputs (replaces the
    // fabricated flat 0.85). Persist the full breakdown so it's queryable — the
    // training panel charts correctness/reasoning/hallucination instead of a log.
    const evaluated = await evaluateFinetuneOutputs(service, examples, modelOutputs);
    await getSql(c)`
      UPDATE ide_training_jobs
      SET eval_score = ${evaluated.score},
          eval_code_correctness = ${evaluated.code_correctness},
          eval_reasoning_quality = ${evaluated.reasoning_quality},
          eval_hallucination_rate = ${evaluated.hallucination_rate},
          eval_details = ${evaluated.details},
          evaluated_at = NOW(),
          updated_at = NOW()
      WHERE id = ${jobId}
    `;
    await getSql(c)`INSERT INTO ide_training_logs (id, job_id, message) VALUES (${generateId()}, ${jobId}, ${`Evaluation complete — score: ${evaluated.score.toFixed(3)}`})`;
    return c.json({ job_id: jobId, ...evaluated, created_at: new Date().toISOString() });
  });

  // ---------- Agents (workforce registry) ----------
  router.get('/agents', async (c) => {
    const rows = await getSql(c)`SELECT * FROM ide_agents WHERE status = 'active' ORDER BY hire_count DESC, created_at DESC`;
    return c.json(rows);
  });

  router.post('/agents', async (c) => {
    const body = await c.req.json<{
      project_id: string | number;
      job_id?: string;
      name: string;
      title: string;
      bio: string;
      skills?: string[];
      base_model: string;
      lora_rank?: number;
      r2_artifact_key?: string;
      resume_md?: string;
      eval_score?: number;
      mamba_state?: unknown;
      package_version?: string;
    }>();
    const projectId = typeof body.project_id === 'number' ? body.project_id : parseProjectIdInt(String(body.project_id));
    if (!(await projectInTenant(c, projectId))) return c.json({ error: 'Project not found' }, 404);
    const id = generateId();
    const skillsJson = JSON.stringify(body.skills ?? []);
    const hasLora = !!body.r2_artifact_key;
    const hasMamba = !!body.mamba_state;
    const inferenceMode = hasLora && hasMamba ? 'hybrid' : hasLora ? 'lora' : 'base';
    const packageVersion = body.package_version ?? (hasMamba ? '2.0' : hasLora ? '1.0' : '1.0');
    const mambaStateJson = hasMamba ? JSON.stringify(body.mamba_state) : null;
    await getSql(c)`
      INSERT INTO ide_agents (id, project_id, job_id, name, title, bio, skills, base_model, lora_rank, r2_artifact_key, resume_md, status, hire_count, eval_score, package_version, mamba_state, inference_mode)
      VALUES (${id}, ${projectId}, ${body.job_id ?? null}, ${body.name}, ${body.title}, ${body.bio}, ${skillsJson},
        ${body.base_model}, ${body.lora_rank ?? null}, ${body.r2_artifact_key ?? null}, ${body.resume_md ?? null}, 'active', 0, ${body.eval_score ?? null},
        ${packageVersion}, ${mambaStateJson}::jsonb, ${inferenceMode})
    `;
    const [row] = await getSql(c)`SELECT * FROM ide_agents WHERE id = ${id}`;
    // Publishing a trained agent (status 'active', carries its eval_score) makes it
    // appear in the public workforce registry — drop the cached listing so the new
    // agent and its evaluation score show up immediately.
    await invalidateCached(c.env as Env, PUBLIC_LIST_CACHE_KEY);
    return c.json(row, 201);
  });

  router.get('/agents/:id', async (c) => {
    const [row] = await getSql(c)`SELECT * FROM ide_agents WHERE id = ${c.req.param('id')}`;
    if (!row) return c.json({ error: 'Agent not found' }, 404);
    return c.json(row);
  });

  router.get('/agents/:id/package', async (c) => {
    const agentId = c.req.param('id');
    const [agent] = await getSql(c)`SELECT * FROM ide_agents WHERE id = ${agentId}`;
    if (!agent) return c.json({ error: 'Agent not found' }, 404);
    await getSql(c)`
      UPDATE ide_agents SET request_count = request_count + 1, last_used_at = NOW() WHERE id = ${agentId}
    `;
    const skills: string[] = Array.isArray(agent.skills) ? agent.skills : JSON.parse(typeof agent.skills === 'string' ? agent.skills : '[]');
    const mambaState = agent.mamba_state ?? null;
    const version = mambaState ? '2.0' : '1.0';
    const basePkg = {
      platform: 'builderforce.ai' as const,
      name: agent.name as string,
      title: agent.title as string,
      bio: agent.bio as string,
      skills,
      base_model: agent.base_model as string,
      lora_config: { rank: (agent.lora_rank as number) ?? 8, alpha: ((agent.lora_rank as number) ?? 8) * 2, target_modules: ['q_proj', 'v_proj'] },
      training_job_id: agent.job_id as string | undefined,
      r2_artifact_key: agent.r2_artifact_key as string | undefined,
      resume_md: agent.resume_md as string | undefined,
      created_at: agent.created_at as string,
    };
    const pkg = mambaState
      ? { version: '2.0' as const, ...basePkg, mamba_state: mambaState }
      : { version: '1.0' as const, ...basePkg };
    const safeName = (agent.name as string).replace(/\s+/g, '-').toLowerCase().replace(/[^\w-]/g, '').replace(/^-+|-+$/g, '') || 'agent';
    c.header('Content-Disposition', `attachment; filename="${safeName}-package.json"`);
    return c.json(pkg);
  });

  router.get('/agents/:id/mamba-state', async (c) => {
    const [agent] = await getSql(c)`SELECT mamba_state, package_version FROM ide_agents WHERE id = ${c.req.param('id')}`;
    if (!agent) return c.json({ error: 'Agent not found' }, 404);
    if (!agent.mamba_state) return c.json({ error: 'No mamba state stored for this agent' }, 404);
    return c.json(agent.mamba_state);
  });

  router.put('/agents/:id/mamba-state', async (c) => {
    const agentId = c.req.param('id');
    // Owner-only write: an agent's brain state may only be overwritten by the tenant
    // whose project owns it (reads stay marketplace-public for hiring/inference).
    const [owner] = await getSql(c)`SELECT project_id FROM ide_agents WHERE id = ${agentId} LIMIT 1`;
    if (!owner || !(await projectInTenant(c, Number(owner.project_id)))) return c.json({ error: 'Agent not found' }, 404);
    const snapshot = await c.req.json();
    const required = ['data', 'dim', 'order', 'channels', 'step'];
    for (const key of required) {
      if (!(key in snapshot)) return c.json({ error: `Missing field: ${key}` }, 400);
    }
    const [row] = await getSql(c)`
      UPDATE ide_agents
      SET mamba_state = ${JSON.stringify(snapshot)}::jsonb, package_version = '2.0', inference_mode = CASE
        WHEN r2_artifact_key IS NOT NULL THEN 'hybrid'
        ELSE 'lora'
      END, updated_at = NOW()
      WHERE id = ${agentId}
      RETURNING id, package_version, inference_mode
    `;
    if (!row) return c.json({ error: 'Agent not found' }, 404);
    return c.json({ ok: true, agent_id: agentId, package_version: row.package_version, inference_mode: row.inference_mode });
  });

  router.post('/agents/:id/chat', async (c) => {
    const agentId = c.req.param('id');
    const body = await c.req.json<{ messages: Array<{ role: string; content: string }>; stream?: boolean }>();
    if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
      return c.json({ error: 'messages array is required' }, 400);
    }
    if (!c.env.OPENROUTER_API_KEY?.trim()) {
      return c.json({ error: 'LLM not configured' }, 503);
    }
    const [agent] = await getSql(c)`SELECT * FROM ide_agents WHERE id = ${agentId}`;
    if (!agent) return c.json({ error: 'Agent not found' }, 404);

    // Recall grounded context from the agent's ingested proprietary knowledge,
    // keyed on the latest user message. '' when the agent has no knowledge or
    // nothing is relevant (read-through cached; invalidated on re-ingest).
    const latestUser = [...body.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    const recalledContext = await recallAgentKnowledge(c.env, getSql(c), agentId, latestUser);
    const descriptor: AgentDescriptor = {
      name: agent.name as string,
      title: agent.title as string,
      bio: agent.bio as string,
      skills: agent.skills as string[] | string | null,
      r2_artifact_key: agent.r2_artifact_key as string | null,
      mamba_state: agent.mamba_state,
      recalledContext,
    };
    const inferenceMode = (agent.inference_mode as string) ?? resolveInferenceMode(descriptor);
    const baseMessages = body.messages.map((m) => ({ role: m.role as 'system' | 'user' | 'assistant', content: m.content }));
    // Persona + recalled-knowledge + Mamba-memory system prompt is built by the
    // shared lowering (same helper as validate / the gateway).
    const messages = applyAgentSystem(baseMessages, buildAgentSystemPrompt(descriptor));

    const logId = generateId();
    const startMs = Date.now();
    // Workforce/hired-agent inference is the tenant's agent doing its job → run on the
    // tenant's connected BYO account when present (connected flagship leads), else the
    // operator pool. No explicit model here, so complete() seeds the BYO flagship.
    const { proxy: service } = await tenantProxyForPlan(c.env, c.get('tenantId') as number);
    let status = 'ok';
    let errorMessage: string | null = null;
    const traceId = newTraceId();
    try {
      const streamed = body.stream !== false;
      const result = await service.complete({ messages, stream: streamed }, undefined, traceId);
      const latencyMs = Date.now() - startMs;
      // Diagnostic trace for workforce/hired-agent inference (surface `agent`) so these
      // runs are as observable in the superadmin trace view as gateway/IDE-chat traffic
      // — the `agent_inference_logs` row above is the product metric, this is the raw
      // model/vendor/attempt telemetry keyed to the same traceId.
      logTrace(c.env, c.executionCtx, {
        traceId, surface: 'agent',
        tenantId: c.get('tenantId') ?? null,
        userId: c.get('userId') ?? null,
        result, streamed,
        requestIp: c.req.header('cf-connecting-ip') ?? null,
        origin: c.req.header('Origin') ?? null,
        userAgent: c.req.header('User-Agent') ?? null,
        requestBody: { agentId, messages, stream: streamed } as unknown as Record<string, unknown>,
        responseBody: null, errorMessage: null,
      });
      await getSql(c)`
        INSERT INTO agent_inference_logs (id, agent_id, model_ref, latency_ms, status, inference_mode, created_at)
        VALUES (${logId}, ${agentId}, ${'builderforce/workforce-' + agentId}, ${latencyMs}, ${status}, ${inferenceMode}, NOW())
      `;
      await getSql(c)`UPDATE ide_agents SET request_count = request_count + 1, last_used_at = NOW() WHERE id = ${agentId}`;
      if (!result.response.body) return c.json({ error: 'No stream body' }, 502);
      return new Response(result.response.body, {
        headers: {
          'Content-Type': body.stream !== false ? 'text/event-stream' : 'application/json',
          'Cache-Control': 'no-cache',
          'X-Inference-Mode': inferenceMode,
        },
      });
    } catch (err) {
      status = 'error';
      errorMessage = err instanceof Error ? err.message : String(err);
      await getSql(c)`
        INSERT INTO agent_inference_logs (id, agent_id, model_ref, latency_ms, status, error_message, inference_mode, created_at)
        VALUES (${logId}, ${agentId}, ${'builderforce/workforce-' + agentId}, ${Date.now() - startMs}, ${status}, ${errorMessage}, ${inferenceMode}, NOW())
      `;
      return c.json({ error: errorMessage }, 502);
    }
  });

  // ── Knowledge ingestion ──────────────────────────────────────────────────
  // Ingest proprietary documents for a published agent: chunk → store → make
  // recallable at inference (grounded context). Replace semantics — re-ingesting
  // supersedes the agent's prior knowledge set. Body: { text?, documents?[] }.
  router.post('/agents/:id/ingest', async (c) => {
    const agentId = c.req.param('id');
    const [agent] = await getSql(c)`SELECT project_id FROM ide_agents WHERE id = ${agentId} LIMIT 1`;
    if (!agent || !(await projectInTenant(c, Number(agent.project_id)))) return c.json({ error: 'Agent not found' }, 404);
    const body = await c.req.json<{ text?: string; documents?: Array<{ name?: string; text?: string }> }>();
    const docs = [
      ...(body.text?.trim() ? [{ text: body.text }] : []),
      ...((body.documents ?? []).filter((d): d is { name?: string; text: string } => Boolean(d?.text?.trim()))),
    ];
    if (docs.length === 0) return c.json({ error: 'text or documents required' }, 400);
    const chunks = await ingestAgentKnowledge(c.env, getSql(c), agentId, docs);
    return c.json({ chunks });
  });

  // ── Pre-publish validation ───────────────────────────────────────────────
  // A user validates a freshly-trained model by CALLING it via API before it can
  // be published to the Workforce Registry. Runs one non-streaming test inference
  // against the CANDIDATE descriptor (no agent row required yet) and returns the
  // sample output + latency + resolved inference mode. The publish UI gates the
  // "Publish" button on a successful response here. Uses the SAME persona/memory
  // prompt builder as the live chat endpoint, so a green validate predicts live
  // behaviour rather than testing a different code path.
  router.post('/agents/validate', async (c) => {
    const body = await c.req.json<{
      name: string;
      title?: string;
      bio?: string;
      skills?: string[] | string;
      base_model: string;
      r2_artifact_key?: string | null;
      mamba_state?: unknown;
      prompt?: string;
    }>();
    if (!c.env.OPENROUTER_API_KEY?.trim()) return c.json({ ok: false, error: 'LLM not configured' }, 503);
    if (!body.name?.trim() || !body.base_model?.trim()) {
      return c.json({ ok: false, error: 'name and base_model are required' }, 400);
    }

    const descriptor: AgentDescriptor = {
      name: body.name,
      title: body.title ?? '',
      bio: body.bio ?? '',
      skills: body.skills ?? [],
      r2_artifact_key: body.r2_artifact_key ?? null,
      mamba_state: body.mamba_state,
    };
    const inferenceMode = resolveInferenceMode(descriptor);
    const prompt = body.prompt?.trim() || 'In one sentence, introduce yourself and your single strongest skill.';
    const messages = applyAgentSystem([{ role: 'user', content: prompt }], buildAgentSystemPrompt(descriptor));

    const startMs = Date.now();
    try {
      const result = await ideProxy(c.env).complete({ messages, stream: false });
      const latencyMs = Date.now() - startMs;
      const json = (await result.response.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const sample = json.choices?.[0]?.message?.content?.trim() ?? '';
      // The validation RAN; an empty/failed model response is a validation result
      // (ok:false), not a transport error — return 200 so the client reads it
      // uniformly and the publish gate stays closed.
      if (!sample) return c.json({ ok: false, error: 'Model returned an empty response', latency_ms: latencyMs });
      return c.json({
        ok: true,
        inference_mode: inferenceMode,
        latency_ms: latencyMs,
        model_ref: 'builderforce/workforce-candidate',
        sample,
      });
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
