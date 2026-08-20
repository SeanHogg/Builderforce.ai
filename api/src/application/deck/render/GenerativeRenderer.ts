/**
 * GenerativeRenderer — render a Builderforce-branded .pptx from {@link DeckData}
 * using pptxgenjs (pure JS; runs in the Worker). Two layouts keyed by archetype:
 *   - 'board'         → the 6-content-slide R&D board deck (Investment,
 *                       Deliverables, Quality, Delivery & Ops, People, AI Impact).
 *   - 'cfo_devfinops' → a finance-lens deck (spend by category, AI program, ROI).
 *
 * Returns the .pptx as a Uint8Array. Native charts use pptxgenjs `addChart`, so
 * the chart caches AND the embedded workbook are written for us — no in-place
 * xlsx surgery (which is what the UPLOADED-template path has to do instead; see
 * {@link ../chartRewriter}).
 *
 * The numbers reach a chart the same way they reach a table: through the
 * `string[][]` matrices {@link DeckData} already assembles, parsed back to
 * numbers by the shared {@link parseNumericCell}. There is deliberately no second
 * numeric shape of the same data to keep in step with the tables beside it.
 */

import pptxgen from 'pptxgenjs';
import type { DeckData, DeckArchetype } from '../types';
import { parseNumericCell } from '../bindingResolver';

const BRAND = {
  primary: '4F46E5',   // indigo
  ink: '111827',
  muted: '6B7280',
  panel: 'F3F4F6',
  white: 'FFFFFF',
  good: '059669',
  warn: 'D97706',
  font: 'Arial',
};

const fmt = (n: number | null | undefined, suffix = ''): string =>
  n == null || !Number.isFinite(n) ? '—' : `${n.toLocaleString('en-US')}${suffix}`;

type Slide = ReturnType<pptxgen['addSlide']>;

function header(slide: Slide, title: string, sub: string): void {
  slide.background = { color: BRAND.white };
  slide.addText(title, { x: 0.4, y: 0.3, w: 9.2, h: 0.6, fontSize: 26, bold: true, color: BRAND.ink, fontFace: BRAND.font });
  slide.addText(sub, { x: 0.4, y: 0.92, w: 9.2, h: 0.3, fontSize: 12, color: BRAND.muted, fontFace: BRAND.font });
  slide.addShape('line' as never, { x: 0.4, y: 1.28, w: 9.2, h: 0, line: { color: BRAND.primary, width: 2 } });
}

/** A KPI stat card. */
function stat(slide: Slide, x: number, y: number, label: string, value: string): void {
  slide.addShape('roundRect' as never, { x, y, w: 2.15, h: 1.1, fill: { color: BRAND.panel }, line: { color: BRAND.panel, width: 1 }, rectRadius: 0.08 });
  slide.addText(value, { x, y: y + 0.12, w: 2.15, h: 0.55, fontSize: 22, bold: true, color: BRAND.primary, align: 'center', fontFace: BRAND.font });
  slide.addText(label, { x, y: y + 0.66, w: 2.15, h: 0.36, fontSize: 10, color: BRAND.muted, align: 'center', fontFace: BRAND.font });
}

/** One plotted series drawn from a column of a {@link DeckData} matrix. */
interface SeriesSpec { name: string; column: number }

/**
 * A native chart over a `[label, …figures]` matrix.
 *
 * Draws NOTHING when no cell in the chosen columns parses to a number. An empty
 * axis pair in a board deck reads as "we measured zero", which is a different and
 * much worse claim than the blank space that says the figure was not available —
 * the same reason `parseNumericCell` returns null instead of 0.
 */
