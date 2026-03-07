import { Hono } from 'hono';
import { neon } from '@neondatabase/serverless';
import {
  generateDatasetWithAI,
  serialiseDataset,
  storeDatasetInR2,
  type DatasetEnv,
} from '../services/dataset';

interface Env extends DatasetEnv {
  NEON_DATABASE_URL: string;
  OPENROUTER_API_KEY?: string;
  AI?: Ai;
  AI_PROVIDER?: string;
  STORAGE: R2Bucket;
}

const datasets = new Hono<{ Bindings: Env }>();

function generateId(): string {
  return crypto.randomUUID();
}

/**
 * GET /api/datasets?projectId=...
 * Lists all datasets for a project, ordered by created_at DESC.
 */
datasets.get('/', async (c) => {
  try {
    const projectId = c.req.query('projectId');
    if (!projectId) return c.json({ error: 'projectId query parameter is required' }, 400);

    const sql = neon(c.env.NEON_DATABASE_URL);
    const rows = await sql`
      SELECT * FROM datasets
      WHERE project_id = ${projectId}
      ORDER BY created_at DESC
    `;
    return c.json(rows);
  } catch (e) {
    console.error('Failed to list datasets:', e);
    return c.json({ error: 'Failed to list datasets' }, 500);
  }
});

/**
 * GET /api/datasets/:id
 * Returns a single dataset by ID.
 */
datasets.get('/:id', async (c) => {
  try {
    const sql = neon(c.env.NEON_DATABASE_URL);
    const rows = await sql`SELECT * FROM datasets WHERE id = ${c.req.param('id')}`;
    if (rows.length === 0) return c.json({ error: 'Dataset not found' }, 404);
    return c.json(rows[0]);
  } catch (e) {
    console.error('Failed to fetch dataset:', e);
    return c.json({ error: 'Failed to fetch dataset' }, 500);
  }
});

/**
 * POST /api/datasets/generate
 * Generates an AI-powered instruction-tuning dataset and stores it in R2 + Postgres.
 *
 * Body: { projectId, capabilityPrompt, name, exampleCount? }
 */
datasets.post('/generate', async (c) => {
  try {
    const body = await c.req.json<{
      projectId: string;
      capabilityPrompt: string;
      name: string;
      exampleCount?: number;
    }>();

    if (!body.projectId || !body.capabilityPrompt || !body.name) {
      return c.json({ error: 'projectId, capabilityPrompt, and name are required' }, 400);
    }

    const sql = neon(c.env.NEON_DATABASE_URL);
    const id = generateId();
    const exampleCount = Math.min(body.exampleCount ?? 50, 200);

    // Insert a pending record immediately so the UI can poll status
    await sql`
      INSERT INTO datasets (id, project_id, name, capability_prompt, r2_key, status)
      VALUES (${id}, ${body.projectId}, ${body.name}, ${body.capabilityPrompt}, '', 'generating')
    `;

    // Stream response back to client while generating in the background
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();

        const emit = (data: unknown) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        try {
          emit({ type: 'status', message: `Generating ${exampleCount} examples for: ${body.capabilityPrompt}` });

          const generated = await generateDatasetWithAI(
            body.capabilityPrompt,
            exampleCount,
            c.env
          );

          emit({ type: 'chunk', content: `Generated ${generated.examples.length} examples` });

          const content = serialiseDataset(generated);
          const r2Key = await storeDatasetInR2(c.env.STORAGE, body.projectId, id, content);

          await sql`
            UPDATE datasets
            SET r2_key = ${r2Key},
                example_count = ${generated.examples.length},
                status = 'ready',
                updated_at = NOW()
            WHERE id = ${id}
          `;

          const rows = await sql`SELECT * FROM datasets WHERE id = ${id}`;
          emit({ type: 'done', dataset: rows[0] });
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Dataset generation failed';
          console.error('Dataset generation error:', e);
          await sql`UPDATE datasets SET status = 'error', updated_at = NOW() WHERE id = ${id}`;
          emit({ type: 'error', message: msg });
        } finally {
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Transfer-Encoding': 'chunked',
      },
    });
  } catch (e) {
    console.error('Failed to start dataset generation:', e);
    return c.json({ error: 'Failed to start dataset generation' }, 500);
  }
});

export default datasets;
