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
import { CANVAS_VIEWPORTS } from '@builderforce/creation-canvas-contract';
import { authMiddleware } from '../middleware/authMiddleware';
import { failResponse } from '../middleware/errorResponse';
import { parseBody, z, zNonEmptyString, zOptionalString } from './requestBody';
import type { HonoEnv } from '../../env';
import { ServiceUnavailableError } from '../../domain/shared/errors';
import { ideProxy, readProxyChoice } from '../../application/llm/LlmProxyService';
import { JSON_OBJECT_FORMAT, completeJson, type CompleteJsonFailureReason } from '../../application/llm/completeJson';
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
import { ROBLOX_RESPONSE_SCHEMA, ROBLOX_SYSTEM_PROMPT, rbxlxFromSpec, readRobloxSpec } from '../../application/game/robloxPlace';
import { findStockImages } from '../../application/creative/stockImageSearch';
import {
<<<<<<< Updated upstream
  SCREENSHOT_REASON_STATUS,
  ScreenshotUnavailableError,
  captureWebScreenshotCached,
} from '../../application/web/webScreenshot';
import { limitParam } from './queryParams';
=======
  ScreenshotUnavailableError,
  captureWebScreenshotCached,
  isScreenshotViewport,
} from '../../application/web/webScreenshot';
>>>>>>> Stashed changes

/** Every kind this route can generate — the `kind` a `/generate` body may carry. */
const CREATIVE_KINDS = ['cad', 'model3d', 'game', 'resume', 'podcast', 'template'] as const;
type CreativeKind = (typeof CREATIVE_KINDS)[number];

/** What each kind produces. `satisfies` keeps this table and {@link CREATIVE_KINDS} in step. */
const KINDS = {
  cad: { artifactKind: 'cad', extension: 'dxf', mimeType: 'application/dxf', outputFormat: 'DXF' },
  model3d: { artifactKind: 'model3d', extension: 'stl', mimeType: 'model/stl', outputFormat: 'STL' },
  game: { artifactKind: 'game', extension: 'html', mimeType: 'text/html', outputFormat: 'HTML' },
  resume: { artifactKind: 'resume', extension: 'md', mimeType: 'text/markdown', outputFormat: 'Markdown' },
  podcast: { artifactKind: 'podcast-script', extension: 'md', mimeType: 'text/markdown', outputFormat: 'Markdown script' },
  template: { artifactKind: 'template', extension: 'json', mimeType: 'application/json', outputFormat: 'JSON' },
} as const satisfies Record<CreativeKind, { artifactKind: string; extension: string; mimeType: string; outputFormat: string }>;

const SOURCE = 'presentation/routes/creativeRoutes.ts';

const ScreenshotBody = z.object({
  url: zNonEmptyString,
  viewport: z.enum(CANVAS_VIEWPORTS).optional(),
  fullPage: z.boolean().optional(),
});

const AttachmentReadBody = z.object({
  sourceFileKey: zOptionalString,
  fileName: zOptionalString,
  dataUrl: zOptionalString,
});

const GenerateBody = z.object({
  kind: z.enum(CREATIVE_KINDS),
  title: zOptionalString,
  brief: zNonEmptyString,
  templateId: zOptionalString,
  /** A game's platform. Only `roblox` changes the machine; anything else is the HTML game. */
  platform: zOptionalString,
});

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

/**
 * What a `completeJson` failure says for the free-pool generators. `invalid` is
 * per-kind (the validator's own sentence) and is mapped at the site.
 */
const GENERATOR_FAILURE: Record<Exclude<CompleteJsonFailureReason, 'invalid'>, string> = {
  gateway: 'Creative generation is unavailable',
  empty: 'The generator returned nothing',
  unparseable: 'The generator did not return a readable spec',
};

function fileSafe(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'builderforce-artifact';
}

/**
 * Models fence code even when told not to; the fence is not part of the file.
 * For the TEXT deliverables only (a game, a résumé, a script) — a JSON reply goes
 * through `completeJson`, whose reader strips its own fence.
 */
function stripFence(text: string): string {
  const fenced = /^\s*```[a-z]*\s*\n([\s\S]*?)\n?```\s*$/i.exec(text);
  return (fenced ? fenced[1]! : text).trim();
}

