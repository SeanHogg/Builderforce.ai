/**
 * Print a document to paper or PDF — the browser's own print pipeline, no
 * rendering dependency.
 *
 * "Save as PDF" is a print destination on every platform we ship to, so a PDF
 * export is a print with the right stylesheet rather than a second document
 * renderer bundled into the app. That matters twice over: it costs nothing in
 * bundle weight, and it works for a GUEST session, where the server-rendered
 * .docx path cannot run because `/api/exports` is authenticated.
 *
 * The page is composed in a hidden same-origin iframe rather than a popup: a
 * popup is blocked by default when the click is one frame removed from the
 * print call, and it steals focus from the canvas.
 */

import { escapeHtml, markdownToHtml } from './richText';
import { PICTURE_KINDS } from './canvasExports';
import { canvasDiagram, canvasObjectMarkdown, canvasSlides, type CanvasSlide } from './canvasDocuments';
import { creativePreviewImageUrl } from './creationDeliverables';
import type { CreationNodeData } from '@/components/creation-canvas/types';
import { RESUME_DOCUMENT_STYLES, renderedCanvasResume, resumePageCss } from './canvasResumeRenderer';

/**
 * The printed page.
 *
 * Ink on paper, deliberately NOT theme tokens: this markup never renders in the
 * application — it exists only inside the hidden print frame, which has no
 * access to the app's stylesheet and no light/dark state to honour. A dark
 * document sent to a printer is a page of solid toner.
 */
const PRINT_STYLES = `
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 0; background: #fff; color: #111827;
    font: 11pt/1.55 Georgia, "Times New Roman", serif;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  h1, h2, h3, h4, h5, h6 { margin: 1.2em 0 .45em; font-family: Helvetica, Arial, sans-serif; line-height: 1.25; break-after: avoid; page-break-after: avoid; }
  h1 { margin-top: 0; font-size: 20pt; letter-spacing: -.01em; }
  h2 { font-size: 15pt; }
  h3 { font-size: 12.5pt; }
  h4, h5, h6 { font-size: 11pt; }
  p { margin: 0 0 .7em; orphans: 3; widows: 3; }
  ul, ol { margin: 0 0 .7em; padding-left: 1.4em; }
  li { margin: .18em 0; }
  blockquote { margin: .8em 0; padding: .1em 0 .1em .9em; border-left: 2px solid #9ca3af; color: #374151; break-inside: avoid; }
  code { font: 9.5pt/1.4 "SFMono-Regular", Consolas, monospace; background: #f3f4f6; padding: .08em .3em; border-radius: 6px; }
  pre { margin: .8em 0; padding: .7em .9em; background: #f3f4f6; border-radius: 6px; overflow: visible; white-space: pre-wrap; word-break: break-word; break-inside: avoid; }
  pre code { padding: 0; background: none; }
  table { width: 100%; border-collapse: collapse; margin: .8em 0; font-size: 9.5pt; break-inside: avoid; }
  th, td { padding: .35em .5em; border: 1px solid #9ca3af; text-align: left; vertical-align: top; }
  th { background: #f3f4f6; font-family: Helvetica, Arial, sans-serif; }
  hr { margin: 1.2em 0; border: 0; border-top: 1px solid #9ca3af; }
  a { color: #1d4ed8; }
  img { max-width: 100%; height: auto; }
  /* Page breaks the author declared on the canvas are the ones we honour. */
  .pageBreak { break-before: page; page-break-before: always; }
`;

/** Give up on the print dialog after this long and reclaim the frame, so a user
 * who dismissed it without printing does not accumulate hidden iframes. */
const FRAME_TTL_MS = 10 * 60_000;

/**
 * Print a body of HTML as a standalone document.
 *
 * Returns `false` when there is no document to print into (server render, or a
 * browser that refused the frame) so the caller can report a real failure
 * instead of claiming a download that never happened.
 */
