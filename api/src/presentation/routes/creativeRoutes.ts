/**
 * Creative generation — /api/creative/*
 *
 * Canvas advertises a creative capability per object kind (`creative.cad`,
 * `creative.game`, …). Those capabilities used to be honoured entirely in the
 * browser by a parameterised primitive: a real, portable file for every kind, but
 * a fixed plate for every CAD brief and a fixed box for every 3D brief, with no
 * model behind any of it. This route is the generator those capabilities name.
 *
 * Two shapes of work, split by what can be validated:
 *
 *  - GEOMETRY (`cad`, `model3d`) — the model authors a bounded parametric SPEC
 *    and the server evaluates it into DXF or STL. Asking a model for DXF or STL
 *    text directly yields files that are plausible and frequently unopenable, so
 *    the shape comes from the model and the file comes from code that can only
 *    emit well-formed geometry. See `application/creative/geometryService`.
 *
 *  - AUTHORED (`game`, `resume`, `podcast`, `template`) — the deliverable IS text,
 *    so the model writes the file and the server checks it is the kind of file it
 *    claims to be before handing it back.
 *
 * Image, comic and animation are not here: those are rendered by the tenant's own
 * published Evermind media model, which the client calls directly.
 *
 * Everything runs on the FREE pool (`ideProxy`), so honouring a creative brief
 * never lands on a paid vendor. Any failure returns 502 and the caller falls back
 * to the browser baseline — a creative object must always end up with a file.
 *
 * Not cached: a generative call keyed on a free-text brief.
 */
import { Hono, type Context } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import type { HonoEnv } from '../../env';
import { ideProxy, readProxyChoice } from '../../application/llm/LlmProxyService';
import { tenantProxyForPlan } from '../../application/llm/tenantProxy';
import {
  GEOMETRY_RESPONSE_SCHEMAS,
  GEOMETRY_SYSTEM_PROMPTS,
  dxfFromProfile,
  facetCount,
  readCadSpec,
  readModel3dSpec,
  stlFromSolids,
} from '../../application/creative/geometryService';
import { normalizeGameDocument, validateGameDocument } from '../../application/game/gameDocument';
import { composeStructured } from '../../application/game';
import { ROBLOX_RESPONSE_SCHEMA, ROBLOX_SYSTEM_PROMPT, rbxlxFromSpec, readRobloxSpec } from '../../application/game/robloxPlace';
import { findStockImages } from '../../application/creative/stockImageSearch';
import {
  ScreenshotUnavailableError,
  captureWebScreenshotCached,
  isScreenshotViewport,
} from '../../application/web/webScreenshot';

/** Every kind this route can generate, and what it produces. */
const KINDS = {
  cad: { artifactKind: 'cad', extension: 'dxf', mimeType: 'application/dxf', outputFormat: 'DXF' },
  model3d: { artifactKind: 'model3d', extension: 'stl', mimeType: 'model/stl', outputFormat: 'STL' },
  game: { artifactKind: 'game', extension: 'html', mimeType: 'text/html', outputFormat: 'HTML' },
  resume: { artifactKind: 'resume', extension: 'md', mimeType: 'text/markdown', outputFormat: 'Markdown' },
  podcast: { artifactKind: 'podcast-script', extension: 'md', mimeType: 'text/markdown', outputFormat: 'Markdown script' },
  template: { artifactKind: 'template', extension: 'json', mimeType: 'application/json', outputFormat: 'JSON' },
} as const;

type CreativeKind = keyof typeof KINDS;

