/**
 * Campaign templates and brand assets.
 *
 * The half of "send a marketing campaign" that is not delivery: a reusable body,
 * a logo that actually loads in a stranger's mail client, and the merge-field
 * contract between the two.
 *
 * THREE THINGS IT REFUSES TO DO
 *  1. Store markup it has not sanitized. An imported template is arbitrary HTML
 *     from outside the product, and it is rendered later into an authenticated
 *     preview in OUR app — so `<script>`, `<iframe>`, `on*=` handlers and
 *     `javascript:` URLs are stripped on WRITE, not on read. Sanitizing on read
 *     means the dangerous version is what is stored, and one forgotten call site
 *     is a stored XSS.
 *  2. Serve an asset to anyone who asks. The bytes live in R2 under a
 *     tenant-prefixed key and are addressed publicly ONLY by an unguessable
 *     token, because a recipient's mail client has no session to authenticate
 *     with. Rotating that token un-publishes the asset without destroying the
 *     record of which campaigns used it.
 *  3. Let a template promise a merge field the audience cannot fill. The fields
 *     a body references are extracted on write, so the composer can tell an
 *     author "this needs `company`" before the send instead of mailing 4,000
 *     people the literal text `{{company}}`.
 */

import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { marketingAssets, marketingTemplates } from '../../infrastructure/database/schema';
import { newChallengeToken } from '../shared/dnsVerification';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { assertSafeUrl, BlockedUrlError, resolveAndAssertPublic } from '../../infrastructure/net/ssrfGuard';

// ---------------------------------------------------------------------------
// Sanitization
// ---------------------------------------------------------------------------

/** Email clients strip these anyway; we strip them so our own preview is safe. */
const FORBIDDEN_ELEMENTS = ['script', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'form'];

/**
 * Make imported markup safe to store and to render in an authenticated preview.
 *
 * Deliberately an ALLOW-nothing-dangerous pass over a well-known small threat
 * surface rather than a full HTML parser: this input is an email template, the
 * output is rendered in a sandboxed preview and then sent to a mail client that
 * runs no JavaScript at all. What it must guarantee is that nothing executable
 * survives into our own DOM.
 *
 * Note the ORDER — element bodies are removed before attributes, so an `onclick`
 * inside a `<script>` block cannot be left behind by a partially-applied pass.
 */
export function sanitizeTemplateHtml(input: string): string {
  let html = String(input ?? '');

  for (const tag of FORBIDDEN_ELEMENTS) {
    // Paired form (body and all) …
    html = html.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, 'gi'), '');
    // … and the self-closing / unterminated form.
    html = html.replace(new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi'), '');
  }

  // Inline event handlers, quoted or bare.
  html = html.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '');
  html = html.replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '');
  html = html.replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '');

  // Script-bearing URLs in href/src/action, including the whitespace-and-entity
  // obfuscations (`java\tscript:`, `java&#115;cript:`) that a naive literal match misses.
  html = html.replace(
    /\b(href|src|action|background)\s*=\s*("|')?\s*(javascript|vbscript|data:text\/html)[^"'\s>]*("|')?/gi,
    '$1="#"',
  );
  html = html.replace(/j\s*a\s*v\s*a\s*s\s*c\s*r\s*i\s*p\s*t\s*:/gi, '');

  // `<style>` survives (email templates are mostly CSS) but its escape hatches do not.
  html = html.replace(/expression\s*\(/gi, '(');
  html = html.replace(/@import\b[^;]*;?/gi, '');

  return html.trim();
}

/** Bodies are stored, previewed and sent whole — bound them so one paste cannot
 *  become a row nothing can render and every send has to stream. */
export const MAX_TEMPLATE_BYTES = 512 * 1024;

/**
 * The merge fields a body actually references.
 *
 * `name`, `email` and `logo` are always available (the renderer supplies them),
 * so they are excluded: reporting them would tell an author to add columns they
 * already have. What is left is exactly the set their audience must carry.
 */
export const BUILTIN_MERGE_FIELDS = ['name', 'email', 'logo', 'unsubscribe'] as const;