export function printHtmlDocument(title: string, bodyHtml: string, extraStyles = ''): boolean {
  if (typeof document === 'undefined') return false;
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('title', title);
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none;';
  document.body.appendChild(frame);
  const view = frame.contentWindow;
  const page = frame.contentDocument ?? view?.document;
  if (!view || !page) { frame.remove(); return false; }

  page.open();
  page.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${PRINT_STYLES}${extraStyles}</style></head><body>${bodyHtml}</body></html>`);
  page.close();

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    window.clearTimeout(timer);
    frame.remove();
  };
  const timer = window.setTimeout(release, FRAME_TTL_MS);
  // Chrome fires `afterprint` on the frame's own window; Safari fires it on the
  // top window. Listening on both, once each, covers the pair without leaking.
  view.addEventListener('afterprint', release, { once: true });
  window.addEventListener('afterprint', release, { once: true });

  const run = () => {
    try {
      view.focus();
      view.print();
    } catch {
      release();
    }
  };
  // Images inside the document have to have loaded, or the printed page has
  // holes where they should be.
  if (page.readyState === 'complete') run(); else frame.addEventListener('load', run, { once: true });
  return true;
}

/**
 * Print a markdown document.
 *
 * Rendered through the same {@link markdownToHtml} the editor opens the document
 * with, so the PDF a person saves is the document they were just looking at.
 * The title is NOT injected as a heading — an authored document opens with its
 * own `# Title`, and adding a second one prints it twice.
 */
export function printMarkdownDocument(title: string, markdown: string): boolean {
  const body = markdownToHtml(markdown);
  return printHtmlDocument(title, body || `<h1>${escapeHtml(title)}</h1>`);
}

/** A deck prints as a deck: one slide per landscape page, not as an outline. */
const DECK_STYLES = `
  @page { size: A4 landscape; margin: 12mm; }
  body { font-family: Helvetica, Arial, sans-serif; }
  .slide { display: flex; flex-direction: column; justify-content: center; min-height: 168mm; break-after: page; page-break-after: always; }
  .slide:last-child { break-after: auto; page-break-after: auto; }
  .slide h2 { margin: 0 0 .6em; font-size: 26pt; line-height: 1.15; letter-spacing: -.015em; }
  .slide ul { margin: 0; padding-left: 1.1em; font-size: 14pt; line-height: 1.5; }
  .slide li { margin: .3em 0; }
  .slide .notes { margin-top: auto; padding-top: .8em; border-top: 1px solid #9ca3af; color: #4b5563; font-size: 9pt; }
  .slide .number { position: absolute; right: 12mm; color: #6b7280; font-size: 9pt; }
`;

function slideHtml(slide: CanvasSlide, index: number): string {
  const bullets = slide.bullets.length ? `<ul>${slide.bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join('')}</ul>` : '';
  const notes = slide.notes ? `<div class="notes">${escapeHtml(slide.notes)}</div>` : '';
  return `<section class="slide"><span class="number">${index + 1}</span><h2>${escapeHtml(slide.title)}</h2>${bullets}${notes}</section>`;
}

/** Print a deck. Returns `false` when the object holds no slides, so an empty
 * deck reports that rather than opening a blank print dialog. */
export function printSlideDeck(title: string, slides: readonly CanvasSlide[]): boolean {
  if (!slides.length) return false;
  return printHtmlDocument(title, slides.map(slideHtml).join(''), DECK_STYLES);
}

/** A drawing prints on one landscape page, scaled to fit rather than cropped. */
const DRAWING_STYLES = `
  @page { size: A4 landscape; margin: 12mm; }
  .drawing { display: flex; align-items: center; justify-content: center; height: 168mm; }
  .drawing svg { max-width: 100%; max-height: 100%; height: auto; }
`;

/** Print a rendered drawing, given the serialized SVG for it. */
export function printSvgDrawing(title: string, svg: string): boolean {
  // The XML prolog is for a standalone .svg FILE; inside an HTML document it
  // would render as stray text above the drawing.
  const markup = svg.replace(/^<\?xml[^>]*\?>\s*/, '');
  return printHtmlDocument(title, `<div class="drawing">${markup}</div>`, DRAWING_STYLES);
}

/**
 * Print whatever this object is, as the thing it is.
 *
 * One switch, so "export as PDF" means a paginated document for a document, a
 * slide per page for a deck, and a scaled drawing for a diagram — rather than
 * every kind being flattened through the same markdown renderer because that
 * was the branch that already existed.
 */
export function printCanvasObject(data: CreationNodeData, svg: string | null): boolean {
  if (data.kind === 'slides') return printSlideDeck(data.title, canvasSlides(data));
  if (data.kind === 'resume') {
    const rendered = renderedCanvasResume(data);
    if (rendered) return printHtmlDocument(data.title, rendered.html, `${resumePageCss(rendered.revision)}${RESUME_DOCUMENT_STYLES}`);
  }
  if (svg) return printSvgDrawing(data.title, svg);
  // A strip, a panel, a rendered frame — a picture prints as the picture, at the
  // size the page allows, rather than as the markdown brief that produced it.
  const picture = creativePreviewImageUrl(data);
  if (picture) return printHtmlDocument(data.title, `<div class="drawing"><img src="${escapeHtml(picture)}" alt="${escapeHtml(data.title)}"></div>`, DRAWING_STYLES);
  if (PICTURE_KINDS.has(data.kind)) return false;
  return printMarkdownDocument(data.title, canvasObjectMarkdown(data));
}

/** Whether this object currently HAS something to print, asked before the button
 * is offered rather than after it fails. */
export function canPrintCanvasObject(data: CreationNodeData): boolean {
  if (data.kind === 'slides') return canvasSlides(data).length > 0;
  if (data.kind === 'diagram') return !!canvasDiagram(data);
  if (PICTURE_KINDS.has(data.kind)) return !!creativePreviewImageUrl(data);
  return true;
}

/**
 * The document as a standalone, self-contained HTML file.
 *
 * The same markup and the SAME stylesheet the PDF is printed from, so a person
 * who takes the HTML and a person who takes the PDF are holding the same
 * document. Self-contained because a file that pulls a stylesheet off our origin
 * stops rendering the moment it is emailed to someone.
 */
export function markdownHtmlDocument(title: string, markdown: string): string {
  const body = markdownToHtml(markdown) || `<h1>${escapeHtml(title)}</h1>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><style>${PRINT_STYLES}
  /* On screen the page needs a margin of its own; @page only applies on paper. */
  body { max-width: 46rem; margin: 0 auto; padding: 2.5rem 1.25rem; }
</style></head><body>${body}</body></html>`;
}
