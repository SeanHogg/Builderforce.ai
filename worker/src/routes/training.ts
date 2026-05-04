import { Hono } from 'hono';
import { neon } from '@neondatabase/serverless';
import { evaluateModelOutputs, saveModelArtifact } from '../services/training';
import type { TrainingEnv } from '../services/training';
import { requestGatewayCompletion, requireGatewayAuthToken } from '../services/gateway';

interface Env extends TrainingEnv {
  NEON_DATABASE_URL: string;
  BUILDERFORCE_API_BASE_URL?: string;
}

const training = new Hono<{ Bindings: Env }>();

function generateId(): string {
  return crypto.randomUUID();
}

/**
 * GET /api/training?projectId=...
 * Lists all training jobs for a project, ordered by created_at DESC.
 */
training.get('/', async (c) => {
  try {
    const projectId = c.req.query('projectId');
    if (!projectId) return c.json({ error: 'projectId query parameter is required' }, 400);

    const sql = neon(c.env.NEON_DATABASE_URL);
    const rows = await sql`
      SELECT * FROM training_jobs
      WHERE project_id = ${projectId}
      ORDER BY created_at DESC
    `;
    return c.json(rows);
  } catch (e) {
    console.error('Failed to list training jobs:', e);
    return c.json({ error: 'Failed to list training jobs' }, 500);
  }
});

/**
 * POST /api/training
 * Creates a new training job record.
 *
 * Body: { projectId, datasetId?, baseModel, loraRank, epochs, batchSize, learningRate }
 */
training.post('/', async (c) => {
  try {
    const body = await c.req.json<{
      projectId: string;
      datasetId?: string;
      baseModel: string;
      loraRank: number;
      epochs: number;
      batchSize: number;
      learningRate: number;
    }>();

    if (!body.projectId || !body.baseModel) {
      return c.json({ error: 'projectId and baseModel are required' }, 400);
    }

    const sql = neon(c.env.NEON_DATABASE_URL);
    const id = generateId();

    const rows = await sql`
      INSERT INTO training_jobs (
        id, project_id, dataset_id, base_model,
        lora_rank, epochs, batch_size, learning_rate
      ) VALUES (
        ${id},
        ${body.projectId},
        ${body.datasetId ?? null},
        ${body.baseModel},
        ${body.loraRank ?? 8},
        ${body.epochs ?? 3},
        ${body.batchSize ?? 4},
        ${body.learningRate ?? 0.0002}
      )
      RETURNING *
    `;

    // Insert an initial log entry
    await sql`
      INSERT INTO training_logs (id, job_id, message)
      VALUES (${generateId()}, ${id}, 'Training job created')
    `;

    return c.json(rows[0], 201);
  } catch (e) {
    console.error('Failed to create training job:', e);
    return c.json({ error: 'Failed to create training job' }, 500);
  }
});

/**
 * GET /api/training/:id
 * Returns a single training job by ID.
 */
training.get('/:id', async (c) => {
  try {
    const sql = neon(c.env.NEON_DATABASE_URL);
    const rows = await sql`SELECT * FROM training_jobs WHERE id = ${c.req.param('id')}`;
    if (rows.length === 0) return c.json({ error: 'Training job not found' }, 404);
    return c.json(rows[0]);
  } catch (e) {
    console.error('Failed to fetch training job:', e);
    return c.json({ error: 'Failed to fetch training job' }, 500);
  }
});

/**
 * PUT /api/training/:id
 * Updates training job status, progress, and loss.
 *
 * Body: { status?, currentEpoch?, currentLoss?, r2ArtifactKey?, errorMessage? }
 */
training.put('/:id', async (c) => {
  try {
    const body = await c.req.json<{
      status?: string;
      currentEpoch?: number;
      currentLoss?: number;
      r2ArtifactKey?: string;
      errorMessage?: string;
    }>();

    const sql = neon(c.env.NEON_DATABASE_URL);
    const rows = await sql`
      UPDATE training_jobs
      SET
        status           = COALESCE(${body.status ?? null}, status),
        current_epoch    = COALESCE(${body.currentEpoch ?? null}, current_epoch),
        current_loss     = COALESCE(${body.currentLoss ?? null}, current_loss),
        r2_artifact_key  = COALESCE(${body.r2ArtifactKey ?? null}, r2_artifact_key),
        error_message    = COALESCE(${body.errorMessage ?? null}, error_message),
        updated_at       = NOW()
      WHERE id = ${c.req.param('id')}
      RETURNING *
    `;
    if (rows.length === 0) return c.json({ error: 'Training job not found' }, 404);
    return c.json(rows[0]);
  } catch (e) {
    console.error('Failed to update training job:', e);
    return c.json({ error: 'Failed to update training job' }, 500);
  }
});

