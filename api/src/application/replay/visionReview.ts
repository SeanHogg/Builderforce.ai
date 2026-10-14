/**
 * The ONE vision request per key page (PRD 33 §5.2 "Review", D13).
 *
 * After both devices of a page are captured on a release, one multimodal request
 * through the gateway (image parts in the `image_url` shape the capability gate
 * detects, so only a vision-capable model is tried) carries the two fold screenshots,
 * the rect map as text, the page's measured facts and the rule findings already
 * proved, and asks for at most {@link VISION_MAX_FINDINGS} observations as JSON.
 *
 * D13: an observation is shown ONLY when `acceptObserved` keeps it — it names an
 * element of the capture's rect map AND cites a fact the page actually measured.
 * Kept findings are upserted `source = 'observed'` (rule `vision_observed`); a
 * proposed patch is validated against the rect map and the page's own palette and
 * dropped (the finding kept, without a visual) when it fails. Shares THE Insights AI
 * budget, and runs at most once per page per release.
 */

import { and, eq } from 'drizzle-orm';
import {
  validateVisualPatch,
  type PageRect,
  type ReplayPrescriptionArea,
  type VisualPatch,
} from '@builderforce/interaction-contract';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { replayPrescriptions } from '../../infrastructure/database/schema';
import { peekCached, setCached } from '../../infrastructure/cache/readThroughCache';
import { asJsonObject, extractJsonPayload } from '../../domain/shared/json';
import { stableHash } from '../../domain/replay/prescriptions/ruleEvidence';
import { estimateImpact } from '../../domain/replay/prescriptions/impact';
import { conversionCohorts, OBSERVED_RULE_ID, PAGE_PRESCRIPTION_RULES } from '../../domain/replay/prescriptions/pageRules';
import { pageFactKeys, type PageFacts } from '../../domain/replay/prescriptions/pageFacts';
import { readProxyChoice } from '../llm/LlmProxyService';
import { tenantProxyForPlan } from '../llm/tenantProxy';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { withinReplayAiBudget } from './replayAiBudget';
import { bumpSiteVersion, pageVisionKey } from './replayCacheKeys';
import { foldDataUrl, listCaptures, readRectMap, type CaptureRow } from './pageCaptureStore';
import { buildPageFacts, newestCaptures } from './pageAggregates';
import { PRESCRIPTION_WINDOW_DAYS } from './prescriptionAggregates';
import { siteOrigin } from './pageCapture';
import { requestRender } from './pageRender';
import { buildVisual } from './pageVisual';
import type { ReplaySiteRecord } from './replaySites';

const SOURCE = 'application/replay/visionReview.ts';
export const VISION_MAX_FINDINGS = 5;
const RECTS_IN_PROMPT = 60;
const TEXT_MAX = 400;
const VISION_GATE_SECONDS = 30 * 86_400;
const OBSERVED_AREAS: ReadonlySet<ReplayPrescriptionArea> = new Set(['ux', 'content', 'seo', 'accessibility']);

const VISION_SHAPE = 'You review ONE web page for problems a visitor can SEE that cost conversions: unclear value, weak or hidden calls to action, '
  + 'clutter, poor hierarchy, missing reassurance, unreadable or inaccessible elements. You get the above-the-fold screenshots (desktop first, then phone), '
  + 'the element map (selector · role · label · box), the page\'s measured facts (key = value), its palette and the rule findings already proved.\n'
  + `Reply with ONLY a JSON array of at most ${VISION_MAX_FINDINGS} objects, no prose:\n`
  + '{"elementSelector": "<a selector copied verbatim from the element map>", "area": "ux"|"content"|"seo"|"accessibility", '
  + '"observation": "<what is wrong, one sentence>", "supportingMetric": "<a key copied verbatim from the facts>", '
  + '"prescription": "<the change, one or two sentences>", "visualPatch": {"ops": [...]}}\n'
  + 'Patch ops: {"op":"setText","selector","text"} · {"op":"setAttr","selector","name":"alt|aria-label|title|placeholder|href","value"} (href stays on this site) · '
  + '{"op":"setStyle","selector","property","value"} (layout, spacing, size, visibility; colours only from the palette) · '
  + '{"op":"moveBefore"|"moveAfter","selector","anchor"} · {"op":"insertAfter","selector","html"} (short HTML: p, span, strong, em, ul, li, a) · {"op":"hide","selector"}.\n'
  + 'Do not repeat a rule finding. Do not quote text you cannot see. If nothing is worth saying, reply [].';

/** One observation `acceptObserved` kept. */
export interface ObservedFinding {
  selector: string;
  label: string;
  area: ReplayPrescriptionArea;
  observation: string;
  supportingMetric: string;
  metricValue: number;
  prescription: string;
  patch: VisualPatch | null;
  /** Why a proposed patch was dropped, when it was. */
  patchRejected: string | null;
}

