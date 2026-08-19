/**
 * RFP co-branding (PRD 15).
 *
 * An RFP request carries the ASKING business's palette (`requester_brand`); the responder
 * tenant's comes from `tenants.brand_palette` (migration 0483), falling back to the
 * Builderforce accent set for a tenant that has not set one. `blendPalettes` co-brands the two — the requesting org leads the header
 * (their colours make the buyer feel seen), the responder tenant owns the accent — and
 * `renderRfpDocHtml` emits a self-contained, inline-styled proposal document (no external
 * assets) that any browser prints to PDF cleanly, mirroring `tabularExport.toHtmlTable`.
 *
 * `renderRfpDocPdf` emits the SAME proposal as real PDF bytes. Both read one
 * source — the `RfpResponseBody` — through `rfpDocSections`, so the file a buyer
 * receives and the page a seller previews cannot describe different numbers. The
 * HTML is still the on-screen preview and the emailable single file; the PDF is
 * the attachment, and it exists because "print this page yourself" is not an
 * export a proposal can be sent with.
 */
import { renderPdf } from '../office/pdfWriter';
import type { MdBlock } from '../office/markdownBlocks';
import type { BrandPalette, RfpResponseBody } from './types';

/** The responder tenant's default palette (Builderforce coral/cyan) when none stored. */
export const DEFAULT_TENANT_PALETTE: BrandPalette = {
  primary: '#ff6b4a',
  secondary: '#0e7490',
  accent: '#22d3ee',
  text: '#111827',
  background: '#ffffff',
};

