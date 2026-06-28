import { describe, it, expect } from 'vitest';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { resolveBindings, formatValue } from './bindingResolver';
import { fillSlideXml, fillTemplate } from './inPlaceFiller';
import { renderGenerativeDeck } from './render/GenerativeRenderer';
import type { DeckData, TokenManifest, ResolvedBindings } from './types';

function emptyData(): DeckData {
  return {
    meta: { quarter: '2026-Q2', tenantName: 'Acme', generatedAt: '2026-06-27T00:00:00.000Z' },
    investment: { rdToRevenuePct: 23, growthRdPct: null, totalActualUsd: 1000, totalPlanUsd: 1200, financialsByCategory: [], fteByCategory: [], initiatives: [['Init A', 'Grow']] },
    deliverables: { rows: [] },
    quality: { uptimePct: 99.9, mttrHours: null, alertsCount: 2, postProductionBugs: 1, supportTickets: 5, defectAging: [] },
    delivery: { deploymentFrequencyPerDay: 1.5, leadTimeHours: 12, changeFailureRatePct: 4, mttrHours: 3, totalPrsMerged: 40, totalIssuesResolved: 30 },
    people: { attritionRatePct: 5, devSatisfactionScore: null, waterfall: [], openPositions: [['UX Lead', 'high', '36', '2026-07-01']] },
    ai: { productivityScore: 72, programInvestedUsd: 50000, adoption: [], programs: [] },
    finance: { spendUsd: 200, forecastUsd: 400, costPerMergedPrUsd: 5 },
  };
}

describe('bindingResolver', () => {
  it('resolves text, formats, and warns on missing data', () => {
    const manifest: TokenManifest = {
      version: 1,
      bindings: [
        { token: 'quarter', bindingKey: 'meta.quarter', kind: 'text' },
        { token: 'rd', bindingKey: 'investment.rdToRevenuePct', kind: 'text', format: 'percent' },
        { token: 'growth', bindingKey: 'investment.growthRdPct', kind: 'text', format: 'percent' },
        { token: 'table:inits', bindingKey: 'investment.initiatives', kind: 'table' },
      ],
    };
    const r = resolveBindings(manifest, emptyData());
    expect(r.byToken.get('quarter')).toEqual({ kind: 'text', value: '2026-Q2' });
    expect(r.byToken.get('rd')).toEqual({ kind: 'text', value: '23%' });
    // growthRdPct is null → fallback + warning
    expect(r.byToken.get('growth')).toEqual({ kind: 'text', value: '—' });
    expect(r.warnings.some((w) => w.includes('growth'))).toBe(true);
    // table resolves to rows
    expect(r.byToken.get('table:inits')).toEqual({ kind: 'table', rows: [['Init A', 'Grow']] });
  });

  it('formatValue handles currency/number/percent', () => {
    expect(formatValue(1234, 'currency')).toBe('$1,234');
    expect(formatValue(1234, 'number')).toBe('1,234');
    expect(formatValue(50, 'percent')).toBe('50%');
    expect(formatValue('', 'number')).toBe('');
  });
});

describe('inPlaceFiller.fillSlideXml', () => {
  const repl = new Map<string, string>([['quarter', '2026-Q2'], ['name', 'A & B']]);

  it('substitutes a simple token', () => {
    const xml = '<a:p><a:r><a:t>{{quarter}}</a:t></a:r></a:p>';
    expect(fillSlideXml(xml, repl)).toContain('2026-Q2');
  });

  it('resolves a token split across runs (the OOXML split-run case)', () => {
    const xml = '<a:p><a:r><a:t>{{quar</a:t></a:r><a:r><a:t>ter}}</a:t></a:r></a:p>';
    const out = fillSlideXml(xml, repl);
    expect(out).toContain('2026-Q2');
    expect(out).not.toContain('{{');
  });

  it('xml-escapes replacement values', () => {
    const xml = '<a:p><a:r><a:t>{{name}}</a:t></a:r></a:p>';
    expect(fillSlideXml(xml, repl)).toContain('A &amp; B');
  });

  it('leaves unknown tokens untouched', () => {
    const xml = '<a:p><a:r><a:t>{{unknown}}</a:t></a:r></a:p>';
    expect(fillSlideXml(xml, repl)).toContain('{{unknown}}');
  });

  it('is a no-op when there are no tokens', () => {
    const xml = '<a:p><a:r><a:t>plain text</a:t></a:r></a:p>';
    expect(fillSlideXml(xml, repl)).toBe(xml);
  });
});

describe('fillTemplate (fflate round-trip)', () => {
  it('fills tokens in a minimal .pptx-shaped package and re-zips', () => {
    const pkg = zipSync({
      '[Content_Types].xml': strToU8('<Types/>'),
      'ppt/slides/slide1.xml': strToU8('<a:p><a:r><a:t>Q: {{quarter}}</a:t></a:r></a:p>'),
      'ppt/media/image1.png': new Uint8Array([1, 2, 3]),
    });
    const resolved: ResolvedBindings = { byToken: new Map([['quarter', { kind: 'text', value: '2026-Q2' }]]), warnings: [] };
    const out = fillTemplate(pkg, resolved);
    const files = unzipSync(out);
    expect(strFromU8(files['ppt/slides/slide1.xml']!)).toContain('2026-Q2');
    // media is preserved untouched
    expect(Array.from(files['ppt/media/image1.png']!)).toEqual([1, 2, 3]);
  });
});

describe('renderGenerativeDeck (pptxgenjs smoke)', () => {
  it('renders a valid .pptx (ZIP magic + Content_Types) for the board layout', async () => {
    const bytes = await renderGenerativeDeck(emptyData(), 'board');
    // ZIP magic "PK\x03\x04"
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const files = unzipSync(bytes);
    expect(Object.keys(files)).toContain('[Content_Types].xml');
  }, 20_000);
});
