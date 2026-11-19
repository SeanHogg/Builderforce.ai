/**
 * The content-free sales brief, rendered.
 *
 * The brief's figures come from the Value outcomes rollup (`AdminOutcomeRollup`) and its
 * wording from `outcomeMetricContract.ts`; `lib/outcomeMetrics.ts` owns how a metric is
 * named and formatted. Nothing rendered it as something a person could put in front of a
 * buyer — this does, in two shapes from ONE model:
 *
 *   - `renderSalesBriefMarkdown` — the plain-text variant (paste into a doc or a deck tool).
 *   - `renderSalesBriefHtml`     — a self-contained printable HTML deck: one 16:9 slide per
 *                                  section, no scripts, no external assets, and `@page`
 *                                  rules so the browser's "Save as PDF" yields a clean deck.
 *
 * ── WHAT EVERY EXPORT CARRIES ───────────────────────────────────────────────
 * The definition version, the denominator (sessions in the cohort), the time window, the
 * data freshness (`generatedAt`) and the small segments that were SUPPRESSED. A deck that
 * quotes a number without those is a claim nobody can audit, and a changing qualification
 * rule must not silently rewrite a prior claim.
 *
 * ── PRIVACY ─────────────────────────────────────────────────────────────────
 * The brief is content-free: the model below has no field for a session title, prompt,
 * artifact or user. The workspace and project breakdowns are reduced to AGGREGATES, and any
 * segment under the external-use threshold is dropped and only COUNTED — a small segment
 * can identify its tenant by its size alone. A rollup below the threshold exports nothing.
 *
 * ── NULL IS NOT ZERO ────────────────────────────────────────────────────────
 * A metric with no value renders the localised "Not measured" through the shared
 * formatter, never `0`.
 *
 * Pure: strings in, strings out. Every user-visible word arrives through `labels`, so the
 * caller localises and this module hardcodes no English.
 */

import {
  formatOutcomeMetric,
  groupOutcomeMetrics,
  northStarMetric,
  outcomeFamilyLabel,
  outcomeMetricDefinition,
  outcomeMetricLabel,
  type OutcomeMetric,
  type OutcomeMetricFamilyRef,
  type OutcomeTranslator,
} from './outcomeMetrics';

/** The slice of the admin rollup the brief needs. Structurally a subset of `AdminOutcomeRollup`. */
export interface SalesBriefRollup {
  period: { start: string; end: string; days: number };
  sampleSize: number;
  deliveredSessions: number;
  gradedSessions?: number;
  definitionVersion?: string;
  northStarKey?: string;
  families?: OutcomeMetricFamilyRef[];
  metrics: OutcomeMetric[];
  tenants: Array<{ tenantId: number; sessions: number; deliveries: number; graded?: number }>;
  projects: Array<{ projectId: number; sessions: number; deliveries: number; graded?: number }>;
  generatedAt: string;
  privacy: { contentFree: true; minimumExternalCohort: number; externalClaimsEligible: boolean };
}

/** Every fixed string the export renders, localised by the caller. */
export interface SalesBriefLabels {
  title: string;
  /** "Period: {start} – {end}" already formatted. */
  period: string;
  /** "Cohort: N sessions · N delivered · N graded" already formatted. */
  cohort: string;
  northStar: string;
  prior: string;
  /** "Definitions {version}" already formatted. */
  definitions: string;
  /** "Generated {date}" already formatted. */
  freshness: string;
  /** "Denominator: N sessions" already formatted. */
  denominator: string;
  /** "{n} small segments suppressed (fewer than {threshold} sessions)" already formatted. */
  suppressed: string;
  /** "Window: {days} days" already formatted. */
  window: string;
  segmentsTitle: string;
  workspacesLabel: string;
  projectsLabel: string;
  sessionsColumn: string;
  deliveredColumn: string;
  gradedColumn: string;
  /** Rendered instead of the deck when the cohort is under the threshold. */
  notEligible: string;
  /** `<html lang>` and nothing else. */
  lang: string;
}

export interface SalesBriefSegment {
  /** Positional, never a tenant/project name — the brief is content-free. */
  label: string;
  sessions: number;
  delivered: number;
  graded: number;
}

export interface SalesBriefModel {
  eligible: boolean;
  title: string;
  stamps: {
    definitionVersion: string;
    denominator: number;
    windowDays: number;
    periodStart: string;
    periodEnd: string;
    generatedAt: string;
    suppressedSegments: number;
    minimumCohort: number;
  };
  northStar: { label: string; definition: string; value: string; prior: string } | null;
  groups: Array<{ heading: string; rows: Array<{ label: string; value: string; prior: string; definition: string }> }>;
  workspaces: SalesBriefSegment[];
  projects: SalesBriefSegment[];
}