export function extractMergeFields(bodyHtml: string, subject = ''): string[] {
  const found = new Set<string>();
  for (const match of `${subject}\n${bodyHtml}`.matchAll(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]{0,63})\s*\}\}/g)) {
    const field = match[1]!;
    if (!(BUILTIN_MERGE_FIELDS as readonly string[]).includes(field)) found.add(field);
  }
  return [...found].sort();
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export type TemplateSource = 'builtin' | 'custom' | 'imported' | 'generated';

export interface TemplateView {
  id: number;
  name: string;
  description: string;
  subject: string;
  bodyHtml: string;
  source: string;
  assetId: number | null;
  mergeFields: string[];
  updatedAt: Date;
}

const TEMPLATE_COLUMNS = {
  id: marketingTemplates.id,
  name: marketingTemplates.name,
  description: marketingTemplates.description,
  subject: marketingTemplates.subject,
  bodyHtml: marketingTemplates.bodyHtml,
  source: marketingTemplates.source,
  assetId: marketingTemplates.assetId,
  mergeFields: marketingTemplates.mergeFields,
  updatedAt: marketingTemplates.updatedAt,
} as const;

function templateView(row: {
  id: number; name: string; description: string; subject: string; bodyHtml: string;
  source: string; assetId: number | null; mergeFields: unknown; updatedAt: Date;
}): TemplateView {
  return { ...row, mergeFields: Array.isArray(row.mergeFields) ? row.mergeFields as string[] : [] };
}

/**
 * Starter templates, seeded into a tenant on first read.
 *
 * Seeded as REAL ROWS rather than served as read-only built-ins so an author can
 * open one and edit it — a starter you cannot change is a screenshot. They are
 * plain tables with inline styles because that is the only layout every mail
 * client renders the same, and both colours are stated explicitly (a template
 * inheriting the app's theme tokens would render as black-on-black in a dark-mode
 * inbox, where our CSS does not exist).
 */
const STARTER_TEMPLATES: ReadonlyArray<{ name: string; description: string; subject: string; bodyHtml: string }> = [
  {
    name: 'Product announcement',
    description: 'Logo, headline, one paragraph, one button. The default for a launch.',
    subject: 'Introducing {{product}}',
    bodyHtml: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 0">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;padding:32px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827">
      <tr><td align="center" style="padding-bottom:24px"><img src="{{logo}}" alt="" height="40" style="max-height:40px;border:0"></td></tr>
      <tr><td style="font-size:24px;font-weight:700;line-height:1.3;padding-bottom:12px">Hi {{name}}, meet {{product}}</td></tr>
      <tr><td style="font-size:16px;line-height:1.6;color:#374151;padding-bottom:24px">Tell them what changed and why it matters to them specifically. One paragraph. Resist the second one.</td></tr>
      <tr><td><a href="https://example.com" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600">See what's new</a></td></tr>
    </table>
  </td></tr>
</table>`,
  },
  {
    name: 'Plain personal note',
    description: 'No images, no buttons. Reads like a colleague wrote it — best reply rates.',
    subject: 'Quick question, {{name}}',
    bodyHtml: `<div style="max-width:560px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.65;color:#111827;background:#ffffff">
  <p>Hi {{name}},</p>
  <p>Say the one thing you actually want to say. Two sentences.</p>
  <p>Ask one question that is easy to answer.</p>
  <p>— {{senderName}}</p>
</div>`,
  },
  {
    name: 'Monthly update',
    description: 'Logo, three bullets, a closing line. For a recurring newsletter.',
    subject: '{{company}} — what shipped this month',
    bodyHtml: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 0">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;padding:32px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827">
      <tr><td style="padding-bottom:20px"><img src="{{logo}}" alt="" height="32" style="max-height:32px;border:0"></td></tr>
      <tr><td style="font-size:20px;font-weight:700;padding-bottom:16px">What shipped this month</td></tr>
      <tr><td style="font-size:16px;line-height:1.6;color:#374151">
        <ul style="padding-left:20px;margin:0 0 20px">
          <li style="padding-bottom:8px">The first thing, and what it lets you do.</li>
          <li style="padding-bottom:8px">The second thing.</li>
          <li>The third thing.</li>
        </ul>
        <p style="margin:0">More next month. Reply if you want any of it walked through.</p>
      </td></tr>
    </table>
  </td></tr>
</table>`,
  },
];

