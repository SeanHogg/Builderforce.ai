/**
 * Evermind model routes — /api/studio/models/*
 *
 * The end of the LLM Studio flow: a user who trained a custom Evermind model
 * PUBLISHES the packaged `.evermind` artifact here, which (1) stores it in R2 and
 * (2) registers a tenant model whose base points at `evermind/<ref>`. From that
 * moment the model is a first-class, callable LLM:
 *   - via the gateway:  POST /v1/chat/completions  { model: "tenant_model:<slug>" }
 *   - via this surface: POST /api/studio/models/:slug/test   (validate + try it)
 * Both are served by the SAME in-Worker EvermindLM runtime (vendors/evermind.ts
 * and ../application/llm/evermindRuntime) — "use our own LLM", end to end.
 *
 * Not cached: publish is a write; test is a generative call keyed on the request
 * body. Model resolution rides the existing cached `resolveTenantModel`.
 */
import { Hono } from 'hono';
import { EvermindModelPackage } from '@seanhogg/builderforce-memory-engine';
import { authMiddleware } from '../middleware/authMiddleware';
import type { Db } from '../../infrastructure/database/connection';
import type { Env, HonoEnv } from '../../env';
import { createTenantModel, resolveTenantModel, TENANT_MODEL_REF_PREFIX } from '../../application/llm/tenantModelService';
import {
  EVERMIND_MODEL_ROOT,
  evermindGenerate,
  buildEvermindCompletion,
} from '../../application/llm/evermindRuntime';

const EVERMIND_PIN_PREFIX = 'evermind/';

interface PublishBody {
  name?: unknown;
  /** base64-encoded EvermindModelPackage.toBlob() output. */
  model?: unknown;
  /** Tokenizer descriptor packaged alongside the model: { vocab, merges }. */
  tokenizer?: unknown;
  description?: unknown;
}

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function createEvermindModelRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  /**
   * POST /api/studio/models/publish
   * Body: { name, model (base64 .evermind), tokenizer: { vocab, merges }, description? }
   * → stores the artifact in R2, registers a callable tenant model, returns its ref.
   */
  router.post('/publish', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string | undefined;
    if (!c.env.UPLOADS) return c.json({ error: 'R2 artifact storage not configured' }, 503);

    const body = (await c.req.json<PublishBody>().catch(() => ({}))) as PublishBody;
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const modelB64 = typeof body.model === 'string' ? body.model : '';
    const tokenizer = body.tokenizer as { vocab?: unknown; merges?: unknown } | undefined;
    if (!name) return c.json({ error: 'name is required' }, 400);
    if (!modelB64) return c.json({ error: 'model (base64 .evermind) is required' }, 400);
    if (!tokenizer || typeof tokenizer.vocab !== 'object' || !Array.isArray(tokenizer.merges)) {
      return c.json({ error: 'tokenizer { vocab, merges } is required' }, 400);
    }

    // Validate the artifact at publish time — reject a corrupt/foreign blob before
    // it ever becomes callable (this is the "validate" half of validate-and-test).
    let bytes: Uint8Array;
    try {
      bytes = decodeBase64(modelB64);
      const verdict = EvermindModelPackage.fromBlob(bytes.buffer as ArrayBuffer).validate();
      if (!verdict.ok) return c.json({ error: `invalid .evermind artifact: ${verdict.errors.join('; ')}` }, 400);
    } catch (err) {
      return c.json({ error: `could not parse .evermind artifact: ${err instanceof Error ? err.message : String(err)}` }, 400);
    }

    // Immutable, versioned ref so the per-isolate model cache is always coherent.
    const ref = `${EVERMIND_MODEL_ROOT}/${tenantId}/${crypto.randomUUID()}`;
    await c.env.UPLOADS.put(`${ref}/model.evermind`, bytes.buffer as ArrayBuffer);
    await c.env.UPLOADS.put(`${ref}/tokenizer.json`, JSON.stringify({ vocab: tokenizer.vocab, merges: tokenizer.merges }));

    const model = await createTenantModel(c.env as Env, db, tenantId, userId ?? null, {
      name,
      baseModel: `${EVERMIND_PIN_PREFIX}${ref}`,
      trainedModelRef: ref,
      visibility: 'tenant',
    });
    if (!model) return c.json({ error: 'Failed to register published model' }, 500);

    return c.json(
      {
        published: true,
        ...model, // includes { slug, ref: tenant_model:<slug>, name, baseModel: evermind/<ref> }
        evermindRef: ref,
        callExample: {
          endpoint: 'POST /v1/chat/completions',
          model: model.ref, // tenant_model:<slug>
        },
        testEndpoint: `/api/studio/models/${model.slug}/test`,
      },
      201,
    );
  });

  /**
   * POST /api/studio/models/:slug/test
   * Body: { prompt? | messages?, maxTokens?, temperature? }
   * → runs the published Evermind model and returns an OpenAI-compatible completion
   *   (the same shape the gateway returns — so "test" mirrors "call").
   */
  router.post('/:slug/test', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const slug = c.req.param('slug');
    if (!c.env.UPLOADS) return c.json({ error: 'R2 artifact storage not configured' }, 503);

    const tm = await resolveTenantModel(c.env as Env, db, tenantId, `${TENANT_MODEL_REF_PREFIX}${slug}`);
    if (!tm || !tm.baseModel?.startsWith(EVERMIND_PIN_PREFIX)) {
      return c.json({ error: 'No published Evermind model with that slug' }, 404);
    }
    const ref = tm.baseModel.slice(EVERMIND_PIN_PREFIX.length);

    const body = (await c.req.json<{ prompt?: unknown; messages?: unknown; maxTokens?: unknown; temperature?: unknown }>().catch(() => ({}))) as {
      prompt?: unknown; messages?: unknown; maxTokens?: unknown; temperature?: unknown;
    };
    const messages = Array.isArray(body.messages)
      ? (body.messages as Array<{ role?: unknown; content?: unknown }>)
      : [{ role: 'user', content: typeof body.prompt === 'string' ? body.prompt : '' }];
    if (messages.length === 0 || messages.every((m) => !m.content)) {
      return c.json({ error: 'prompt or messages is required' }, 400);
    }

    try {
      const gen = await evermindGenerate(c.env.UPLOADS, ref, messages, {
        ...(typeof body.maxTokens === 'number' ? { maxTokens: body.maxTokens } : {}),
        ...(typeof body.temperature === 'number' ? { temperature: body.temperature } : {}),
      });
      return c.json(buildEvermindCompletion(gen, tm.baseModel));
    } catch (err) {
      return c.json({ error: 'Evermind generation failed', detail: err instanceof Error ? err.message : String(err) }, 502);
    }
  });

  return router;
}
