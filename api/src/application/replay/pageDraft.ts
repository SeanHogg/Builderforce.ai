/**
 * The page half of a prescription draft (PRD 33 §5.2 "Render", D13): a page-review
 * finding is drafted from the CAPTURE — its facts and its rect map — rather than from
 * recordings, and the drafter also asks for the change as a `VisualPatch` (ux /
 * content / accessibility), a SERP before/after (title and meta description) or the
 * JSON-LD to add (structured data).
 *
 * `prescriptionDraft.ts` orchestrates (one budget, one daily cap, one condense
 * primitive); this module only builds the numbered transcript and reads the extra
 * lines back. Everything the model proposes is validated before it is stored: a patch
 * must pass `validateVisualPatch` against the capture's rect map and the page's own
 * palette, or the fix is stored without a visual and the reason is logged.
 */

import { and, eq } from 'drizzle-orm';
import { validateVisualPatch, type PageRect, type ReplayVisualDto } from '@builderforce/interaction-contract';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { replayPageCaptures } from '../../infrastructure/database/schema';
import { asJsonObject } from '../../domain/shared/json';
import { VISUAL_AREAS } from '../../domain/replay/prescriptions/pageRules';
import { readRectMap, toCaptureDto, type CaptureRow } from './pageCaptureStore';
import { buildVisual, jsonLdDiff, serpBefore } from './pageVisual';
import { siteOrigin } from './pageCapture';
import type { PrescriptionRow } from './prescriptionReads';
import type { ReplaySiteRecord } from './replaySites';

const ELEMENTS_PER_DRAFT = 40;
const SERP_RULES = new Set(['seo_title_length', 'seo_missing_meta_description', 'seo_low_ctr_high_impressions']);
const JSONLD_RULES = new Set(['seo_no_structured_data']);

export const PAGE_DRAFT_HEADER = 'A proved finding on one web page, the page\'s measured facts and its element map. Each line is numbered #n.';

/** What the page drafter carries between the transcript and the reply. */
export interface PageDraftContext {
  capture: CaptureRow;
  rectMap: PageRect[];
  palette: string[];
  origin: string | null;
  url: string;
}

/** The extra reply lines a page finding asks for, by rule. */
export function pageShapeExtra(row: Pick<PrescriptionRow, 'ruleId' | 'area'>): string {
  if (SERP_RULES.has(row.ruleId)) {
    return '\nSERP: one JSON object {"title":"<the new page title, ≤ 60 characters>","description":"<the new meta description, ≤ 155 characters>"}';
  }
  if (JSONLD_RULES.has(row.ruleId)) {
    return '\nJSONLD: one schema.org JSON-LD object for this page (Organization, Product, Article, FAQPage …), built only from facts in the lines above.';
  }
  if (!VISUAL_AREAS.has(row.area)) return '';
  return '\nVISUAL: one JSON object {"ops":[...]} — the change as edits to elements of the map. Ops: '
    + '{"op":"setText","selector","text"} · {"op":"setAttr","selector","name":"alt|aria-label|title|placeholder|href","value"} · '
    + '{"op":"setStyle","selector","property","value"} (layout, spacing, size, visibility; colours only from the palette line) · '
    + '{"op":"moveBefore"|"moveAfter","selector","anchor"} · {"op":"insertAfter","selector","html"} (short HTML: p, span, strong, em, ul, li) · {"op":"hide","selector"}. '
    + 'Selectors are copied verbatim from element lines.';
}

