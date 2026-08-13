/**
 * Author and extend portable draw.io files whose source material is an image.
 *
 * The image is embedded as a data URL in an mxCell, so the diagram remains a
 * single account-backed file: there is no expiring blob URL and downloading the
 * `.drawio` file does not lose its source artwork.
 */

export interface DrawioImageAsset {
  name: string;
  dataUrl: string;
  width?: number;
  height?: number;
}

const DEFAULT_WIDTH = 640;
const DEFAULT_HEIGHT = 420;
const GAP = 48;

function xmlAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function safeDimension(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Math.max(40, Math.min(Math.round(value!), 2400)) : fallback;
}

function imageCell(asset: DrawioImageAsset, id: string, x: number, y: number): string {
  const width = safeDimension(asset.width, DEFAULT_WIDTH);
  const height = safeDimension(asset.height, DEFAULT_HEIGHT);
  const style = `shape=image;imageAspect=0;aspect=fixed;image=${asset.dataUrl};`;
  return `<mxCell id="${xmlAttribute(id)}" value="${xmlAttribute(asset.name)}" style="${xmlAttribute(style)}" vertex="1" parent="1"><mxGeometry x="${x}" y="${y}" width="${width}" height="${height}" as="geometry" /></mxCell>`;
}

export function createDrawioImageCanvas(asset: DrawioImageAsset): string {
  const cell = imageCell(asset, 'image-1', 40, 40);
  return `<mxfile host="Builderforce" agent="Builderforce Creation Canvas"><diagram id="builderforce-images" name="Page-1"><mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1169" pageHeight="827" math="0" shadow="0"><root><mxCell id="0" /><mxCell id="1" parent="0" />${cell}</root></mxGraphModel></diagram></mxfile>`;
}

/** Append beside existing generated cells. The method intentionally accepts
 * plain mxGraph XML as well as our mxfile wrapper, which also makes imported,
 * uncompressed draw.io documents extendable. */
export function appendImageToDrawioCanvas(source: string, asset: DrawioImageAsset): string | null {
  if (!/<mxGraphModel\b/i.test(source) || !/<\/root>/i.test(source)) return null;
  const geometries = [...source.matchAll(/<mxGeometry\b[^>]*\bx="([\d.-]+)"[^>]*\by="([\d.-]+)"[^>]*\bwidth="([\d.-]+)"[^>]*\bheight="([\d.-]+)"/gi)];
  const right = geometries.reduce((maximum, match) => Math.max(maximum, Number(match[1]) + Number(match[3])), 0);
  const ids = [...source.matchAll(/\bid="image-(\d+)"/gi)].map((match) => Number(match[1]));
  const nextId = Math.max(0, ...ids) + 1;
  const cell = imageCell(asset, `image-${nextId}`, right ? right + GAP : 40, 40);
  return source.replace(/<\/root>/i, `${cell}</root>`);
}
