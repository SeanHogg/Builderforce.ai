/**
 * ChartRewriter — re-data a NATIVE chart inside a customer-supplied .pptx.
 *
 * The in-place fill path ({@link ./inPlaceFiller}) substitutes `{{token}}` TEXT in
 * slide XML. A native OOXML chart holds none of its numbers there: the slide only
 * carries a `<graphicFrame>` pointing at a `ppt/charts/chartN.xml` part, and the
 * numbers live in that part's caches plus an embedded .xlsx workbook. So a deck
 * that filled perfectly still showed the figures it was UPLOADED with — the one
 * place in a board deck an executive actually looks.
 *
 * This module rewrites the chart part instead of the slide text:
 *
 *   1. A chart opts in by carrying `{{chart:<token>}}` in its TITLE. That is the
 *      only authoring surface a template designer already has inside a chart, and
 *      it keeps the manifest the single declaration of what binds where — the
 *      same contract the text tokens use. The token is REMOVED from the rendered
 *      title, so the deck never ships with braces showing.
 *   2. `<c:cat>` and each `<c:ser>`'s `<c:tx>` / `<c:val>` are replaced with
 *      freshly built refs + caches. PowerPoint RENDERS FROM THE CACHE, so the
 *      cache is what makes the picture change.
 *   3. The embedded workbook is REPLACED, not left alone. A stale workbook is the
 *      same defect one level down: the chart would draw the new numbers and
 *      "Edit Data" would open the old ones. {@link buildChartWorkbook} writes a
 *      minimal, valid .xlsx holding exactly the data the caches now claim.
 *
 * Surplus series are DROPPED and missing ones are WARNED about rather than
 * invented: a chart whose shape does not match its data is a template/manifest
 * mismatch the author has to see, and silently drawing three of five series is
 * how a board deck under-reports without anyone noticing.
 *
 * Everything here is pure string/byte transformation — no I/O — so it is unit
 * testable and runs unchanged inside the Worker.
 */

import { zipSync, strToU8 } from 'fflate';
import type { ChartSeries, ResolvedValue } from './types';

/** `{{chart:token}}` inside a chart title — the opt-in marker. */
const CHART_TOKEN_RE = /\{\{\s*chart:([^{}]+?)\s*\}\}/;

/** Spreadsheet column letter for a zero-based column index (A, B, … Z). */
function columnLetter(index: number): string {
  return String.fromCharCode(65 + Math.min(25, Math.max(0, index)));
}

const xmlEscape = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Merge the `<a:t>` runs of an XML fragment into one string. PowerPoint splits a
 * typed token across runs at will, so a title authored as `{{chart:spend}}` can
 * arrive as `{{chart:` + `spend}}` — the same hazard the slide filler handles.
 */
function mergedRunText(fragment: string): string {
  const runRe = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g;
  let out = '';
  let m: RegExpExecArray | null;
  while ((m = runRe.exec(fragment)) !== null) out += m[1] ?? '';
  return out;
}

/** The `<c:title>…</c:title>` block of a chart part, or null when it has none. */
function titleBlock(xml: string): { block: string; start: number; end: number } | null {
  const start = xml.indexOf('<c:title');
  if (start < 0) return null;
  const closeTag = '</c:title>';
  const close = xml.indexOf(closeTag, start);
  if (close < 0) return null;
  const end = close + closeTag.length;
  return { block: xml.slice(start, end), start, end };
}

/**
 * The chart token a part opts in with, or null. Read from the chart's own title
 * so a designer needs no tooling beyond PowerPoint to bind a chart.
 */
export function chartTokenOf(chartXml: string): string | null {
  const title = titleBlock(chartXml);
  if (!title) return null;
  const match = CHART_TOKEN_RE.exec(mergedRunText(title.block));
  return match ? (match[1] ?? '').trim() || null : null;
}

/**
 * Strip the `{{chart:…}}` marker from the title, leaving any surrounding words as
 * the visible title. A title that was ONLY the marker falls back to `fallback`
 * (the manifest's declared label) so the chart is never left untitled.
 */