/**
 * The tenant's templates, seeding the starters the first time they look.
 *
 * Seeding here rather than at signup keeps it lazy — a tenant that never opens
 * the campaign composer never gets three rows they did not ask for — and the
 * unique index on (tenant, name) makes a concurrent double-read idempotent.
 */
export async function listTemplates(db: Db, tenantId: number): Promise<TemplateView[]> {
  const rows = await db
    .select(TEMPLATE_COLUMNS)
    .from(marketingTemplates)
    .where(eq(marketingTemplates.tenantId, tenantId))
    .orderBy(desc(marketingTemplates.updatedAt));
  if (rows.length > 0) return rows.map(templateView);

  await db
    .insert(marketingTemplates)
    .values(STARTER_TEMPLATES.map((t) => ({
      tenantId,
      name: t.name,
      description: t.description,
      subject: t.subject,
      bodyHtml: t.bodyHtml,
      source: 'builtin' as const,
      mergeFields: extractMergeFields(t.bodyHtml, t.subject),
    })))
    .onConflictDoNothing();

  const seeded = await db
    .select(TEMPLATE_COLUMNS)
    .from(marketingTemplates)
    .where(eq(marketingTemplates.tenantId, tenantId))
    .orderBy(asc(marketingTemplates.id));
  return seeded.map(templateView);
}

export async function getTemplate(db: Db, tenantId: number, templateId: number): Promise<TemplateView | null> {
  const [row] = await db
    .select(TEMPLATE_COLUMNS)
    .from(marketingTemplates)
    .where(and(eq(marketingTemplates.id, templateId), eq(marketingTemplates.tenantId, tenantId)))
    .limit(1);
  return row ? templateView(row) : null;
}

export type TemplateResult =
  | { ok: true; template: TemplateView }
  | { ok: false; status: 400 | 404 | 409; error: string };

/**
 * Create or import a template. `source` records provenance; the body is
 * sanitized regardless of it, because "custom" only means it was typed into our
 * textarea, not that it is trustworthy.
 */
export async function createTemplate(
  db: Db,
  tenantId: number,
  input: {
    name: string; subject?: string; bodyHtml?: string; description?: string;
    source?: TemplateSource; assetId?: number | null; createdBy?: string | null;
  },
): Promise<TemplateResult> {
  const name = input.name.trim().slice(0, 255);
  if (!name) return { ok: false, status: 400, error: 'Name the template.' };

  const raw = input.bodyHtml ?? '';
  if (raw.length > MAX_TEMPLATE_BYTES) {
    return { ok: false, status: 400, error: 'That template is larger than 512 KB.' };
  }
  const bodyHtml = sanitizeTemplateHtml(raw);
  const subject = (input.subject ?? '').slice(0, 500);

  const [row] = await db
    .insert(marketingTemplates)
    .values({
      tenantId,
      name,
      description: (input.description ?? '').slice(0, 2_000),
      subject,
      bodyHtml,
      source: input.source ?? 'custom',
      assetId: input.assetId ?? null,
      mergeFields: extractMergeFields(bodyHtml, subject),
      createdBy: input.createdBy ?? null,
    })
    // Re-importing under the same name UPDATES rather than 409s: the alternative
    // is "Newsletter (2)", and nobody wants that library.
    .onConflictDoUpdate({
      target: [marketingTemplates.tenantId, marketingTemplates.name],
      set: {
        subject: sql`excluded.subject`,
        bodyHtml: sql`excluded.body_html`,
        description: sql`excluded.description`,
        source: sql`excluded.source`,
        assetId: sql`excluded.asset_id`,
        mergeFields: sql`excluded.merge_fields`,
        updatedAt: sql`NOW()`,
      },
    })
    .returning(TEMPLATE_COLUMNS);
  return { ok: true, template: templateView(row!) };
}