const clip = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, TEXT_MAX) : '');

/**
 * Keep an observation only when it names an element of the rect map AND cites a key
 * of the page's measured facts (D13). A patch is kept only when it validates.
 */
export function acceptObserved(
  raw: unknown,
  rectMap: readonly PageRect[],
  facts: Readonly<Record<string, number>>,
  opts: { palette?: readonly string[]; origin?: string | null } = {},
): ObservedFinding | null {
  const f = asJsonObject<Record<string, unknown>>(raw);
  if (!f) return null;
  const selector = typeof f.elementSelector === 'string' ? f.elementSelector : '';
  const rect = rectMap.find((r) => r.selector === selector);
  if (!rect) return null;
  const metric = typeof f.supportingMetric === 'string' ? f.supportingMetric.trim() : '';
  if (!metric || !Object.prototype.hasOwnProperty.call(facts, metric)) return null;
  const observation = clip(f.observation);
  const prescription = clip(f.prescription);
  if (!observation || !prescription) return null;
  const area = OBSERVED_AREAS.has(f.area as ReplayPrescriptionArea) ? (f.area as ReplayPrescriptionArea) : 'ux';

  let patch: VisualPatch | null = null;
  let patchRejected: string | null = null;
  if (f.visualPatch !== undefined && f.visualPatch !== null) {
    const verdict = validateVisualPatch(f.visualPatch, rectMap, opts.palette ?? [], { origin: opts.origin ?? null });
    if (verdict.ok) patch = f.visualPatch as VisualPatch;
    else patchRejected = verdict.reason;
  }
  return { selector, label: rect.label, area, observation, supportingMetric: metric, metricValue: facts[metric]!, prescription, patch, patchRejected };
}

/** The request's messages: one text part, then the fold screenshots as `image_url` parts. */
export function buildVisionMessages(input: { text: string; images: readonly string[] }): Array<{ role: 'system' | 'user'; content: unknown }> {
  return [
    { role: 'system', content: VISION_SHAPE },
    {
      role: 'user',
      content: [
        { type: 'text', text: input.text },
        ...input.images.map((url) => ({ type: 'image_url', image_url: { url } })),
      ],
    },
  ];
}

/** The text half: element map, facts, palette and the proved rule findings. */
export function visionText(page: PageFacts, rectMap: readonly PageRect[], palette: readonly string[]): string {
  const facts = pageFactKeys(page);
  const findings = PAGE_PRESCRIPTION_RULES.flatMap((rule) => rule.detect({
    siteId: '', days: 0, grid: 0, site: page.site, routes: [], issues: [], elements: [], scroll: [], funnelSteps: [],
    devices: [], releases: [], knownCohorts: [], proofs: [], patterns: [], pages: [page],
  }));
  return [
    `Page: ${page.path}`,
    '',
    'Element map:',
    ...rectMap.slice(0, RECTS_IN_PROMPT).map((r) => `${r.selector} · ${r.role} · "${r.label.replace(/"/g, "'").slice(0, 80)}" · ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.w)}×${Math.round(r.h)}`),
    '',
    'Facts:',
    ...Object.entries(facts).map(([k, v]) => `${k} = ${Math.round(v * 1000) / 1000}`),
    '',
    `Palette: ${palette.join(', ') || '(unknown)'}`,
    '',
    'Rule findings already proved:',
    ...(findings.length ? findings.map((f) => `- ${f.ruleId} ${JSON.stringify(f.params)}`) : ['- (none)']),
  ].join('\n');
}

/** Parse the reply into at most {@link VISION_MAX_FINDINGS} raw findings. */
export function parseVisionReply(text: string): unknown[] {
  const payload = extractJsonPayload(text);
  const list = Array.isArray(payload) ? payload : Array.isArray(asJsonObject<{ findings?: unknown }>(payload)?.findings) ? (payload as { findings: unknown[] }).findings : [];
  return list.slice(0, VISION_MAX_FINDINGS);
}

