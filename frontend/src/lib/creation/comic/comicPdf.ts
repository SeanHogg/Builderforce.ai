/**
 * A minimal PDF 1.4 writer: one full-bleed RGB image per page, no other content.
 *
 * Pages arrive as raw RGB and are deflated by the shared builder (`../pdf/pdfDocument`),
 * so the embedded image is a plain FlateDecode stream with no PNG predictor to get wrong.
 * Object ids are sequential — catalog 1, page tree 2, then page / content / image per
 * page — so the cross-reference table is dense.
 */
import { createPdfBuilder } from '../pdf/pdfDocument';

export interface PdfPageImage {
  width: number;
  height: number;
  /** width*height*3 bytes, no alpha. */
  rgb: Uint8Array;
}

/** RGBA (as `getImageData` returns it) to RGB, compositing any transparency onto white. */
export function rgbaToRgb(rgba: Uint8ClampedArray | Uint8Array): Uint8Array {
  const out = new Uint8Array((rgba.length / 4) * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    const a = rgba[i + 3]! / 255;
    out[j] = Math.round(rgba[i]! * a + 255 * (1 - a));
    out[j + 1] = Math.round(rgba[i + 1]! * a + 255 * (1 - a));
    out[j + 2] = Math.round(rgba[i + 2]! * a + 255 * (1 - a));
  }
  return out;
}

export function buildPdf(pages: readonly PdfPageImage[]): Uint8Array {
  if (pages.length === 0) throw new Error('buildPdf: no pages');
  const pdf = createPdfBuilder();
  const catalogId = pdf.reserve();
  const pagesId = pdf.reserve();
  const pageIds: number[] = [];

  for (const page of pages) {
    const pageId = pdf.reserve();
    const contentId = pdf.reserve();
    const imageId = pdf.reserve();
    pageIds.push(pageId);
    pdf.object(pageId, `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${page.width} ${page.height}] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    pdf.stream(contentId, '', `q\n${page.width} 0 0 ${page.height} 0 0 cm\n/Im0 Do\nQ\n`);
    pdf.rgbImage(imageId, page.width, page.height, page.rgb);
  }
  pdf.pageTree(catalogId, pagesId, pageIds);
  return pdf.build(catalogId);
}
