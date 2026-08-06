import type { TabularSource } from './canvasTabularData';
import { toNumber } from './canvasTabularData';

/**
 * The geographic half of the Canvas data layer: turn tabular rows into plotted
 * points, and project those points into the flat coordinate space a card-sized SVG
 * can draw.
 *
 * Two decisions are worth stating, because both were the alternative to something
 * more obvious:
 *
 *  1. **No tile provider.** A slippy map means an external raster host on every
 *     render — blocked outright in a published artifact's CSP, a third-party
 *     request from a private canvas, and a broken grey square offline. The map
 *     instead draws its own graticule and, when the object carries one, a real
 *     GeoJSON boundary fetched once by `geo.geocode` and stored ON the object. So
 *     the card renders identically online, offline, and in an export.
 *  2. **Web Mercator, not raw lat/lng.** Plotting degrees directly squashes a
 *     US-state-sized extent noticeably north-south. Mercator's y transform is four
 *     lines and makes the shape read correctly at every latitude a user will plot.
 *     It is unusable at the poles, which is why {@link MAX_MERCATOR_LATITUDE} clamps
 *     rather than lets a ±90 row produce Infinity.
 */

/** Beyond this Mercator's y → ±∞. The standard web-map clamp. */
export const MAX_MERCATOR_LATITUDE = 85.05112878;

/** One plotted place. `value` drives marker size; `tone` drives marker colour. */
export type MapPoint = {
  label: string;
  lat: number;
  lng: number;
  value?: number;
  tone?: 'success' | 'warning' | 'danger' | 'info';
  detail?: string;
};

/** `[south, north, west, east]` — the order `geo.geocode` returns and the order a
 *  viewport is fitted to. */
export type GeoBounds = [number, number, number, number];

/** Column names, lowercased and stripped of separators, that hold each coordinate.
 *  Matched on the normalized name so `Latitude`, `lat_deg`, and `LAT` all resolve. */
const LATITUDE_NAMES = ['lat', 'latitude', 'latdeg', 'ycoord', 'y'];
const LONGITUDE_NAMES = ['lng', 'lon', 'long', 'longitude', 'lngdeg', 'londeg', 'xcoord', 'x'];
/** Preferred label columns, best first. Falls back to the first text column. */
const LABEL_NAMES = ['name', 'label', 'district', 'place', 'city', 'title', 'location', 'region', 'county', 'school', 'schooldistrict'];