const RESUME_IMPORT_EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'rtf', 'txt', 'md', 'markdown', 'json', 'png', 'jpg', 'jpeg', 'webp']);
const RESUME_IMPORT_MAX_BYTES = 20 * 1024 * 1024;
const ATTACHMENT_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
/**
 * What `/attachments/read` will look at.
 *
 * PDFs and photographs, and nothing else, because those are the two shapes that have a
 * PAGE with no text layer. An Office file, a CSV or a Markdown file is parsed
 * deterministically in the browser and always will be — sending one to a model would
 * spend tokens to produce a worse answer than the parser already gives for free.
 */
const ATTACHMENT_READ_EXTENSIONS = new Set(['pdf', 'png', 'jpg', 'jpeg', 'webp', 'heic', 'tif', 'tiff']);

/**
 * The read instruction.
 *
 * It asks for the page as it IS, not for a summary, because the caller is turning the
 * answer into a `document` object somebody will read and edit — a summary would silently
 * destroy the contract clause they dropped it to find. The refusal instruction matters as
 * much: a model that guesses at an illegible scan produces a document that looks
 * authoritative and says something nobody wrote.
 */
const ATTACHMENT_READ_PROMPT = `Transcribe this document into Markdown, exactly as it appears.

Rules:
- Reproduce ALL the text. Do not summarise, shorten, paraphrase or comment.
- Keep the structure: headings as headings, lists as lists, tables as Markdown tables.
- Keep the reading order of a multi-column page: finish a column before starting the next.
- Transcribe headers, footers and page numbers only when they carry meaning (a document
  reference, a clause number); drop pure decoration.
- Where text is genuinely illegible, write [illegible] rather than guessing. A plausible
  invention is far worse than a gap a reader can see.
- Return the Markdown only. No preamble, no explanation, no code fence around the whole
  answer.`;

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