function rewriteTitle(chartXml: string, fallback: string): string {
  const title = titleBlock(chartXml);
  if (!title) return chartXml;

  const runRe = /(<a:t[^>]*>)([\s\S]*?)(<\/a:t>)/g;
  const merged = mergedRunText(title.block);
  if (!CHART_TOKEN_RE.test(merged)) return chartXml;

  const cleaned = merged.replace(CHART_TOKEN_RE, '').replace(/\s+/g, ' ').trim() || fallback;

  let i = 0;
  const rewritten = title.block.replace(runRe, (_whole, open: string, _text: string, close: string) => {
    const inner = i === 0 ? xmlEscape(cleaned) : '';
    i += 1;
    return `${open}${inner}${close}`;
  });
  return chartXml.slice(0, title.start) + rewritten + chartXml.slice(title.end);
}

/** `<c:pt idx="…"><c:v>…</c:v></c:pt>` points for a string cache. */
function strPoints(values: string[]): string {
  return values.map((v, i) => `<c:pt idx="${i}"><c:v>${xmlEscape(v)}</c:v></c:pt>`).join('');
}

/**
 * Numeric points. A null is OMITTED rather than written as 0 — a missing month
 * must render as a gap in the line, not as a month where nothing was spent.
 */
function numPoints(values: Array<number | null>): string {
  return values
    .map((v, i) => (v == null || !Number.isFinite(v) ? '' : `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`))
    .join('');
}

/** A fresh `<c:cat>` bound to column A of the rebuilt worksheet. */
function categoryBlock(categories: string[]): string {
  const last = categories.length + 1;
  return (
    '<c:cat><c:strRef>' +
    `<c:f>Sheet1!$A$2:$A$${last}</c:f>` +
    `<c:strCache><c:ptCount val="${categories.length}"/>${strPoints(categories)}</c:strCache>` +
    '</c:strRef></c:cat>'
  );
}

/** A fresh `<c:val>` bound to this series' column of the rebuilt worksheet. */
function valueBlock(values: Array<number | null>, seriesIndex: number): string {
  const col = columnLetter(seriesIndex + 1);
  const last = values.length + 1;
  return (
    '<c:val><c:numRef>' +
    `<c:f>Sheet1!$${col}$2:$${col}$${last}</c:f>` +
    `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${values.length}"/>${numPoints(values)}</c:numCache>` +
    '</c:numRef></c:val>'
  );
}

/** A fresh `<c:tx>` carrying the series name in this series' header cell. */
function seriesNameBlock(name: string, seriesIndex: number): string {
  const col = columnLetter(seriesIndex + 1);
  return (
    '<c:tx><c:strRef>' +
    `<c:f>Sheet1!$${col}$1</c:f>` +
    `<c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${xmlEscape(name)}</c:v></c:pt></c:strCache>` +
    '</c:strRef></c:tx>'
  );
}

/**
 * Replace the first element named `tag` (in any of its accepted forms) inside a
 * `<c:ser>` block. Returns the block unchanged when the element is absent — a
 * scatter or bubble chart has no `<c:cat>`, and that is not an error.
 */
function replaceElement(serXml: string, tag: string, replacement: string): string {
  const open = new RegExp(`<${tag}(?:\\s[^>]*)?>`);
  const m = open.exec(serXml);
  if (!m) return serXml;
  const closeTag = `</${tag}>`;
  const closeAt = serXml.indexOf(closeTag, m.index);
  if (closeAt < 0) return serXml;
  return serXml.slice(0, m.index) + replacement + serXml.slice(closeAt + closeTag.length);
}

/** Split a chart part into its `<c:ser>` blocks, keeping their positions. */
function seriesBlocks(chartXml: string): Array<{ xml: string; start: number; end: number }> {
  const out: Array<{ xml: string; start: number; end: number }> = [];
  const re = /<c:ser>[\s\S]*?<\/c:ser>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(chartXml)) !== null) out.push({ xml: m[0], start: m.index, end: m.index + m[0].length });
  return out;
}

export interface ChartRewriteResult {
  xml: string;
  /** Human-readable notes surfaced next to the deck's binding warnings. */
  warnings: string[];
}

/**
 * Rewrite one chart part against resolved chart data.
 *
 * The chart's OWN series count wins: it is the design the customer approved. Data
 * with more series than the chart draws is reported, not silently truncated
 * without a word; data with fewer leaves the surplus `<c:ser>` blocks removed so
 * the legend never advertises a series with no points behind it.
 */