/** The numbered transcript of one page finding, or null when its capture is gone. */
export async function buildPageDraftTranscript(
  env: Env,
  db: Db,
  site: ReplaySiteRecord,
  row: Pick<PrescriptionRow, 'ruleId' | 'pagePath' | 'finding' | 'impact' | 'captureId'>,
): Promise<{ transcript: string; lines: number; selectors: Set<string>; page: PageDraftContext } | null> {
  if (!row.captureId) return null;
  const [capture] = await db
    .select()
    .from(replayPageCaptures)
    .where(and(eq(replayPageCaptures.siteId, site.id), eq(replayPageCaptures.id, row.captureId)))
    .limit(1);
  if (!capture) return null;
  const dto = toCaptureDto(capture);
  const rectMap = await readRectMap(env, capture);
  const origin = await siteOrigin(env, db, site).catch(() => null);
  const lines: string[] = [];
  const add = (text: string) => lines.push(`[#${lines.length}] ${text.replace(/[\r\n]+/g, ' ')}`);

  const params = Object.entries(asJsonObject<{ params?: Record<string, unknown> }>(row.finding)?.params ?? {})
    .map(([k, v]) => `${k}=${String(v)}`).join(' · ');
  add(`finding ${row.ruleId} on ${row.pagePath ?? capture.path} (${capture.deviceClass}): ${params}`);
  const impact = asJsonObject<Record<string, unknown>>(row.impact);
  if (impact && (impact.low !== undefined || impact.high !== undefined)) {
    add(`impact over ${String(impact.horizonDays ?? 30)} days: ${String(impact.low ?? '?')} to ${String(impact.high ?? '?')} ${String(impact.unit ?? 'conversions')}`);
  }
  const seo = dto.seo;
  if (seo) {
    add(`title "${(seo.title ?? '').slice(0, 120)}" (${seo.titleLength} chars) · meta description ${seo.metaDescription ? `"${seo.metaDescription.slice(0, 200)}"` : 'none'}`);
    add(`h1 count ${seo.h1Count} · structured data ${seo.structuredDataTypes.join(', ') || 'none'} · words ${seo.wordCount}`);
  }
  const content = dto.content;
  if (content) {
    // Above-the-fold text was read with masked and blocked regions excluded.
    add(`above the fold: "${content.aboveFoldText.slice(0, 300)}" · value proposition ${content.valuePropAboveFold ? 'present' : 'missing'}`);
    add(`calls to action: ${content.ctaLabels.slice(0, 8).map((l) => `"${l}"`).join(', ') || 'none'} · trust signals ${content.trustSignals.join(', ') || 'none'} · reading grade ${content.readabilityGrade ?? '?'}`);
  }
  if (dto.labPerf) add(`lab load: LCP ${dto.labPerf.lcpMs ?? '?'} ms · CLS ${dto.labPerf.cls ?? '?'} · weight ${Math.round(dto.labPerf.pageWeightBytes / 1024)} KB`);
  if (dto.a11y) add(`accessibility: ${dto.a11y.contrastFailures.length} contrast failures · ${dto.a11y.smallTapTargets.length} small tap targets · ${dto.a11y.missingLabels.length} unlabelled inputs`);
  const palette = content?.palette ?? [];
  add(`palette: ${palette.join(', ') || 'unknown'}`);

  const selectors = new Set<string>();
  for (const r of rectMap.slice(0, ELEMENTS_PER_DRAFT)) {
    selectors.add(r.selector);
    add(`element ${r.selector} · ${r.role}${r.label ? ` "${r.label.replace(/"/g, "'").slice(0, 80)}"` : ''}`);
  }
  return {
    transcript: lines.join('\n'),
    lines: lines.length,
    selectors,
    page: { capture, rectMap, palette, origin, url: `${origin ?? ''}${capture.path}` },
  };
}

function jsonField(text: string, name: string): unknown {
  const match = new RegExp(`^\\s*${name}\\s*:\\s*(.+)$`, 'im').exec(text);
  if (!match) return null;
  try {
    return JSON.parse(match[1]!.trim());
  } catch {
    return null;
  }
}

/**
 * The visual a page draft's reply carries, validated; null (with the reason) when it
 * carries none or it fails validation.
 */
export function pageVisualFromDraft(
  text: string,
  row: Pick<PrescriptionRow, 'ruleId' | 'area'>,
  page: PageDraftContext,
): { visual: ReplayVisualDto | null; rejected: string | null } {
  const seo = toCaptureDto(page.capture).seo;
  if (SERP_RULES.has(row.ruleId)) {
    const serp = asJsonObject<{ title?: unknown; description?: unknown }>(jsonField(text, 'SERP'));
    if (!serp || typeof serp.title !== 'string' || !serp.title.trim()) return { visual: null, rejected: 'no SERP proposal' };
    const before = serpBefore(seo, page.url);
    const after = {
      title: serp.title.trim().slice(0, 70),
      url: page.url,
      description: typeof serp.description === 'string' ? serp.description.trim().slice(0, 170) : before.description,
    };
    return { visual: buildVisual({ ops: [] }, { serp: { before, after } }), rejected: null };
  }
  if (JSONLD_RULES.has(row.ruleId)) {
    const jsonLd = asJsonObject(jsonField(text, 'JSONLD'));
    if (!jsonLd) return { visual: null, rejected: 'no JSON-LD proposal' };
    return { visual: buildVisual({ ops: [] }, { jsonLdDiff: jsonLdDiff(seo?.structuredDataTypes ?? [], jsonLd) }), rejected: null };
  }
  if (!VISUAL_AREAS.has(row.area)) return { visual: null, rejected: null };
  const patch = jsonField(text, 'VISUAL');
  if (patch === null) return { visual: null, rejected: 'no patch proposed' };
  const verdict = validateVisualPatch(patch, page.rectMap, page.palette, { origin: page.origin });
  if (!verdict.ok) return { visual: null, rejected: verdict.reason };
  return { visual: buildVisual(patch as ReplayVisualDto['patch']), rejected: null };
}
