/**
 * The one place the Worker constructs a pptxgenjs presentation.
 *
 * pptxgenjs is loaded on first use, never at module scope: a static import put the
 * library's evaluation on the cold-start path of EVERY request the Worker serves,
 * though only deck and slide exports ever touch it. Both renderers
 * (deck/render/GenerativeRenderer, office/slidesRenderer) build through here, so
 * neither can quietly reintroduce the static import.
 */

import type PptxGenJS from 'pptxgenjs';

export type Presentation = PptxGenJS;
export type PresentationSlide = ReturnType<PptxGenJS['addSlide']>;

export async function createPresentation(): Promise<Presentation> {
  const { default: PptxGen } = await import('pptxgenjs');
  return new PptxGen();
}