function chart(
  pptx: pptxgen,
  slide: Slide,
  type: 'bar' | 'line',
  opts: { x: number; y: number; w: number; h: number; title: string; rows: string[][]; series: SeriesSpec[] },
): void {
  const labels = opts.rows.map((r) => String(r?.[0] ?? ''));
  const data = opts.series.map((s) => ({
    name: s.name,
    labels,
    values: opts.rows.map((r) => parseNumericCell(r?.[s.column]) ?? 0),
  }));

  const hasNumber = opts.rows.some((r) => opts.series.some((s) => parseNumericCell(r?.[s.column]) != null));
  if (!labels.length || !hasNumber) {
    slide.addText(`${opts.title} — no data`, {
      x: opts.x, y: opts.y + opts.h / 2 - 0.2, w: opts.w, h: 0.4,
      fontSize: 11, color: BRAND.muted, align: 'center', fontFace: BRAND.font,
    });
    return;
  }

  slide.addChart(type === 'line' ? pptx.ChartType.line : pptx.ChartType.bar, data, {
    x: opts.x, y: opts.y, w: opts.w, h: opts.h,
    title: opts.title,
    showTitle: true,
    titleColor: BRAND.ink,
    titleFontFace: BRAND.font,
    titleFontSize: 12,
    showLegend: data.length > 1,
    legendPos: 'b',
    legendColor: BRAND.muted,
    chartColors: [BRAND.primary, BRAND.warn, BRAND.good, BRAND.muted],
    catAxisLabelColor: BRAND.muted,
    valAxisLabelColor: BRAND.muted,
    catAxisLabelFontSize: 9,
    valAxisLabelFontSize: 9,
    dataBorder: { pt: 0, color: BRAND.white },
    barDir: 'col',
  });
}

function table(slide: Slide, x: number, y: number, w: number, head: string[], rows: string[][]): void {
  const headerRow = head.map((h) => ({ text: h, options: { bold: true, color: BRAND.white, fill: { color: BRAND.primary }, fontSize: 10 } }));
  const body = (rows.length ? rows : [head.map(() => '—')]).slice(0, 10).map((r) =>
    r.map((c) => ({ text: String(c ?? ''), options: { color: BRAND.ink, fontSize: 10 } })),
  );
  slide.addTable([headerRow, ...body] as never, { x, y, w, border: { type: 'solid', color: 'E5E7EB', pt: 1 }, fontFace: BRAND.font, autoPage: false });
}

function titleSlide(pptx: pptxgen, data: DeckData, subtitle: string): void {
  const slide = pptx.addSlide();
  slide.background = { color: BRAND.primary };
  slide.addText(data.meta.tenantName ?? 'R&D Organization', { x: 0.5, y: 1.7, w: 9, h: 0.5, fontSize: 16, color: 'C7D2FE', fontFace: BRAND.font });
  slide.addText(subtitle, { x: 0.5, y: 2.2, w: 9, h: 1.2, fontSize: 34, bold: true, color: BRAND.white, fontFace: BRAND.font });
  slide.addText(`${data.meta.quarter}  ·  Generated ${data.meta.generatedAt.slice(0, 10)}`, { x: 0.5, y: 3.5, w: 9, h: 0.4, fontSize: 13, color: 'E0E7FF', fontFace: BRAND.font });
}

