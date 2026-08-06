/**
 * Reading a mesh once, and re-drawing it from wherever the camera ends up.
 *
 * The 3D canvas shows a generated model as a picture on its card. A picture taken
 * at a fixed angle is a photograph of the object: the scene turns and the model
 * does not. So the mesh is parsed ONCE per exported file and kept, and only the
 * projection — cheap, pure, deterministic — is redone when the camera settles.
 *
 * Two caches, because they expire for different reasons: the triangles belong to
 * the file and never change, while a projection belongs to an angle and is only
 * worth keeping for as long as the user keeps returning to it.
 */
import {
  meshFormatFromHint,
  meshPreviewSvg,
  parseMeshTriangles,
  svgDataUrl,
  type GeometryTriangle,
} from './creativeGeometry';

/**
 * The most facets a preview tile is drawn from.
 *
 * A tile is a couple of hundred pixels tall, so past this the extra triangles are
 * smaller than a pixel and cost only document size. A denser mesh is sampled at an
 * even stride, which keeps the silhouette and the shading honest rather than
 * cropping the model to its first few thousand facets.
 */
const MAX_PREVIEW_FACETS = 4000;
/** Angles are cached to the degree; finer than that is invisible and unbounded. */
const ANGLE_PRECISION = 1;
const MAX_PROJECTIONS = 240;

const meshes = new Map<string, Promise<readonly GeometryTriangle[]>>();
const projections = new Map<string, string>();

function sample(triangles: readonly GeometryTriangle[]): readonly GeometryTriangle[] {
  if (triangles.length <= MAX_PREVIEW_FACETS) return triangles;
  const stride = triangles.length / MAX_PREVIEW_FACETS;
  return Array.from({ length: MAX_PREVIEW_FACETS }, (_, index) => triangles[Math.floor(index * stride)]!);
}

/**
 * The triangles of the mesh at `url`, read at most once per URL.
 *
 * Resolves to an empty list rather than rejecting: a model in a container this
 * cannot read, or a file that will not load, is a card that keeps whatever static
 * preview it already had — never a broken view.
 */
export function loadMeshTriangles(url: string, formatHint?: string): Promise<readonly GeometryTriangle[]> {
  const cached = meshes.get(url);
  if (cached) return cached;
  const pending = (async () => {
    try {
      const response = await fetch(url);
      if (!response.ok) return [];
      const buffer = await response.arrayBuffer();
      const format = meshFormatFromHint(formatHint ?? '') ?? meshFormatFromHint(url);
      return sample(parseMeshTriangles(buffer, format));
    } catch {
      return [];
    }
  })();
  meshes.set(url, pending);
  return pending;
}

/**
 * The mesh at `url` drawn from the given camera angle, as an image data URL.
 *
 * Keyed on the file and the angle, so orbiting back to an angle already seen costs
 * a map lookup. Null when there is nothing readable to draw.
 */
export function meshProjectionUrl(
  url: string,
  triangles: readonly GeometryTriangle[],
  yaw: number,
  pitch: number,
): string | null {
  if (!triangles.length) return null;
  const key = `${url}@${yaw.toFixed(ANGLE_PRECISION)}/${pitch.toFixed(ANGLE_PRECISION)}`;
  const cached = projections.get(key);
  if (cached) return cached;
  const svg = meshPreviewSvg(triangles, { yaw, pitch });
  if (!svg) return null;
  const dataUrl = svgDataUrl(svg);
  // Oldest first: a Map preserves insertion order, so the entry the user orbited
  // away from longest ago is the one that goes.
  if (projections.size >= MAX_PROJECTIONS) {
    const oldest = projections.keys().next().value;
    if (oldest !== undefined) projections.delete(oldest);
  }
  projections.set(key, dataUrl);
  return dataUrl;
}