export interface SalesBriefInput {
  rollup: SalesBriefRollup;
  /** Metric/family translator (`useTranslations('outcomeMetrics')`). */
  metricT: OutcomeTranslator;
  labels: SalesBriefLabels;
  /** Positional segment names, e.g. (n) => `Workspace ${n}`. */
  segmentName: (kind: 'workspace' | 'project', ordinal: number) => string;
}

/**
 * Keep only segments that clear the external-use threshold; count the rest.
 * Exported because the rule is the privacy contract and deserves its own test.
 */
export function suppressSmallSegments<T extends { sessions: number }>(
  segments: readonly T[],
  minimum: number,
): { kept: T[]; suppressed: number } {
  const kept = segments.filter((segment) => segment.sessions >= minimum);
  return { kept, suppressed: segments.length - kept.length };
}

/** Reduce the rollup to the render model — the single source both renderers read. */
export function buildSalesBriefModel(input: SalesBriefInput): SalesBriefModel {
  const { rollup, metricT, labels } = input;
  const minimum = rollup.privacy.minimumExternalCohort;
  const eligible = rollup.privacy.externalClaimsEligible;

  const tenants = suppressSmallSegments(rollup.tenants, minimum);
  const projects = suppressSmallSegments(rollup.projects, minimum);
  const toSegments = (
    kind: 'workspace' | 'project',
    rows: Array<{ sessions: number; deliveries: number; graded?: number }>,
  ): SalesBriefSegment[] => rows.map((row, index) => ({
    label: input.segmentName(kind, index + 1),
    sessions: row.sessions,
    delivered: row.deliveries,
    graded: row.graded ?? 0,
  }));

  const star = northStarMetric(rollup.metrics, rollup.northStarKey);
  const groups = groupOutcomeMetrics(rollup.metrics, rollup.families ?? []).map((group) => ({
    heading: outcomeFamilyLabel(metricT, group.family),
    rows: group.metrics.map((metric) => ({
      label: outcomeMetricLabel(metricT, metric),
      value: formatOutcomeMetric(metricT, metric.current, metric.unit),
      prior: formatOutcomeMetric(metricT, metric.baseline, metric.unit),
      definition: outcomeMetricDefinition(metricT, metric),
    })),
  }));

  return {
    eligible,
    title: labels.title,
    stamps: {
      definitionVersion: rollup.definitionVersion ?? '—',
      denominator: rollup.sampleSize,
      windowDays: rollup.period.days,
      periodStart: rollup.period.start,
      periodEnd: rollup.period.end,
      generatedAt: rollup.generatedAt,
      suppressedSegments: tenants.suppressed + projects.suppressed,
      minimumCohort: minimum,
    },
    northStar: star
      ? {
        label: outcomeMetricLabel(metricT, star),
        definition: outcomeMetricDefinition(metricT, star),
        value: formatOutcomeMetric(metricT, star.current, star.unit),
        prior: formatOutcomeMetric(metricT, star.baseline, star.unit),
      }
      : null,
    groups,
    workspaces: toSegments('workspace', tenants.kept),
    projects: toSegments('project', projects.kept),
  };
}

/** The stamp lines every export ends with, in one place so both variants agree. */
function stampLines(model: SalesBriefModel, labels: SalesBriefLabels): string[] {
  return [
    labels.period,
    labels.window,
    labels.denominator,
    labels.cohort,
    labels.definitions,
    labels.freshness,
    ...(model.stamps.suppressedSegments > 0 ? [labels.suppressed] : []),
  ];
}

const mdCell = (value: string): string => value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

/** The markdown variant. An ineligible cohort exports the refusal, not the figures. */
export function renderSalesBriefMarkdown(model: SalesBriefModel, labels: SalesBriefLabels): string {
  const lines: string[] = [`# ${model.title}`, ''];
  if (!model.eligible) {
    lines.push(labels.notEligible, '', ...stampLines(model, labels).map((line) => `- ${line}`));
    return `${lines.join('\n')}\n`;
  }
  if (model.northStar) {
    lines.push(
      `## ${labels.northStar}`, '',
      `**${model.northStar.label}: ${model.northStar.value}** (${labels.prior}: ${model.northStar.prior})`,
      '', model.northStar.definition, '',
    );
  }
  for (const group of model.groups) {
    lines.push(`## ${group.heading}`, '');
    for (const row of group.rows) lines.push(`- ${row.label}: ${row.value} (${labels.prior}: ${row.prior})`);
    lines.push('');
  }
  for (const [heading, segments] of [[labels.workspacesLabel, model.workspaces], [labels.projectsLabel, model.projects]] as const) {
    if (!segments.length) continue;
    lines.push(`## ${heading}`, '', `| | ${labels.sessionsColumn} | ${labels.deliveredColumn} | ${labels.gradedColumn} |`, '|---|---:|---:|---:|');
    for (const segment of segments) lines.push(`| ${mdCell(segment.label)} | ${segment.sessions} | ${segment.delivered} | ${segment.graded} |`);
    lines.push('');
  }
  lines.push('---', '', ...stampLines(model, labels).map((line) => `- ${line}`));
  return `${lines.join('\n')}\n`;
}