const AUTHORING_PROMPTS: Record<'game' | 'resume' | 'podcast' | 'template', string> = {
  // The touch, viewport and offline requirements are NOT decoration: this exact
  // document is what gets installed on a phone home screen and wrapped in an APK
  // (see application/game/gameTarget.ts). A game written for a mouse and a fixed
  // 800×600 canvas is unplayable on the device most people asked for.
  game: 'You write small, complete browser games. Reply with ONE self-contained HTML document — inline CSS and JS, '
    + 'no external files, no network, no CDN — that actually plays the game described in the brief: real rules, '
    + 'real input handling, a win or lose state, and a visible score or objective.\n'
    + 'It must play on a PHONE as well as a laptop:\n'
    + '- Handle BOTH keyboard (arrow keys or WASD, and space) AND touch (pointerdown/pointermove on the play area). '
    + 'Never require a key that has no touch equivalent.\n'
    + '- Size the play area to the viewport with CSS and resize with it — never a fixed pixel width. '
    + 'If you use a canvas, set its width/height from the element size and redraw on resize.\n'
    + '- Make text and targets big enough to read and hit with a thumb.\n'
    + '- Start on a tap or a key, not automatically, and offer a restart when the game ends.\n'
    + 'Reply with the HTML only, no commentary.',
  resume: 'You write resumes. Reply with a complete Markdown resume for the person and role described in the brief: '
    + 'a summary, experience with measurable achievements, skills, and education. Use only facts the brief supports '
    + 'and clearly bracketed placeholders where it gives none. Reply with the Markdown only.',
  podcast: 'You write podcast scripts. Reply with a complete Markdown script for the episode described in the brief: '
    + 'a cold open, segments with speaker cues and actual spoken lines, transitions, and an outro. '
    + 'Reply with the Markdown only.',
  template: 'You design reusable content templates. Reply with a JSON object describing the template the brief asks '
    + 'for: an id, a name, a description, and a `fields` array where each field has a key, a label, a type '
    + '(text, textarea, number, date, select) and, for select, its options. Reply with JSON only.',
};

/** Token ceilings per kind. A game is a document; a spec is a page of numbers. */
const MAX_TOKENS: Record<CreativeKind, number> = {
  cad: 1600, model3d: 1600, game: 8000, resume: 2400, podcast: 3200, template: 1600,
};

function fileSafe(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'builderforce-artifact';
}

/** Models fence code even when told not to; the fence is not part of the file. */
function stripFence(text: string): string {
  const fenced = /^\s*```[a-z]*\s*\n([\s\S]*?)\n?```\s*$/i.exec(text);
  return (fenced ? fenced[1]! : text).trim();
}

const RESUME_IMPORT_EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'rtf', 'txt', 'md', 'markdown', 'json', 'png', 'jpg', 'jpeg', 'webp']);
const RESUME_IMPORT_MAX_BYTES = 20 * 1024 * 1024;
const ATTACHMENT_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;

/** One R2 write, scoped to the caller's tenant and user, for every route that needs to
 * keep a file's bytes past the request that received them. */
async function storeTenantFile(
  c: Context<HonoEnv>,
  scope: string,
  extension: string,
  bytes: ArrayBuffer,
  contentType: string,
  originalName: string,
  purpose: string,
): Promise<string | null> {
  if (!c.env.UPLOADS) return null;
  const key = `${c.get('tenantId')}/${c.get('userId')}/${scope}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${extension || 'bin'}`;
  await c.env.UPLOADS.put(key, bytes, {
    httpMetadata: { contentType },
    customMetadata: { originalName, tenantId: String(c.get('tenantId')), purpose },
  });
  return key;
}
const RESUME_EXTRACTION_PROMPT = `Extract this resume into one JSON Resume object. Return JSON only.
Rules:
- Copy facts exactly; never invent employers, dates, credentials, metrics, contact details, or skills.
- Use empty arrays or omit fields when the source does not provide them.
- Preserve every supported item and bullet.
- Shape: { basics: { name, label, image, email, phone, url, summary, location: { address, postalCode, city, countryCode, region } }, work: [{ id, name, position, url, startDate, endDate, summary, highlights }], education: [{ id, institution, url, area, studyType, startDate, endDate, score, courses }], skills: [{ id, name, level, keywords }], volunteer: [], projects: [], awards: [], certificates: [], publications: [], languages: [], interests: [], references: [] }.`;

function parsedJsonObject(raw: string): Record<string, unknown> | null {
  const clean = stripFence(raw);
  try {
    const parsed = JSON.parse(clean) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    const start = clean.indexOf('{'); const end = clean.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      const parsed = JSON.parse(clean.slice(start, end + 1)) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
    } catch { return null; }
  }
}

function bytesBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
  }
  return btoa(binary);
}

export function createCreativeRoutes(): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  /** Live provider reads are cached briefly so repeated agent turns do not spend provider quota. */
  router.get('/images/search', async (c) => {
    const query = String(c.req.query('q') ?? '').trim().slice(0, 200);
    if (!query) return c.json({ error: 'q is required' }, 400);
    const limit = Math.max(1, Math.min(20, Number(c.req.query('limit')) || 12));
    try {
      return c.json({ results: await findStockImages(c.env, query, limit) });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Stock image search failed' }, 503);
    }
  });

  /**
   * POST /api/creative/screenshot  { url, viewport?, fullPage? }
   *  → { imageDataUrl, url, width, height, viewport, capturedAt, provider }
   *
   * Pixels of a LIVE page — the "before" a redesign is compared against. Sibling of
   * `builtin_web_fetch`, which reads what a page says; this reads what it looks like,
   * and a "show me a before and after" conversation needs both. See
   * `application/web/webScreenshot.ts` for the session that made it necessary.
   *
   * The failure paths matter as much as the success one: every refusal carries the
   * REAL reason (`unconfigured` — this deployment has no renderer; `provider` — the
   * page timed out or refused; `too-large` — the capture exceeds what a canvas object
   * may hold), because the canvas relays that sentence to the user verbatim rather
   * than letting the model invent a limitation of its own.
   *
   * Cached inside the service (six hours), so a comparison re-read during a working
   * session costs one render rather than one per turn.
   */
  router.post('/screenshot', async (c) => {
    type ShotBody = { url?: unknown; viewport?: unknown; fullPage?: unknown };
    const body = await c.req.json<ShotBody>().catch(() => ({} as ShotBody));
    const url = String(body.url ?? '').trim();
    if (!url) return c.json({ error: 'url is required' }, 400);
    const viewport = isScreenshotViewport(body.viewport) ? body.viewport : 'desktop';
    try {
      const shot = await captureWebScreenshotCached(c.env, url, { viewport, fullPage: body.fullPage === true });
      return c.json(shot);
    } catch (error) {
      if (error instanceof ScreenshotUnavailableError) {
        // 503 for "this deployment cannot", 502 for "that page would not" — different
        // answers to the operator's monitoring and to the user reading the reply.
        return c.json({ error: error.message, reason: error.reason }, error.reason === 'unconfigured' ? 503 : 502);
      }
      // An SSRF refusal or a malformed URL — the caller's input, not the renderer.
      return c.json({ error: error instanceof Error ? error.message : 'The page could not be captured', reason: 'rejected' }, 400);
    }
  });

  /**
   * Parse text, Office/PDF files, and photographed scans into canonical JSON Resume.
   *
   * The file arrives one of three ways: fresh bytes in `file` (the résumé editor's
   * own picker), a `sourceFileKey` already sitting in R2 (a canvas attachment
   * uploaded there at drop time by a signed-in session — see `/attachments/upload`),
   * or an inline `dataUrl` (a canvas attachment kept as base64 on a local/guest
   * session that has since signed in and is escalating it now that a tenant
   * exists to bill the read to). Whichever it is, it becomes the same `fileBytes`.
   */
  router.post('/resume/import', async (c) => {
    const form = await c.req.formData();
    const file = form.get('file') as unknown;
    const extractedText = String(form.get('text') ?? '').trim().slice(0, 80_000);
    const existingKey = String(form.get('sourceFileKey') ?? '').trim();
    const inlineDataUrl = String(form.get('dataUrl') ?? '').trim();
    const suppliedName = String(form.get('fileName') ?? '').trim();

    let fileBytes: ArrayBuffer;
    let fileName: string;
    let mimeType: string;
    let sourceFileKey: string | null = null;

    if (file && typeof file === 'object' && 'arrayBuffer' in file && 'name' in file) {
      const resumeFile = file as File;
      fileBytes = await resumeFile.arrayBuffer();
      fileName = resumeFile.name;
      mimeType = resumeFile.type || 'application/octet-stream';
    } else if (existingKey) {
      if (!existingKey.startsWith(`${c.get('tenantId')}/`)) return c.json({ error: 'Attachment does not belong to this workspace' }, 403);
      if (!c.env.UPLOADS) return c.json({ error: 'File storage is not configured' }, 503);
      const stored = await c.env.UPLOADS.get(existingKey);
      if (!stored) return c.json({ error: 'Attachment could not be found' }, 404);
      fileBytes = await stored.arrayBuffer();
      fileName = suppliedName || existingKey.split('/').pop() || 'attachment';
      mimeType = stored.httpMetadata?.contentType || 'application/octet-stream';
      sourceFileKey = existingKey;
    } else if (/^data:[^;]+;base64,/.test(inlineDataUrl)) {
      const [, declaredType, base64] = /^data:([^;]+);base64,(.+)$/s.exec(inlineDataUrl) ?? [];
      mimeType = declaredType || 'application/octet-stream';
      const binary = atob(base64 ?? '');
      const decoded = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) decoded[i] = binary.charCodeAt(i);
      fileBytes = decoded.buffer;
      fileName = suppliedName || 'attachment';
    } else {
      return c.json({ error: 'A resume file is required' }, 400);
    }

    const extension = (fileName.split('.').pop() ?? '').toLowerCase();
    if (!RESUME_IMPORT_EXTENSIONS.has(extension)) return c.json({ error: 'Unsupported resume file type' }, 415);
    if (!fileBytes.byteLength || fileBytes.byteLength > RESUME_IMPORT_MAX_BYTES) return c.json({ error: 'Resume files must be between 1 byte and 20MB' }, 413);

    // A key we already hold (or just decoded) is kept as-is; only fresh bytes get a new one.
    if (!sourceFileKey) sourceFileKey = await storeTenantFile(c, 'resumes', extension, fileBytes, mimeType, fileName, 'resume-source');
    if (extension === 'json') {
      try {
        const document = JSON.parse(new TextDecoder().decode(fileBytes)) as unknown;
        if (!document || typeof document !== 'object' || Array.isArray(document)) throw new Error('not an object');
        return c.json({ document, sourceFileKey, provider: 'builderforce-json', model: 'deterministic' });
      } catch {
        return c.json({ error: 'JSON Resume must contain one valid object', sourceFileKey }, 422);
      }
    }

    const dataUrl = extractedText ? null : `data:${mimeType};base64,${bytesBase64(fileBytes)}`;
    const content: unknown = extractedText
      ? `${RESUME_EXTRACTION_PROMPT}\n\nSOURCE RESUME:\n${extractedText}`
      : extension === 'pdf' || extension === 'doc' || extension === 'docx'
        ? [{ type: 'text', text: RESUME_EXTRACTION_PROMPT }, { type: 'file', file: { filename: fileName, file_data: dataUrl } }]
        : [{ type: 'text', text: RESUME_EXTRACTION_PROMPT }, { type: 'image_url', image_url: { url: dataUrl } }];
    try {
      const { proxy } = await tenantProxyForPlan(c.env, c.get('tenantId'));
      const result = await proxy.complete({
        messages: [{ role: 'user', content } as never],
        response_format: { type: 'json_object' },
        temperature: 0,
        max_tokens: 6000,
        useCase: extractedText ? 'resume_structured_extraction' : 'resume_ocr',
      });
      if (result.response.status >= 400) return c.json({ error: 'Resume extraction is unavailable', sourceFileKey }, 502);
      const choice = await readProxyChoice(result);
      const document = parsedJsonObject(choice.content);
      if (!document) return c.json({ error: 'Resume extraction returned invalid structured data', sourceFileKey }, 502);
      return c.json({ document, sourceFileKey, provider: result.resolvedVendor, model: result.resolvedModel });
    } catch (error) {
      return c.json({ error: 'Resume extraction failed', detail: error instanceof Error ? error.message : String(error), sourceFileKey }, 502);
    }
  });

  /**
   * Keep a canvas attachment's bytes past the drop that brought it in, so a file
   * the browser could not read (a scanned PDF, a corrupted DOCX) can still be
   * escalated to server-side OCR/multimodal reading later — by `/resume/import`
   * today, and by any future reader of a `file`-kind canvas object. Signed-in
   * only: the alternative for a session with no tenant is to keep the bytes
   * inline on the canvas object instead of calling this route at all.
   */
  router.post('/attachments/upload', async (c) => {
    if (!c.env.UPLOADS) return c.json({ error: 'File storage is not configured' }, 503);
    const form = await c.req.formData();
    const file = form.get('file') as unknown;
    if (!file || typeof file !== 'object' || !('arrayBuffer' in file) || !('name' in file)) return c.json({ error: 'A file is required' }, 400);
    const attachment = file as File;
    if (!attachment.size || attachment.size > ATTACHMENT_UPLOAD_MAX_BYTES) return c.json({ error: 'File must be between 1 byte and 20MB' }, 413);
    const extension = (attachment.name.split('.').pop() ?? '').toLowerCase();
    const sourceFileKey = await storeTenantFile(
      c, 'attachments', extension, await attachment.arrayBuffer(),
      attachment.type || 'application/octet-stream', attachment.name, 'canvas-attachment-source',
    );
    if (!sourceFileKey) return c.json({ error: 'File storage is not configured' }, 503);
    return c.json({ sourceFileKey });
  });

  /**
   * POST /api/creative/generate
   * Body: { kind, title, brief, templateId? }
   * → { artifactKind, fileName, mimeType, outputFormat, content, provider, model, validationDetail, summary? }
   */
  router.post('/generate', async (c) => {
    type GenerateBody = { kind?: unknown; title?: unknown; brief?: unknown; templateId?: unknown; platform?: unknown };
    const body: GenerateBody = await c.req.json<GenerateBody>().catch(() => ({} as GenerateBody));
    const kind = String(body.kind ?? '') as CreativeKind;
    const target = KINDS[kind];
    if (!target) return c.json({ error: 'Unsupported creative kind', kind: String(body.kind ?? '') }, 400);

    const title = String(body.title ?? '').trim().slice(0, 200) || kind;
    const brief = String(body.brief ?? '').trim().slice(0, 8000);
    if (!brief) return c.json({ error: 'A brief is required to generate this deliverable' }, 400);
    const templateId = typeof body.templateId === 'string' ? body.templateId.trim().slice(0, 120) : '';
    const stem = fileSafe(title);

    /**
     * A Roblox game is a different MACHINE, not a different format.
     *
     * Roblox has no DOM, so the HTML branch below cannot serve it — the brief is
     * re-authored against Luau instead. It lives here, beside the other creative
     * kinds, rather than behind the project-scoped game-target routes, because
     * AUTHORING a place needs nothing but a brief; only PUBLISHING one needs a
     * project, a workspace and an API key. Binding the two together is what made
     * "create a Roblox game" unreachable from the canvas at all.
     *
     * Same discipline as the geometry kinds: the model authors a bounded spec and
     * code emits the file, because `.rbxlx` property serialisation is unforgiving
     * and a hand-written one opens to an error or to silently defaulted parts.
     */
    if (kind === 'game' && body.platform === 'roblox') {
      let spec;
      try {
        spec = readRobloxSpec(
          await composeStructured(c.env)({
            system: ROBLOX_SYSTEM_PROMPT,
            user: `Title: ${title}\nBrief: ${brief}`,
            schema: ROBLOX_RESPONSE_SCHEMA,
            maxTokens: 8000,
            useCase: 'creative_game_roblox',
          }),
        );
      } catch (err) {
        return c.json({ error: 'Roblox place generation failed', detail: err instanceof Error ? err.message : String(err) }, 502);
      }
      if (!spec) {
        return c.json({ error: 'The generated Roblox place had no buildable parts or no server script, so it would open empty' }, 502);
      }
      return c.json({
        artifactKind: 'roblox-place',
        fileName: `${stem}.rbxlx`,
        mimeType: 'application/xml',
        outputFormat: 'Roblox place',
        provider: 'builderforce-roblox',
        model: '',
        content: rbxlxFromSpec(spec),
        validationDetail:
          `Roblox place with ${spec.parts.length} built part${spec.parts.length === 1 ? '' : 's'}, `
          + 'a server ruleset and a client HUD — open it in Roblox Studio and press Play',
        summary: spec.summary || null,
      });
    }

    const geometry = kind === 'cad' || kind === 'model3d';
    const userPrompt = `Title: ${title}\n${templateId ? `Template: ${templateId}\n` : ''}Brief: ${brief}`;

    let result;
    try {
      result = await ideProxy(c.env).complete({
        messages: [
          { role: 'system', content: geometry ? GEOMETRY_SYSTEM_PROMPTS[kind] : AUTHORING_PROMPTS[kind] },
          { role: 'user', content: userPrompt },
        ],
        temperature: geometry ? 0.2 : 0.7,
        max_tokens: MAX_TOKENS[kind],
        ...(geometry ? { response_format: GEOMETRY_RESPONSE_SCHEMAS[kind] } : {}),
        ...(kind === 'template' ? { response_format: { type: 'json_object' as const } } : {}),
        useCase: `creative_${kind}`,
      });
    } catch (err) {
      return c.json({ error: 'Creative generation failed', detail: err instanceof Error ? err.message : String(err) }, 502);
    }
    if (result.response.status >= 400) return c.json({ error: 'Creative generation is unavailable' }, 502);
    const { content } = await readProxyChoice(result);
    if (!content.trim()) return c.json({ error: 'The generator returned nothing' }, 502);

    const common = {
      artifactKind: target.artifactKind,
      fileName: `${stem}${kind === 'podcast' ? '-script' : ''}.${target.extension}`,
      mimeType: target.mimeType,
      outputFormat: target.outputFormat,
      provider: geometry ? 'builderforce-geometry' : 'builderforce-authoring',
      model: result.resolvedModel,
    };

    if (geometry) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        return c.json({ error: 'The geometry generator did not return a readable spec' }, 502);
      }
      if (kind === 'cad') {
        const spec = readCadSpec(parsed);
        if (!spec) return c.json({ error: 'The generated profile was not a drawable outline' }, 502);
        return c.json({
          ...common,
          content: dxfFromProfile(spec),
          validationDetail: `Closed ${spec.outline.length}-point DXF profile with ${spec.holes?.length ?? 0} bore(s), generated from the brief and evaluated on the server`,
          summary: spec.summary ?? null,
        });
      }
      const spec = readModel3dSpec(parsed);
      if (!spec) return c.json({ error: 'The generated model had no buildable solids' }, 502);
      const facets = facetCount(spec);
      if (!facets) return c.json({ error: 'The generated model tessellated to nothing' }, 502);
      return c.json({
        ...common,
        content: stlFromSolids(stem, spec),
        validationDetail: `Closed ${facets}-facet ASCII STL from ${spec.solids.length} primitive(s), generated from the brief and evaluated on the server`,
        summary: spec.summary ?? null,
      });
    }

    const file = stripFence(content);
    // The file has to BE what it claims to be. A refusal, an apology or a stray
    // paragraph is not an artifact, and shipping it as one is the failure this
    // route exists to remove.
    //
    // A game is checked by the SAME validator every game target uses, so a
    // document that would produce a blank screen is refused here — once, before
    // anyone publishes it or spends five minutes building an APK from it —
    // rather than in each place it would eventually fail.
    if (kind === 'game') {
      const playable = validateGameDocument(file);
      if (!playable.ok) return c.json({ error: playable.reason }, 502);
    }
    if (kind === 'template') {
      try {
        JSON.parse(file);
      } catch {
        return c.json({ error: 'The generated template was not valid JSON' }, 502);
      }
    }
    if (file.length < 40) return c.json({ error: 'The generated deliverable was too short to be usable' }, 502);

    return c.json({
      ...common,
      content: kind === 'game' ? normalizeGameDocument(file, title) : file,
      validationDetail: kind === 'game'
        ? `Self-contained playable HTML game, checked for a script and for offline independence (${file.length} characters)`
        : `${target.outputFormat} deliverable generated from the brief and checked for shape (${file.length} characters)`,
      summary: null,
    });
  });

  return router;
}