function normalizeColumnName(column: string): string {
  return column.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findColumn(columns: readonly string[], candidates: readonly string[]): string | null {
  const normalized = columns.map((column) => [normalizeColumnName(column), column] as const);
  for (const candidate of candidates) {
    const hit = normalized.find(([name]) => name === candidate);
    if (hit) return hit[1];
  }
  return null;
}

export type GeoColumns = { latitude: string | null; longitude: string | null; label: string | null; value: string | null };

/**
 * Which columns of a tabular source carry geography.
 *
 * Returned as a description rather than applied silently, so a caller that finds no
 * coordinates can say WHICH columns it looked at — "no latitude/longitude columns;
 * available columns are …" is actionable, and "cannot plot" is not.
 */
export function detectGeoColumns(source: TabularSource, valueHint?: string): GeoColumns {
  const latitude = findColumn(source.columns, LATITUDE_NAMES);
  const longitude = findColumn(source.columns, LONGITUDE_NAMES);
  const label = findColumn(source.columns, LABEL_NAMES)
    ?? source.columns.find((column) => column !== latitude && column !== longitude && source.rows.some((row) => typeof row[column] === 'string' && String(row[column]).trim()))
    ?? null;
  const value = (valueHint && source.columns.includes(valueHint) ? valueHint : null)
    ?? source.columns.find((column) => column !== latitude && column !== longitude && column !== label && source.rows.some((row) => toNumber(row[column]) != null))
    ?? null;
  return { latitude, longitude, label, value };
}

/**
 * Build plottable points from rows. A row whose coordinates do not parse is DROPPED,
 * not defaulted — a failed geocode rendered at (0, 0) puts every unresolved place off
 * the coast of Africa, which reads as data rather than as a gap.
 */
export function mapPointsFromRows(source: TabularSource, columns: GeoColumns, limit = 500): MapPoint[] {
  const { latitude, longitude, label, value } = columns;
  if (!latitude || !longitude) return [];
  const points: MapPoint[] = [];
  for (const row of source.rows) {
    if (points.length >= limit) break;
    const lat = toNumber(row[latitude]);
    const lng = toNumber(row[longitude]);
    if (lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    const numericValue = value ? toNumber(row[value]) : null;
    points.push({
      label: label ? String(row[label] ?? '').slice(0, 120) : `${lat.toFixed(3)}, ${lng.toFixed(3)}`,
      lat,
      lng,
      ...(numericValue != null ? { value: numericValue } : {}),
    });
  }
  return points;
}

/** Coerce an unknown authored value to a finite number, or null. Separate from
 *  {@link toNumber} because that one is typed to tabular cells; this reads free-form
 *  LLM-authored JSON where a coordinate may arrive as `"42.3"`. */
function numeric(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Read a well-formed MapPoint array off an authored/LLM-supplied object field. */
export function sanitizeMapPoints(raw: unknown, limit = 500): MapPoint[] {
  if (!Array.isArray(raw)) return [];
  const tones = new Set(['success', 'warning', 'danger', 'info']);
  const points: MapPoint[] = [];
  for (const item of raw) {
    if (points.length >= limit) break;
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const lat = numeric(record.lat) ?? numeric(record.latitude);
    const lng = numeric(record.lng) ?? numeric(record.longitude) ?? numeric(record.lon);
    if (lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    const value = numeric(record.value);
    const tone = typeof record.tone === 'string' && tones.has(record.tone) ? record.tone as MapPoint['tone'] : undefined;
    const detail = typeof record.detail === 'string' && record.detail.trim() ? record.detail.trim().slice(0, 200) : undefined;
    points.push({
      label: String(record.label ?? record.name ?? `${lat.toFixed(3)}, ${lng.toFixed(3)}`).slice(0, 120),
      lat,
      lng,
      ...(value != null ? { value } : {}),
      ...(tone ? { tone } : {}),
      ...(detail ? { detail } : {}),
    });
  }
  return points;
}

/** Web Mercator y, normalized so the transform is monotonic in latitude. */
export function mercatorY(latitude: number): number {
  const clamped = Math.max(-MAX_MERCATOR_LATITUDE, Math.min(MAX_MERCATOR_LATITUDE, latitude));
  const radians = clamped * Math.PI / 180;
  return Math.log(Math.tan(Math.PI / 4 + radians / 2));
}

/**
 * The extent a viewport should cover: an explicit region when the object carries one,
 * otherwise the points' own bounds. A single point (or several at one spot) has zero
 * extent, so a minimum span is applied — without it the projection divides by zero and
 * one marker fills the card with no sense of where it is.
 */
export function geoBoundsFor(points: readonly MapPoint[], region?: GeoBounds | null, minimumSpan = 0.5): GeoBounds | null {
  if (region && region.every((value) => Number.isFinite(value))) {
    const [south, north, west, east] = region;
    if (north > south && east > west) return region;
  }
  if (!points.length) return null;
  let south = Infinity; let north = -Infinity; let west = Infinity; let east = -Infinity;
  for (const point of points) {
    south = Math.min(south, point.lat); north = Math.max(north, point.lat);
    west = Math.min(west, point.lng); east = Math.max(east, point.lng);
  }
  const latitudePad = Math.max((north - south) * 0.12, minimumSpan / 2);
  const longitudePad = Math.max((east - west) * 0.12, minimumSpan / 2);
  return [
    Math.max(-MAX_MERCATOR_LATITUDE, south - latitudePad),
    Math.min(MAX_MERCATOR_LATITUDE, north + latitudePad),
    Math.max(-180, west - longitudePad),
    Math.min(180, east + longitudePad),
  ];
}

export type ProjectedPoint = MapPoint & { x: number; y: number; radius: number };

export type MapProjection = {
  width: number;
  height: number;
  bounds: GeoBounds;
  points: ProjectedPoint[];
  /** Evenly spaced graticule lines, already projected. */
  graticule: { verticals: Array<{ x: number; lng: number }>; horizontals: Array<{ y: number; lat: number }> };
  project: (lat: number, lng: number) => { x: number; y: number };
};

/** Marker radii in SVG units. The small floor keeps a zero-valued place visible —
 *  "this district reported nothing" is data, and an invisible dot is not. */
const MIN_RADIUS = 2.6;
const MAX_RADIUS = 9;

/** Round to a readable graticule step for the given span (degrees). */
function graticuleStep(span: number): number {
  for (const step of [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30]) {
    if (span / step <= 6) return step;
  }
  return 45;
}

/**
 * Project points into an SVG viewBox. Pure and side-effect free so the renderer is a
 * thin `map()` over the result and the geometry itself is unit-tested rather than
 * eyeballed in a browser.
 */
export function projectMap(
  points: readonly MapPoint[],
  options: { width?: number; height?: number; region?: GeoBounds | null; padding?: number } = {},
): MapProjection | null {
  const width = options.width ?? 320;
  const height = options.height ?? 200;
  const padding = options.padding ?? 8;
  const bounds = geoBoundsFor(points, options.region ?? null);
  if (!bounds) return null;
  const [south, north, west, east] = bounds;
  const top = mercatorY(north);
  const bottom = mercatorY(south);
  const verticalSpan = top - bottom || 1;
  const horizontalSpan = east - west || 1;
  const innerWidth = Math.max(1, width - padding * 2);
  const innerHeight = Math.max(1, height - padding * 2);
  const project = (lat: number, lng: number) => ({
    x: padding + (lng - west) / horizontalSpan * innerWidth,
    y: padding + (top - mercatorY(lat)) / verticalSpan * innerHeight,
  });

  const values = points.map((point) => point.value).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const maxValue = values.length ? Math.max(...values) : 0;
  const minValue = values.length ? Math.min(...values) : 0;
  const valueSpan = maxValue - minValue;
  const projected: ProjectedPoint[] = points.map((point) => {
    const position = project(point.lat, point.lng);
    // Area-proportional, not radius-proportional: a value twice as large should look
    // twice as large, and radius-scaling exaggerates it to four times the ink.
    const ratio = valueSpan > 0 && typeof point.value === 'number' ? (point.value - minValue) / valueSpan : 0;
    const radius = values.length
      ? Math.sqrt(MIN_RADIUS ** 2 + ratio * (MAX_RADIUS ** 2 - MIN_RADIUS ** 2))
      : (MIN_RADIUS + MAX_RADIUS) / 2.6;
    return { ...point, ...position, radius };
  });

  const longitudeStep = graticuleStep(horizontalSpan);
  const latitudeStep = graticuleStep(north - south || 1);
  const verticals: Array<{ x: number; lng: number }> = [];
  for (let lng = Math.ceil(west / longitudeStep) * longitudeStep; lng <= east; lng += longitudeStep) {
    verticals.push({ lng: Number(lng.toFixed(4)), x: project(south, lng).x });
  }
  const horizontals: Array<{ y: number; lat: number }> = [];
  for (let lat = Math.ceil(south / latitudeStep) * latitudeStep; lat <= north; lat += latitudeStep) {
    horizontals.push({ lat: Number(lat.toFixed(4)), y: project(lat, west).y });
  }

  return { width, height, bounds, points: projected, graticule: { verticals, horizontals }, project };
}

/** A boundary as flat rings of `[longitude, latitude]` pairs — the FLAT form, and the
 *  form an outline is stored in on a canvas object. */
export type OutlineRings = number[][][];

/** True for `[[[lng, lat], …], …]` — an already-flattened ring list. */
function isRingList(value: unknown): value is OutlineRings {
  return Array.isArray(value) && value.every((ring) => Array.isArray(ring) && ring.every((position) => Array.isArray(position) && position.length >= 2));
}

/**
 * Normalize any boundary shape into flat rings.
 *
 * Accepts what `geo.geocode` returns — a bare geometry, a Feature, or a
 * FeatureCollection — AND the flattened form already stored on an object. The flat form
 * is canonical on the object for a concrete reason: the shared authored-patch sanitizer
 * drops values nested deeper than four levels, and a GeoJSON **MultiPolygon**'s
 * positions sit exactly one level past that. Michigan is a MultiPolygon (two peninsulas
 * plus islands), so storing raw GeoJSON would have silently emptied the outline for the
 * very shape that motivated it.
 */
export function outlineRings(outline: unknown, maxRings = 400): OutlineRings {
  if (isRingList(outline)) return outline.slice(0, maxRings);
  const rings: OutlineRings = [];
  const collectGeometry = (geometry: unknown): void => {
    if (rings.length >= maxRings || !geometry || typeof geometry !== 'object') return;
    const node = geometry as { type?: unknown; coordinates?: unknown; geometry?: unknown; geometries?: unknown; features?: unknown };
    if (Array.isArray(node.features)) { node.features.forEach(collectGeometry); return; }
    if (Array.isArray(node.geometries)) { node.geometries.forEach(collectGeometry); return; }
    if (node.geometry) { collectGeometry(node.geometry); return; }
    const coordinates = node.coordinates;
    if (!Array.isArray(coordinates)) return;
    switch (node.type) {
      case 'Polygon': coordinates.forEach((ring) => { if (Array.isArray(ring)) rings.push(ring as number[][]); }); break;
      case 'MultiPolygon': coordinates.forEach((polygon) => { if (Array.isArray(polygon)) polygon.forEach((ring) => { if (Array.isArray(ring)) rings.push(ring as number[][]); }); }); break;
      case 'LineString': rings.push(coordinates as number[][]); break;
      case 'MultiLineString': coordinates.forEach((line) => { if (Array.isArray(line)) rings.push(line as number[][]); }); break;
      default: break;
    }
  };
  collectGeometry(outline);
  return rings.slice(0, maxRings);
}

/**
 * SVG path data for a boundary, projected through the same transform as the points so
 * the outline and the markers cannot disagree.
 */
export function outlinePaths(outline: unknown, project: (lat: number, lng: number) => { x: number; y: number }, maxRings = 400): string[] {
  return outlineRings(outline, maxRings).flatMap((ring) => {
    const commands: string[] = [];
    for (const position of ring) {
      // GeoJSON is [longitude, latitude] — the reverse of every other coordinate pair
      // in this file, and the single most common way an outline lands sideways.
      const lng = Number(position?.[0]);
      const lat = Number(position?.[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const { x, y } = project(lat, lng);
      commands.push(`${commands.length ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`);
    }
    return commands.length > 1 ? [`${commands.join(' ')} Z`] : [];
  });
}

/** Read a `[south, north, west, east]` region off an authored object field, or null.
 *  Also accepts `geo.geocode`'s `boundingBox` verbatim, which is the same order — so a
 *  region can be pasted straight from a lookup without a transform step to get wrong. */
export function sanitizeGeoBounds(raw: unknown): GeoBounds | null {
  if (!Array.isArray(raw) || raw.length !== 4) return null;
  const [south, north, west, east] = raw.map((value) => numeric(value));
  if (south == null || north == null || west == null || east == null) return null;
  if (Math.abs(south) > 90 || Math.abs(north) > 90 || Math.abs(west) > 180 || Math.abs(east) > 180) return null;
  return north > south && east > west ? [south, north, west, east] : null;
}
