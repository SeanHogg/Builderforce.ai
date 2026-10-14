/**
 * The improvement prompt of one fix, or of every accepted fix on a page (PRD 33 §5.2
 * "Prompt") — compiled ON READ through THE contract compiler
 * (`compileImprovementPrompt`), never stored.
 *
 * The input is built from what the fixes already hold: the finding's params and
 * impact (evidence), the validated visual patch (each op becomes a change with the
 * element's rect-map label as "before"), the SERP or JSON-LD proposal of an SEO
 * fix, or the drafted change. The rect map's labels are empty for masked regions,
 * so a masked element's text can never reach a prompt.
 */

import {
  IMPROVEMENT_AUDIENCES,
  type ImprovementAudience,
  type ImprovementChange,
  type ImprovementPromptInput,
  type ReplayImprovementPromptDto,
  type ReplayPrescriptionDto,
  type VisualPatchOp,
  compileImprovementPrompt,
} from '@builderforce/interaction-contract';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { NotFoundError, ValidationError } from '../../domain/shared/errors';
import { asJsonRecord } from '../../domain/shared/json';
import type { ReplayScope } from '../../domain/replay/replayScope';
import { findCapture, readRectMap } from './pageCaptureStore';
import { siteOrigin } from './pageCapture';
import { getPrescription, listPrescriptions } from './prescriptionReads';
import { getSiteForTenant } from './replaySites';

/** Fixes a page prompt bundles: every one a person has not dismissed or already settled. */
export const ACCEPTED_STATUSES: ReadonlySet<string> = new Set(['proposed', 'applied', 'measuring']);

export function parseAudience(raw: string | null | undefined, fallback: ImprovementAudience = 'coding_agent'): ImprovementAudience {
  const v = (raw ?? '').trim();
  if (!v) return fallback;
  if (!(IMPROVEMENT_AUDIENCES as readonly string[]).includes(v)) throw new ValidationError(`audience must be one of ${IMPROVEMENT_AUDIENCES.join(', ')}`);
  return v as ImprovementAudience;
}

const stripTags = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

/** What one patch op changes, in words. */
export function describeOp(op: VisualPatchOp, labelOf: (selector: string) => string): string {
  switch (op.op) {
    case 'setText': return op.text;
    case 'setAttr': return `${op.name}="${op.value}"`;
    case 'setStyle': return `${op.property}: ${op.value}`;
    case 'moveBefore': return `move it before ${labelOf(op.anchor) || op.anchor}`;
    case 'moveAfter': return `move it after ${labelOf(op.anchor) || op.anchor}`;
    case 'insertAfter': return `add after it: ${stripTags(op.html)}`;
    case 'hide': return 'hide it';
  }
}

/** The changes one fix makes. */
export function changesOf(rx: ReplayPrescriptionDto, labelOf: (selector: string) => string): ImprovementChange[] {
  const reason = rx.prescription ?? String(rx.finding.params.observation ?? rx.ruleId.replace(/_/g, ' '));
  const visual = rx.visual;
  if (visual?.serp) {
    return [
      { selector: null, label: 'page title', before: visual.serp.before.title, after: visual.serp.after.title, reason },
      { selector: null, label: 'meta description', before: visual.serp.before.description, after: visual.serp.after.description, reason },
    ];
  }
  if (visual?.jsonLdDiff) {
    return [{ selector: null, label: 'structured data', after: `add this JSON-LD to the page head: ${visual.jsonLdDiff.replace(/^\+ /gm, '').replace(/\n/g, ' ')}`, reason }];
  }
  if (visual && visual.patch.ops.length > 0) {
    return visual.patch.ops.map((op) => ({
      selector: op.selector,
      label: labelOf(op.selector) || null,
      before: op.op === 'setText' ? labelOf(op.selector) || null : null,
      after: describeOp(op, labelOf),
      reason,
    }));
  }
  const change = asJsonRecord(rx.change);
  const target = typeof change.target === 'string' && change.target ? change.target : rx.finding.selector;
  const description = typeof change.description === 'string' && change.description ? change.description : reason;
  return [{ selector: target, label: target ? labelOf(target) || rx.finding.label : null, after: description, reason }];
}

