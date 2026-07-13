/**
 * TemplateLibraryService — the deck-template catalog. Template binaries live in
 * the UPLOADS R2 bucket under `templates/{tenantId}/{id}.pptx`; metadata + the
 * {{token}} manifest live in deck_templates (built-ins at tenant_id=0). Reads are
 * cached; writes invalidate.
 */

import { and, eq, inArray, or } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { deckTemplates } from '../../infrastructure/database/schema';
import { unzipSync, strFromU8 } from 'fflate';
import type { DeckTemplateRecord, TokenManifest, DeckArchetype } from './types';

const BUILTIN_TENANT = 0;

function cacheKey(tenantId: number): string { return `deck:templates:t:${tenantId}`; }

function toRecord(row: Record<string, unknown>): DeckTemplateRecord {
  const manifest = (row.manifestJson ?? { version: 1, bindings: [] }) as TokenManifest;
  return {
    id: String(row.id),
    tenantId: Number(row.tenantId),
    name: String(row.name),
    description: (row.description as string | null) ?? null,
    archetype: String(row.archetype) as DeckArchetype,
    r2Key: (row.r2Key as string | null) ?? null,
    manifest: { version: manifest.version ?? 1, bindings: manifest.bindings ?? [] },
    isBuiltin: Boolean(row.isBuiltin),
  };
}

/** List built-in templates + this tenant's own. */
export async function listTemplates(db: Db, env: Env, tenantId: number): Promise<DeckTemplateRecord[]> {
  return getOrSetCached(env, cacheKey(tenantId), async () => {
    const rows = await db.select().from(deckTemplates)
      .where(or(eq(deckTemplates.tenantId, BUILTIN_TENANT), eq(deckTemplates.tenantId, tenantId)));
    return (rows as Array<Record<string, unknown>>).map(toRecord);
  }, { kvTtlSeconds: 300 });
}

/** Get one template visible to this tenant (own or built-in). */
export async function getTemplate(db: Db, tenantId: number, id: string): Promise<DeckTemplateRecord | null> {
  const rows = await db.select().from(deckTemplates)
    .where(and(eq(deckTemplates.id, id), inArray(deckTemplates.tenantId, [BUILTIN_TENANT, tenantId])))
    .limit(1);
  return rows[0] ? toRecord(rows[0] as Record<string, unknown>) : null;
}

/** The default built-in board template (used when no templateId is supplied). */
export async function getDefaultBoardTemplate(db: Db, tenantId: number): Promise<DeckTemplateRecord | null> {
  const rows = await db.select().from(deckTemplates)
    .where(and(eq(deckTemplates.tenantId, BUILTIN_TENANT), eq(deckTemplates.archetype, 'board')))
    .limit(1);
  return rows[0] ? toRecord(rows[0] as Record<string, unknown>) : await getTemplate(db, tenantId, '');
}

/** Scan a .pptx for {{tokens}} and auto-build a manifest, mapping each token to a
 *  DeckData dot-path when the token name matches a known leaf (else the token maps
 *  to itself → resolves to a fallback + warning, surfacing the unbound token). */
export function deriveManifest(templateBytes: Uint8Array): TokenManifest {
  const files = unzipSync(templateBytes);
  const tokens = new Set<string>();
  for (const path of Object.keys(files)) {
    const part = files[path];
    if (part && /^ppt\/slides\/.*\.xml$/.test(path)) {
      const xml = strFromU8(part);
      for (const m of xml.matchAll(/\{\{([^{}]+)\}\}/g)) { const t = m[1]; if (t) tokens.add(t.trim()); }
    }
  }
  const bindings = Array.from(tokens).map((token) => {
    const isTable = token.startsWith('table:');
    const guess = KNOWN_TOKEN_BINDINGS[token];
    return {
      token,
      bindingKey: guess ?? (isTable ? `${token.slice('table:'.length)}.rows` : token),
      kind: (isTable ? 'table' : 'text') as 'table' | 'text',
    };
  });
  return { version: 1, bindings };
}

/** Best-effort token→bindingKey guesses for common board tokens in custom uploads. */
const KNOWN_TOKEN_BINDINGS: Record<string, string> = {
  quarter: 'meta.quarter',
  uptime: 'quality.uptimePct',
  mttr: 'quality.mttrHours',
  attrition: 'people.attritionRatePct',
  dev_satisfaction: 'people.devSatisfactionScore',
  ai_productivity: 'ai.productivityScore',
  lead_time: 'delivery.leadTimeHours',
  deploy_freq: 'delivery.deploymentFrequencyPerDay',
  change_failure: 'delivery.changeFailureRatePct',
  prs_merged: 'delivery.totalPrsMerged',
  rd_to_revenue: 'investment.rdToRevenuePct',
  'table:deliverables': 'deliverables.rows',
  'table:initiatives': 'investment.initiatives',
  'table:openPositions': 'people.openPositions',
  'table:financials': 'investment.financialsByCategory',
  'table:aiPrograms': 'ai.programs',
};

/** Promote an uploaded .pptx (already in R2 at `sourceKey`) into a tenant template:
 *  copy it to the templates path, derive the manifest, persist the row. */
export async function createTemplateFromUpload(
  db: Db,
  env: Env,
  tenantId: number,
  userId: string | null,
  args: { name: string; description?: string; sourceKey: string; archetype?: DeckArchetype },
): Promise<DeckTemplateRecord> {
  const bucket = env.UPLOADS;
  if (!bucket) throw new Error('File storage not configured');
  const obj = await bucket.get(args.sourceKey);
  if (!obj) throw new Error('Uploaded template not found');
  const bytes = new Uint8Array(await obj.arrayBuffer());

  const manifest = deriveManifest(bytes);
  const rows = (await db.insert(deckTemplates).values({
    tenantId,
    name: args.name,
    description: args.description ?? null,
    archetype: args.archetype ?? 'custom',
    manifestJson: manifest,
    isBuiltin: false,
    createdBy: userId,
  }).returning()) as Array<Record<string, unknown>>;
  if (!rows[0]) throw new Error('Failed to persist template');
  const rec = toRecord(rows[0]);

  const destKey = `templates/${tenantId}/${rec.id}.pptx`;
  await bucket.put(destKey, bytes, {
    httpMetadata: { contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
    customMetadata: { tenantId: String(tenantId), templateId: rec.id },
  });
  await db.update(deckTemplates).set({ r2Key: destKey }).where(eq(deckTemplates.id, rec.id));

  await invalidateCached(env, cacheKey(tenantId));
  return { ...rec, r2Key: destKey };
}

/** Delete a tenant template (built-ins are immutable). */
export async function deleteTemplate(db: Db, env: Env, tenantId: number, id: string): Promise<boolean> {
  const rows = (await db.delete(deckTemplates)
    .where(and(eq(deckTemplates.id, id), eq(deckTemplates.tenantId, tenantId)))
    .returning({ id: deckTemplates.id, r2Key: deckTemplates.r2Key })) as Array<{ id: string; r2Key: string | null }>;
  if (!rows[0]) return false;
  if (rows[0].r2Key && env.UPLOADS) await env.UPLOADS.delete(rows[0].r2Key).catch(() => { /* best-effort */ });
  await invalidateCached(env, cacheKey(tenantId));
  return true;
}

/** Fetch a template's .pptx bytes from R2 (for in-place fill). */
export async function loadTemplateBytes(env: Env, r2Key: string): Promise<Uint8Array | null> {
  const bucket = env.UPLOADS;
  if (!bucket) return null;
  const obj = await bucket.get(r2Key);
  if (!obj) return null;
  return new Uint8Array(await obj.arrayBuffer());
}