/** Escape text for HTML element content and double-quoted attributes. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const DECK_CSS = `
@page { size: 13.333in 7.5in; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; background: #e9edf1; color: #14202b; font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.slide { width: 13.333in; height: 7.5in; margin: 0.25in auto; padding: 0.6in 0.8in; background: #fff; display: flex; flex-direction: column; page-break-after: always; break-after: page; overflow: hidden; }
.slide:last-child { page-break-after: auto; break-after: auto; }
h1 { font-size: 40px; margin: 0 0 12px; }
h2 { font-size: 24px; margin: 0 0 14px; color: #3b4a58; letter-spacing: .02em; }
.star { font-size: 84px; font-weight: 700; line-height: 1.05; margin: 8px 0; }
.muted { color: #66717c; font-size: 14px; }
table { border-collapse: collapse; width: 100%; font-size: 16px; }
th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid #dfe5ea; }
td.n, th.n { text-align: right; }
.stamps { margin-top: auto; padding-top: 14px; border-top: 1px solid #dfe5ea; font-size: 12px; color: #66717c; display: flex; flex-wrap: wrap; gap: 4px 18px; }
@media print { body { background: #fff; } .slide { margin: 0; } }
`;

function slide(inner: string, stamps: string): string {
  return `<section class="slide">${inner}<footer class="stamps">${stamps}</footer></section>`;
}

function segmentTable(heading: string, segments: SalesBriefSegment[], labels: SalesBriefLabels): string {
  const rows = segments
    .map((s) => `<tr><td>${escapeHtml(s.label)}</td><td class="n">${s.sessions}</td><td class="n">${s.delivered}</td><td class="n">${s.graded}</td></tr>`)
    .join('');
  return `<h2>${escapeHtml(heading)}</h2><table><thead><tr><th></th><th class="n">${escapeHtml(labels.sessionsColumn)}</th><th class="n">${escapeHtml(labels.deliveredColumn)}</th><th class="n">${escapeHtml(labels.gradedColumn)}</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/** The self-contained printable HTML deck. No scripts, no external assets. */
export function renderSalesBriefHtml(model: SalesBriefModel, labels: SalesBriefLabels): string {
  const stamps = stampLines(model, labels).map((line) => `<span>${escapeHtml(line)}</span>`).join('');
  const slides: string[] = [];

  if (!model.eligible) {
    slides.push(slide(`<h1>${escapeHtml(model.title)}</h1><p>${escapeHtml(labels.notEligible)}</p>`, stamps));
  } else {
    slides.push(slide(
      `<h1>${escapeHtml(model.title)}</h1>${model.northStar
        ? `<h2>${escapeHtml(labels.northStar)} — ${escapeHtml(model.northStar.label)}</h2><div class="star">${escapeHtml(model.northStar.value)}</div><p class="muted">${escapeHtml(labels.prior)}: ${escapeHtml(model.northStar.prior)}</p><p>${escapeHtml(model.northStar.definition)}</p>`
        : ''}`,
      stamps,
    ));
    for (const group of model.groups) {
      const rows = group.rows
        .map((row) => `<tr><td title="${escapeHtml(row.definition)}">${escapeHtml(row.label)}</td><td class="n"><strong>${escapeHtml(row.value)}</strong></td><td class="n muted">${escapeHtml(labels.prior)}: ${escapeHtml(row.prior)}</td></tr>`)
        .join('');
      slides.push(slide(`<h2>${escapeHtml(group.heading)}</h2><table><tbody>${rows}</tbody></table>`, stamps));
    }
    const segmentSlides = [
      model.workspaces.length ? segmentTable(labels.workspacesLabel, model.workspaces, labels) : '',
      model.projects.length ? segmentTable(labels.projectsLabel, model.projects, labels) : '',
    ].filter(Boolean);
    if (segmentSlides.length) slides.push(slide(`<h1>${escapeHtml(labels.segmentsTitle)}</h1>${segmentSlides.join('')}`, stamps));
  }

  return `<!doctype html><html lang="${escapeHtml(labels.lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(model.title)}</title><style>${DECK_CSS}</style></head><body>${slides.join('')}</body></html>`;
}

/** A filesystem-safe name for the download, stamped with the definition version. */
export function salesBriefFilename(model: SalesBriefModel, extension: 'md' | 'html'): string {
  const version = model.stamps.definitionVersion.replace(/[^a-z0-9._-]+/gi, '-');
  return `value-outcomes-brief-${version}.${extension}`;
}