/** The evidence lines of a set of fixes on one page. */
export function evidenceOf(rows: readonly ReplayPrescriptionDto[]): ImprovementPromptInput['evidence'] {
  const out: ImprovementPromptInput['evidence'] = [];
  for (const rx of rows) {
    const params = Object.entries(rx.finding.params).filter(([k]) => k !== 'route' && k !== 'observation');
    out.push({ label: rx.ruleId.replace(/_/g, ' '), value: params.map(([k, v]) => `${k} ${v}`).join(', ') || `${rx.finding.affected} visits` });
    const { estimate, low, high, unit, horizonDays } = rx.impact;
    if (estimate !== null) out.push({ label: 'Expected over the next 30 days', value: `≈ ${estimate} ${unit}` });
    else if (low !== null && high !== null) out.push({ label: `Range over ${horizonDays} days`, value: `${low} to ${high} ${unit}` });
  }
  return out;
}

/** Pure: the compiler input of the fixes on one page. */
export function promptInputFor(
  rows: readonly ReplayPrescriptionDto[],
  ctx: { path: string; url: string | null; siteLabel: string; labelOf: (selector: string) => string },
): ImprovementPromptInput {
  return {
    page: { path: ctx.path, url: ctx.url, siteLabel: ctx.siteLabel },
    evidence: evidenceOf(rows),
    changes: rows.flatMap((rx) => changesOf(rx, ctx.labelOf)),
    acceptance: rows.flatMap((rx) => (rx.acceptance ? [rx.acceptance] : []))
      .filter((a, i, all) => all.findIndex((b) => b.metric === a.metric && b.direction === a.direction) === i),
  };
}

/** The selectors a set of fixes changes, in order (the canvas's `previewPick` chips). */
export function selectorsOf(input: ImprovementPromptInput): string[] {
  return [...new Set(input.changes.map((c) => c.selector).filter((s): s is string => !!s))];
}

/** Labels of the page's elements, from the capture the fixes were read from. */
async function labelsFor(env: Env, db: Db, scope: ReplayScope, rows: readonly ReplayPrescriptionDto[]): Promise<(selector: string) => string> {
  const labels = new Map<string, string>();
  const captureIds = [...new Set(rows.map((r) => r.captureId).filter((id): id is string => !!id))];
  for (const id of captureIds) {
    const capture = await findCapture(db, scope, id).catch(() => null);
    if (!capture) continue;
    for (const rect of await readRectMap(env, capture)) if (!labels.has(rect.selector)) labels.set(rect.selector, rect.label);
  }
  for (const rx of rows) if (rx.finding.selector && rx.finding.label && !labels.has(rx.finding.selector)) labels.set(rx.finding.selector, rx.finding.label);
  return (selector) => labels.get(selector) ?? '';
}

async function compileFor(
  env: Env,
  db: Db,
  scope: ReplayScope,
  path: string,
  rows: readonly ReplayPrescriptionDto[],
  audience: ImprovementAudience,
): Promise<ReplayImprovementPromptDto> {
  const site = await getSiteForTenant(env, db, scope.tenantId, scope.siteId);
  const origin = await siteOrigin(env, db, site).catch(() => null);
  const labelOf = await labelsFor(env, db, scope, rows);
  const input = promptInputFor(rows, {
    path,
    url: origin ? `${origin}${path}` : null,
    siteLabel: site.label || site.id,
    labelOf,
  });
  const selectors = selectorsOf(input);
  return {
    audience,
    prompt: compileImprovementPrompt(input, { audience }),
    selectors,
    // The rect map's label for each (empty for a masked region) — one composer chip each.
    targets: selectors.map((selector) => ({ selector, label: labelOf(selector) })),
    prescriptionIds: rows.map((r) => r.id),
  };
}

/** One fix's prompt. */
export async function prescriptionPrompt(env: Env, db: Db, scope: ReplayScope, prescriptionId: string, audience: ImprovementAudience): Promise<ReplayImprovementPromptDto> {
  const rx = await getPrescription(env, db, scope, prescriptionId);
  return compileFor(env, db, scope, rx.pagePath ?? '/', [rx], audience);
}

/**
 * Every accepted fix on a page, in ranked order — or only the ones `ids` names (the
 * page review's "include in one prompt" checkboxes). 404 when nothing is left.
 */
export async function pagePrompt(
  env: Env,
  db: Db,
  scope: ReplayScope,
  path: string,
  audience: ImprovementAudience,
  ids?: readonly string[] | null,
): Promise<ReplayImprovementPromptDto> {
  const clean = path.trim();
  if (!clean.startsWith('/')) throw new ValidationError('path must start with /');
  const only = ids && ids.length > 0 ? new Set(ids) : null;
  const rows = (await listPrescriptions(env, db, scope))
    .filter((rx) => rx.pagePath === clean && ACCEPTED_STATUSES.has(rx.status) && (!only || only.has(rx.id)));
  if (rows.length === 0) throw new NotFoundError('Fixes on page', clean);
  return compileFor(env, db, scope, clean, rows, audience);
}
