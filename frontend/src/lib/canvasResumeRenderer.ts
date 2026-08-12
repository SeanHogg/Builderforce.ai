import { escapeHtml, markdownToHtml } from './richText';
import {
  RESUME_TEMPLATES,
  activeResumeRevision,
  normalizedResumeTemplate,
  renderResumeMarkdown,
  resumeFamilyFromNode,
  type CanvasResumeDocument,
  type CanvasResumeRevision,
  type ResumeOrientation,
  type ResumePageSize,
  type ResumeTemplateDefinition,
} from './canvasResume';
import type { CreationNodeData } from '@/components/creation-canvas/types';

export const RESUME_DOCUMENT_STYLES = `
  .canvasResumeDocument {
    --resume-accent: #7c3aed; --resume-paper: #fff; --resume-ink: #172033;
    min-height: 240mm; margin: 0; border-top: 5px solid var(--resume-accent);
    background: var(--resume-paper); color: var(--resume-ink); padding: 16mm 18mm;
    font: 10.5pt/1.45 Arial, Helvetica, sans-serif;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .canvasResumeDocument[data-font="serif"] { font-family: Georgia, "Times New Roman", serif; }
  .canvasResumeDocument[data-font="mono"] { font-family: Consolas, "SFMono-Regular", monospace; }
  .canvasResumeDocument[data-heading="divider"] h2 { border-top: .25mm solid var(--resume-accent); border-bottom: 0; padding-top: 1.5mm; }
  .canvasResumeDocument[data-heading="plain"] h2 { border: 0; text-transform: none; letter-spacing: normal; }
  .canvasResumeDocument[data-heading="underlined"] h2 { border-bottom-width: .6mm; text-transform: none; letter-spacing: normal; }
  .canvasResumeDocument[data-heading="caps"] h2 { border: 0; }
  .canvasResumeDocument[data-density="compact"] { padding: 11mm 13mm; font-size: 9.5pt; line-height: 1.32; }
  .canvasResumeDocument[data-density="spacious"] { padding: 20mm 21mm; font-size: 11pt; line-height: 1.62; }
  .canvasResumeDocument h1 { margin: 0 0 2mm; color: var(--resume-accent); font-size: 25pt; line-height: 1.08; }
  .canvasResumeDocument h2 { margin: 7mm 0 2.5mm; border-bottom: .35mm solid var(--resume-accent); color: var(--resume-accent); font-size: 11.5pt; letter-spacing: .06em; text-transform: uppercase; break-after: avoid; }
  .canvasResumeDocument h3 { margin: 4mm 0 1mm; font-size: 10.5pt; break-after: avoid; }
  .canvasResumeDocument p, .canvasResumeDocument ul { margin: 1.5mm 0; }
  .canvasResumeDocument ul { padding-left: 5mm; }
  .canvasResumeDocument li { margin: .7mm 0; }
  .canvasResumeDocument a { color: var(--resume-accent); }
  .canvasResumeColumns { display: grid; grid-template-columns: minmax(0, 1.65fr) minmax(0, .85fr); gap: 9mm; align-items: start; }
  .canvasResumeColumns > aside { border-left: .25mm solid color-mix(in srgb, var(--resume-accent) 28%, transparent); padding-left: 6mm; }
  .canvasResumeDocument section[data-layout="grid"] ul { display:grid; grid-template-columns:repeat(var(--section-columns,2),minmax(0,1fr)); gap:1.5mm 4mm; padding-left:0; list-style:none; }
  .canvasResumeDocument section[data-layout="cards"] h3 { border:.25mm solid color-mix(in srgb,var(--resume-accent) 22%,transparent); border-radius:1.5mm; padding:2mm; }
  .canvasResumeDocument section[data-layout="timeline"] { border-left:.5mm solid color-mix(in srgb,var(--resume-accent) 28%,transparent); padding-left:4mm; }
  .canvasResumeDocument[data-mode="hero"] h1 { padding-top: 4mm; font-size: 30pt; }
  .canvasResumeHero { display:grid; gap:6mm; margin:-16mm -18mm 8mm; padding:14mm 18mm; color:#fff; background:linear-gradient(135deg,var(--resume-accent),color-mix(in srgb,var(--resume-accent) 58%,#111827)); }
  .canvasResumeDocument[data-density="compact"] .canvasResumeHero { margin:-11mm -13mm 7mm; padding:10mm 13mm; }
  .canvasResumeDocument[data-density="spacious"] .canvasResumeHero { margin:-20mm -21mm 9mm; padding:16mm 21mm; }
  .canvasResumeHero[data-layout="split"] { grid-template-columns:auto minmax(0,1fr) minmax(45mm,.75fr); align-items:center; }
  .canvasResumeHero[data-layout="stacked"] { text-align:center; justify-items:center; }
  .canvasResumeHero[data-layout="compact"] { grid-template-columns:auto 1fr; align-items:center; padding-top:7mm; padding-bottom:7mm; }
  .canvasResumeAvatar { width:25mm; height:25mm; border-radius:999px; object-fit:cover; border:1mm solid rgb(255 255 255 / 45%); }
  .canvasResumeHero h1 { color:inherit; padding:0 !important; }
  .canvasResumeHero p { max-width:150mm; }
  .canvasResumeContacts { display:flex; flex-wrap:wrap; gap:2mm; margin-top:3mm; }
  .canvasResumeContacts a { color:inherit; border:.25mm solid rgb(255 255 255 / 48%); border-radius:99px; padding:1.3mm 3mm; text-decoration:none; }
  .canvasResumeHeroMedia video { display:block; width:100%; max-height:48mm; object-fit:cover; border-radius:2mm; }
  .canvasResumeMediaStrip { display:flex; flex-wrap:wrap; gap:2mm; margin:2mm 0 4mm; }
  .canvasResumeMediaStrip img,.canvasResumeMediaStrip video { width:32mm; height:24mm; border-radius:1.5mm; object-fit:cover; border:.25mm solid color-mix(in srgb,var(--resume-accent) 25%,transparent); }
  .canvasResumeMediaStrip a { display:inline-flex; align-items:center; min-height:8mm; padding:1mm 2mm; border:.25mm solid color-mix(in srgb,var(--resume-accent) 25%,transparent); border-radius:1.5mm; }
  @media print {
    .canvasResumeDocument { min-height: auto; border-radius: 0; box-shadow: none; }
    .canvasResumeDocument h2, .canvasResumeDocument h3, .canvasResumeDocument li { break-inside: avoid; }
  }
`;

