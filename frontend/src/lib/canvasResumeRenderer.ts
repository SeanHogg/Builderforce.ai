import { escapeHtml, markdownToHtml } from './richText';
import {
  RESUME_TEMPLATES,
  activeResumeRevision,
  resumeFamilyFromNode,
  type CanvasResumeRevision,
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
  .canvasResumeDocument[data-density="compact"] { padding: 11mm 13mm; font-size: 9.5pt; line-height: 1.32; }
  .canvasResumeDocument[data-density="spacious"] { padding: 20mm 21mm; font-size: 11pt; line-height: 1.62; }
  .canvasResumeDocument h1 { margin: 0 0 2mm; color: var(--resume-accent); font-size: 25pt; line-height: 1.08; }
  .canvasResumeDocument h2 { margin: 7mm 0 2.5mm; border-bottom: .35mm solid var(--resume-accent); color: var(--resume-accent); font-size: 11.5pt; letter-spacing: .06em; text-transform: uppercase; break-after: avoid; }
  .canvasResumeDocument h3 { margin: 4mm 0 1mm; font-size: 10.5pt; break-after: avoid; }
  .canvasResumeDocument p, .canvasResumeDocument ul { margin: 1.5mm 0; }
  .canvasResumeDocument ul { padding-left: 5mm; }
  .canvasResumeDocument li { margin: .7mm 0; }
  .canvasResumeDocument a { color: var(--resume-accent); }
  .canvasResumeDocument[data-columns="2"] > ul { columns: 2; column-gap: 9mm; }
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
    html: `<article class="canvasResumeDocument" data-template="${template.id}" data-mode="${template.mode}" data-font="${template.font}" data-density="${template.density}" data-columns="${template.columns}" style="${variables}">${markdownToHtml(revision.markdown)}</article>`,
  };
}

export function renderedCanvasResume(data: CreationNodeData): RenderedCanvasResume | null {
  const family = resumeFamilyFromNode(data);
  return family ? renderCanvasResumeRevision(activeResumeRevision(family)) : null;
}

export function resumeHtmlFile(title: string, rendered: RenderedCanvasResume): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><style>@page{size:A4;margin:0}body{margin:0;background:#fff}${RESUME_DOCUMENT_STYLES}</style></head><body>${rendered.html}</body></html>`;
}