function renderBoard(pptx: pptxgen, data: DeckData): void {
  titleSlide(pptx, data, 'R&D Quarterly Board Review');

  // 1 — Investment
  let s = pptx.addSlide();
  header(s, 'Investment', 'R&D financials, FTE allocation & strategic initiatives');
  stat(s, 0.4, 1.5, 'Total R&D $ / Revenue', fmt(data.investment.rdToRevenuePct, '%'));
  stat(s, 2.7, 1.5, '% Growth R&D (QoQ)', fmt(data.investment.growthRdPct, '%'));
  stat(s, 5.0, 1.5, 'Total Actual', data.investment.totalActualUsd == null ? '—' : `$${Math.round(data.investment.totalActualUsd).toLocaleString('en-US')}`);
  stat(s, 7.3, 1.5, 'Total Plan', data.investment.totalPlanUsd == null ? '—' : `$${Math.round(data.investment.totalPlanUsd).toLocaleString('en-US')}`);
  table(s, 0.4, 2.9, 5.1, ['Category', 'Actual', 'Plan', 'vs Plan'], data.investment.financialsByCategory);
  table(s, 5.7, 2.9, 3.9, ['Initiative', 'Objective'], data.investment.initiatives);

  // 1b — Investment, plotted. The table above answers "what did each category
  // cost"; only the plot answers "which category is off plan", which is the
  // question the slide is in the deck to settle.
  s = pptx.addSlide();
  header(s, 'Investment — Actual vs Plan', 'R&D spend by category against plan');
  chart(pptx, s, 'bar', {
    x: 0.4, y: 1.5, w: 9.2, h: 3.6,
    title: 'Spend by category',
    rows: data.investment.financialsByCategory,
    series: [{ name: 'Actual', column: 1 }, { name: 'Plan', column: 2 }],
  });

  // 2 — Deliverables
  s = pptx.addSlide();
  header(s, 'Deliverables', 'Current-quarter deliverable breakdown');
  table(s, 0.4, 1.5, 9.2, ['Objective', 'Target', '% Complete', 'Status', 'Cost'], data.deliverables.rows);

  // 3 — Quality
  s = pptx.addSlide();
  header(s, 'Quality', 'Reliability & customer-support health');
  stat(s, 0.4, 1.5, 'Uptime', fmt(data.quality.uptimePct, '%'));
  stat(s, 2.7, 1.5, 'MTTR (hrs)', fmt(data.quality.mttrHours));
  stat(s, 5.0, 1.5, 'Alerts', fmt(data.quality.alertsCount));
  stat(s, 7.3, 1.5, 'Support Tickets', fmt(data.quality.supportTickets));
  table(s, 0.4, 2.9, 4.5, ['Defect Age', 'Open'], data.quality.defectAging);
  // The right half of this slide was empty, and an aging profile is a shape:
  // "12 defects" and "12 defects all older than 90 days" are not the same news.
  chart(pptx, s, 'bar', {
    x: 5.2, y: 2.75, w: 4.4, h: 2.5,
    title: 'Open defects by age',
    rows: data.quality.defectAging,
    series: [{ name: 'Open', column: 1 }],
  });

  // 4 — Delivery & Operations
  s = pptx.addSlide();
  header(s, 'Delivery & Operations', 'DORA four-keys & throughput');
  stat(s, 0.4, 1.5, 'Deploy Freq /day', fmt(data.delivery.deploymentFrequencyPerDay));
  stat(s, 2.7, 1.5, 'Lead Time (hrs)', fmt(data.delivery.leadTimeHours));
  stat(s, 5.0, 1.5, 'Change Failure', fmt(data.delivery.changeFailureRatePct, '%'));
  stat(s, 7.3, 1.5, 'MTTR (hrs)', fmt(data.delivery.mttrHours));
  stat(s, 0.4, 2.8, 'PRs Merged', fmt(data.delivery.totalPrsMerged));
  stat(s, 2.7, 2.8, 'Issues Resolved', fmt(data.delivery.totalIssuesResolved));

  // 5 — People
  s = pptx.addSlide();
  header(s, 'People', 'Headcount, attrition & developer experience');
  stat(s, 0.4, 1.5, 'Attrition', fmt(data.people.attritionRatePct, '%'));
  stat(s, 2.7, 1.5, 'Dev Satisfaction', fmt(data.people.devSatisfactionScore));
  table(s, 0.4, 2.8, 4.7, ['Month', 'Hires', 'Leaves', 'Net', 'End'], data.people.waterfall);
  table(s, 5.3, 2.8, 4.3, ['Open Position', 'Priority', 'Days', 'Target'], data.people.openPositions);

  // 5b — Headcount movement. The waterfall table states each month; the line is
  // what shows hires and departures converging, which is the attrition story a
  // single percentage on the previous slide cannot tell.
  s = pptx.addSlide();
  header(s, 'People — Headcount Movement', 'Hires against departures, month by month');
  chart(pptx, s, 'line', {
    x: 0.4, y: 1.5, w: 9.2, h: 3.6,
    title: 'Hires vs departures',
    rows: data.people.waterfall,
    series: [{ name: 'Hires', column: 1 }, { name: 'Departures', column: 2 }],
  });

  // 6 — AI Impact
  s = pptx.addSlide();
  header(s, 'AI Impact', 'AI productivity, adoption & program investment');
  stat(s, 0.4, 1.5, 'AI Productivity', fmt(data.ai.productivityScore));
  stat(s, 2.7, 1.5, 'Program Invested', data.ai.programInvestedUsd == null ? '—' : `$${Math.round(data.ai.programInvestedUsd).toLocaleString('en-US')}`);
  table(s, 0.4, 2.8, 5.0, ['AI Tool', 'Adoption', 'Hrs Saved', 'Cost'], data.ai.adoption);
  table(s, 5.6, 2.8, 4.0, ['Program', 'Objective', 'Invested'], data.ai.programs);
}