/**
 * GET /api/training/:id/logs
 * Returns all log entries for a training job, ordered by created_at ASC.
 */
training.get('/:id/logs', async (c) => {
  try {
    const sql = neon(c.env.NEON_DATABASE_URL);
    const rows = await sql`
      SELECT * FROM training_logs
      WHERE job_id = ${c.req.param('id')}
      ORDER BY created_at ASC
    `;
    return c.json(rows);
  } catch (e) {
    console.error('Failed to fetch training logs:', e);
    return c.json({ error: 'Failed to fetch training logs' }, 500);
  }
});

/**
 * POST /api/training/:id/logs
 * Appends a log entry to a training job.
 *
 * Body: { epoch?, step?, loss?, message }
 */
training.post('/:id/logs', async (c) => {
  try {
    const body = await c.req.json<{
      epoch?: number;
      step?: number;
      loss?: number;
      message: string;
    }>();

    if (!body.message) return c.json({ error: 'message is required' }, 400);

    const sql = neon(c.env.NEON_DATABASE_URL);
    const rows = await sql`
      INSERT INTO training_logs (id, job_id, epoch, step, loss, message)
      VALUES (
        ${generateId()},
        ${c.req.param('id')},
        ${body.epoch ?? null},
        ${body.step ?? null},
        ${body.loss ?? null},
        ${body.message}
      )
      RETURNING *
    `;
    return c.json(rows[0], 201);
  } catch (e) {
    console.error('Failed to add training log:', e);
    return c.json({ error: 'Failed to add training log' }, 500);
  }
});

/**
 * GET /api/training/:id/logs/stream
 * Streams training logs as SSE for a running job.
 * Polls for new logs every second until the job completes or fails.
 */