/** A neutral fallback for a requesting org that didn't supply colours. */
export const DEFAULT_REQUESTER_PALETTE: BrandPalette = {
  primary: '#334155',
  secondary: '#64748b',
  accent: '#0ea5e9',
  text: '#111827',
  background: '#ffffff',
};

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Normalise a colour to a safe #rrggbb, or a fallback if invalid. */
export function safeHex(v: unknown, fallback: string): string {
  if (typeof v !== 'string') return fallback;
  const s = v.trim();
  if (!HEX.test(s)) return fallback;
  if (s.length === 4) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`.toLowerCase();
  return s.toLowerCase();
}

/** Coerce an arbitrary object into a full BrandPalette, filling gaps from a fallback. */
export function normalizePalette(raw: unknown, fallback: BrandPalette): BrandPalette {
  const p = (raw ?? {}) as Partial<BrandPalette>;
  const logo = typeof p.logoUrl === 'string' && p.logoUrl.trim() ? p.logoUrl.trim().slice(0, 2000) : null;
  return {
    primary: safeHex(p.primary, fallback.primary),
    secondary: safeHex(p.secondary, fallback.secondary),
    accent: safeHex(p.accent, fallback.accent),
    text: safeHex(p.text, fallback.text),
    background: safeHex(p.background, fallback.background),
    logoUrl: logo,
  };
}

/**
 * Co-brand: the requesting org's primary leads (header/title), the responder tenant's
 * primary becomes the accent/CTA, secondaries and text/background reconcile to keep the
 * document readable. Deterministic — same inputs, same document.
 */
export function blendPalettes(requester: BrandPalette, tenant: BrandPalette): BrandPalette {
  return {
    primary: requester.primary,
    secondary: tenant.primary,
    accent: tenant.accent,
    text: requester.text || tenant.text,
    background: '#ffffff',
    logoUrl: tenant.logoUrl ?? requester.logoUrl ?? null,
  };
}

function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const money = (n: number): string => `$${Math.round(n).toLocaleString('en-US')}`;

/**
 * Render the response body to a complete, self-contained branded HTML document.
 * Inline `<style>` only — safe to email, download, or print-to-PDF.
 */
export function renderRfpDocHtml(opts: {
  title: string;
  requesterOrgName: string;
  tenantName: string;
  body: RfpResponseBody;
  generatedAtIso: string;
}): string {
  const { body } = opts;
  const b = body.branding.blended;
  const c = body.costModel;

  const logo = b.logoUrl
    ? `<img src="${esc(b.logoUrl)}" alt="" style="height:44px;max-width:180px;object-fit:contain" />`
    : '';

  const components = body.capabilityRoster.keyComponents.length
    ? `<table class="grid"><thead><tr><th>Component</th><th>Responsibility</th></tr></thead><tbody>${body.capabilityRoster.keyComponents
        .map((k) => `<tr><td>${esc(k.name)}</td><td>${esc(k.responsibility)}</td></tr>`)
        .join('')}</tbody></table>`
    : '<p class="muted">Greenfield — capabilities proposed from the requirements.</p>';

  const costRows = c.lineItems
    .map((li) => `<tr><td>${esc(li.label)}</td><td class="num">${money(li.amountUsd)}</td></tr>`)
    .join('');

  const phases = body.plan.phases
    .map(
      (p) => `<tr><td>${esc(p.name)}</td><td>${esc(p.startDate)} → ${esc(p.endDate)}</td><td>${
        p.milestones.length ? p.milestones.map((m) => `${esc(m.name)} (${esc(m.date)})`).join('; ') : '—'
      }</td></tr>`,
    )
    .join('');

  const risks = body.risks
    .map((r) => `<tr><td>${esc(r.title)}</td><td><span class="sev sev-${esc(r.severity)}">${esc(r.severity)}</span></td><td>${esc(r.mitigation)}</td></tr>`)
    .join('');

  const deps = body.dependencies
    .map((d) => `<tr><td>${esc(d.title)}</td><td>${esc(d.type)}</td><td>${esc(d.note)}</td></tr>`)
    .join('');

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.title)}</title>
<style>
  :root {
    --brand-primary: ${b.primary}; --brand-secondary: ${b.secondary};
    --brand-accent: ${b.accent}; --doc-text: ${b.text}; --doc-bg: ${b.background};
  }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; color: var(--doc-text);
         background: var(--doc-bg); margin: 0; padding: 0; line-height: 1.5; }
  .wrap { max-width: 900px; margin: 0 auto; padding: 32px 28px 64px; }
  header.doc { display: flex; align-items: center; justify-content: space-between; gap: 16px;
    border-bottom: 4px solid var(--brand-primary); padding-bottom: 16px; margin-bottom: 8px; flex-wrap: wrap; }
  header.doc .org { font-size: 13px; color: var(--brand-secondary); font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
  header.doc h1 { font-size: 26px; margin: 4px 0 0; color: var(--brand-primary); }
  .price-badge { background: var(--brand-primary); color: #fff; border-radius: 10px; padding: 12px 18px; text-align: right; }
  .price-badge .label { font-size: 11px; opacity: .85; text-transform: uppercase; letter-spacing: .05em; }
  .price-badge .val { font-size: 24px; font-weight: 700; }
  h2 { font-size: 16px; margin: 28px 0 10px; color: var(--brand-secondary); border-left: 4px solid var(--brand-accent); padding-left: 10px; }
  p { margin: 8px 0; } .muted { color: #6b7280; }
  ul { margin: 8px 0; padding-left: 20px; } li { margin: 3px 0; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; margin: 6px 0; }
  th, td { border: 1px solid #e5e7eb; padding: 7px 10px; text-align: left; vertical-align: top; }
  thead th { background: #f8fafc; font-weight: 600; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tr.total td { font-weight: 700; background: #f1f5f9; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 999px; padding: 2px 10px; font-size: 12px; }
  .sev { border-radius: 6px; padding: 1px 8px; font-size: 12px; text-transform: capitalize; }
  .sev-high { background: #fee2e2; color: #991b1b; } .sev-medium { background: #fef3c7; color: #92400e; } .sev-low { background: #dcfce7; color: #166534; }
  .foot { margin-top: 40px; font-size: 12px; color: #6b7280; border-top: 1px solid #e5e7eb; padding-top: 12px; }
  @media print { .wrap { padding: 0 12px; } }
</style></head>
<body><div class="wrap">
  <header class="doc">
    <div>
      <div class="org">Prepared for ${esc(opts.requesterOrgName || 'the requesting organisation')}</div>
      <h1>${esc(opts.title)}</h1>
      <div class="muted" style="font-size:13px">By ${esc(opts.tenantName)}</div>
    </div>
    <div style="display:flex;align-items:center;gap:16px">
      ${logo}
      <div class="price-badge"><div class="label">Quoted price</div><div class="val">${money(c.quotedPriceUsd)}</div></div>
    </div>
  </header>

  <h2>Executive summary</h2>
  <p>${esc(body.executiveSummary)}</p>

  <h2>Capabilities &amp; approach</h2>
  ${body.capabilityRoster.valueProps.length ? `<div class="chips">${body.capabilityRoster.valueProps.map((v) => `<span class="chip">${esc(v)}</span>`).join('')}</div>` : ''}
  ${components}
  ${body.capabilityRoster.frameworks.length ? `<p class="muted">Stack: ${body.capabilityRoster.frameworks.map(esc).join(', ')}</p>` : ''}

  <h2>Investment &amp; commercials</h2>
  <table><thead><tr><th>Line item</th><th class="num">Amount</th></tr></thead><tbody>
    ${costRows}
    <tr class="total"><td>Quoted price</td><td class="num">${money(c.quotedPriceUsd)}</td></tr>
  </tbody></table>

  <h2>Delivery plan</h2>
  <table><thead><tr><th>Phase</th><th>Timeline</th><th>Milestones</th></tr></thead><tbody>${phases || '<tr><td colspan="3" class="muted">—</td></tr>'}</tbody></table>
  <p class="muted">Estimated delivery: ${esc(body.timeline.startDate)} → ${esc(body.timeline.endDate)} (${body.timeline.weeks} weeks).</p>

  <h2>Key risks</h2>
  <table><thead><tr><th>Risk</th><th>Severity</th><th>Mitigation</th></tr></thead><tbody>${risks || '<tr><td colspan="3" class="muted">—</td></tr>'}</tbody></table>

  <h2>Dependencies</h2>
  <table><thead><tr><th>Dependency</th><th>Type</th><th>Note</th></tr></thead><tbody>${deps || '<tr><td colspan="3" class="muted">—</td></tr>'}</tbody></table>

  <div class="foot">Generated ${esc(opts.generatedAtIso)} · ${esc(opts.tenantName)} · Confidential pre-sales proposal.</div>
</div></body></html>`;
}