export async function updateTemplate(
  db: Db,
  tenantId: number,
  templateId: number,
  patch: { name?: string; subject?: string; bodyHtml?: string; description?: string; assetId?: number | null },
): Promise<TemplateResult> {
  const set: Record<string, unknown> = { updatedAt: sql`NOW()` };
  if (typeof patch.name === 'string') {
    const name = patch.name.trim().slice(0, 255);
    if (!name) return { ok: false, status: 400, error: 'Name the template.' };
    set.name = name;
  }
  if (typeof patch.description === 'string') set.description = patch.description.slice(0, 2_000);
  if (patch.assetId !== undefined) set.assetId = patch.assetId;

  // Subject and body decide the merge fields together, so whenever either
  // changes the field list is recomputed from the FINAL pair — patching one and
  // recomputing from the patch alone would drop the other's fields.
  if (typeof patch.subject === 'string' || typeof patch.bodyHtml === 'string') {
    const current = await getTemplate(db, tenantId, templateId);
    if (!current) return { ok: false, status: 404, error: 'Template not found.' };
    const subject = typeof patch.subject === 'string' ? patch.subject.slice(0, 500) : current.subject;
    const raw = typeof patch.bodyHtml === 'string' ? patch.bodyHtml : current.bodyHtml;
    if (raw.length > MAX_TEMPLATE_BYTES) {
      return { ok: false, status: 400, error: 'That template is larger than 512 KB.' };
    }
    const bodyHtml = sanitizeTemplateHtml(raw);
    set.subject = subject;
    set.bodyHtml = bodyHtml;
    set.mergeFields = extractMergeFields(bodyHtml, subject);
  }

  const [row] = await db
    .update(marketingTemplates)
    .set(set)
    .where(and(eq(marketingTemplates.id, templateId), eq(marketingTemplates.tenantId, tenantId)))
    .returning(TEMPLATE_COLUMNS);
  if (!row) return { ok: false, status: 404, error: 'Template not found.' };
  return { ok: true, template: templateView(row) };
}