/** Upsert one kept observation as an open `observed` prescription. Returns the row id written. */
async function storeObserved(db: Db, site: ReplaySiteRecord, page: PageFacts, capture: CaptureRow, found: ObservedFinding, now: Date): Promise<{ id: string; visual: unknown } | null> {
  const cohorts = conversionCohorts(page);
  const impact = { ...estimateImpact({ affected: page.behaviour.all.sessions }, cohorts, PRESCRIPTION_WINDOW_DAYS), basis: cohorts };
  const finding = {
    params: { route: page.path, observation: found.observation, metric: found.supportingMetric, value: found.metricValue },
    evidence: [],
    selector: found.selector,
    label: found.label || null,
    fingerprint: null,
    affected: page.behaviour.all.sessions,
    issueId: null,
  };
  const visual = found.patch ? buildVisual(found.patch) : null;
  const columns = {
    area: found.area,
    pagePath: page.path,
    captureId: capture.id,
    finding,
    prescription: found.prescription,
    change: { kind: 'layout', target: found.selector, description: found.prescription },
    visual,
    impact,
    updatedAt: now,
  };
  const subjectKey = `${page.path}|vision|${stableHash(found.selector)}`.slice(0, 400);
  const [created] = await db
    .insert(replayPrescriptions)
    .values({
      siteId: site.id, ruleId: OBSERVED_RULE_ID, source: 'observed', subjectKey, status: 'proposed',
      acceptance: PAGE_PRESCRIPTION_RULES.find((r) => r.id === OBSERVED_RULE_ID)?.acceptance ?? null,
      createdAt: now, ...columns,
    })
    .onConflictDoNothing()
    .returning({ id: replayPrescriptions.id, visual: replayPrescriptions.visual });
  if (created) return created;
  // Already open: refresh only while nobody has acted on it.
  const [updated] = await db
    .update(replayPrescriptions)
    .set(columns)
    .where(and(
      eq(replayPrescriptions.siteId, site.id),
      eq(replayPrescriptions.ruleId, OBSERVED_RULE_ID),
      eq(replayPrescriptions.subjectKey, subjectKey),
      eq(replayPrescriptions.status, 'proposed'),
    ))
    .returning({ id: replayPrescriptions.id, visual: replayPrescriptions.visual });
  return updated ?? null;
}

/**
 * Review one page with vision, once per page per release. Never throws; answers what
 * it did (`skipped` names why it did nothing).
 */
export async function reviewPage(
  env: Env,
  db: Db,
  site: ReplaySiteRecord,
  path: string,
  opts: { now?: Date } = {},
): Promise<{ reviewed: boolean; accepted: number; skipped: string | null }> {
  const now = opts.now ?? new Date();
  try {
    const newest = newestCaptures(await listCaptures(db, site.id, { paths: [path], limit: 20 })).get(path) ?? {};
    const desktop = newest.desktop;
    const phone = newest.phone;
    if (!desktop || !phone || desktop.releaseKey !== phone.releaseKey) return { reviewed: false, accepted: 0, skipped: 'captures_incomplete' };
    const gate = pageVisionKey(site.id, path, desktop.releaseKey);
    if (await peekCached<boolean>(env, gate)) return { reviewed: false, accepted: 0, skipped: 'already_reviewed' };

    const page = (await buildPageFacts(env, db, site, { days: PRESCRIPTION_WINDOW_DAYS, now })).find((p) => p.path === path);
    if (!page) return { reviewed: false, accepted: 0, skipped: 'no_facts' };
    const [desktopRects, phoneRects, desktopFold, phoneFold] = await Promise.all([
      readRectMap(env, desktop), readRectMap(env, phone), foldDataUrl(env, desktop), foldDataUrl(env, phone),
    ]);
    const images = [desktopFold, phoneFold].filter((u): u is string => !!u);
    if (images.length === 0) return { reviewed: false, accepted: 0, skipped: 'no_screenshots' };
    const rectMap = [...desktopRects, ...phoneRects.filter((r) => !desktopRects.some((d) => d.selector === r.selector))];
    const palette = page.captures.desktop?.content?.palette ?? page.captures.phone?.content?.palette ?? [];

    if (!(await withinReplayAiBudget(env, site.tenantId, { now }))) return { reviewed: false, accepted: 0, skipped: 'ai_budget' };
    await setCached(env, gate, true, { kvTtlSeconds: VISION_GATE_SECONDS });

    const { proxy } = await tenantProxyForPlan(env, site.tenantId);
    const result = await proxy.complete({
      // Multipart content: the gateway routes on the `image_url` parts at runtime (capabilityGate).
      messages: buildVisionMessages({ text: visionText(page, rectMap, palette), images }) as never,
      temperature: 0.2,
      max_tokens: 1_200,
    });
    const { content } = await readProxyChoice(result);
    const origin = await siteOrigin(env, db, site).catch(() => null);
    const facts = pageFactKeys(page);
    let accepted = 0;
    for (const raw of parseVisionReply(content ?? '')) {
      const found = acceptObserved(raw, rectMap, facts, { palette, origin });
      if (!found) continue;
      if (found.patchRejected) console.warn('[insights] vision patch rejected', { siteId: site.id, path, reason: found.patchRejected });
      const stored = await storeObserved(db, site, page, desktop, found, now);
      if (!stored) continue;
      accepted += 1;
      if (found.patch) await requestRender(env, db, site, { id: stored.id, pagePath: path, visual: stored.visual }, now);
    }
    if (accepted > 0) await bumpSiteVersion(env, site.id);
    return { reviewed: true, accepted, skipped: null };
  } catch (error) {
    reportCaughtError(error, { source: SOURCE, operation: 'reviewPage', context: { siteId: site.id } });
    return { reviewed: false, accepted: 0, skipped: 'error' };
  }
}