export interface RenderedCanvasResume {
  revision: CanvasResumeRevision;
  template: ResumeTemplateDefinition;
  html: string;
}

const SECTION_FROM_HEADING: Record<string, string> = {
  summary: 'summary', experience: 'work', education: 'education', skills: 'skills', volunteer: 'volunteer', projects: 'projects', awards: 'awards', certifications: 'certificates', publications: 'publications', languages: 'languages', interests: 'interests', references: 'references',
};

const TEMPLATE_SECTION_ORDER: Partial<Record<ResumeTemplateDefinition['id'], string[]>> = {
  'intern-education-first': ['education', 'work', 'projects', 'skills', 'volunteer', 'awards', 'languages', 'interests'],
  'actor-headshot-hero': ['projects', 'skills', 'languages', 'education', 'awards', 'references'],
  'director-filmography-serif': ['projects', 'awards', 'publications', 'work', 'education', 'skills', 'references'],
};

interface RenderedSection { id: string; html: string }

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const safeUrl = (value: unknown, protocols = ['https:', 'http:']): string => {
  const candidate = text(value);
  if (!candidate) return '';
  try { const parsed = new URL(candidate); return protocols.includes(parsed.protocol) ? candidate : ''; } catch { return ''; }
};
const cloneDocument = (document: CanvasResumeDocument): CanvasResumeDocument => JSON.parse(JSON.stringify(document)) as CanvasResumeDocument;

function descriptorDocument(revision: CanvasResumeRevision, template: ResumeTemplateDefinition): CanvasResumeDocument | null {
  if (!revision.document || revision.structuredStale) return null;
  const document = cloneDocument(revision.document);
  const descriptor = normalizedResumeTemplate(template);
  if (Array.isArray(document.references)) document.references = document.references.filter((reference) => !reference || typeof reference !== 'object' || Array.isArray(reference) || (reference as Record<string, unknown>).private !== true);
  for (const [sectionId, rule] of Object.entries(descriptor.sections)) {
    const rows = document[sectionId];
    if (!Array.isArray(rows)) continue;
    const records = rows.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object' && !Array.isArray(row));
    if (rule?.showHighlights === false) for (const row of records) delete row.highlights;
    if (rule?.sortBy === 'date_desc' || rule?.sortBy === 'date_asc') rows.sort((a, b) => {
      const leftRecord = a as Record<string, unknown>; const rightRecord = b as Record<string, unknown>;
      const left = text(leftRecord.startDate ?? leftRecord.date ?? leftRecord.releaseDate); const right = text(rightRecord.startDate ?? rightRecord.date ?? rightRecord.releaseDate);
      return rule.sortBy === 'date_desc' ? right.localeCompare(left) : left.localeCompare(right);
    });
  }
  return document;
}

