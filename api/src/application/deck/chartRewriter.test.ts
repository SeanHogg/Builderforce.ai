import { describe, expect, it } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import {
  asChartValue,
  buildChartWorkbook,
  chartTokenOf,
  embeddedWorkbookPath,
  rewriteChartXml,
} from './chartRewriter';
import { matrixToChart, parseNumericCell, resolveBindings } from './bindingResolver';
import { fillTemplate } from './inPlaceFiller';
import { deriveManifest } from './TemplateLibraryService';
import type { ChartSeries, DeckData, ResolvedBindings, TokenBinding } from './types';

/**
 * The defect this file exists to catch: a filled deck showed LIVE text sitting
 * next to the figures the template was uploaded with, because the fill pass only
 * ever read slide text and a native chart keeps its numbers somewhere else.
 */

/** A minimal but structurally faithful bar-chart part with two series. */
function chartPart(title: string): string {
  const ser = (idx: number, name: string, cats: string[], vals: number[]) =>
    '<c:ser>' +
    `<c:idx val="${idx}"/><c:order val="${idx}"/>` +
    `<c:tx><c:strRef><c:f>Sheet1!$B$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${name}</c:v></c:pt></c:strCache></c:strRef></c:tx>` +
    '<c:cat><c:strRef><c:f>Sheet1!$A$2:$A$3</c:f><c:strCache>' +
    `<c:ptCount val="${cats.length}"/>` +
    cats.map((c, i) => `<c:pt idx="${i}"><c:v>${c}</c:v></c:pt>`).join('') +
    '</c:strCache></c:strRef></c:cat>' +
    '<c:val><c:numRef><c:f>Sheet1!$B$2:$B$3</c:f><c:numCache><c:formatCode>General</c:formatCode>' +
    `<c:ptCount val="${vals.length}"/>` +
    vals.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join('') +
    '</c:numCache></c:numRef></c:val>' +
    '</c:ser>';

  return (
    '<?xml version="1.0"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">' +
    `<c:chart><c:title><c:tx><c:rich><a:p><a:r><a:t>${title}</a:t></a:r></a:p></c:rich></c:tx></c:title>` +
    '<c:plotArea><c:barChart>' +
    ser(0, 'Uploaded A', ['Old 1', 'Old 2'], [11, 22]) +
    ser(1, 'Uploaded B', ['Old 1', 'Old 2'], [33, 44]) +
    '</c:barChart></c:plotArea></c:chart></c:chartSpace>'
  );
}

const twoSeries: ChartSeries = {
  categories: ['Platform', 'Growth', 'Data'],
  series: [
    { name: 'Actual', values: [120, 80, null] },
    { name: 'Plan', values: [100, 90, 60] },
  ],
};

describe('chartTokenOf — how a chart opts in', () => {
  it('reads the {{chart:…}} marker out of the chart title', () => {
    expect(chartTokenOf(chartPart('Spend {{chart:financials}}'))).toBe('financials');
  });

  it('finds a marker PowerPoint split across runs', () => {
    const split = chartPart('x').replace(
      '<a:r><a:t>x</a:t></a:r>',
      '<a:r><a:t>{{chart:fin</a:t></a:r><a:r><a:t>ancials}}</a:t></a:r>',
    );
    expect(chartTokenOf(split)).toBe('financials');
  });

  it('returns null for an unbound chart', () => {
    expect(chartTokenOf(chartPart('Quarterly spend'))).toBeNull();
  });
});

