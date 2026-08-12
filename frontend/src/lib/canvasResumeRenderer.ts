import { escapeHtml, markdownToHtml } from './richText';
import {
  RESUME_TEMPLATES,
  activeResumeRevision,
  resumeFamilyFromNode,
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
  .canvasResumeDocument section[data-layout="grid"] ul { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:1.5mm 4mm; padding-left:0; list-style:none; }
  .canvasResumeDocument section[data-layout="cards"] h3 { border:.25mm solid color-mix(in srgb,var(--resume-accent) 22%,transparent); border-radius:1.5mm; padding:2mm; }
  .canvasResumeDocument section[data-layout="timeline"] { border-left:.5mm solid color-mix(in srgb,var(--resume-accent) 28%,transparent); padding-left:4mm; }
  .canvasResumeDocument[data-mode="hero"] h1 { padding-top: 4mm; font-size: 30pt; }
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

const TEMPLATE_SECTION_LAYOUT: Partial<Record<ResumeTemplateDefinition['id'], Partial<Record<string, 'timeline' | 'cards' | 'grid' | 'list'>>>> = {
  'hired-default': { work: 'timeline', education: 'timeline', volunteer: 'timeline', skills: 'grid', languages: 'grid', projects: 'cards', interests: 'grid' },
  'intern-education-first': { skills: 'grid', languages: 'grid', interests: 'grid' },
  'actor-headshot-hero': { skills: 'grid', languages: 'grid' },
  'director-filmography-serif': { skills: 'grid' },
};

interface RenderedSection { id: string; html: string }

function structuredTemplateHtml(markdown: string, template: ResumeTemplateDefinition): string {
  const raw = markdownToHtml(markdown);
  const headings = [...raw.matchAll(/<h2>(.*?)<\/h2>/g)];
  if (!headings.length) return raw;
  const intro = raw.slice(0, headings[0]!.index);
  const sections: RenderedSection[] = headings.map((heading, index) => {
    const id = SECTION_FROM_HEADING[heading[1]!.replace(/<[^>]+>/g, '').trim().toLowerCase()] ?? `section-${index}`;
    const end = headings[index + 1]?.index ?? raw.length;
    return { id, html: raw.slice(heading.index, end) };
  });
  const order = TEMPLATE_SECTION_ORDER[template.id] ?? [];
  sections.sort((a, b) => {
    const ai = order.indexOf(a.id); const bi = order.indexOf(b.id);
    return (ai < 0 ? Number.MAX_SAFE_INTEGER : ai) - (bi < 0 ? Number.MAX_SAFE_INTEGER : bi);
  });
  const layouts = TEMPLATE_SECTION_LAYOUT[template.id] ?? {};
  const wrap = (section: RenderedSection) => `<section data-section="${section.id}" data-layout="${layouts[section.id] ?? 'list'}">${section.html}</section>`;
  if (template.columns === 1) return `${intro}<div class="canvasResumeMain">${sections.map(wrap).join('')}</div>`;
  const sidebarIds = new Set<string>(template.sidebar);
  const sidebar = sections.filter((section) => sidebarIds.has(section.id));
  const main = sections.filter((section) => !sidebarIds.has(section.id));
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
  const template = templateFor(revision);
  const variables = `--resume-accent:${template.accent};--resume-paper:${template.paper};--resume-ink:${template.ink}`;
  return {
    revision,
    template,
    html: `<article class="canvasResumeDocument" data-template="${template.id}" data-mode="${template.mode}" data-font="${template.font}" data-density="${template.density}" data-heading="${template.headingStyle}" data-columns="${template.columns}" data-page-size="${revision.pageSize}" data-orientation="${revision.orientation}" style="${variables}">${structuredTemplateHtml(revision.markdown, template)}</article>`,
  };
}

export function renderedCanvasResume(data: CreationNodeData): RenderedCanvasResume | null {
  const family = resumeFamilyFromNode(data);
  return family ? renderCanvasResumeRevision(activeResumeRevision(family)) : null;
}

export function resumeHtmlFile(title: string, rendered: RenderedCanvasResume): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><style>${resumePageCss(rendered.revision)}body{margin:0;background:#fff}${RESUME_DOCUMENT_STYLES}</style></head><body>${rendered.html}</body></html>`;
}