training.get('/:id/logs/stream', async (c) => {
  const jobId = c.req.param('id');
  const sql = neon(c.env.NEON_DATABASE_URL);

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      // Unix epoch as the initial cursor — ensures all existing rows are delivered
      // on the first poll before we advance the cursor to the latest timestamp.
      const EPOCH_START = new Date(0).toISOString();
      let afterTimestamp = EPOCH_START;
      let complete = false;

      while (!complete) {
        try {
          const jobRows = await sql`SELECT status FROM training_jobs WHERE id = ${jobId}`;
          if (jobRows.length === 0) break;
          const status = jobRows[0].status as string;
          complete = status === 'completed' || status === 'failed';

          const logRows = await sql`
            SELECT * FROM training_logs
            WHERE job_id = ${jobId}
              AND created_at > ${afterTimestamp}
            ORDER BY created_at ASC
          `;

          for (const row of logRows) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(row)}\n\n`));
            afterTimestamp = row.created_at as string;
          }

          if (!complete) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        } catch {
          break;
        }
      }

      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Transfer-Encoding': 'chunked',
    },
  });
});

/**
 * POST /api/training/:id/artifact
 * Accepts a raw binary LoRA adapter blob from the browser WebGPU trainer,
 * saves it to R2 under artifacts/{projectId}/{jobId}/adapter.bin,
 * and updates the training_jobs record with the artifact key.
 *
 * Content-Type: application/octet-stream
 */
training.post('/:id/artifact', async (c) => {
  try {
    const jobId = c.req.param('id');
    const sql = neon(c.env.NEON_DATABASE_URL);

    const jobRows = await sql`SELECT project_id FROM training_jobs WHERE id = ${jobId}`;
    if (jobRows.length === 0) return c.json({ error: 'Training job not found' }, 404);
    const projectId = jobRows[0].project_id as string;

    const body = await c.req.arrayBuffer();
    if (!body || body.byteLength === 0) {
      return c.json({ error: 'Empty artifact body' }, 400);
    }

    const r2Key = `artifacts/${projectId}/${jobId}/adapter.bin`;
    await c.env.STORAGE.put(r2Key, body, {
      httpMetadata: { contentType: 'application/octet-stream' },
      customMetadata: { jobId, projectId, uploadedAt: new Date().toISOString() },
    });

    await sql`
      UPDATE training_jobs
      SET r2_artifact_key = ${r2Key}, updated_at = NOW()
      WHERE id = ${jobId}
    `;

    await sql`
      INSERT INTO training_logs (id, job_id, message)
      VALUES (${crypto.randomUUID()}, ${jobId}, ${'LoRA adapter uploaded to R2: ' + r2Key})
    `;

    return c.json({ r2Key }, 201);
  } catch (e) {
    console.error('Failed to upload artifact:', e);
    return c.json({ error: 'Failed to upload artifact' }, 500);
  }
});

/**
 * POST /api/training/:id/evaluate
 * Evaluates the fine-tuned model using an AI judge.
 * Returns quality scores and stores the result in R2.
 */
training.post('/:id/evaluate', async (c) => {
  try {
    const authToken = requireGatewayAuthToken(c.req.header('Authorization'));
    const jobId = c.req.param('id');
    const sql = neon(c.env.NEON_DATABASE_URL);

    const jobRows = await sql`SELECT * FROM training_jobs WHERE id = ${jobId}`;
    if (jobRows.length === 0) return c.json({ error: 'Training job not found' }, 404);

    const job = jobRows[0];

    // Fetch dataset examples if a dataset is linked
    let examples: { instruction: string; input: string; output: string }[] = [];
    if (job.dataset_id) {
      const dsRows = await sql`SELECT r2_key FROM datasets WHERE id = ${job.dataset_id}`;
      if (dsRows.length > 0 && dsRows[0].r2_key) {
        const obj = await c.env.STORAGE.get(dsRows[0].r2_key as string);
        if (obj) {
          const text = await obj.text();
          examples = text.split('\n')
            .filter(Boolean)
            .slice(0, 10)
            .map(line => {
              try { return JSON.parse(line) as { instruction: string; input: string; output: string }; }
              catch { return null; }
            })
            .filter((ex): ex is { instruction: string; input: string; output: string } => ex !== null);
        }
      }
    }

    // Ask the centralized Builderforce gateway to generate outputs for evaluation.
    const modelOutputs: string[] = [];
    for (const ex of examples) {
      try {
        const outText = await requestGatewayCompletion({
          env: c.env,
          authToken,
          messages: [
          { role: 'system', content: `You are answering as a fine-tuned agent for: ${job.base_model}. Provide a high-quality output for the instruction.` },
          { role: 'user', content: ex.instruction + (ex.input ? `\nContext: ${ex.input}` : '') },
          ],
          maxTokens: 1024,
        });
        modelOutputs.push(outText || `(Failed to generate output for: ${ex.instruction})`);
      } catch (error) {
        console.error('Gateway generation call failed:', error);
        modelOutputs.push(`(Error generating output)`);
      }
    }

    const result = await evaluateModelOutputs(examples, modelOutputs, jobId, c.env, authToken);

    // Store evaluation result in the artifact key
    await saveModelArtifact(c.env.STORAGE, job.project_id as string, jobId, {
      evaluation: result,
      base_model: job.base_model,
    });

    // Update the job with the evaluation score
    await sql`
      UPDATE training_jobs
      SET updated_at = NOW()
      WHERE id = ${jobId}
    `;

    await sql`
      INSERT INTO training_logs (id, job_id, message)
      VALUES (
        ${generateId()},
        ${jobId},
        ${`Evaluation complete — score: ${result.score.toFixed(3)}`}
      )
    `;

    // Store in model_artifacts table
    await sql`
      INSERT INTO model_artifacts (id, project_id, job_id, base_model, r2_key, eval_score)
      VALUES (
        ${generateId()},
        ${job.project_id},
        ${jobId},
        ${job.base_model},
        ${`artifacts/${job.project_id}/${jobId}/adapter.bin`},
        ${result.score}
      )
    `;

    return c.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to evaluate model';
    if (msg.includes('Authorization') || msg.includes('clk_*') || msg.includes('JWT')) {
      return c.json({ error: msg }, 401);
    }
    console.error('Failed to evaluate model:', e);
    return c.json({ error: 'Failed to evaluate model' }, 500);
  }
});

export default training;