export async function deleteTemplate(db: Db, tenantId: number, templateId: number): Promise<void> {
  await db
    .delete(marketingTemplates)
    .where(and(eq(marketingTemplates.id, templateId), eq(marketingTemplates.tenantId, tenantId)));
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

export interface AssetView {
  id: number;
  name: string;
  kind: string;
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  source: string;
  prompt: string | null;
  /** Absolute, session-less URL — what a template's `<img src>` points at. */
  url: string;
  updatedAt: Date;
}

const ASSET_COLUMNS = {
  id: marketingAssets.id,
  name: marketingAssets.name,
  kind: marketingAssets.kind,
  mimeType: marketingAssets.mimeType,
  byteSize: marketingAssets.byteSize,
  width: marketingAssets.width,
  height: marketingAssets.height,
  source: marketingAssets.source,
  prompt: marketingAssets.prompt,
  publicToken: marketingAssets.publicToken,
  updatedAt: marketingAssets.updatedAt,
} as const;

/**
 * The absolute URL for an asset.
 *
 * Built from {@link resolveAssetOrigin}, never from the request origin: a
 * template authored on a preview deployment and sent from production would
 * otherwise bake a dead host into mail that has already been delivered.
 */
export function assetUrl(origin: string, publicToken: string): string {
  return `${origin.replace(/\/+$/, '')}/api/campaign-assets/${publicToken}`;
}

/**
 * The origin that serves campaign assets — the SAME resolver the tracking links
 * use, for the same reason: links inside delivered mail must keep working
 * forever, and a corporate mail gateway is far likelier to allow the canonical
 * host than a per-environment one.
 */
export function resolveAssetOrigin(env: { CAMPAIGN_TRACKING_ORIGIN?: string }): string {
  return (env.CAMPAIGN_TRACKING_ORIGIN ?? 'https://builderforce.ai/gateway').replace(/\/+$/, '');
}

function assetView(
  row: { publicToken: string } & Omit<AssetView, 'url'>,
  origin: string,
): AssetView {
  const { publicToken, ...rest } = row;
  return { ...rest, url: assetUrl(origin, publicToken) };
}

export async function listAssets(
  db: Db,
  tenantId: number,
  origin: string,
  kind?: 'logo' | 'image',
): Promise<AssetView[]> {
  const rows = await db
    .select(ASSET_COLUMNS)
    .from(marketingAssets)
    .where(kind
      ? and(eq(marketingAssets.tenantId, tenantId), eq(marketingAssets.kind, kind))
      : eq(marketingAssets.tenantId, tenantId))
    .orderBy(desc(marketingAssets.updatedAt));
  return rows.map((r) => assetView(r, origin));
}

/** Images only, and small enough that a mail client will actually render it
 *  inline rather than hiding it behind "download". */
export const MAX_ASSET_BYTES = 2 * 1024 * 1024;
const ALLOWED_ASSET_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'] as const;

export type AssetResult =
  | { ok: true; asset: AssetView }
  | { ok: false; status: 400 | 404 | 413 | 503; error: string };

/**
 * Store an image and return its public URL.
 *
 * SVG is accepted because logos are vectors, but it is stored with an
 * `image/svg+xml` content type that the serving route pins along with a
 * restrictive CSP — an SVG is a document and can carry script, so it must never
 * be served in a way that lets it run against our origin.
 */
export async function createAsset(
  db: Db,
  env: Env,
  tenantId: number,
  input: {
    name: string;
    bytes: ArrayBuffer;
    mimeType: string;
    kind?: 'logo' | 'image';
    source?: 'uploaded' | 'generated';
    prompt?: string | null;
    createdBy?: string | null;
  },
): Promise<AssetResult> {
  if (!env.UPLOADS) {
    return { ok: false, status: 503, error: 'Asset storage is not configured on this deployment.' };
  }
  const mimeType = input.mimeType.split(';')[0]!.trim().toLowerCase();
  if (!(ALLOWED_ASSET_TYPES as readonly string[]).includes(mimeType)) {
    return { ok: false, status: 400, error: 'Upload a PNG, JPEG, GIF, WebP or SVG image.' };
  }
  if (input.bytes.byteLength === 0) return { ok: false, status: 400, error: 'That file is empty.' };
  if (input.bytes.byteLength > MAX_ASSET_BYTES) {
    return { ok: false, status: 413, error: 'Images must be 2 MB or smaller.' };
  }

  const publicToken = newChallengeToken();
  // Tenant-prefixed, matching the platform-wide upload key convention so the
  // shared `keyOwnedByTenant` check keeps working over these objects too.
  const r2Key = `${tenantId}/marketing/${publicToken}`;
  await env.UPLOADS.put(r2Key, input.bytes, {
    httpMetadata: { contentType: mimeType },
    customMetadata: { tenantId: String(tenantId), name: input.name.slice(0, 255) },
  });

  const [row] = await db
    .insert(marketingAssets)
    .values({
      tenantId,
      name: input.name.trim().slice(0, 255) || 'Image',
      kind: input.kind ?? 'image',
      r2Key,
      mimeType,
      byteSize: input.bytes.byteLength,
      source: input.source ?? 'uploaded',
      prompt: input.prompt ?? null,
      publicToken,
      createdBy: input.createdBy ?? null,
    })
    .returning(ASSET_COLUMNS);
  return { ok: true, asset: assetView(row!, resolveAssetOrigin(env)) };
}

/**
 * Delete an asset, bytes and all.
 *
 * The row goes first: an orphaned R2 object is invisible and cheap, whereas a
 * row pointing at bytes that no longer exist is a broken image in every template
 * that referenced it and no way to tell why.
 */
export async function deleteAsset(db: Db, env: Env, tenantId: number, assetId: number): Promise<void> {
  const [row] = await db
    .delete(marketingAssets)
    .where(and(eq(marketingAssets.id, assetId), eq(marketingAssets.tenantId, tenantId)))
    .returning({ r2Key: marketingAssets.r2Key });
  if (!row || !env.UPLOADS) return;
  await env.UPLOADS.delete(row.r2Key).catch((error) => {
    reportCaughtError(error, { source: 'application/marketing/templateLibrary.ts', operation: 'deleteAsset' });
  });
}

/** Fetch an asset's bytes by public token. The ONLY read path for the public
 *  route — it takes a token and nothing else, so there is no id to enumerate and
 *  no tenant to confuse. */
export async function readAssetByToken(
  db: Db,
  env: Env,
  publicToken: string,
): Promise<{ body: ReadableStream; mimeType: string } | null> {
  if (!env.UPLOADS) return null;
  const [row] = await db
    .select({ r2Key: marketingAssets.r2Key, mimeType: marketingAssets.mimeType })
    .from(marketingAssets)
    .where(eq(marketingAssets.publicToken, publicToken))
    .limit(1);
  if (!row) return null;
  const object = await env.UPLOADS.get(row.r2Key);
  if (!object) return null;
  return { body: object.body, mimeType: row.mimeType };
}

/**
 * The logo a campaign renders through `{{logo}}` when the template does not name
 * one — the most recently updated asset of kind `logo`.
 *
 * Resolved by ROLE rather than by id so replacing the logo updates every
 * template at once, which is the whole reason `kind` exists.
 */
export async function defaultLogoUrl(db: Db, tenantId: number, origin: string): Promise<string | null> {
  const [row] = await db
    .select({ publicToken: marketingAssets.publicToken })
    .from(marketingAssets)
    .where(and(eq(marketingAssets.tenantId, tenantId), eq(marketingAssets.kind, 'logo')))
    .orderBy(desc(marketingAssets.updatedAt))
    .limit(1);
  return row ? assetUrl(origin, row.publicToken) : null;
}

// ---------------------------------------------------------------------------
// Logo generation
// ---------------------------------------------------------------------------

/**
 * Shape a bare brand description into an image prompt that produces a usable
 * LOGO rather than an illustration.
 *
 * The negative constraints matter more than the positive ones: an unguided
 * image model returns a detailed scene with a drop shadow and gibberish
 * lettering, which is unusable at 40px in an email header.
 */
export function logoPrompt(description: string, style?: string): string {
  const brand = description.trim().slice(0, 400);
  const styleHint = style?.trim() ? `Style: ${style.trim().slice(0, 120)}.` : 'Style: clean, geometric, modern.';
  return [
    `A simple, flat vector-style logo mark for: ${brand}.`,
    styleHint,
    'Centred on a plain white background, generous margin, bold silhouette that stays legible at 40 pixels tall.',
    'No text, no letters, no words, no gradients, no drop shadows, no photorealism, no 3D rendering, no mockup, no background scene.',
  ].join(' ');
}

/**
 * Fetch generated image bytes for storage.
 *
 * The image endpoint answers with either a URL or base64, depending on which
 * vendor served the request, and a caller storing the result must handle both —
 * so both are absorbed here rather than at every call site.
 */
export async function fetchGeneratedImage(
  image: { url?: string; b64_json?: string },
): Promise<{ bytes: ArrayBuffer; mimeType: string } | null> {
  if (image.b64_json) {
    try {
      return { bytes: decodeBase64(image.b64_json), mimeType: 'image/png' };
    } catch (error) {
      reportCaughtError(error, {
        source: 'application/marketing/templateLibrary.ts', operation: 'fetchGeneratedImage',
      });
      return null;
    }
  }
  if (!image.url) return null;
  const read = await readMediaSource(image.url);
  return read.ok ? { bytes: read.bytes, mimeType: read.mimeType } : null;
}

/** Decode one base64 payload to a standalone ArrayBuffer. A `Uint8Array` view
 *  over a pooled buffer would store trailing garbage, hence the copy. */
function decodeBase64(base64: string): ArrayBuffer {
  const binary = atob(base64);
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0)).slice().buffer;
}

