/**
 * `.pptx` → slides, in presentation order.
 */

import { decodeXmlText, openZip } from './container';

/* ----------------------------------------------------------------- PPTX --- */

export interface OfficeSlide { title: string; bullets: string[]; notes?: string }

function slideParagraphs(xml: string): string[] {
  return [...xml.matchAll(/<a:p(?:\s[^>]*)?>([\s\S]*?)<\/a:p>|<a:p(?:\s[^>]*)?\/>/g)]
    .map((paragraph) => [...(paragraph[1] ?? '').matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map((text) => decodeXmlText(text[1]!)).join('').trim())
    .filter(Boolean);
}

/** A slide's title placeholder, when the deck declared one — the first text box
 * on the slide is often a subtitle or a page number instead. */
function placeholderTitle(xml: string): string | null {
  for (const shape of xml.matchAll(/<p:sp(?:\s[^>]*)?>([\s\S]*?)<\/p:sp>/g)) {
    const body = shape[1]!;
    if (!/<p:ph\b[^>]*type="(?:ctrTitle|title)"/.test(body)) continue;
    const text = slideParagraphs(body).join(' ').trim();
    if (text) return text;
  }
  return null;
}

/** Read the slides of a `.pptx` deck in presentation order. */
export async function readPptx(bytes: Uint8Array, maxSlides = 200): Promise<OfficeSlide[] | null> {
  const archive = openZip(bytes);
  if (!archive) return null;
  const slidePaths = archive.names
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((left, right) => Number(/(\d+)\.xml$/.exec(left)![1]) - Number(/(\d+)\.xml$/.exec(right)![1]))
    .slice(0, maxSlides);
  if (!slidePaths.length) return null;
  const slides: OfficeSlide[] = [];
  for (const path of slidePaths) {
    const xml = await archive.readText(path);
    if (!xml) continue;
    const paragraphs = slideParagraphs(xml);
    const declared = placeholderTitle(xml);
    const title = declared ?? paragraphs[0] ?? '';
    const bullets = declared ? paragraphs.filter((line) => line !== declared) : paragraphs.slice(1);
    const notesXml = await archive.readText(path.replace('ppt/slides/', 'ppt/notesSlides/').replace('slide', 'notesSlide'));
    const notes = notesXml ? slideParagraphs(notesXml).join('\n').trim() : '';
    if (!title && !bullets.length && !notes) continue;
    slides.push({ title, bullets, ...(notes ? { notes } : {}) });
  }
  return slides.length ? slides : null;
}