describe('rewriteChartXml — the caches are what PowerPoint draws', () => {
  it('replaces categories, series names and values', () => {
    const { xml, warnings } = rewriteChartXml(chartPart('{{chart:financials}}'), twoSeries, 'R&D financials');

    expect(xml).toContain('<c:v>Platform</c:v>');
    expect(xml).toContain('<c:v>Actual</c:v>');
    expect(xml).toContain('<c:v>120</c:v>');
    expect(xml).not.toContain('Uploaded A');
    expect(xml).not.toContain('<c:v>11</c:v>');
    expect(warnings).toEqual([]);
  });

  it('omits a null rather than plotting it as zero', () => {
    const { xml } = rewriteChartXml(chartPart('{{chart:x}}'), twoSeries, 'x');
    // "Data" is the third category and Actual has no figure for it: two points,
    // not three, and certainly not a zero that reads as "spent nothing".
    const actualCache = xml.slice(xml.indexOf('<c:val>'), xml.indexOf('</c:val>'));
    expect(actualCache).toContain('<c:ptCount val="3"/>');
    expect((actualCache.match(/<c:pt idx=/g) ?? []).length).toBe(2);
  });

  it('drops a series the data does not fill instead of leaving stale numbers beside fresh ones', () => {
    const oneSeries: ChartSeries = { categories: ['A'], series: [{ name: 'Only', values: [5] }] };
    const { xml } = rewriteChartXml(chartPart('{{chart:x}}'), oneSeries, 'x');
    expect((xml.match(/<c:ser>/g) ?? []).length).toBe(1);
    expect(xml).not.toContain('Uploaded B');
  });

  it('warns rather than silently under-reporting when the data has more series than the chart draws', () => {
    const three: ChartSeries = {
      categories: ['A'],
      series: [
        { name: 'One', values: [1] },
        { name: 'Two', values: [2] },
        { name: 'Three', values: [3] },
      ],
    };
    const { warnings } = rewriteChartXml(chartPart('{{chart:x}}'), three, 'Spend');
    expect(warnings.join(' ')).toContain('not plotted');
  });

  it('strips the marker from the visible title and keeps the surrounding words', () => {
    const { xml } = rewriteChartXml(chartPart('Spend by category {{chart:financials}}'), twoSeries, 'R&amp;D');
    expect(xml).toContain('<a:t>Spend by category</a:t>');
    expect(xml).not.toContain('{{chart:');
  });

  it('falls back to the declared label when the marker WAS the whole title', () => {
    const { xml } = rewriteChartXml(chartPart('{{chart:financials}}'), twoSeries, 'R&D financials');
    expect(xml).toContain('R&amp;D financials');
  });

  it('leaves a chart with no series alone and says so', () => {
    const empty = '<c:chartSpace><c:chart><c:plotArea/></c:chart></c:chartSpace>';
    const { xml, warnings } = rewriteChartXml(empty, twoSeries, 'Spend');
    expect(xml).toBe(empty);
    expect(warnings).toHaveLength(1);
  });
});

describe('buildChartWorkbook — Edit Data must agree with the picture', () => {
  it('writes a valid minimal xlsx holding exactly the plotted numbers', () => {
    const files = unzipSync(buildChartWorkbook(twoSeries));
    expect(Object.keys(files)).toContain('xl/worksheets/sheet1.xml');
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml']!);
    expect(sheet).toContain('<t>Platform</t>');
    expect(sheet).toContain('<t>Actual</t>');
    expect(sheet).toContain('<v>120</v>');
    // The null stays a genuinely empty cell.
    expect(sheet).not.toContain('<c r="B4"><v>');
  });
});

describe('embeddedWorkbookPath', () => {
  it('resolves the ../embeddings target against the chart part folder', () => {
    const rels = '<Relationships><Relationship Id="rId1" Type="…/package" Target="../embeddings/Microsoft_Excel_Sheet1.xlsx"/></Relationships>';
    expect(embeddedWorkbookPath('ppt/charts/chart1.xml', rels)).toBe('ppt/embeddings/Microsoft_Excel_Sheet1.xlsx');
  });

  it('returns null for a chart with no embedded package', () => {
    expect(embeddedWorkbookPath('ppt/charts/chart1.xml', '<Relationships/>')).toBeNull();
    expect(embeddedWorkbookPath('ppt/charts/chart1.xml', null)).toBeNull();
  });
});

describe('parseNumericCell — display strings back into numbers', () => {
  it.each([
    ['$12,400', 12400],
    ['87%', 87],
    ['(1,200)', -1200],
    ['-4.5', -4.5],
    [3, 3],
  ])('parses %s', (raw, expected) => {
    expect(parseNumericCell(raw)).toBe(expected);
  });

  it.each(['—', '', 'n/a', null, undefined])('treats %s as a gap, never zero', (raw) => {
    expect(parseNumericCell(raw)).toBeNull();
  });
});

describe('matrixToChart', () => {
  const binding: TokenBinding = { token: 'chart:fin', bindingKey: 'investment.financialsByCategory', kind: 'chart' };

  it('takes column 0 as the axis and names undeclared columns positionally', () => {
    const chart = matrixToChart([['Platform', '$100', '$120'], ['Growth', '$50', '$40']], binding);
    expect(chart.categories).toEqual(['Platform', 'Growth']);
    expect(chart.series.map((s) => s.name)).toEqual(['Series 1', 'Series 2']);
    expect(chart.series[0]!.values).toEqual([100, 50]);
  });

  it('honours declared series columns and names', () => {
    const chart = matrixToChart(
      [['Platform', '$100', '$120', '17%']],
      { ...binding, chartSeries: [{ column: 2, name: 'Plan' }] },
    );
    expect(chart.series).toEqual([{ name: 'Plan', values: [120] }]);
  });
});

describe('resolveBindings — chart kind', () => {
  const data = { investment: { financialsByCategory: [['Platform', '$100', '$120']] } } as unknown as DeckData;

  it('resolves a chart binding and carries its label', () => {
    const resolved = resolveBindings(
      { version: 1, bindings: [{ token: 'chart:fin', bindingKey: 'investment.financialsByCategory', kind: 'chart', fallback: 'R&D financials' }] },
      data,
    );
    const chart = asChartValue(resolved.byToken.get('chart:fin'));
    expect(chart?.categories).toEqual(['Platform']);
    expect(resolved.warnings).toEqual([]);
  });

  it('warns when nothing in the matrix is plottable', () => {
    const empty = { investment: { financialsByCategory: [['Platform', '—', '—']] } } as unknown as DeckData;
    const resolved = resolveBindings(
      { version: 1, bindings: [{ token: 'chart:fin', bindingKey: 'investment.financialsByCategory', kind: 'chart' }] },
      empty,
    );
    expect(resolved.warnings.join(' ')).toContain('uploaded figures');
  });
});

