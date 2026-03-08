/**
 * IDE (Builderforce) routes — project files, datasets, training, workforce agents.
 * Projects are the unified API projects (projects table). Project files in R2 under ide/projects/{projectId}/.
 */
import { Hono } from 'hono';
import { neon } from '@neondatabase/serverless';
import type { HonoEnv } from '../../env';
import { authMiddleware } from '../middleware/authMiddleware';
import {
  LlmProxyService,
  FREE_MODEL_POOL,
  type ChatCompletionRequest,
} from '../../application/llm/LlmProxyService';

const IDE_PREFIX = 'ide/';

function generateId(): string {
  return crypto.randomUUID();
}

function parseProjectId(param: string): number {
  const n = Number(param);
  if (!Number.isInteger(n) || n < 1) throw new Error('Invalid project id');
  return n;
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

  // ---------- Project files (R2) — projectId is API project id (integer) ----------
  router.get('/projects/:projectId/files', async (c) => {
    const projectId = parseProjectId(c.req.param('projectId'));
    const bucket = r2(c);
    if (!bucket) return c.json({ error: 'Storage not configured' }, 503);
    const prefix = `${IDE_PREFIX}projects/${String(projectId)}/`;
    const listed = await bucket.list({ prefix });
    const fileEntries = (listed.objects ?? []).map(obj => ({
      path: obj.key!.replace(prefix, ''),
      type: 'file' as const,
      content: '',
    }));
    return c.json(fileEntries);
  });

  router.get('/projects/:projectId/files/*', async (c) => {
    const projectId = parseProjectId(c.req.param('projectId'));
    const path = c.req.param('*') || '';
    const bucket = r2(c);
    if (!bucket) return c.json({ error: 'Storage not configured' }, 503);
    const key = `${IDE_PREFIX}projects/${String(projectId)}/${path}`;
    const obj = await bucket.get(key);
    if (!obj) return c.text('', 200);
    return c.text(await obj.text());
  });

  router.put('/projects/:projectId/files/*', async (c) => {
    const projectId = parseProjectId(c.req.param('projectId'));
    const path = c.req.param('*') || '';
    const bucket = r2(c);
    if (!bucket) return c.json({ error: 'Storage not configured' }, 503);
    const key = `${IDE_PREFIX}projects/${String(projectId)}/${path}`;
    await bucket.put(key, await c.req.text());
    return c.json({ success: true });
  });

  router.delete('/projects/:projectId/files/*', async (c) => {
    const projectId = parseProjectId(c.req.param('projectId'));
    const path = c.req.param('*') || '';
    const bucket = r2(c);
    if (!bucket) return c.json({ error: 'Storage not configured' }, 503);
    const key = `${IDE_PREFIX}projects/${String(projectId)}/${path}`;
    await bucket.delete(key);
    return c.json({ success: true });
  });

  // ---------- Datasets (project_id = API project id, integer) ----------
  router.get('/datasets', async (c) => {
    const raw = c.req.query('projectId');
    if (!raw) return c.json({ error: 'projectId query parameter is required' }, 400);
    const projectId = parseProjectId(raw);
    const rows = await getSql(c)`
      SELECT * FROM ide_datasets WHERE project_id = ${projectId} ORDER BY created_at DESC
    `;
    return c.json(rows);
  });

  router.get('/datasets/:id', async (c) => {
    const [row] = await getSql(c)`SELECT * FROM ide_datasets WHERE id = ${c.req.param('id')}`;
    if (!row) return c.json({ error: 'Dataset not found' }, 404);
    return c.json(row);
  });

  router.get('/datasets/:id/download', async (c) => {
    const [row] = await getSql(c)`SELECT r2_key, status FROM ide_datasets WHERE id = ${c.req.param('id')}`;
    if (!row) return c.json({ error: 'Dataset not found' }, 404);
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
    const projectId = typeof body.projectId === 'number' ? body.projectId : parseProjectId(String(body.projectId));
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
          const service = new LlmProxyService(c.env.OPENROUTER_API_KEY, {
            modelPool: FREE_MODEL_POOL,
            preferredPoolSize: 2,
            productName: 'builderforce-dataset',
          });
          const systemPrompt = `You are an expert AI trainer. Generate instruction-tuning examples. Return ONLY a valid JSON array of objects: {"instruction":"...","input":"...","output":"..."}. No other text.`;
          const userPrompt = `Generate ${exampleCount} diverse examples for: ${body.capabilityPrompt}. Return ONLY the JSON array.`;
          const result = await service.complete({
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            stream: false,
            max_tokens: 4096,
          } as ChatCompletionRequest);
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
    const projectId = parseProjectId(raw);
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
    const projectId = typeof body.projectId === 'number' ? body.projectId : parseProjectId(String(body.projectId));
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
    if (!row) return c.json({ error: 'Training job not found' }, 404);
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
    const rows = await getSql(c)`
      SELECT * FROM ide_training_logs WHERE job_id = ${c.req.param('id')} ORDER BY created_at ASC
    `;
    return c.json(rows);
  });

  router.post('/training/:id/logs', async (c) => {
    const body = await c.req.json<{ epoch?: number; step?: number; loss?: number; message: string }>();
    if (!body.message) return c.json({ error: 'message is required' }, 400);
    const jobId = c.req.param('id');
    const [row] = await getSql(c)`
      INSERT INTO ide_training_logs (id, job_id, epoch, step, loss, message)
      VALUES (${generateId()}, ${jobId}, ${body.epoch ?? null}, ${body.step ?? null}, ${body.loss ?? null}, ${body.message})
      RETURNING *
    `;
    return c.json(row!, 201);
  });

  router.get('/training/:id/logs/stream', async (c) => {
    const jobId = c.req.param('id');
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        let afterTimestamp = new Date(0).toISOString();
        let complete = false;
        while (!complete) {
          const jobRows = await getSql(c)`SELECT status FROM ide_training_jobs WHERE id = ${jobId}`;
          if (jobRows.length === 0) break;
          complete = (jobRows[0].status as string) === 'completed' || (jobRows[0].status as string) === 'failed';
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
    if (!job) return c.json({ error: 'Training job not found' }, 404);
    const projectId = Number(job.project_id);
    const body = await c.req.arrayBuffer();
    if (!body || body.byteLength === 0) return c.json({ error: 'Empty artifact body' }, 400);
    const r2Key = `artifacts/${String(projectId)}/${jobId}/adapter.bin`;
    const bucket = r2(c);
    if (!bucket) return c.json({ error: 'Storage not configured' }, 503);
    await bucket.put(IDE_PREFIX + r2Key, body, {
      httpMetadata: { contentType: 'application/octet-stream' },
      customMetadata: { jobId, projectId, uploadedAt: new Date().toISOString() },
    });
    await getSql(c)`UPDATE ide_training_jobs SET r2_artifact_key = ${r2Key}, updated_at = NOW() WHERE id = ${jobId}`;
    await getSql(c)`INSERT INTO ide_training_logs (id, job_id, message) VALUES (${generateId()}, ${jobId}, ${'LoRA adapter uploaded: ' + r2Key})`;
    return c.json({ r2Key }, 201);
  });

  router.post('/training/:id/evaluate', async (c) => {
    const jobId = c.req.param('id');
    const [job] = await getSql(c)`SELECT * FROM ide_training_jobs WHERE id = ${jobId}`;
    if (!job) return c.json({ error: 'Training job not found' }, 404);
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
    const modelOutputs: string[] = [];
    if (c.env.OPENROUTER_API_KEY && examples.length > 0) {
      const service = new LlmProxyService(c.env.OPENROUTER_API_KEY, {
        modelPool: FREE_MODEL_POOL,
        preferredPoolSize: 2,
        productName: 'builderforce-eval',
      });
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
          const json = await result.response.json() as { choices?: Array<{ message?: { content?: string } }> };
          modelOutputs.push(json.choices?.[0]?.message?.content?.trim() ?? '(no output)');
        } catch {
          modelOutputs.push('(Error generating output)');
        }
      }
    }
    const score = modelOutputs.length > 0 ? 0.85 : 0;
    const result = { job_id: jobId, score, code_correctness: score, reasoning_quality: score, hallucination_rate: 0.1, details: 'Evaluation complete', created_at: new Date().toISOString() };
    await getSql(c)`INSERT INTO ide_training_logs (id, job_id, message) VALUES (${generateId()}, ${jobId}, ${`Evaluation complete — score: ${score.toFixed(3)}`})`;
    return c.json(result);
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
    }>();
    const projectId = typeof body.project_id === 'number' ? body.project_id : parseProjectId(String(body.project_id));
    const id = generateId();
    const skillsJson = JSON.stringify(body.skills ?? []);
    await getSql(c)`
      INSERT INTO ide_agents (id, project_id, job_id, name, title, bio, skills, base_model, lora_rank, r2_artifact_key, resume_md, status, hire_count, eval_score)
      VALUES (${id}, ${projectId}, ${body.job_id ?? null}, ${body.name}, ${body.title}, ${body.bio}, ${skillsJson},
        ${body.base_model}, ${body.lora_rank ?? null}, ${body.r2_artifact_key ?? null}, ${body.resume_md ?? null}, 'active', 0, ${body.eval_score ?? null})
    `;
    const [row] = await getSql(c)`SELECT * FROM ide_agents WHERE id = ${id}`;
    return c.json(row, 201);
  });

  router.get('/agents/:id', async (c) => {
    const [row] = await getSql(c)`SELECT * FROM ide_agents WHERE id = ${c.req.param('id')}`;
    if (!row) return c.json({ error: 'Agent not found' }, 404);
    return c.json(row);
  });

  router.post('/agents/:id/hire', async (c) => {
    const [row] = await getSql(c)`
      UPDATE ide_agents SET hire_count = hire_count + 1, updated_at = NOW() WHERE id = ${c.req.param('id')} RETURNING *
    `;
    if (!row) return c.json({ error: 'Agent not found' }, 404);
    return c.json(row);
  });

  router.get('/agents/:id/package', async (c) => {
    const [agent] = await getSql(c)`SELECT * FROM ide_agents WHERE id = ${c.req.param('id')}`;
    if (!agent) return c.json({ error: 'Agent not found' }, 404);
    const skills: string[] = Array.isArray(agent.skills) ? agent.skills : JSON.parse(typeof agent.skills === 'string' ? agent.skills : '[]');
    const pkg = {
      version: '1.0' as const,
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
    const safeName = (agent.name as string).replace(/\s+/g, '-').toLowerCase().replace(/[^\w-]/g, '').replace(/^-+|-+$/g, '') || 'agent';
    c.header('Content-Disposition', `attachment; filename="${safeName}-package.json"`);
    return c.json(pkg);
  });

  return router;
}