function renderCfo(pptx: pptxgen, data: DeckData): void {
  titleSlide(pptx, data, 'CFO / DevFinOps Review');

  let s = pptx.addSlide();
  header(s, 'R&D Financials', 'Spend by category — actual vs plan');
  stat(s, 0.4, 1.5, 'Total R&D $ / Revenue', fmt(data.investment.rdToRevenuePct, '%'));
  stat(s, 2.7, 1.5, 'Total Actual', data.investment.totalActualUsd == null ? '—' : `$${Math.round(data.investment.totalActualUsd).toLocaleString('en-US')}`);
  stat(s, 5.0, 1.5, 'Total Plan', data.investment.totalPlanUsd == null ? '—' : `$${Math.round(data.investment.totalPlanUsd).toLocaleString('en-US')}`);
  stat(s, 7.3, 1.5, 'Cost / Merged PR', data.finance.costPerMergedPrUsd == null ? '—' : `$${data.finance.costPerMergedPrUsd}`);
  table(s, 0.4, 2.9, 9.2, ['Category', 'Actual', 'Plan', 'vs Plan'], data.investment.financialsByCategory);

  // The CFO lens is a variance conversation, and variance is read off a plot far
  // faster than off a column of "vs Plan" percentages.
  s = pptx.addSlide();
  header(s, 'Spend by Category', 'Actual against plan, by R&D category');
  chart(pptx, s, 'bar', {
    x: 0.4, y: 1.5, w: 9.2, h: 3.6,
    title: 'Actual vs plan',
    rows: data.investment.financialsByCategory,
    series: [{ name: 'Actual', column: 1 }, { name: 'Plan', column: 2 }],
  });

  s = pptx.addSlide();
  header(s, 'FinOps & AI Program', 'LLM spend, forecast & AI program investment');
  stat(s, 0.4, 1.5, 'LLM Spend (MTD)', data.finance.spendUsd == null ? '—' : `$${data.finance.spendUsd}`);
  stat(s, 2.7, 1.5, 'Forecast', data.finance.forecastUsd == null ? '—' : `$${data.finance.forecastUsd}`);
  stat(s, 5.0, 1.5, 'AI Program Invested', data.ai.programInvestedUsd == null ? '—' : `$${Math.round(data.ai.programInvestedUsd).toLocaleString('en-US')}`);
  table(s, 0.4, 2.9, 9.2, ['Program', 'Objective', 'Invested'], data.ai.programs);
}

/** Render the deck and return the .pptx bytes. */
export async function renderGenerativeDeck(data: DeckData, archetype: DeckArchetype): Promise<Uint8Array> {
  const pptx = new pptxgen();
  pptx.author = 'Builderforce';
  pptx.company = data.meta.tenantName ?? 'Builderforce';
  // Default layout is LAYOUT_16x9 (10in × 5.625in) — the coordinates above assume it.

  if (archetype === 'cfo_devfinops') renderCfo(pptx, data);
  else renderBoard(pptx, data);

  const out = (await pptx.write({ outputType: 'arraybuffer' })) as ArrayBuffer;
  return new Uint8Array(out);
}
