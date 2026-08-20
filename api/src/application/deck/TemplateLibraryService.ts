import { reportCaughtError } from '../observability/caughtErrorReporter';
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
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { unzipSync, strFromU8 } from 'fflate';
import type { DeckTemplateRecord, TokenManifest, DeckArchetype } from './types';
import { chartTokenOf } from './chartRewriter';

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
    // Chart parts are scanned as well as slides. A `{{chart:…}}` marker is
    // authored in the CHART'S OWN TITLE — nowhere in the slide XML — so scanning
    // slides alone derived a manifest with no chart binding in it, and the chart
    // then kept the numbers it was uploaded with while every text token beside it
    // went live. The token that binds a chart has to be findable where it lives.
    if (part && /^ppt\/(slides|charts)\/[^/]*\.xml$/.test(path)) {
      const xml = strFromU8(part);
      for (const m of xml.matchAll(/\{\{([^{}]+)\}\}/g)) { const t = m[1]; if (t) tokens.add(t.trim()); }
      // …and PowerPoint may have split the marker across runs, in which case the
      // raw part never matches. Re-read the merged title text for chart parts.
      if (/^ppt\/charts\//.test(path)) {
        const merged = chartTokenOf(xml);
        if (merged) tokens.add(`chart:${merged}`);
      }
    }
  }

  const bindings = Array.from(tokens).map((token) => {
    if (token.startsWith('chart:')) {
      const name = token.slice('chart:'.length);
      const known = KNOWN_CHART_BINDINGS[token];
      return {
        token,
        bindingKey: known?.bindingKey ?? KNOWN_TOKEN_BINDINGS[`table:${name}`] ?? name,
        kind: 'chart' as const,
        fallback: known?.label ?? name,
        ...(known?.chartSeries ? { chartSeries: known.chartSeries } : {}),
      };
    }
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

/**
 * Chart tokens whose plotted columns we can name without asking.
 *
 * A chart binding reads the same `[label, …figures]` matrices the tables read, so
 * the only thing it needs beyond a table binding is WHICH columns to plot and
 * what to call them. Guessing that from column position alone would legend a
 * board chart "Series 1" / "Series 2", so the shapes the platform assembles say
 * it outright; an unrecognised token still resolves positionally.
 */
const KNOWN_CHART_BINDINGS: Record<string, { bindingKey: string; label: string; chartSeries?: Array<{ column: number; name: string }> }> = {
  'chart:financials': {
    bindingKey: 'investment.financialsByCategory',
    label: 'Spend by category',
    chartSeries: [{ column: 1, name: 'Actual' }, { column: 2, name: 'Plan' }],
  },
  'chart:defectAging': {
    bindingKey: 'quality.defectAging',
    label: 'Open defects by age',
    chartSeries: [{ column: 1, name: 'Open' }],
  },
  'chart:headcount': {
    bindingKey: 'people.waterfall',
    label: 'Hires vs departures',
    chartSeries: [{ column: 1, name: 'Hires' }, { column: 2, name: 'Departures' }],
  },
  'chart:aiAdoption': {
    bindingKey: 'ai.adoption',
    label: 'AI tool adoption',
    chartSeries: [{ column: 1, name: 'Adoption %' }],
  },
  'chart:fte': {
    bindingKey: 'investment.fteByCategory',
    label: 'FTE by category',
    chartSeries: [{ column: 1, name: 'FTE' }],
  },
};

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
  await db.update(deckTemplates).set({ r2Key: destKey }).where(scopedToTenant(deckTemplates, tenantId, eq(deckTemplates.id, rec.id)));

  await invalidateCached(env, cacheKey(tenantId));
  return { ...rec, r2Key: destKey };
}

/** Delete a tenant template (built-ins are immutable). */
export async function deleteTemplate(db: Db, env: Env, tenantId: number, id: string): Promise<boolean> {
  const rows = (await db.delete(deckTemplates)
    .where(and(eq(deckTemplates.id, id), eq(deckTemplates.tenantId, tenantId)))
    .returning({ id: deckTemplates.id, r2Key: deckTemplates.r2Key })) as Array<{ id: string; r2Key: string | null }>;
  if (!rows[0]) return false;
  if (rows[0].r2Key && env.UPLOADS) await env.UPLOADS.delete(rows[0].r2Key).catch((error) => { /* best-effort */ 
    reportCaughtError(error, { source: "application/deck/TemplateLibraryService.ts", operation: "deleteTemplate" });
  });
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