describe('deriveManifest — a chart token must be findable where it lives', () => {
  it('discovers a {{chart:…}} marker in a chart part, which slide-only scanning missed', () => {
    const pkg = zipSync({
      'ppt/slides/slide1.xml': strToU8('<a:p><a:r><a:t>{{quarter}}</a:t></a:r></a:p>'),
      'ppt/charts/chart1.xml': strToU8(chartPart('{{chart:financials}}')),
    });
    const manifest = deriveManifest(pkg);
    const binding = manifest.bindings.find((b) => b.token === 'chart:financials');
    expect(binding?.kind).toBe('chart');
    expect(binding?.bindingKey).toBe('investment.financialsByCategory');
    expect(binding?.chartSeries).toEqual([{ column: 1, name: 'Actual' }, { column: 2, name: 'Plan' }]);
  });

  it('discovers a marker PowerPoint split across runs', () => {
    const split = chartPart('x').replace(
      '<a:r><a:t>x</a:t></a:r>',
      '<a:r><a:t>{{chart:defect</a:t></a:r><a:r><a:t>Aging}}</a:t></a:r>',
    );
    const manifest = deriveManifest(zipSync({ 'ppt/charts/chart1.xml': strToU8(split) }));
    expect(manifest.bindings.map((b) => b.token)).toContain('chart:defectAging');
  });

  it('binds an unrecognised chart token positionally rather than dropping it', () => {
    const manifest = deriveManifest(zipSync({ 'ppt/charts/chart1.xml': strToU8(chartPart('{{chart:custom}}')) }));
    const binding = manifest.bindings.find((b) => b.token === 'chart:custom');
    expect(binding?.kind).toBe('chart');
    expect(binding?.chartSeries).toBeUndefined();
  });
});

describe('fillTemplate — the whole package round-trip', () => {
  function pkg(): Uint8Array {
    return zipSync({
      '[Content_Types].xml': strToU8('<Types/>'),
      'ppt/slides/slide1.xml': strToU8('<a:p><a:r><a:t>Q: {{quarter}}</a:t></a:r></a:p>'),
      'ppt/charts/chart1.xml': strToU8(chartPart('{{chart:financials}}')),
      'ppt/charts/_rels/chart1.xml.rels': strToU8(
        '<Relationships><Relationship Id="rId1" Type="…/package" Target="../embeddings/book.xlsx"/></Relationships>',
      ),
      'ppt/embeddings/book.xlsx': new Uint8Array([9, 9, 9]),
      'ppt/media/image1.png': new Uint8Array([1, 2, 3]),
    });
  }

  const resolved: ResolvedBindings = {
    byToken: new Map([
      ['quarter', { kind: 'text', value: '2026-Q2' }],
      ['chart:financials', { kind: 'chart', label: 'R&D financials', ...twoSeries }],
    ]),
    warnings: [],
  };

  it('re-datas the chart part AND replaces its stale embedded workbook', () => {
    const files = unzipSync(fillTemplate(pkg(), resolved).bytes);

    expect(strFromU8(files['ppt/slides/slide1.xml']!)).toContain('2026-Q2');

    const chart = strFromU8(files['ppt/charts/chart1.xml']!);
    expect(chart).toContain('<c:v>Platform</c:v>');
    expect(chart).not.toContain('Uploaded A');

    // The workbook is no longer the three bytes it was uploaded as.
    const book = files['ppt/embeddings/book.xlsx']!;
    expect(Array.from(book.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(strFromU8(unzipSync(book)['xl/worksheets/sheet1.xml']!)).toContain('<v>120</v>');

    // Everything else is preserved untouched.
    expect(Array.from(files['ppt/media/image1.png']!)).toEqual([1, 2, 3]);
  });

  it('reports a bound chart whose token the manifest never declared', () => {
    const bare: ResolvedBindings = { byToken: new Map(), warnings: [] };
    const { warnings } = fillTemplate(pkg(), bare);
    expect(warnings.join(' ')).toContain('not declared in the template manifest');
  });

  it('resolves ordinary text tokens inside a chart title, which never used to work', () => {
    const withText = zipSync({
      'ppt/charts/chart1.xml': strToU8(chartPart('Spend — {{quarter}}')),
    });
    const files = unzipSync(fillTemplate(withText, resolved).bytes);
    expect(strFromU8(files['ppt/charts/chart1.xml']!)).toContain('2026-Q2');
  });
});