function mediaMarkup(document: CanvasResumeDocument, itemId: unknown): string {
  if (!text(itemId) || !Array.isArray(document.metaData)) return '';
  const items = document.metaData.filter((value): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value) && text((value as Record<string, unknown>).referenceId) === text(itemId));
  const markup = items.map((item) => {
    const url = safeUrl(item.url); if (!url) return '';
    const label = escapeHtml(text(item.name) || 'Media'); const kind = text(item.metaType).toLowerCase();
    if (kind.includes('image')) return `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer"><img src="${escapeHtml(url)}" alt="${label}" loading="lazy"></a>`;
    if (kind.includes('video') && /\.(mp4|webm)(?:$|\?)/i.test(url)) return `<video src="${escapeHtml(url)}" controls preload="metadata" aria-label="${label}"></video>`;
    return `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${label}</a>`;
  }).filter(Boolean).join('');
  return markup ? `<div class="canvasResumeMediaStrip">${markup}</div>` : '';
}

function enhanceSectionMedia(section: RenderedSection, document: CanvasResumeDocument, template: ResumeTemplateDefinition): RenderedSection {
  const rule = normalizedResumeTemplate(template).sections[section.id as keyof NonNullable<ResumeTemplateDefinition['sections']>];
  const rows = document[section.id] as unknown;
  if (!rule?.showMedia || !Array.isArray(rows)) return section;
  let index = 0;
  return { ...section, html: section.html.replace(/<h3>(.*?)<\/h3>/g, (heading) => `${heading}${mediaMarkup(document, (rows[index++] as Record<string, unknown> | undefined)?.id)}`) };
}

function heroMarkup(document: CanvasResumeDocument | null, template: ResumeTemplateDefinition): string {
  if (!document) return '';
  const descriptor = normalizedResumeTemplate(template); const basics = document.basics ?? {};
  if (!descriptor.hero.enabled) return '';
  const avatar = descriptor.hero.showAvatar ? safeUrl(basics.image) : '';
  const name = text(basics.name); const label = text(basics.label); const summary = descriptor.hero.showSummary ? text(basics.summary) : '';
  const contacts = descriptor.hero.showContactButtons ? [
    text(basics.email) ? { href: `mailto:${text(basics.email)}`, label: text(basics.email) } : null,
    text(basics.phone) ? { href: `tel:${text(basics.phone).replace(/[^+\d]/g, '')}`, label: text(basics.phone) } : null,
    safeUrl(basics.url) ? { href: safeUrl(basics.url), label: text(basics.url) } : null,
  ].filter((item): item is { href: string; label: string } => !!item) : [];
  const video = descriptor.hero.showVideo ? safeUrl(basics.video) : '';
  const identity = `<div class="canvasResumeIdentity">${name ? `<h1>${escapeHtml(name)}</h1>` : ''}${label ? `<p>${escapeHtml(label)}</p>` : ''}${contacts.length ? `<nav class="canvasResumeContacts">${contacts.map((item) => `<a href="${escapeHtml(item.href)}">${escapeHtml(item.label)}</a>`).join('')}</nav>` : ''}${summary ? `<p>${escapeHtml(summary)}</p>` : ''}</div>`;
  return `<header class="canvasResumeHero" data-layout="${descriptor.hero.layout}">${avatar ? `<img class="canvasResumeAvatar" src="${escapeHtml(avatar)}" alt="${escapeHtml(name)}">` : ''}${identity}${video && /\.(mp4|webm)(?:$|\?)/i.test(video) ? `<div class="canvasResumeHeroMedia"><video src="${escapeHtml(video)}" controls preload="metadata"></video></div>` : ''}</header>`;
}