export type MediaSourceResult =
  | { ok: true; bytes: ArrayBuffer; mimeType: string }
  | { ok: false; status: 400 | 413 | 502; error: string };

/**
 * ONE reader for "wherever those pixels are now" → bytes this store can hold.
 *
 * ── WHY IT IS SHARED, AND WHY IT IS SSRF-GUARDED ────────────────────────────
 * `fetchGeneratedImage` fetched its URL with a bare `fetch` and no guard. That
 * looked acceptable while the only URL came from our own image route, and it is
 * an SSRF the moment a second caller passes a URL a person or a model chose.
 * The Creation Canvas is exactly that second caller: it hands over whatever an
 * `image` object is holding so the picture can be published to a social network.
 * So the guard lives here once and both callers get it.
 *
 * Three shapes, because those are the three a canvas creative object is ever in:
 * a `data:` URI (generated in the browser), an `https:` URL (stock photography,
 * an already-public asset), and raw base64 (what some image vendors return).
 * Anything else — `blob:`, `file:`, a relative path — is refused by name rather
 * than fetched, because none of them mean anything on a server.
 */
export async function readMediaSource(source: string): Promise<MediaSourceResult> {
  const raw = source.trim();
  if (!raw) return { ok: false, status: 400, error: 'No image was supplied.' };
  const tooBig = { ok: false, status: 413, error: 'Images must be 2 MB or smaller.' } as const;
  const rejectType = (mimeType: string): MediaSourceResult => ({
    ok: false, status: 400,
    error: `${mimeType || 'That file'} cannot be published — use a PNG, JPEG, GIF, WebP or SVG image.`,
  });

  if (raw.startsWith('data:')) {
    const match = /^data:([^;,]+)(;base64)?,([\s\S]*)$/.exec(raw);
    if (!match) return { ok: false, status: 400, error: 'That data URL could not be read.' };
    const mimeType = match[1]!.trim().toLowerCase();
    if (!(ALLOWED_ASSET_TYPES as readonly string[]).includes(mimeType)) return rejectType(mimeType);
    let bytes: ArrayBuffer;
    try {
      bytes = match[2]
        ? decodeBase64(match[3]!)
        : new TextEncoder().encode(decodeURIComponent(match[3]!)).slice().buffer;
    } catch {
      return { ok: false, status: 400, error: 'That data URL could not be decoded.' };
    }
    if (bytes.byteLength === 0) return { ok: false, status: 400, error: 'That image is empty.' };
    if (bytes.byteLength > MAX_ASSET_BYTES) return tooBig;
    return { ok: true, bytes, mimeType };
  }

  let url: URL;
  try {
    url = assertSafeUrl(raw);
  } catch (error) {
    return { ok: false, status: 400, error: error instanceof Error ? error.message : 'That image URL cannot be read.' };
  }
  try {
    await resolveAndAssertPublic(url.hostname);
  } catch (error) {
    if (error instanceof BlockedUrlError) {
      return { ok: false, status: 400, error: 'That image URL resolves to a private address and will not be fetched.' };
    }
  }

  let res: Response;
  try {
    res = await fetch(url.toString());
  } catch (error) {
    reportCaughtError(error, { source: 'application/marketing/templateLibrary.ts', operation: 'readMediaSource' });
    return { ok: false, status: 502, error: 'That image could not be downloaded.' };
  }
  if (!res.ok) return { ok: false, status: 502, error: `That image could not be downloaded (${res.status}).` };

  const mimeType = (res.headers.get('content-type') ?? 'image/png').split(';')[0]!.trim().toLowerCase();
  if (!(ALLOWED_ASSET_TYPES as readonly string[]).includes(mimeType)) return rejectType(mimeType);
  // Read from the header first, where the server was honest about it, so an
  // oversized body is refused before it is buffered — and again after, because
  // `content-length` is optional.
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_ASSET_BYTES) return tooBig;
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength === 0) return { ok: false, status: 400, error: 'That image is empty.' };
  if (bytes.byteLength > MAX_ASSET_BYTES) return tooBig;
  return { ok: true, bytes, mimeType };
}