/** A `completeJson` validator that admits a plain object and refuses arrays and scalars. */
function jsonObjectOnly(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
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
    const limit = limitParam(c.req.query('limit'), 12, 20);
    try {
      return c.json({ results: await findStockImages(c.env, query, limit) });
    } catch (error) {
      // Unconfigured keys and a provider's own failure are both "not available here":
      // a 503 the global handler reports, with the provider's text kept out of the body.
      const unavailable = new ServiceUnavailableError('Stock image search is unavailable');
      unavailable.cause = error;
      throw unavailable;
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
    const body = await parseBody(c, ScreenshotBody);
    const viewport = body.viewport ?? 'desktop';
    try {
      const shot = await captureWebScreenshotCached(c.env, body.url, { viewport, fullPage: body.fullPage === true });
      return c.json(shot);
    } catch (error) {
      if (error instanceof ScreenshotUnavailableError) {
        // 503 for "this deployment cannot", 502 for "that page would not" — different
        // answers to the operator's monitoring and to the user reading the reply. The
        // mapping lives with the reasons so a new one must decide its own status.
        return c.json({ error: error.message, reason: error.reason }, SCREENSHOT_REASON_STATUS[error.reason]);
      }
      // An SSRF refusal or a malformed URL — the caller's input, not the renderer.
      return c.json({ error: error instanceof Error ? error.message : 'The page could not be captured', reason: 'rejected' }, 400);
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
    const content = extractedText
      ? `${RESUME_EXTRACTION_PROMPT}\n\nSOURCE RESUME:\n${extractedText}`
      : extension === 'pdf' || extension === 'doc' || extension === 'docx'
        ? [{ type: 'text', text: RESUME_EXTRACTION_PROMPT }, { type: 'file', file: { filename: fileName, file_data: dataUrl } }]
        : [{ type: 'text', text: RESUME_EXTRACTION_PROMPT }, { type: 'image_url', image_url: { url: dataUrl } }];

    // Resolving the tenant's plan/credentials can throw; the completion itself cannot.
    let proxy;
    try {
      ({ proxy } = await tenantProxyForPlan(c.env, c.get('tenantId')));
    } catch (error) {
      return failResponse(c, error, { source: SOURCE, operation: 'resolve-resume-extraction-proxy' }, { sourceFileKey });
    }
    const out = await completeJson(
      { kind: 'proxy', proxy },
      {
        system: '',
        user: content,
        schema: JSON_OBJECT_FORMAT,
        maxTokens: 6000,
        useCase: extractedText ? 'resume_structured_extraction' : 'resume_ocr',
      },
      jsonObjectOnly,
    );
    if (!out.ok) {
      const error = out.reason === 'gateway' ? 'Resume extraction is unavailable' : 'Resume extraction returned invalid structured data';
      return c.json({ error, sourceFileKey }, 502);
    }
    return c.json({ document: out.value, sourceFileKey, provider: out.result?.resolvedVendor ?? null, model: out.model });
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
   * READ A RETAINED ATTACHMENT THAT HAS NO TEXT LAYER.
   *
   * ── THE DOOR THAT EXISTED AND NOBODY WALKED THROUGH ──────────────────────────
   * `office/pdf.ts` extracts a PDF's own text and refuses anything it cannot decode
   * above a legibility threshold — correctly, because a page of mojibake pasted onto the
   * board as a document is worse than an attachment card that says it could not be read.
   * Two cases fail that gate and can never pass it: a page that is a photograph of a page
   * (no text layer to decode) and an `/Encrypt`ed file (refused outright).
   *
   * Both already RETAIN their bytes — `/attachments/upload` puts them in R2 and hands
   * back a `sourceFileKey` — so the escalation door has been open the whole time and
   * nothing read through it. A scanned contract dropped on the canvas stayed an
   * attachment card forever.
   *
   * This is the read. It hands the retained file to the multimodal pool with an `ocr`
   * use case (`poolRouting.ts` already floats the OCR-capable models up on that signal —
   * see its `hasOcr` check) and returns MARKDOWN, which is what the canvas turns into a
   * `document` object.
   *
   * ── WHY IT IS A SEPARATE CALL AND NOT PART OF THE DROP ───────────────────────
   * It costs tokens and it is slow, and the overwhelming majority of dropped PDFs have a
   * perfectly good text layer that `office/pdf.ts` reads for free in the browser. Running
   * a model over every drop would bill every tenant for the common case in order to serve
   * the rare one. So the drop stays local and free, and a card that could not be read
   * offers this.
   *
   * ── WHY THE OUTPUT IS MARKDOWN AND NOT JSON ──────────────────────────────────
   * `/resume/import` asks for structured JSON because it knows what a résumé IS. This
   * route knows nothing about the document — it might be a contract, a scanned invoice,
   * a lecture handout — so imposing a schema would be inventing one. Markdown preserves
   * the headings, lists and tables a reader needs and is exactly what the canvas
   * `document` kind already holds.
   */
  router.post('/attachments/read', async (c) => {
    const body = await parseBody(c, AttachmentReadBody);
    const sourceFileKey = body.sourceFileKey ?? '';
    const inlineDataUrl = body.dataUrl ?? '';
    const suppliedName = body.fileName ?? '';

    let bytes: ArrayBuffer;
    let fileName: string;
    let mimeType: string;

    if (sourceFileKey) {
      // The same tenant-prefix check `/resume/import` makes, and for the same reason: a
      // key is a guessable string, and reading somebody else's retained contract is the
      // one failure this route absolutely must not have.
      if (!sourceFileKey.startsWith(`${c.get('tenantId')}/`)) return c.json({ error: 'Attachment does not belong to this workspace' }, 403);
      if (!c.env.UPLOADS) return c.json({ error: 'File storage is not configured' }, 503);
      const stored = await c.env.UPLOADS.get(sourceFileKey);
      if (!stored) return c.json({ error: 'Attachment could not be found' }, 404);
      bytes = await stored.arrayBuffer();
      fileName = suppliedName || sourceFileKey.split('/').pop() || 'attachment';
      mimeType = stored.httpMetadata?.contentType || 'application/octet-stream';
    } else if (/^data:[^;]+;base64,/.test(inlineDataUrl)) {
      // A guest board keeps its attachment inline; this is the same escalation path
      // `/resume/import` offers once a tenant exists to bill the read to.
      const [, declaredType, base64] = /^data:([^;]+);base64,(.+)$/s.exec(inlineDataUrl) ?? [];
      mimeType = declaredType || 'application/octet-stream';
      const binary = atob(base64 ?? '');
      const decoded = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) decoded[i] = binary.charCodeAt(i);
      bytes = decoded.buffer;
      fileName = suppliedName || 'attachment';
    } else {
      return c.json({ error: 'sourceFileKey or dataUrl is required' }, 400);
    }

    const extension = (fileName.split('.').pop() ?? '').toLowerCase();
    if (!ATTACHMENT_READ_EXTENSIONS.has(extension)) {
      return c.json({ error: `A ${extension || 'file'} has no page to read. This reads scanned or encrypted PDFs and photographed pages.` }, 415);
    }
    if (!bytes.byteLength || bytes.byteLength > ATTACHMENT_UPLOAD_MAX_BYTES) {
      return c.json({ error: 'Files must be between 1 byte and 20MB' }, 413);
    }

    const dataUrl = `data:${mimeType};base64,${bytesBase64(bytes)}`;
    const content = extension === 'pdf'
      ? [{ type: 'text', text: ATTACHMENT_READ_PROMPT }, { type: 'file', file: { filename: fileName, file_data: dataUrl } }]
      : [{ type: 'text', text: ATTACHMENT_READ_PROMPT }, { type: 'image_url', image_url: { url: dataUrl } }];

    try {
      const { proxy } = await tenantProxyForPlan(c.env, c.get('tenantId'));
      const result = await proxy.complete({
        messages: [{ role: 'user', content } as never],
        temperature: 0,
        max_tokens: 8000,
        // The slug `poolRouting.hasOcr` matches on. Without it the request routes to
        // whatever the general pool offers, which is how an OCR job lands on a model
        // that cannot see.
        useCase: 'attachment_ocr',
      });
      if (result.response.status >= 400) return c.json({ error: 'Reading this file is unavailable right now', sourceFileKey: sourceFileKey || null }, 502);
      const choice = await readProxyChoice(result);
      const markdown = String(choice.content ?? '').trim();
      // An empty read is reported as one rather than returned as an empty document: a
      // blank `document` card on the board asserts that the page said nothing.
      if (!markdown) return c.json({ error: 'Nothing legible could be read from this file', sourceFileKey: sourceFileKey || null }, 422);
      return c.json({
        markdown,
        fileName,
        sourceFileKey: sourceFileKey || null,
        // Read off the envelope rather than a field on the choice: `ProxyChoice` carries
        // the message, not the routing, and inventing a shape here would be a second
        // answer to "which model ran this".
        model: typeof choice.body?.model === 'string' ? choice.body.model : null,
      });
    } catch (error) {
      return failResponse(c, error, { source: SOURCE, operation: 'read-attachment' }, { sourceFileKey: sourceFileKey || null });
    }
  });

  /**
   * POST /api/creative/generate
   * Body: { kind, title, brief, templateId? }
   * → { artifactKind, fileName, mimeType, outputFormat, content, provider, model, validationDetail, summary? }
   */
  router.post('/generate', async (c) => {
    const body = await parseBody(c, GenerateBody);
    const { kind } = body;
    const target = KINDS[kind];

    const title = (body.title ?? kind).slice(0, 200);
    const brief = body.brief.slice(0, 8000);
    const templateId = body.templateId?.slice(0, 120) ?? '';
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
      const out = await completeJson(
        { kind: 'ide', env: c.env },
        {
          system: ROBLOX_SYSTEM_PROMPT,
          user: `Title: ${title}\nBrief: ${brief}`,
          schema: ROBLOX_RESPONSE_SCHEMA,
          temperature: 0.4,
          maxTokens: 8000,
          useCase: 'creative_game_roblox',
        },
        readRobloxSpec,
      );
      if (!out.ok) {
        return c.json({
          error: out.reason === 'invalid'
            ? 'The generated Roblox place had no buildable parts or no server script, so it would open empty'
            : GENERATOR_FAILURE[out.reason],
        }, 502);
      }
      const spec = out.value;
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
    const common = (model: string | null) => ({
      artifactKind: target.artifactKind,
      fileName: `${stem}${kind === 'podcast' ? '-script' : ''}.${target.extension}`,
      mimeType: target.mimeType,
      outputFormat: target.outputFormat,
      provider: geometry ? 'builderforce-geometry' : 'builderforce-authoring',
      model,
    });

    // ── JSON deliverables: a geometry SPEC (strict schema) or a template (any object) ──
    if (geometry || kind === 'template') {
      const out = await completeJson(
        { kind: 'ide', env: c.env },
        {
          system: geometry ? GEOMETRY_SYSTEM_PROMPTS[kind] : AUTHORING_PROMPTS.template,
          user: userPrompt,
          schema: geometry ? GEOMETRY_RESPONSE_SCHEMAS[kind] : JSON_OBJECT_FORMAT,
          temperature: geometry ? 0.2 : 0.7,
          maxTokens: MAX_TOKENS[kind],
          useCase: `creative_${kind}`,
        },
        jsonObjectOnly,
      );
      if (!out.ok) {
        const unreadable = geometry
          ? 'The geometry generator did not return a readable spec'
          : 'The generated template was not valid JSON';
        return c.json({ error: out.reason === 'unparseable' || out.reason === 'invalid' ? unreadable : GENERATOR_FAILURE[out.reason] }, 502);
      }

      if (kind === 'cad') {
        const spec = readCadSpec(out.value);
        if (!spec) return c.json({ error: 'The generated profile was not a drawable outline' }, 502);
        return c.json({
          ...common(out.model),
          content: dxfFromProfile(spec),
          validationDetail: `Closed ${spec.outline.length}-point DXF profile with ${spec.holes?.length ?? 0} bore(s), generated from the brief and evaluated on the server`,
          summary: spec.summary ?? null,
        });
      }
      if (kind === 'model3d') {
        const spec = readModel3dSpec(out.value);
        if (!spec) return c.json({ error: 'The generated model had no buildable solids' }, 502);
        const facets = facetCount(spec);
        if (!facets) return c.json({ error: 'The generated model tessellated to nothing' }, 502);
        return c.json({
          ...common(out.model),
          content: stlFromSolids(stem, spec),
          validationDetail: `Closed ${facets}-facet ASCII STL from ${spec.solids.length} primitive(s), generated from the brief and evaluated on the server`,
          summary: spec.summary ?? null,
        });
      }
      // A template is handed back as the JSON the model authored, re-serialised so
      // the file is exactly the object that was validated — never a fenced reply.
      const file = JSON.stringify(out.value, null, 2);
      if (file.length < 40) return c.json({ error: 'The generated deliverable was too short to be usable' }, 502);
      return c.json({
        ...common(out.model),
        content: file,
        validationDetail: `${target.outputFormat} deliverable generated from the brief and checked for shape (${file.length} characters)`,
        summary: null,
      });
    }

    // ── TEXT deliverables (a game, a résumé, a script): the reply IS the file ──
    let result;
    try {
      result = await ideProxy(c.env).complete({
        messages: [
          { role: 'system', content: AUTHORING_PROMPTS[kind] },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: MAX_TOKENS[kind],
        useCase: `creative_${kind}`,
      });
    } catch (error) {
      return failResponse(c, error, { source: SOURCE, operation: 'generate-creative-text' });
    }
    if (result.response.status >= 400) return c.json({ error: GENERATOR_FAILURE.gateway }, 502);
    const { content } = await readProxyChoice(result);
    if (!content.trim()) return c.json({ error: GENERATOR_FAILURE.empty }, 502);

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
    if (file.length < 40) return c.json({ error: 'The generated deliverable was too short to be usable' }, 502);

    return c.json({
      ...common(result.resolvedModel),
      content: kind === 'game' ? normalizeGameDocument(file, title) : file,
      validationDetail: kind === 'game'
        ? `Self-contained playable HTML game, checked for a script and for offline independence (${file.length} characters)`
        : `${target.outputFormat} deliverable generated from the brief and checked for shape (${file.length} characters)`,
      summary: null,
    });
  });

  return router;
}
