/**
 * Large-JSON projection. A head slice of a big JSON result hands the model the first
 * few rows and a broken bracket; it never learns what fields exist or how many rows it
 * missed. A projection keeps the SHAPE instead: every top-level key, nested values to a
 * bounded depth, arrays cut to their first items with an explicit count of the rest,
 * and long strings clipped with their length — so the model can re-call the tool with
 * the filter or limit it now knows it needs.
 */

export interface ProjectionStep {
  depth: number;
  arrayItems: number;
  stringChars: number;
}

/** Progressively tighter projections, tried in order until one fits. */
const STEPS: readonly ProjectionStep[] = [
  { depth: 4, arrayItems: 10, stringChars: 400 },
  { depth: 3, arrayItems: 5, stringChars: 200 },
  { depth: 2, arrayItems: 3, stringChars: 120 },
  { depth: 2, arrayItems: 1, stringChars: 80 },
  { depth: 1, arrayItems: 1, stringChars: 60 },
];

function describe(value: unknown): string {
  if (Array.isArray(value)) return `[array: ${value.length} items]`;
  if (value && typeof value === 'object') return `{object: ${Object.keys(value as object).length} keys}`;
  return String(value);
}

function projectValue(value: unknown, step: ProjectionStep, depth: number): unknown {
  if (typeof value === 'string') {
    return value.length > step.stringChars ? `${value.slice(0, step.stringChars)}…(+${value.length - step.stringChars} chars)` : value;
  }
  if (value === null || typeof value !== 'object') return value;
  if (depth >= step.depth) return describe(value);
  if (Array.isArray(value)) {
    const head = value.slice(0, step.arrayItems).map((v) => projectValue(v, step, depth + 1));
    if (value.length > step.arrayItems) head.push(`…(+${value.length - step.arrayItems} more of ${value.length} items)`);
    return head;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = projectValue(v, step, depth + 1);
  return out;
}

export interface JsonProjection {
  /** The projected value; `undefined` when no step fits. */
  value: unknown;
  /** JSON of the projection. */
  json: string;
  fits: boolean;
}

/**
 * Project `value` to fit `maxChars` of JSON. Top-level keys always survive (depth 0 is
 * never summarised away); arrays and strings shrink step by step until it fits.
 */
export function projectJson(value: unknown, maxChars: number): JsonProjection {
  let last: JsonProjection = { value: undefined, json: '', fits: false };
  for (const step of STEPS) {
    const projected = projectValue(value, step, 0);
    const json = JSON.stringify(projected);
    last = { value: projected, json, fits: json.length <= maxChars };
    if (last.fits) return last;
  }
  return last;
}