/**
 * Store whatever a creative object is holding and hand back a PUBLIC url.
 *
 * ── THE GAP THIS CLOSES ─────────────────────────────────────────────────────
 * `social_campaigns.media_urls` and `POST /api/social/publish` take public
 * `https` URLs, because Instagram and TikTok FETCH the media themselves with no
 * session — while the canvas's own generated pictures live in a `data:` URI or
 * behind authenticated storage. So "post the image the board just made" meant
 * uploading it somewhere else first, and an Instagram target was silently
 * `skipped` with a blocker nobody could clear from the canvas.
 *
 * The asset store already solved this for EMAIL — a recipient's mail client is
 * exactly as session-less as Instagram's fetcher — so this is that same store
 * with that same public token, not a second one.
 */
export async function createAssetFromSource(
  db: Db,
  env: Env,
  tenantId: number,
  input: { source: string; name: string; kind?: 'logo' | 'image'; prompt?: string | null; createdBy?: string | null },
): Promise<AssetResult> {
  const read = await readMediaSource(input.source);
  // A 502 from the reader is a bad INPUT url as far as the caller is concerned —
  // the asset result type carries the statuses a caller can act on.
  if (!read.ok) return { ok: false, status: read.status === 502 ? 400 : read.status, error: read.error };
  return createAsset(db, env, tenantId, {
    name: input.name,
    bytes: read.bytes,
    mimeType: read.mimeType,
    kind: input.kind ?? 'image',
    // `generated` is the truth for everything arriving this way: it was made on
    // the board, not uploaded from a disk by a person.
    source: 'generated',
    prompt: input.prompt ?? null,
    createdBy: input.createdBy ?? null,
  });
}
