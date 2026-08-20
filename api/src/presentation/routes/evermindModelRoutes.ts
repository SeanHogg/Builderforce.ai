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
import { createTenantModel, resolveTenantModel, updateTenantModel, TENANT_MODEL_REF_PREFIX } from '../../application/llm/tenantModelService';
import { zipSync, type Zippable } from 'fflate';
import {
  EVERMIND_MODEL_ROOT,
  evermindGenerate,
  evermindGenerateWithTools,
  evermindGenerateMedia,
  buildEvermindCompletion,
  benchmarkEvermind,
  exportEvermindArtifact,
  EXPORT_FORMATS,
  type ExportFormat,
} from '../../application/llm/evermindRuntime';
import {
  normalizeEvermindTools,
  resolveEvermindToolChoice,
  evermindToolChoiceMinMargin,
} from '../../application/llm/evermindToolCall';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';

const EVERMIND_PIN_PREFIX = 'evermind/';

/** Stable content hash for a benchmark cache key (hex SHA-256). */
async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

interface PublishBody {
  name?: unknown;
  /** base64-encoded EvermindModelPackage.toBlob() output. */
  model?: unknown;
  /** Tokenizer descriptor packaged alongside the model: { vocab, merges }. */
  tokenizer?: unknown;
  description?: unknown;
  heldOutCorpus?: unknown;
  qualityGate?: unknown;
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
    const hasTokenizer = !!tokenizer && typeof tokenizer.vocab === 'object' && Array.isArray(tokenizer.merges);
    if (!name) return c.json({ error: 'name is required' }, 400);
    if (!modelB64) return c.json({ error: 'model (base64 .evermind) is required' }, 400);

    // Validate the artifact at publish time — reject a corrupt/foreign blob before
    // it ever becomes callable (this is the "validate" half of validate-and-test).
    let bytes: Uint8Array;
    let modality: string;
    try {
      bytes = decodeBase64(modelB64);
      const pkg = EvermindModelPackage.fromBlob(bytes.buffer as ArrayBuffer);
      const verdict = pkg.validate();
      if (!verdict.ok) return c.json({ error: `invalid .evermind artifact: ${verdict.errors.join('; ')}` }, 400);
      modality = pkg.manifest.modality ?? 'text';
    } catch (err) {
      return c.json({ error: `could not parse .evermind artifact: ${err instanceof Error ? err.message : String(err)}` }, 400);
    }

    // Text models need a tokenizer for I/O; media (video/image) models bundle their
    // codec inside the artifact and only need a tokenizer when text-conditioned.
    if (modality === 'text' && !hasTokenizer) {
      return c.json({ error: 'tokenizer { vocab, merges } is required for text models' }, 400);
    }

    // Immutable, versioned ref so the per-isolate model cache is always coherent.
    const ref = `${EVERMIND_MODEL_ROOT}/${tenantId}/${crypto.randomUUID()}`;
    await c.env.UPLOADS.put(`${ref}/model.evermind`, bytes.buffer as ArrayBuffer);
    if (hasTokenizer) {
      await c.env.UPLOADS.put(`${ref}/tokenizer.json`, JSON.stringify({ vocab: tokenizer!.vocab, merges: tokenizer!.merges }));
    }