function structuredTemplateHtml(markdown: string, template: ResumeTemplateDefinition, document: CanvasResumeDocument | null): string {
  const raw = markdownToHtml(markdown);
  const headings = [...raw.matchAll(/<h2>(.*?)<\/h2>/g)];
  if (!headings.length) return document && template.mode === 'hero' ? heroMarkup(document, template) : raw;
  const intro = document && template.mode === 'hero' && normalizedResumeTemplate(template).hero.enabled ? heroMarkup(document, template) : raw.slice(0, headings[0]!.index);
  const sections: RenderedSection[] = headings.map((heading, index) => {
    const id = SECTION_FROM_HEADING[heading[1]!.replace(/<[^>]+>/g, '').trim().toLowerCase()] ?? `section-${index}`;
    const end = headings[index + 1]?.index ?? raw.length;
    return { id, html: raw.slice(heading.index, end) };
  }).map((section) => document ? enhanceSectionMedia(section, document, template) : section);
  const order = TEMPLATE_SECTION_ORDER[template.id] ?? [];
  sections.sort((a, b) => {
    const ai = order.indexOf(a.id); const bi = order.indexOf(b.id);
    return (ai < 0 ? Number.MAX_SAFE_INTEGER : ai) - (bi < 0 ? Number.MAX_SAFE_INTEGER : bi);
  });
  const descriptor = normalizedResumeTemplate(template);
  const enabled = new Set<string>(descriptor.enabledSections);
  const visibleSections = sections.filter((section) => enabled.has(section.id) && !(template.mode === 'hero' && section.id === 'summary'));
  const wrap = (section: RenderedSection) => {
    const rule = descriptor.sections[section.id as keyof typeof descriptor.sections];
    return `<section data-section="${section.id}" data-layout="${rule?.layout ?? 'list'}" data-sort="${rule?.sortBy ?? 'manual'}" data-highlights="${rule?.showHighlights !== false}" data-media="${rule?.showMedia === true}" style="--section-columns:${rule?.columns ?? 2}">${section.html}</section>`;
  };
  if (template.columns === 1) return `${intro}<div class="canvasResumeMain">${visibleSections.map(wrap).join('')}</div>`;
  const sidebarIds = new Set<string>(template.sidebar);
  const sidebar = visibleSections.filter((section) => sidebarIds.has(section.id));
  const main = visibleSections.filter((section) => !sidebarIds.has(section.id));
  return `${intro}<div class="canvasResumeColumns"><main>${main.map(wrap).join('')}</main><aside>${sidebar.map(wrap).join('')}</aside></div>`;
}

const PAGE_MM: Record<ResumePageSize, { width: number; height: number }> = {
  letter: { width: 215.9, height: 279.4 }, legal: { width: 215.9, height: 355.6 }, a4: { width: 210, height: 297 },
};

export function resumePageDimensions(pageSize: ResumePageSize, orientation: ResumeOrientation): { width: number; height: number } {
  const page = PAGE_MM[pageSize];
  return orientation === 'landscape' ? { width: page.height, height: page.width } : page;
}

export function resumePageCss(revision: Pick<CanvasResumeRevision, 'pageSize' | 'orientation'>): string {
  return `@page{size:${revision.pageSize} ${revision.orientation};margin:0}`;
}

function templateFor(revision: CanvasResumeRevision): ResumeTemplateDefinition {
  return RESUME_TEMPLATES.find((template) => template.id === revision.templateId) ?? RESUME_TEMPLATES[0]!;
}

/** The exact artifact markup used on Canvas, in standalone HTML, and in print/PDF. */
export function renderCanvasResumeRevision(revision: CanvasResumeRevision): RenderedCanvasResume {
  const template = normalizedResumeTemplate(templateFor(revision));
  const document = descriptorDocument(revision, template);
  const markdown = document ? renderResumeMarkdown(document) : revision.markdown;
  const variables = `--resume-accent:${template.accent};--resume-paper:${template.paper};--resume-ink:${template.ink}`;
  return {
    revision,
    template,
    html: `<article class="canvasResumeDocument" data-template="${template.id}" data-mode="${template.mode}" data-hero-layout="${template.hero.layout}" data-show-avatar="${template.hero.showAvatar}" data-show-contact="${template.hero.showContactButtons}" data-show-summary="${template.hero.showSummary}" data-show-video="${template.hero.showVideo}" data-font="${template.font}" data-density="${template.density}" data-heading="${template.headingStyle}" data-columns="${template.columns}" data-page-size="${revision.pageSize}" data-orientation="${revision.orientation}" style="${variables}">${structuredTemplateHtml(markdown, template, document)}</article>`,
  };
}

export function renderedCanvasResume(data: CreationNodeData): RenderedCanvasResume | null {
  const family = resumeFamilyFromNode(data);
  return family ? renderCanvasResumeRevision(activeResumeRevision(family)) : null;
}

export function resumeHtmlFile(title: string, rendered: RenderedCanvasResume): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><style>${resumePageCss(rendered.revision)}body{margin:0;background:#fff}${RESUME_DOCUMENT_STYLES}</style></head><body>${rendered.html}</body></html>`;
}