export function rewriteChartXml(chartXml: string, data: ChartSeries, label: string): ChartRewriteResult {
  const warnings: string[] = [];
  const blocks = seriesBlocks(chartXml);

  if (blocks.length === 0) {
    return { xml: chartXml, warnings: [`Chart "${label}" has no plottable series to re-data.`] };
  }
  if (data.series.length === 0) {
    return { xml: chartXml, warnings: [`No data resolved for chart "${label}" — it still shows its uploaded numbers.`] };
  }
  if (data.series.length > blocks.length) {
    warnings.push(
      `Chart "${label}" draws ${blocks.length} series but the data has ${data.series.length}; ` +
      `the extra ${data.series.length - blocks.length} were not plotted.`,
    );
  }

  const used = Math.min(blocks.length, data.series.length);

  // Rebuild back-to-front so each splice leaves earlier offsets valid.
  let xml = chartXml;
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const block = blocks[i]!;
    if (i >= used) {
      // A series the data does not fill: remove it rather than leave it holding
      // the uploaded numbers next to freshly re-dataed neighbours.
      xml = xml.slice(0, block.start) + xml.slice(block.end);
      continue;
    }
    const spec = data.series[i]!;
    let ser = block.xml;
    ser = replaceElement(ser, 'c:tx', seriesNameBlock(spec.name, i));
    ser = replaceElement(ser, 'c:cat', categoryBlock(data.categories));
    ser = replaceElement(ser, 'c:val', valueBlock(spec.values, i));
    xml = xml.slice(0, block.start) + ser + xml.slice(block.end);
  }

  return { xml: rewriteTitle(xml, label), warnings };
}

/**
 * Build the minimal .xlsx a re-dataed chart points at.
 *
 * Written from scratch rather than patched: the uploaded workbook's shape
 * (shared strings, styles, arbitrary sheet names) is the customer's, and editing
 * it in place means re-implementing enough of the format to corrupt it. Five
 * parts with inline strings is what PowerPoint's "Edit Data" needs to open the
 * numbers the chart now draws, and nothing else in the package references it.
 */
export function buildChartWorkbook(data: ChartSeries): Uint8Array<ArrayBuffer> {
  const rows: string[] = [];

  const headerCells = ['<c r="A1" t="inlineStr"><is><t></t></is></c>']
    .concat(data.series.map((s, i) => `<c r="${columnLetter(i + 1)}1" t="inlineStr"><is><t>${xmlEscape(s.name)}</t></is></c>`));
  rows.push(`<row r="1">${headerCells.join('')}</row>`);

  data.categories.forEach((category, rowIdx) => {
    const r = rowIdx + 2;
    const cells = [`<c r="A${r}" t="inlineStr"><is><t>${xmlEscape(category)}</t></is></c>`];
    data.series.forEach((s, i) => {
      const v = s.values[rowIdx];
      if (v == null || !Number.isFinite(v)) return;
      cells.push(`<c r="${columnLetter(i + 1)}${r}"><v>${v}</v></c>`);
    });
    rows.push(`<row r="${r}">${cells.join('')}</row>`);
  });

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '</Types>',
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>',
    ),
    'xl/workbook.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '</Relationships>',
    ),
    'xl/worksheets/sheet1.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      `<sheetData>${rows.join('')}</sheetData></worksheet>`,
    ),
  };

  return zipSync(files, { level: 4 });
}

/**
 * The embedded-workbook part a chart part points at, read from its `.rels`.
 * Returns null when the chart carries no embedded package (a chart pasted as
 * "link to data" has none) — there is then nothing to keep in step.
 */
export function embeddedWorkbookPath(chartPath: string, relsXml: string | null): string | null {
  if (!relsXml) return null;
  const m = /Target="([^"]*embeddings\/[^"]+)"/.exec(relsXml);
  if (!m) return null;
  const target = m[1] ?? '';
  // Targets are relative to the chart part's folder (`ppt/charts/`).
  const base = chartPath.slice(0, chartPath.lastIndexOf('/') + 1);
  return normalizePath(base + target);
}

/** Collapse `../` segments so a relationship target becomes a package path. */
function normalizePath(path: string): string {
  const out: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '.' || segment === '') continue;
    if (segment === '..') out.pop();
    else out.push(segment);
  }
  return out.join('/');
}

/** Narrow a resolved binding to chart data. */
export function asChartValue(value: ResolvedValue | undefined): ChartSeries | null {
  return value && value.kind === 'chart' ? { categories: value.categories, series: value.series } : null;
}
