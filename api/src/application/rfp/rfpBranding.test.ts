import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { renderRfpDocHtml, renderRfpDocPptx, rfpDocSections, rfpDocSlides } from './rfpBranding';
import type { BrandPalette, RfpResponseBody } from './types';

const palette: BrandPalette = {
  primary: '#ff6b4a',
  secondary: '#0e7490',
  accent: '#22d3ee',
  text: '#111827',
  background: '#ffffff',
};

function sampleBody(): RfpResponseBody {
  return {
    executiveSummary: 'We raise to scale the product.',
    grounding: { mode: 'existing', projectId: 1, projectName: 'Acme' },
    capabilityRoster: {
      capabilities: ['billing'],
      keyComponents: [{ name: 'Ledger', responsibility: 'Money in' }],
      frameworks: ['Hono'],
      primaryLanguages: ['TypeScript'],
      valueProps: ['Deterministic quotes'],
      source: 'diagnostics',
    },
    costModel: {
      buildCostUsd: 80000,
      agenticCostUsd: 2000,
      marketingCostUsd: 8200,
      contingencyUsd: 9020,
      subtotalCostUsd: 99220,
      marginPct: 0.25,
      marginUsd: 25780,
      quotedPriceUsd: 125000,
      effortWeeks: 10,
      lineItems: [{ label: 'Build', category: 'build', amountUsd: 80000 }],
    },
    plan: {
      phases: [{
        name: 'Build',
        startDate: '2026-01-01',
        endDate: '2026-03-01',
        milestones: [{ name: 'Beta', date: '2026-02-01' }],
      }],
    },
    risks: [{ title: 'Key-person', severity: 'medium', mitigation: 'Documented runbooks' }],
    dependencies: [{ title: 'Bank feed', type: 'external', note: 'Plaid' }],
    timeline: { startDate: '2026-01-01', endDate: '2026-03-01', weeks: 8 },
    branding: { requester: palette, tenant: palette, blended: palette },
  };
}

describe('rfpDocSections / rfpDocSlides', () => {
  it('splits the body into one slide per heading, sharing the quoted price with HTML', () => {
    const body = sampleBody();
    const slides = rfpDocSlides(body);
    expect(slides.map((s) => s.title)).toEqual([
      'Executive summary',
      'Capabilities & approach',
      'Investment & commercials',
      'Delivery plan',
      'Key risks',
      'Dependencies',
    ]);

    const investment = rfpDocSections(body).find((b) => b.kind === 'table' && b.head[0] === 'Line item');
    expect(investment).toMatchObject({
      kind: 'table',
      rows: expect.arrayContaining([['Quoted price', '$125,000']]),
    });
    expect(renderRfpDocHtml({
      title: 'Fundraising pack — Acme',
      requesterOrgName: 'Lead fund',
      tenantName: 'Acme',
      body,
      generatedAtIso: '2026-04-01',
    })).toContain('$125,000');
  });
});

describe('renderRfpDocPptx', () => {
  it('produces a .pptx zip with a title slide plus one slide per section', { timeout: 20_000 }, async () => {
    const bytes = await renderRfpDocPptx({
      title: 'Fundraising pack — Acme',
      requesterOrgName: 'Lead fund',
      tenantName: 'Acme',
      body: sampleBody(),
      generatedAtIso: '2026-04-01',
    });
    expect(Array.from(bytes.slice(0, 2))).toEqual([0x50, 0x4b]);

    const files = unzipSync(bytes);
    const slideFiles = Object.keys(files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
    expect(slideFiles.length).toBe(7);

    const xml = slideFiles.map((f) => strFromU8(files[f]!)).join('\n');
    expect(xml).toContain('Executive summary');
    expect(xml).toContain('125,000');
    expect(xml).toContain('FF6B4A');
  });
});