    const heldOutCorpus = typeof body.heldOutCorpus === 'string' ? body.heldOutCorpus.trim() : '';
    if (heldOutCorpus.length < 20) {
      await Promise.all([c.env.UPLOADS.delete(`${ref}/model.evermind`), c.env.UPLOADS.delete(`${ref}/tokenizer.json`)]);
      return c.json({ error: 'heldOutCorpus (at least 20 characters) is required before publication' }, 400);
    }
    let benchmark;
    try {
      benchmark = await benchmarkEvermind(c.env.UPLOADS, ref, heldOutCorpus, { topK: 5 });
    } catch (err) {
      await Promise.all([c.env.UPLOADS.delete(`${ref}/model.evermind`), c.env.UPLOADS.delete(`${ref}/tokenizer.json`)]);
      return c.json({ error: `held-out benchmark failed: ${err instanceof Error ? err.message : String(err)}` }, 422);
    }
    const gate = body.qualityGate && typeof body.qualityGate === 'object' ? body.qualityGate as { maxPerplexity?: unknown; minTop1Accuracy?: unknown } : {};
    const maxPerplexity = typeof gate.maxPerplexity === 'number' && Number.isFinite(gate.maxPerplexity) ? gate.maxPerplexity : Number.POSITIVE_INFINITY;
    const minTop1Accuracy = typeof gate.minTop1Accuracy === 'number' && Number.isFinite(gate.minTop1Accuracy) ? gate.minTop1Accuracy : 0;
    if (benchmark.perplexity > maxPerplexity || benchmark.top1Accuracy < minTop1Accuracy) {
      await Promise.all([c.env.UPLOADS.delete(`${ref}/model.evermind`), c.env.UPLOADS.delete(`${ref}/tokenizer.json`)]);
      return c.json({ error: 'Model did not pass the publication quality gate', benchmark, qualityGate: { maxPerplexity, minTop1Accuracy } }, 422);
    }

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
        benchmark,
        qualityGate: { passed: true, maxPerplexity, minTop1Accuracy },
      },
      201,
    );
  });

  /**
   * POST /api/studio/models/:slug/rollback { targetSlug }
   * Re-point one stable callable model ref at a prior immutable Evermind package.
   * The previous package is retained and returned, so rollback is itself reversible.
   */
  router.post('/:slug/rollback', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const current = await resolveTenantModel(c.env as Env, db, tenantId, `${TENANT_MODEL_REF_PREFIX}${c.req.param('slug')}`);
    const body = await c.req.json<{ targetSlug?: unknown; targetEvermindRef?: unknown }>().catch(() => ({} as { targetSlug?: unknown; targetEvermindRef?: unknown }));
    const targetSlug = typeof body.targetSlug === 'string' ? body.targetSlug.trim() : '';
    if (!current || !current.baseModel?.startsWith(EVERMIND_PIN_PREFIX)) return c.json({ error: 'Published Evermind model not found' }, 404);
    const explicitRef = typeof body.targetEvermindRef === 'string' ? body.targetEvermindRef.trim() : '';
    const target = targetSlug ? await resolveTenantModel(c.env as Env, db, tenantId, `${TENANT_MODEL_REF_PREFIX}${targetSlug}`) : null;
    const nextRef = target?.baseModel?.startsWith(EVERMIND_PIN_PREFIX) ? target.baseModel.slice(EVERMIND_PIN_PREFIX.length) : explicitRef;
    if (!nextRef || !nextRef.startsWith(`${EVERMIND_MODEL_ROOT}/${tenantId}/`)) return c.json({ error: 'A tenant-owned targetSlug or targetEvermindRef is required' }, 400);
    if (!c.env.UPLOADS || !(await c.env.UPLOADS.head(`${nextRef}/model.evermind`))) return c.json({ error: 'Rollback target artifact not found' }, 404);
    const previousBaseModel = current.baseModel;
    const activeBaseModel = `${EVERMIND_PIN_PREFIX}${nextRef}`;
    const updated = await updateTenantModel(c.env as Env, db, tenantId, current.id, { baseModel: activeBaseModel, trainedModelRef: nextRef });
    if (!updated) return c.json({ error: 'Model rollback failed' }, 500);
    return c.json({ rolledBack: true, model: updated, previousBaseModel, activeBaseModel, rollbackToken: previousBaseModel.slice(EVERMIND_PIN_PREFIX.length) });
  });

  /**
   * POST /api/studio/models/:slug/test
   * Body: { prompt? | messages?, tools?, tool_choice?, maxTokens?, temperature? }
   * → runs the published Evermind model and returns an OpenAI-compatible completion
   *   (the same shape the gateway returns — so "test" mirrors "call").
   *
   * `tools` is honoured here for the same reason the shape is: the bench is where an
   * operator decides whether a head is fit to serve, and since the gateway now
   * tool-calls (constrained decoding — application/llm/evermindToolCall), a bench that
   * silently ignored `tools` would answer a question the gateway never asked.
   * `toolChoiceMargin` rides alongside the completion so the confidence the vendor
   * GATES on is visible here rather than only inferable from a 400 in production.
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

    const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as {
      prompt?: unknown; messages?: unknown; maxTokens?: unknown; temperature?: unknown;
      tools?: unknown; tool_choice?: unknown;
    };
    const messages = Array.isArray(body.messages)
      ? (body.messages as Array<{ role?: unknown; content?: unknown }>)
      : [{ role: 'user', content: typeof body.prompt === 'string' ? body.prompt : '' }];
    if (messages.length === 0 || messages.every((m) => !m.content)) {
      return c.json({ error: 'prompt or messages is required' }, 400);
    }

    const genOpts = {
      ...(typeof body.maxTokens === 'number' ? { maxTokens: body.maxTokens } : {}),
      ...(typeof body.temperature === 'number' ? { temperature: body.temperature } : {}),
    };

    try {
      // Same normalization the vendor applies, from the same shared module, so the
      // bench and the gateway can't disagree about what was offered.
      const tools = normalizeEvermindTools(Array.isArray(body.tools) ? body.tools : undefined);
      const choice = resolveEvermindToolChoice(body.tool_choice, tools);
      if (tools.length > 0 && choice.mode !== 'none') {
        const planned = await evermindGenerateWithTools(c.env.UPLOADS, ref, messages, tools, choice, genOpts);
        return c.json({
          ...buildEvermindCompletion({ content: planned.content, usage: planned.usage }, tm.baseModel, Date.now(), planned.calls),
          // Unlike the gateway, the bench REPORTS the margin instead of refusing on it:
          // an operator testing a head needs to see how close to the bar it landed.
          toolChoiceMargin: Number.isFinite(planned.margin) ? planned.margin : null,
          // The bar ACTUALLY in force, not the shipped constant — a bench that
          // reports a different threshold from the gateway is how an operator
          // concludes a head is fine and then watches production refuse it.
          toolChoiceMinMargin: evermindToolChoiceMinMargin(c.env as { EVERMIND_TOOL_CHOICE_MIN_MARGIN?: string }),
        });
      }
      const gen = await evermindGenerate(c.env.UPLOADS, ref, messages, genOpts);
      return c.json(buildEvermindCompletion(gen, tm.baseModel));
    } catch (err) {
      return c.json({ error: 'Evermind generation failed', detail: err instanceof Error ? err.message : String(err) }, 502);
    }
  });

  /**
   * POST /api/studio/models/:slug/generate-media
   * Body: { prompt?, maxFrames?, maxTokens?, temperature?, seed? }
   * → runs a published VIDEO/IMAGE Evermind model and returns base64 frames + shape.
   *   Not cached: a generative call keyed on the request body.
   */
  router.post('/:slug/generate-media', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const slug = c.req.param('slug');
    if (!c.env.UPLOADS) return c.json({ error: 'R2 artifact storage not configured' }, 503);

    const tm = await resolveTenantModel(c.env as Env, db, tenantId, `${TENANT_MODEL_REF_PREFIX}${slug}`);
    if (!tm || !tm.baseModel?.startsWith(EVERMIND_PIN_PREFIX)) {
      return c.json({ error: 'No published Evermind model with that slug' }, 404);
    }
    const ref = tm.baseModel.slice(EVERMIND_PIN_PREFIX.length);

    const body = (await c.req.json<{
      prompt?: unknown; maxFrames?: unknown; maxTokens?: unknown; temperature?: unknown; seed?: unknown;
    }>().catch(() => ({}))) as { prompt?: unknown; maxFrames?: unknown; maxTokens?: unknown; temperature?: unknown; seed?: unknown };

    try {
      const media = await evermindGenerateMedia(c.env.UPLOADS, ref, {
        ...(typeof body.prompt === 'string' ? { prompt: body.prompt } : {}),
        ...(typeof body.maxFrames === 'number' ? { maxFrames: body.maxFrames } : {}),
        ...(typeof body.maxTokens === 'number' ? { maxTokens: body.maxTokens } : {}),
        ...(typeof body.temperature === 'number' ? { temperature: body.temperature } : {}),
        ...(typeof body.seed === 'number' ? { seed: body.seed } : {}),
      });
      return c.json({ model: tm.baseModel, ...media });
    } catch (err) {
      return c.json({ error: 'Evermind media generation failed', detail: err instanceof Error ? err.message : String(err) }, 502);
    }
  });

  /**
   * POST /api/studio/models/:slug/benchmark
   * Body: { corpus, topK? }
   * → scores the user's ACTUAL trained `.evermind` artifact on held-out text
   *   (perplexity / bits-per-token / top-1 / top-k / throughput + a sample),
   *   tokenized with the model's OWN persisted tokenizer. Read-through cached on
   *   the immutable ref + corpus hash (same model + same text ⇒ same score).
   */
  router.post('/:slug/benchmark', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const slug = c.req.param('slug');
    if (!c.env.UPLOADS) return c.json({ error: 'R2 artifact storage not configured' }, 503);

    const tm = await resolveTenantModel(c.env as Env, db, tenantId, `${TENANT_MODEL_REF_PREFIX}${slug}`);
    if (!tm || !tm.baseModel?.startsWith(EVERMIND_PIN_PREFIX)) {
      return c.json({ error: 'No published Evermind model with that slug' }, 404);
    }
    const ref = tm.baseModel.slice(EVERMIND_PIN_PREFIX.length);

    const body = (await c.req.json<{ corpus?: unknown; topK?: unknown }>().catch(() => ({}))) as {
      corpus?: unknown; topK?: unknown;
    };
    const corpus = typeof body.corpus === 'string' ? body.corpus.trim() : '';
    if (corpus.length < 20) {
      return c.json({ error: 'corpus is required — provide held-out text (≥ 20 chars) to score the model on' }, 400);
    }
    const topK = typeof body.topK === 'number' && body.topK > 0 ? Math.min(20, Math.floor(body.topK)) : 5;

    try {
      // ref is immutable (versioned at publish) and the corpus hash makes the key
      // content-addressed, so (ref, corpus, topK) fully determines the result — no
      // invalidation needed; it stays cached until a different model/corpus is scored.
      const result = await getOrSetCached(
        c.env as Env,
        `evermind_bench:${ref}:${await sha256Hex(`${topK}\n${corpus}`)}`,
        () => benchmarkEvermind(c.env.UPLOADS as Parameters<typeof benchmarkEvermind>[0], ref, corpus, { topK }),
        { kvTtlSeconds: 600 },
      );
      return c.json(result);
    } catch (err) {
      return c.json({ error: 'Evermind benchmark failed', detail: err instanceof Error ? err.message : String(err) }, 502);
    }
  });

  /**
   * GET /api/studio/models/:slug/export?format=<id>&fp16=<bool>
   * → exports the user's published `.evermind` model to a portable artifact and
   *   streams it as a download: a single file (safetensors / onnx / gguf) or a
   *   ZIP of the full Hugging Face repo bundle. No external credential needed —
   *   pushing the bundle to a hub is a separate, token-gated step.
   *
   * Not read-through cached: the artifact bytes are large binary blobs that can
   * exceed KV value limits; the expensive part (load + deserialize) is already
   * memoized per-isolate by `loadEvermindModel`, export is deterministic
   * serialization, and the immutable ref lets the browser/edge cache via headers.
   */
  router.get('/:slug/export', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const slug = c.req.param('slug');
    if (!c.env.UPLOADS) return c.json({ error: 'R2 artifact storage not configured' }, 503);

    const tm = await resolveTenantModel(c.env as Env, db, tenantId, `${TENANT_MODEL_REF_PREFIX}${slug}`);
    if (!tm || !tm.baseModel?.startsWith(EVERMIND_PIN_PREFIX)) {
      return c.json({ error: 'No published Evermind model with that slug' }, 404);
    }
    const ref = tm.baseModel.slice(EVERMIND_PIN_PREFIX.length);

    const formatId = (c.req.query('format') ?? 'huggingface') as ExportFormat;
    const formatDef = EXPORT_FORMATS.find((f) => f.id === formatId);
    if (!formatDef) {
      return c.json({ error: `unknown export format — one of: ${EXPORT_FORMATS.map((f) => f.id).join(', ')}` }, 400);
    }
    const fp16 = c.req.query('fp16') === 'true';
    const safeSlug = slug.replace(/[^a-zA-Z0-9._-]/g, '_');

    try {
      const result = await exportEvermindArtifact(c.env.UPLOADS as Parameters<typeof exportEvermindArtifact>[0], ref, formatId, {
        fp16,
        name: tm.name || slug,
      });
      const toBytes = (data: Uint8Array | string): Uint8Array =>
        typeof data === 'string' ? new TextEncoder().encode(data) : data;

      // Single-file formats stream directly; the multi-file HF repo is zipped.
      const [single] = result.files;
      if (result.files.length === 1 && single) {
        return new Response(toBytes(single.data) as BodyInit, {
          headers: {
            'Content-Type': single.contentType,
            'Content-Disposition': `attachment; filename="${safeSlug}${formatDef.ext}"`,
            'Cache-Control': 'private, max-age=3600',
          },
        });
      }
      const zippable: Zippable = {};
      for (const file of result.files) zippable[file.path] = toBytes(file.data);
      const zipped = zipSync(zippable);
      return new Response(zipped as BodyInit, {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${safeSlug}-evermind-hf.zip"`,
          'Cache-Control': 'private, max-age=3600',
        },
      });
    } catch (err) {
      return c.json({ error: 'Evermind export failed', detail: err instanceof Error ? err.message : String(err) }, 502);
    }
  });

  return router;
}