// ── the one section model both renderers read ────────────────────────────────

/**
 * The proposal as ordered blocks.
 *
 * Extracted so the HTML document and the PDF are two RENDERINGS of one reading
 * of the body, rather than two hand-written documents that drift apart the first
 * time a section is added to one of them.
 */
export function rfpDocSections(body: RfpResponseBody): MdBlock[] {
  const c = body.costModel;
  const blocks: MdBlock[] = [];

  blocks.push({ kind: 'heading', level: 1, text: 'Executive summary' });
  blocks.push({ kind: 'paragraph', text: body.executiveSummary });

  blocks.push({ kind: 'heading', level: 1, text: 'Capabilities & approach' });
  if (body.capabilityRoster.valueProps.length) {
    blocks.push({ kind: 'list', ordered: false, items: body.capabilityRoster.valueProps });
  }
  if (body.capabilityRoster.keyComponents.length) {
    blocks.push({
      kind: 'table',
      head: ['Component', 'Responsibility'],
      rows: body.capabilityRoster.keyComponents.map((k) => [k.name, k.responsibility]),
    });
  } else {
    blocks.push({ kind: 'paragraph', text: 'Greenfield — capabilities proposed from the requirements.' });
  }
  if (body.capabilityRoster.frameworks.length) {
    blocks.push({ kind: 'paragraph', text: `Stack: ${body.capabilityRoster.frameworks.join(', ')}` });
  }

  blocks.push({ kind: 'heading', level: 1, text: 'Investment & commercials' });
  blocks.push({
    kind: 'table',
    head: ['Line item', 'Amount'],
    rows: [...c.lineItems.map((li) => [li.label, money(li.amountUsd)]), ['Quoted price', money(c.quotedPriceUsd)]],
  });

  blocks.push({ kind: 'heading', level: 1, text: 'Delivery plan' });
  blocks.push({
    kind: 'table',
    head: ['Phase', 'Timeline', 'Milestones'],
    rows: body.plan.phases.length
      ? body.plan.phases.map((p) => [
        p.name,
        `${p.startDate} - ${p.endDate}`,
        p.milestones.length ? p.milestones.map((m) => `${m.name} (${m.date})`).join('; ') : '-',
      ])
      : [['-', '-', '-']],
  });
  blocks.push({
    kind: 'paragraph',
    text: `Estimated delivery: ${body.timeline.startDate} to ${body.timeline.endDate} (${body.timeline.weeks} weeks).`,
  });

  blocks.push({ kind: 'heading', level: 1, text: 'Key risks' });
  blocks.push({
    kind: 'table',
    head: ['Risk', 'Severity', 'Mitigation'],
    rows: body.risks.length ? body.risks.map((r) => [r.title, r.severity, r.mitigation]) : [['-', '-', '-']],
  });

  blocks.push({ kind: 'heading', level: 1, text: 'Dependencies' });
  blocks.push({
    kind: 'table',
    head: ['Dependency', 'Type', 'Note'],
    rows: body.dependencies.length ? body.dependencies.map((d) => [d.title, d.type, d.note]) : [['-', '-', '-']],
  });

  return blocks;
}

/**
 * The branded proposal as real PDF bytes — the attachment, not a print dialog.
 *
 * Co-branding survives the format: the blended primary paints the cover band and
 * the section rules, the blended secondary paints the table header bands, so the
 * file a buyer opens is recognisably the same document as the preview.
 */
export function renderRfpDocPdf(opts: {
  title: string;
  requesterOrgName: string;
  tenantName: string;
  body: RfpResponseBody;
  generatedAtIso: string;
}): Uint8Array {
  const b = opts.body.branding.blended;
  return renderPdf({
    blocks: rfpDocSections(opts.body),
    title: opts.title,
    subtitle: `Prepared for ${opts.requesterOrgName || 'the requesting organisation'} by ${opts.tenantName}`,
    badge: { label: 'Quoted price', value: money(opts.body.costModel.quotedPriceUsd) },
    footer: `Generated ${opts.generatedAtIso} - ${opts.tenantName} - Confidential pre-sales proposal`,
    theme: { accent: b.primary, secondary: b.secondary },
  });
}
